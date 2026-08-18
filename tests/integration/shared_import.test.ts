import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../../plugin/ArtifactWriter.js";
import { Migrate } from "../../plugin/Migrate.js";
import { SharedLayer } from "../../plugin/SharedLayer.js";
import { Store } from "../../plugin/Store.js";
import { type OkfEntry, computeEntryId, serialize } from "../../plugin/okf.js";

const REPO_A = "aaaaaaaaaaaaaaaa";
const REPO_B = "bbbbbbbbbbbbbbbb";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-shared-import-"));
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
	for (const file of readdirSync(join(process.cwd(), "migrations"))) {
		if (file.startsWith("00") || file === "009_v08_team.sql") {
			copyFileSync(join(process.cwd(), "migrations", file), join(dir, file));
		}
	}
	return dir;
}

async function openMigrated(): Promise<Store> {
	const store = new Store({ path: join(tmpRoot, "kevin.db") });
	await new Migrate(store, makeMigrationsDir()).run();
	return store;
}

function entry(statement: string, evidence = 1): OkfEntry {
	return {
		entry_id: computeEntryId("rule", statement, null),
		type: "rule",
		statement,
		scope: null,
		evidence,
		recurrence: 0,
		origin: "pattern",
		author_hash: "3c9ab8d2f7e14a05",
		op: "assert",
		created_at: "2026-08-01T00:00:00Z",
		supersedes: null,
	};
}

function sharedRows(store: Store): Array<Record<string, unknown>> {
	return store
		.prepare(
			"SELECT repo_id, entry_id, statement, evidence, confidence, op FROM shared_entries ORDER BY repo_id, entry_id",
		)
		.all() as Array<Record<string, unknown>>;
}

