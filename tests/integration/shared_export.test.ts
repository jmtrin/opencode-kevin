import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { SharedLayer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { fnv1a64 } from "@jmtrin/kevin-core";
import { type OkfEntry, computeEntryId, serialize } from "@jmtrin/kevin-core";

const REPO_A = "aaaaaaaaaaaaaaaa";
const REPO_B = "bbbbbbbbbbbbbbbb";
const PROJECT = "cccccccccccccccc";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-shared-export-"));
	drops = [];
});

afterEach(() => {
	for (const d of [...drops, tmpRoot]) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
});

function makeMigrationsDir(): string {
	const dir = join(tmpRoot, "migrations");
	mkdirSync(dir, { recursive: true });
	for (const file of readdirSync(join(process.cwd(), "packages/core/migrations"))) {
		if (file.startsWith("00") || file === "009_v08_team.sql") {
			copyFileSync(join(process.cwd(), "packages/core/migrations", file), join(dir, file));
		}
	}
	return dir;
}

async function openMigrated(): Promise<Store> {
	const store = new Store({ path: join(tmpRoot, "kevin.db") });
	await new Migrate(store, makeMigrationsDir()).run();
	return store;
}

function layer(store: Store): SharedLayer {
	return new SharedLayer({
		store,
		repoId: REPO_A,
		projectId: PROJECT,
		version: "0.8.0",
		writer: new ArtifactWriter(store, "test-project"),
	});
}

function entry(
	statement: string,
	evidence = 1,
	scope: string | null = null,
): OkfEntry {
	return {
		entry_id: computeEntryId("rule", statement, scope),
		type: "rule",
		statement,
		scope,
		evidence,
		recurrence: 0,
		origin: "pattern",
		author_hash: "3c9ab8d2f7e14a05",
		op: "assert",
		created_at: "2026-08-01T00:00:00Z",
		supersedes: null,
	};
}

function seedMemory(
	store: Store,
	opts: {
		id: string;
		content: string;
		evidence?: number;
		recurrence?: number;
		curated?: number;
		origin?: string;
	} = { id: "mem-1", content: "seed memory", evidence: 3 },
): void {
	store
		.prepare(
			`INSERT INTO memories
			 (id, type, content, scope, relevance_score, project_id,
			  evidence_count, recurrence_count, created_at, updated_at,
			  status, curated, inferable, origin, layer, repo_id)
			 VALUES (?, 'rule', ?, 'project', 0.3, ?, ?, ?, datetime('now'),
			  datetime('now'), 'active', ?, 1, ?, 'local', ?)`,
		)
		.run(
			opts.id,
			opts.content,
			PROJECT,
			opts.evidence ?? 3,
			opts.recurrence ?? 0,
			opts.curated ?? 1,
			opts.origin ?? "pattern",
			REPO_A,
		);
}

