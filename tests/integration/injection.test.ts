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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let memories: MemoryService;
let injector: ContextInjector;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-inj-int-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), MIGRATION_003_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memories = new MemoryService(store);
	injector = new ContextInjector(memories);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ContextInjector integration with real MemoryService", () => {
	it("onSystemTransform injects a saved error lesson", () => {
		memories.save({
			type: "error",
			content: "typecheck no-unused-vars: fix the unused import",
			scope: "project",
		});

		const output = { system: ["base"] };
		injector.onSystemTransform(
			{ messages: [{ role: "user", content: "fix the typecheck error" }] },
			output,
		);

		expect(output.system.length).toBe(2);
		expect(output.system[1]).toContain("<kevin-context>");
		expect(output.system[1]).toContain("typecheck no-unused-vars");
	});

	it("onCompacting injects memories into output.context", () => {
		memories.save({
			type: "decision",
			content: "usamos vitest para los tests del proyecto",
			scope: "project",
		});

		const output = { context: [] };
		injector.onCompacting(
			{
				sessionID: "s1",
				messages: [{ role: "user", content: "how do I handle tests" }],
			},
			output,
		);

		expect(output.context.length).toBe(1);
		expect(output.context[0]).toContain("<kevin-memory>");
		expect(output.context[0]).toContain("usamos vitest");
	});

	it("does not inject when no relevant memories exist", () => {
		memories.save({
			type: "context",
			content: "completely unrelated topic about cooking pasta",
			scope: "project",
		});

		const sysOut = { system: ["base"] };
		injector.onSystemTransform(
			{ messages: [{ role: "user", content: "fix typecheck error" }] },
			sysOut,
		);
		expect(sysOut.system.length).toBe(1);

		const compactOut = { context: [] };
		injector.onCompacting(
			{
				sessionID: "s1",
				messages: [{ role: "user", content: "fix typecheck error" }],
			},
			compactOut,
		);
		expect(compactOut.context.length).toBe(0);
	});

	it("respects token budget (system transform 1500 tokens ~ 6000 chars)", () => {
		for (let i = 0; i < 5; i++) {
			memories.save({
				type: "error",
				content: `error fix ${"x".repeat(2000)} marker${i}`,
				scope: "project",
			});
		}

		const output: { system: string[] } = { system: [] };
		injector.onSystemTransform(
			{ messages: [{ role: "user", content: "fix error" }] },
			output,
		);

		expect(output.system.length).toBe(1);
		const injected = output.system[0];
		expect(injected.length).toBeLessThan(6200);
	});
});
