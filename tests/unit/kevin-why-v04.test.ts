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
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { kevinWhy } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let mem: MemoryService;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-why-"));
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
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function seedPattern(
	fp: string,
	evidence: number,
	recurrence: number,
	fixArgs: string | null,
	lesson = "When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
): void {
	const errorId = mem.save({
		type: "error",
		content: lesson,
		scope: "project",
		origin: "reflector",
		fingerprint: fp,
		projectId: "proj-A",
		relevanceScore: 0.5,
	});
	if (fixArgs) {
		store
			.prepare("UPDATE memories SET fix_args = ? WHERE id = ?")
			.run(fixArgs, errorId);
	}
	mem.promoteToPattern(errorId, evidence, recurrence);
}

describe("K4-020 — kevin_why honest output", () => {
	it("exposes recurrence_count and fix_args with two-sided confidence", () => {
		seedPattern("aaaaaaaaaaaaaaaa", 1, 2, 'bash with args "npm i -g rg"');
		const why = kevinWhy(store, "TS2304");
		expect(why).not.toBeNull();
		expect(why?.recurrence_count).toBe(2);
		expect(why?.fix_args).toBe('bash with args "npm i -g rg"');
		expect(why?.evidence_count).toBe(1);
		// computeConfidence(1, 2) = 0.5 + 0.1 - 0.3 = 0.3
		expect(why?.confidence).toBeCloseTo(0.3, 5);
	});

	it("recurrence > 0 → 'resolved in N of M attempts' phrasing", () => {
		seedPattern("bbbbbbbbbbbbbbbb", 3, 1, 'bash with args "npm i -g rg"');
		const why = kevinWhy(store, "TS2304");
		expect(why).not.toBeNull();
		expect(why?.summary).toContain("resolved in 3 of 4 attempts");
		expect(why?.summary).toContain('by fixing bash with args "npm i -g rg"');
		expect(why?.summary).not.toContain("consistently");
	});

	it("recurrence = 0 → legacy templated phrasing, no attempts wording", () => {
		seedPattern("cccccccccccccccc", 1, 0, null);
		const why = kevinWhy(store, "TS2304");
		expect(why).not.toBeNull();
		expect(why?.summary).not.toContain("attempts");
		expect(why?.summary).toMatch(/resolved by fixing/);
		expect(why?.recurrence_count).toBe(0);
		expect(why?.fix_args).toBeNull();
	});

	it("no fix_args → falls back to related_rules, then the underlying issue", () => {
		seedPattern("dddddddddddddddd", 2, 1, null);
		const withCode = kevinWhy(store, "TS2304");
		expect(withCode?.summary).toContain("by fixing import or typo");

		seedPattern(
			"eeeeeeeeeeeeeeee",
			1,
			1,
			null,
			"When bash fails with fetch failed: connection reset.",
		);
		const withoutCode = kevinWhy(store, "fetch failed");
		expect(withoutCode).not.toBeNull();
		expect(withoutCode?.summary).toContain("the underlying issue");
	});
});