function setSetting(store: Store, key: string, value: string): void {
	store
		.prepare(
			"INSERT INTO kevin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run(key, value);
}

function fileHash(path: string): string {
	return fnv1a64(readFileSync(path, "utf8"));
}

function refusedPlan(plan: {
	write: { outcome: string; reason?: string };
}): void {
	expect(plan.write.outcome).toBe("refused");
	expect(plan.write.reason).toBeTypeOf("string");
}

describe("K8-020 — planExport/applyExport/planTombstone (plan §5.5)", () => {
	it("planExport is pure: no write, no mtime change; the diff contains only added lines", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(
			okfPath,
			serialize([entry("existing rule")], REPO_A, "0.8.0"),
		);
		seedMemory(store, { id: "mem-1", content: "brand new rule", evidence: 3 });
		const beforeHash = fileHash(okfPath);
		const beforeMtime = statSync(okfPath).mtimeMs;

		const plan = sl.planExport(["mem-1"], okfPath);
		expect(plan.entriesAdded).toBe(1);
		expect(plan.write.outcome).toBe("written");
		expect(fileHash(okfPath)).toBe(beforeHash);
		expect(statSync(okfPath).mtimeMs).toBe(beforeMtime);

		const diffLines = plan.write.diff.split("\n");
		const changeLines = diffLines.filter(
			(l) =>
				!l.startsWith("@@") && !l.startsWith("---") && !l.startsWith("+++"),
		);
		expect(changeLines.some((l) => l.startsWith("+"))).toBe(true);
		expect(changeLines.some((l) => l.startsWith("-"))).toBe(false);
		expect(diffLines[0].startsWith("---")).toBe(true);
		expect(diffLines[1].startsWith("+++")).toBe(true);
		expect(diffLines[2].startsWith("@@")).toBe(true);

		const applied = sl.applyExport(plan);
		expect(applied.applied).toBe("written");
		expect(plan.write.after).toBe(readFileSync(okfPath, "utf8"));
	});

	it("a missing file is created by the export", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		seedMemory(store, { id: "mem-1", content: "first rule", evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		expect(plan.write.outcome).toBe("written");
		expect(sl.applyExport(plan).applied).toBe("written");
		expect(fileHash(okfPath)).toBe(fnv1a64(plan.write.after));
	});

	it("exporting the same candidates twice is a noop on the second call", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		seedMemory(store, { id: "mem-1", content: "stable rule", evidence: 3 });

		const first = sl.planExport(["mem-1"], okfPath);
		expect(sl.applyExport(first).applied).toBe("written");

		const second = sl.planExport(["mem-1"], okfPath);
		expect(second.entriesAdded).toBe(0);
		expect(second.write.outcome).toBe("noop");
		expect(sl.applyExport(second).applied).toBe("noop");
		expect(second.write.before).toBe(second.write.after);
	});

	it("an updated memory rewrites its line but adds no new entry", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		seedMemory(store, { id: "mem-1", content: "evolving rule", evidence: 2 });
		expect(sl.applyExport(sl.planExport(["mem-1"], okfPath)).applied).toBe(
			"written",
		);

		store
			.prepare(
				"UPDATE memories SET evidence_count = 5 WHERE id = 'mem-1' AND repo_id = ?",
			)
			.run(REPO_A);
		const again = sl.planExport(["mem-1"], okfPath);
		expect(again.entriesAdded).toBe(0);
		expect(again.write.outcome).toBe("written");
		expect(again.write.diff).toContain('"evidence":5');
	});

	it("refuses not_okf: the file exists and its first line is not `#okf `", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, "this is not an okf file\n");
		seedMemory(store, { id: "mem-1", content: "candidate", evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("not_okf");
	});

	it("refuses version_ahead: the file declares a future format", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, "#okf 99\n#repo aaaaaaaaaaaaaaaa\n");
		seedMemory(store, { id: "mem-1", content: "candidate", evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("version_ahead");
	});

	it("refuses repo_mismatch: the file belongs to another repository", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, serialize([entry("other repo")], REPO_B, "0.8.0"));
		seedMemory(store, { id: "mem-1", content: "candidate", evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("repo_mismatch");
	});

	it("refuses line_too_long: a candidate canonicalizes over MAX_LINE_BYTES", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		seedMemory(store, { id: "mem-1", content: "a".repeat(5000), evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("line_too_long");
	});

	it("refuses below_floor: the candidate's confidence is under shared_confidence_floor", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		seedMemory(store, { id: "mem-1", content: "weak rule", evidence: 0 });

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("below_floor");
	});

	it("below_floor clamps the floor to [0, 1] and defaults to 0.7 on NaN", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		seedMemory(store, { id: "mem-1", content: "weak rule", evidence: 0 });

		setSetting(store, "shared_confidence_floor", "not-a-number");
		expect(sl.planExport(["mem-1"], okfPath).write.reason).toBe("below_floor");

		setSetting(store, "shared_confidence_floor", "0.3");
		expect(sl.planExport(["mem-1"], okfPath).write.outcome).toBe("written");

		setSetting(store, "shared_confidence_floor", "3");
		expect(sl.planExport(["mem-1"], okfPath).write.reason).toBe("below_floor");
	});

	it("refuses not_curated only when share_requires_approval is the string '1'", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		seedMemory(store, {
			id: "mem-1",
			content: "uncurated rule",
			evidence: 3,
			curated: 0,
		});

		expect(sl.planExport(["mem-1"], okfPath).write.reason).toBe("not_curated");

		setSetting(store, "share_requires_approval", "0");
		expect(sl.planExport(["mem-1"], okfPath).write.outcome).toBe("written");
	});

	it("refuses parse_damaged: the file produced a rejected line; nothing is overwritten", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		const good = entry("intact rule");
		writeFileSync(
			okfPath,
			`${serialize([good], REPO_A, "0.8.0")}{"this is":"not json"}\n`,
		);
		seedMemory(store, { id: "mem-1", content: "candidate", evidence: 3 });
		const before = fileHash(okfPath);

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("parse_damaged");
		expect(fileHash(okfPath)).toBe(before);
		expect(plan.write.before).toBe(plan.write.after);
	});

	it("refuses too_many_entries: the merged corpus exceeds MAX_ENTRIES", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		const corpus = Array.from({ length: 2000 }, (_, i) => entry(`rule ${i}`));
		writeFileSync(okfPath, serialize(corpus, REPO_A, "0.8.0"));
		seedMemory(store, { id: "mem-1", content: "one too many", evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("too_many_entries");
	});

	it("refused plans record both hashes through the writer (after === before)", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, "garbage\n");
		seedMemory(store, { id: "mem-1", content: "candidate", evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		refusedPlan(plan);
		expect(sl.applyExport(plan).applied).toBe("refused");
		expect(plan.write.hashBefore).toBe(plan.write.hashAfter);
		const rows = store
			.prepare(
				"SELECT reason, hash_before, hash_after FROM artifact_writes WHERE path = ? ORDER BY id DESC LIMIT 1",
			)
			.all(okfPath) as Array<{
			reason: string;
			hash_before: string;
			hash_after: string;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].reason).toBe("not_okf");
		expect(rows[0].hash_before).toBe(rows[0].hash_after);
	});

	it("planTombstone replaces a present entry with a tombstone line and removes none", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		const e1 = entry("doomed rule", 1, "project");
		const e2 = entry("surviving rule", 1, "project");
		writeFileSync(okfPath, serialize([e1, e2], REPO_A, "0.8.0"));
		sl.import(okfPath);
		const before = readFileSync(okfPath, "utf8");

		const plan = sl.planTombstone([e1.entry_id], okfPath);
		expect(plan.write.outcome).toBe("written");
		expect(plan.entriesAdded).toBe(0);
		expect(sl.applyExport(plan).applied).toBe("written");

		const after = readFileSync(okfPath, "utf8");
		expect(after).toContain(`"entry_id":"${e1.entry_id}"`);
		expect(after).toContain('"op":"tombstone"');
		expect(after).toContain(`"entry_id":"${e2.entry_id}"`);
		expect(after).toContain('"op":"assert"');
		expect(after.split("\n").length).toBe(before.split("\n").length);
	});

	it("planTombstone appends a tombstone line when the entry's line is gone; the count grows", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		const e1 = entry("kept rule", 1, "project");
		const e2 = entry("kept rule two", 1, "project");
		const e3 = entry("deleted elsewhere rule", 1, "project");
		writeFileSync(okfPath, serialize([e1, e2, e3], REPO_A, "0.8.0"));
		sl.import(okfPath);
		// A teammate removed the line on their side; our projection survives.
		writeFileSync(okfPath, serialize([e1, e2], REPO_A, "0.8.0"));
		const linesBefore = readFileSync(okfPath, "utf8").split("\n").length;

		const plan = sl.planTombstone([e3.entry_id], okfPath);
		expect(plan.write.outcome).toBe("written");
		expect(plan.entriesAdded).toBe(1);
		expect(sl.applyExport(plan).applied).toBe("written");

		const after = readFileSync(okfPath, "utf8");
		expect(after.split("\n").length).toBe(linesBefore + 1);
		expect(after).toContain(`"entry_id":"${e1.entry_id}"`);
		expect(after).toContain(`"entry_id":"${e2.entry_id}"`);
		expect(after).toContain(`"entry_id":"${e3.entry_id}"`);
		expect(after).toContain('"op":"tombstone"');
	});

	it("planTombstone refuses an entry id with no local projection", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, serialize([entry("existing")], REPO_A, "0.8.0"));

		const plan = sl.planTombstone(
			["0000000000000000000000000000000000000000"],
			okfPath,
		);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("unknown_entry");
	});

	it("planTombstone refuses damaged files instead of rewriting them", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, serialize([entry("intact")], REPO_A, "0.8.0"));
		sl.import(okfPath);
		writeFileSync(okfPath, `${readFileSync(okfPath, "utf8")}broken\n`);

		const plan = sl.planTombstone(["whatever"], okfPath);
		refusedPlan(plan);
		expect(plan.write.reason).toBe("parse_damaged");
	});

	it("export followed by import in a second store reproduces the entries exactly", async () => {
		const storeA = await openMigrated();
		const slA = layer(storeA);
		seedMemory(storeA, {
			id: "mem-1",
			content: "round trip rule",
			evidence: 4,
		});
		const okfPath = join(tmpRoot, "knowledge.okf");

		const plan = slA.planExport(["mem-1"], okfPath);
		expect(slA.applyExport(plan).applied).toBe("written");

		const storeB = await openMigrated();
		const slB = layer(storeB);
		const report = slB.import(okfPath);
		expect(report.parsed).toBe(1);
		expect(report.imported).toBe(1);
		const rows = storeB
			.prepare(
				"SELECT entry_id, statement, evidence, confidence, op FROM shared_entries WHERE repo_id = ?",
			)
			.all(REPO_A) as Array<{
			entry_id: string;
			statement: string;
			evidence: number;
			confidence: number;
			op: string;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].entry_id).toBe(
			computeEntryId("rule", "round trip rule", "project"),
		);
		expect(rows[0].statement).toBe("round trip rule");
		expect(rows[0].evidence).toBe(4);
		expect(rows[0].confidence).toBe(0.9);
		expect(rows[0].op).toBe("assert");
	});

	it("merging into an existing corpus keeps both sides (K8-015 semantics)", async () => {
		const store = await openMigrated();
		const sl = layer(store);
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, serialize([entry("file side")], REPO_A, "0.8.0"));
		seedMemory(store, { id: "mem-1", content: "memory side", evidence: 3 });

		const plan = sl.planExport(["mem-1"], okfPath);
		expect(plan.write.outcome).toBe("written");
		expect(sl.applyExport(plan).applied).toBe("written");
		const after = readFileSync(okfPath, "utf8");
		expect(after).toContain("file side");
		expect(after).toContain("memory side");
	});
});
