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
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Reflector } from "../../plugin/Reflector.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let memories: MemoryService;
let reflector: Reflector;
let injector: ContextInjector;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-e2e-inj-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memories = new MemoryService(store);
	reflector = new Reflector(memories);
	injector = new ContextInjector(memories);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("e2e — reflection → next session → context injection", () => {
	it("injects a lesson from session 1 into session 2 system prompt", async () => {
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
				messages: [{ role: "user", content: "fix typecheck" }],
			},
			output,
		);

		expect(output.system.length).toBe(2);
		const injected = output.system[1];
		expect(injected).toContain("<kevin-context>");
		expect(injected).toContain("Verify types and imports");
		expect(injected).toContain("[error]");
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
						content: "the typecheck keeps failing on this build",
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
	});
});