describe("K8-016 — SharedLayer.import() + okf_imports + hash skip (plan §5.5)", () => {
	it("importing the same unchanged file twice parses exactly once; the second call skips and still writes an audit row", async () => {
		const store = await openMigrated();
		const layer = new SharedLayer({
			store,
			repoId: REPO_A,
			projectId: "cccccccccccccccc",
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const okfPath = join(tmpRoot, "knowledge.okf");
		writeFileSync(okfPath, serialize([entry("rule one")], REPO_A, "0.8.0"));

		const first = layer.import(okfPath);
		expect(first.skipped).toBe(false);
		expect(first.parsed).toBe(1);
		expect(first.imported).toBe(1);

		const second = layer.import(okfPath);
		expect(second.skipped).toBe(true);
		expect(second.parsed).toBe(0);
		expect(second.imported).toBe(0);

		const rows = store
			.prepare("SELECT * FROM okf_imports ORDER BY rowid")
			.all() as Array<Record<string, unknown>>;
		expect(rows).toHaveLength(2);
		expect(rows[1].skipped).toBe(1);
		expect(rows[1].entries_parsed).toBe(0);
		expect(rows[0].entries_parsed).toBe(1);
		expect(rows[0].file_hash).toBe(rows[1].file_hash);
		store.close();
	});

	it("500 entries import into 500 rows; re-importing after changing one entry's evidence updates exactly one row and inserts none", async () => {
		const store = await openMigrated();
		const layer = new SharedLayer({
			store,
			repoId: REPO_A,
			projectId: "cccccccccccccccc",
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const okfPath = join(tmpRoot, "knowledge.okf");
		const entries = Array.from({ length: 500 }, (_, i) =>
			entry(`statement ${i}`, 1 + (i % 4)),
		);
		writeFileSync(okfPath, serialize(entries, REPO_A, "0.8.0"));

		const report = layer.import(okfPath);
		expect(report.imported).toBe(500);
		expect(sharedRows(store)).toHaveLength(500);

		// Change one entry's evidence (the file's transportable counter;
		// confidence is derived, plan §5.3) and re-import.
		const changed = [...entries];
		changed[42] = { ...changed[42], evidence: 9 };
		writeFileSync(okfPath, serialize(changed, REPO_A, "0.8.0"));
		const again = layer.import(okfPath);
		expect(again.skipped).toBe(false);
		expect(again.imported).toBe(500);

		const rows = sharedRows(store);
		expect(rows).toHaveLength(500);
		const row42 = rows.find((r) => r.statement === "statement 42") as Record<
			string,
			unknown
		>;
		expect(row42.evidence).toBe(9);
		// computeConfidence clamps at 0.95: 0.5 + 0.1*9 - 0.15*0 = 1.4.
		expect(row42.confidence).toBeCloseTo(0.95);
		store.close();
	});

	it("a missing file returns parsed: 0 and fileHash: null, writes an audit row, and does not throw", async () => {
		const store = await openMigrated();
		const layer = new SharedLayer({
			store,
			repoId: REPO_A,
			projectId: "cccccccccccccccc",
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const report = layer.import(join(tmpRoot, "absent.okf"));
		expect(report.fileHash).toBeNull();
		expect(report.parsed).toBe(0);
		expect(report.skipped).toBe(false);
		const rows = store.prepare("SELECT * FROM okf_imports").all() as Array<
			Record<string, unknown>
		>;
		expect(rows).toHaveLength(1);
		expect(rows[0].file_hash).toBeNull();
		expect(rows[0].repo_id).toBe(REPO_A);
		store.close();
	});

	it("two repo_ids importing files that share an entry_id produce two distinct rows", async () => {
		const store = await openMigrated();
		const a = new SharedLayer({
			store,
			repoId: REPO_A,
			projectId: "cccccccccccccccc",
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const b = new SharedLayer({
			store,
			repoId: REPO_B,
			projectId: "dddddddddddddddd",
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const same = entry("shared rule");
		const pathA = join(tmpRoot, "a.okf");
		const pathB = join(tmpRoot, "b.okf");
		writeFileSync(pathA, serialize([same], REPO_A, "0.8.0"));
		writeFileSync(pathB, serialize([same], REPO_B, "0.8.0"));
		a.import(pathA);
		b.import(pathB);
		const rows = sharedRows(store);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.repo_id).sort()).toEqual([REPO_A, REPO_B]);
		store.close();
	});

	it("okf_imports is append-only: a source scan finds no UPDATE okf_imports anywhere", () => {
		for (const f of readdirSync(join(process.cwd(), "plugin"))) {
			if (!f.endsWith(".ts")) continue;
			const src = readFileSync(join(process.cwd(), "plugin", f), "utf8");
			expect(
				src.match(/UPDATE\s+okf_imports/i),
				`UPDATE okf_imports found in plugin/${f}`,
			).toBeNull();
		}
	});

	it("import order does not affect the final shared_entries contents (shuffled lines, identical table)", async () => {
		const store = await openMigrated();
		const layer = new SharedLayer({
			store,
			repoId: REPO_A,
			projectId: "cccccccccccccccc",
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const entries = Array.from({ length: 40 }, (_, i) => entry(`rule ${i}`, 1));
		const canonical = serialize(entries, REPO_A, "0.8.0");
		writeFileSync(join(tmpRoot, "ordered.okf"), canonical);
		layer.import(join(tmpRoot, "ordered.okf"));

		// A fresh database gets the shuffled file.
		const store2 = await openMigrated();
		const layer2 = new SharedLayer({
			store: store2,
			repoId: REPO_A,
			projectId: "cccccccccccccccc",
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const shuffled = canonical
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.sort(() => 1);
		const body = `#okf 2\n#repo aaaaaaaaaaaaaaaa\n#generated-by opencode-kevin/0.8.0\n${shuffled.join("\n")}\n`;
		writeFileSync(join(tmpRoot, "shuffled.okf"), body);
		layer2.import(join(tmpRoot, "shuffled.okf"));

		expect(sharedRows(store2)).toEqual(sharedRows(store));
		store.close();
		store2.close();
	});
});
