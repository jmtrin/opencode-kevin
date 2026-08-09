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
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "migrations", "005_v04_signal.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let mem: MemoryService;
let ledger: InjectionLedger;
let injector: ContextInjector;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-sugg-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const [name, sql] of [
		["001_initial.sql", SQL_001],
		["003_v02_signal.sql", SQL_003],
		["004_v03_knowledge.sql", SQL_004],
		["005_v04_signal.sql", SQL_005],
	]) {
		writeFileSync(join(migrationsDir, name), sql);
	}
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	mem = new MemoryService(store);
	ledger = new InjectionLedger(store);
	injector = new ContextInjector(mem, null, ledger);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

const FP = "aaaaaaaaaaaaaaaa";
const LESSON =
	"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.\nSuggestion: Install or use the tool before running this command.";

/** Creates a causal pattern for FP with the given fix_args (or none). */
function seedPattern(fixArgs: string | null): void {
	const errorId = mem.save({
		type: "error",
		content: LESSON,
		scope: "project",
		origin: "reflector",
		fingerprint: FP,
		projectId: "proj-A",
		relevanceScore: 0.5,
	});
	if (fixArgs) {
		store
			.prepare("UPDATE memories SET fix_args = ? WHERE id = ?")
			.run(fixArgs, errorId);
	}
	mem.promoteToPattern(errorId, 1, 0);
}

/** Inserts `n` failing tool_calls for FP in the session (recurrences). */
function seedRecurrences(sessionId: string, n: number): void {
	const insert = store.prepare(
		`INSERT INTO tool_calls
		 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, error_fingerprint)
		 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 0, 5, null, 'TS2304', '{}', 'proj-A', ?)`,
	);
	for (let i = 0; i < n; i++) {
		insert.run(`${sessionId}-recur-${i}`, sessionId, FP);
	}
}

describe("K4-016 — smarter HITL suggestion", () => {
	it("block contains pattern text, exact recurrence count, fix_args and confidence", () => {
		seedPattern('bash with args "npm i -g rg"');
		seedRecurrences("sess-1", 4);
		injector.setRecurrences(4, "sess-1");

		const block = injector.generateSuggestion();
		expect(block).toContain('The error pattern "When bash fails with TS2304');
		expect(block).toContain("recurred 4 time(s) this session.");
		expect(block).toContain('Observed fix: bash with args "npm i -g rg"');
		expect(block).toContain("(1 confirmed fix, confidence 60%).");
	});

	it("AGENTS.md draft line derives from the lesson Suggestion text", () => {
		seedPattern('bash with args "npm i -g rg"');
		seedRecurrences("sess-1", 2);
		injector.setRecurrences(2, "sess-1");

		const block = injector.generateSuggestion();
		expect(block).toContain(
			"- Install or use the tool before running this command.",
		);
		expect(block).not.toContain("## Recurring pattern");
	});

	it("without fix_args: names pattern + count, omits the fix line", () => {
		seedPattern(null);
		seedRecurrences("sess-1", 3);
		injector.setRecurrences(3, "sess-1");

		const block = injector.generateSuggestion();
		expect(block).toContain('The error pattern "When bash fails with TS2304');
		expect(block).toContain("recurred 3 time(s) this session.");
		expect(block).not.toContain("Observed fix:");
	});

	it("never emits 'the same error pattern' — fallback names the count", () => {
		// No pattern memory exists for the recurred fingerprint.
		seedRecurrences("sess-1", 2);
		injector.setRecurrences(2, "sess-1");

		const block = injector.generateSuggestion();
		expect(block).not.toContain("the same error pattern");
		expect(block).toContain("recurred 2 time(s) this session.");
	});

	it("resets after one emission", () => {
		seedPattern(null);
		seedRecurrences("sess-1", 1);
		injector.setRecurrences(1, "sess-1");

		expect(injector.generateSuggestion()).not.toBe("");
		expect(injector.generateSuggestion()).toBe("");
	});
});
