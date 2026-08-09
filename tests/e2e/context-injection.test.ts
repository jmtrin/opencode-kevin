import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextInjector } from "../../plugin/ContextInjector.js";
import { InjectionLedger } from "../../plugin/InjectionLedger.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Reflector } from "../../plugin/Reflector.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const MIGRATION_003_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);
const MIGRATION_004_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const MIGRATION_005_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "005_v04_signal.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let memories: MemoryService;
let reflector: Reflector;
let injector: ContextInjector;
let ledger: InjectionLedger;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-e2e-inj-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), MIGRATION_003_SQL);
	writeFileSync(
		join(migrationsDir, "004_v03_knowledge.sql"),
		MIGRATION_004_SQL,
	);
	// v0.4.0 (K4-017): the fixture now runs migration 005 so kevin_injections
	// and kevin_settings exist (quality gate + ledger paths are exercised).
	writeFileSync(join(migrationsDir, "005_v04_signal.sql"), MIGRATION_005_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memories = new MemoryService(store);
	reflector = new Reflector(memories);
	ledger = new InjectionLedger(store);
	injector = new ContextInjector(memories, null, ledger);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("e2e — reflection → next session → context injection", () => {
	it("injects a snippet lesson from session 1 into session 2 system prompt", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "npm run typecheck",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-1",
		});

		const output = { system: ["You are a helpful assistant."] };
		injector.onSystemTransform(
			{
				sessionID: "sess-2",
				messages: [{ role: "user", content: "fix TS2304 error" }],
			},
			output,
		);

		expect(output.system.length).toBe(2);
		const injected = output.system[1];
		// v0.4.0 (K4-012/K4-017): snippet payload — id: line + [type]
		// prefix + first 2 lines, wrapped in <protect>.
		expect(injected).toContain("<kevin-context>");
		expect(injected).toContain("id: ");
		expect(injected).toContain("[error]");
		expect(injected).toContain("<protect>");
		expect(injected).toContain("Verify types and imports");
		expect(injected).not.toContain("</protect>\n</protect>");

		// v0.4.0 (K4-017): one ledger row per injected memory.
		const rows = ledger.rowsForSession("sess-2");
		expect(rows.length).toBe(1);
		expect(rows[0].hook).toBe("pre_prompt");
		expect(rows[0].outcome).toBe("unmeasured");
		expect(rows[0].memory_id).toBeDefined();
		expect(rows[0].tokens).toBeGreaterThan(0);
	});

	it("BUG-015 — agent-saved memories without fingerprint produce no ledger row", () => {
		// A context note saved by the agent has no fingerprint (save()
		// only derives one for error rows). It is still injected — the
		// agent explicitly asked to remember it — but an unmeasurable
		// ledger row ('' fingerprint) would settle `effective` forever
		// and inflate precision_rate, so it must be skipped.
		memories.save({
			type: "context",
			content: "agent note about the build tooling",
			scope: "project",
			sourceTool: "kevin_save",
		});

		const output = { system: [] as string[] };
		injector.onSystemTransform(
			{
				sessionID: "sess-nofp",
				messages: [{ role: "user", content: "build tooling" }],
			},
			output,
		);
		expect(output.system.length).toBe(1);
		expect(output.system[0]).toContain("agent note about the build tooling");
		expect(ledger.rowsForSession("sess-nofp").length).toBe(0);
	});

	it("lesson appears proactively before the agent acts (no explicit request)", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'bar'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-a",
		});

		const output = { system: [] };
		injector.onSystemTransform(
			{
				sessionID: "sess-b",
				messages: [
					{
						role: "user",
						content: "the TS2304 error keeps failing on this build",
					},
				],
			},
			output,
		);

		expect(output.system.length).toBe(1);
		expect(output.system[0]).toContain("Verify types and imports");
	});

	it("does not inject unrelated lessons when query does not match", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'baz'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-x",
		});

		const output = { system: [] };
		injector.onSystemTransform(
			{
				sessionID: "sess-y",
				messages: [{ role: "user", content: "cook pasta recipe dinner" }],
			},
			output,
		);

		expect(output.system.length).toBe(0);
		expect(ledger.rowsForSession("sess-y").length).toBe(0);
	});

	it("does not re-inject the same memory twice in one session (seen-set)", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "npm run build",
			stderr: "error TS2322: Type 'string' is not assignable to type 'number'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-1",
		});

		const output = { system: [] };
		injector.onSystemTransform(
			{
				sessionID: "sess-2",
				messages: [{ role: "user", content: "fix the TS2322 error" }],
			},
			output,
		);
		expect(output.system.length).toBe(1);

		const second = { system: [] };
		injector.onSystemTransform(
			{
				sessionID: "sess-2",
				messages: [{ role: "user", content: "still failing TS2322 build" }],
			},
			second,
		);
		expect(second.system.length).toBe(0);
		expect(ledger.rowsForSession("sess-2").length).toBe(1);

		// A new session re-injects (per-session seen-set).
		injector.onSessionCreated("sess-3");
		const third = { system: [] };
		injector.onSystemTransform(
			{
				sessionID: "sess-3",
				messages: [{ role: "user", content: "TS2322 still failing" }],
			},
			third,
		);
		expect(third.system.length).toBe(1);
	});

	it("gate blocks unresolved lessons (dispatch with no code) from injection", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "something went horribly wrong during the operation",
			stdout: "",
			exitCode: 1,
			errorType: "unknown",
			sessionId: "sess-1",
		});

		const output = { system: [] };
		injector.onSystemTransform(
			{
				sessionID: "sess-2",
				messages: [
					{
						role: "user",
						content: "the operation went horribly wrong again",
					},
				],
			},
			output,
		);

		expect(output.system.length).toBe(0);
		expect(ledger.rowsForSession("sess-2").length).toBe(0);
	});
});
