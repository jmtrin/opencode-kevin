import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactWriter } from "../../plugin/ArtifactWriter.js";
import { Curator } from "../../plugin/Curator.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import { buildAudit } from "../../plugin/kevin_audit.js";
import { Metrics } from "../../plugin/metrics.js";

const MIGRATIONS = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
	"008_v07_truth.sql",
	"009_v08_team.sql",
];

async function freshStore(): Promise<Store> {
	const root = mkdtempSync(join(tmpdir(), "kevin-curator-shared-"));
	const dir = join(root, "migrations");
	mkdirSync(dir, { recursive: true });
	for (const file of MIGRATIONS) {
		copyFileSync(join(process.cwd(), "migrations", file), join(dir, file));
	}
	const store = new Store({ path: ":memory:" });
	await new Migrate(store, dir).run();
	return store;
}

function seedMemory(
	store: Store,
	opts: { id: string; content: string; evidence?: number } = {
		id: "mem-a",
		content: "alpha local",
		evidence: 2,
	},
): void {
	store
		.prepare(
			`INSERT INTO memories
			 (id, type, content, scope, relevance_score, project_id,
			  evidence_count, recurrence_count, created_at, updated_at,
			  status, curated, inferable, origin, layer)
			 VALUES (?, 'rule', ?, 'project', 0.3, 'proj-x', ?, 0,
			  '2026-08-01 10:00:00', '2026-08-01 10:00:00', 'active', 0,
			  NULL, 'pattern', 'local')`,
		)
		.run(opts.id, opts.content, opts.evidence ?? 2);
}

function seedShared(
	store: Store,
	opts: {
		id: string;
		entryId: string;
		statement: string;
		evidence?: number;
		author?: string | null;
		op?: "assert" | "tombstone";
		createdAt?: string;
	},
): void {
	store
		.prepare(
			`INSERT INTO shared_entries
			 (id, repo_id, entry_id, type, statement, scope, confidence,
			  evidence, origin, author_hash, op, created_at)
			 VALUES (?, 'repo-x', ?, 'rule', ?, 'project', ?, ?, 'shared',
			  ?, ?, ?)`,
		)
		.run(
			opts.id,
			opts.entryId,
			opts.statement,
			(opts.evidence ?? 2) * 0.35 + 0.35,
			opts.evidence ?? 2,
			opts.author ?? null,
			opts.op ?? "assert",
			opts.createdAt ?? "2026-08-01 10:00:00",
		);
}

function setFlag(store: Store, key: string, value: string): void {
	store
		.prepare(
			"INSERT INTO kevin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run(key, value);
}

function freshCurator(store: Store): Curator {
	return new Curator(store, new MemoryService(store), "proj-x", null, "repo-x");
}

describe("K8-023 — Curator shared rendering (plan §5.7)", () => {
	it("flag off: output is byte-identical to the v0.6.0 path even with shared entries present", async () => {
		const store = await freshStore();
		seedMemory(store, { id: "mem-a", content: "alpha local", evidence: 2 });
		seedMemory(store, { id: "mem-b", content: "bravo local", evidence: 5 });
		seedShared(store, {
			id: "s1",
			entryId: "e-shared",
			statement: "shared only",
			evidence: 4,
		});
		const curator = freshCurator(store);
		const legacy = new Curator(store, new MemoryService(store), "proj-x");
		expect(curator.candidates()).toEqual(legacy.candidates());
		expect(curator.candidates(undefined, "memories")).toEqual(
			curator.candidates(),
		);
		expect(curator.candidates().map((c) => c.memoryId)).toEqual([
			"mem-b",
			"mem-a",
		]);
		store.close();
	});

	it("flag on: candidates read shared_entries — predicate, caps and id order unchanged", async () => {
		const store = await freshStore();
		setFlag(store, "shared_layer_enabled", "1");
		seedMemory(store, { id: "mem-a", content: "alpha local", evidence: 5 });
		seedShared(store, {
			id: "s1",
			entryId: "e-b",
			statement: "bravo shared",
			evidence: 3,
		});
		seedShared(store, {
			id: "s2",
			entryId: "e-a",
			statement: "alpha shared",
			evidence: 2,
		});
		seedShared(store, {
			id: "s3",
			entryId: "e-c",
			statement: "charlie weak",
			evidence: 1,
		});
		seedShared(store, {
			id: "s4",
			entryId: "e-d",
			statement: "delta tombstone",
			evidence: 3,
			op: "tombstone",
		});
		seedShared(store, {
			id: "s5",
			entryId: "e-e",
			statement: "echo shared",
			evidence: 5,
		});
		const curator = freshCurator(store);
		const cands = curator.candidates(undefined, "shared");
		// e-c (evidence 1) fails the predicate, e-d is a tombstone, and the
		// local memory is invisible to the shared source.
		expect(cands.map((c) => c.memoryId)).toEqual(["e-e", "e-b", "e-a"]);
		expect(cands.map((c) => c.line)).toEqual([
			"- echo shared (verified 5\u00d7)",
			"- bravo shared (verified 3\u00d7)",
			"- alpha shared (verified 2\u00d7)",
		]);
		// The rendered block is ordered by id (D6-10), unchanged.
		expect(curator.renderBlock(cands)).toBe(
			"- alpha shared (verified 2\u00d7)\n- bravo shared (verified 3\u00d7)\n- echo shared (verified 5\u00d7)\n",
		);
		store.close();
	});

	it("flag on: propose() routes to the shared layer and renders exactly the passing statements", async () => {
		const store = await freshStore();
		setFlag(store, "shared_layer_enabled", "1");
		const target = join(
			mkdtempSync(join(tmpdir(), "kevin-curator-flag-")),
			"AGENTS.md",
		);
		writeFileSync(target, "", "utf8");
		setFlag(store, "agents_md_path", target);
		seedShared(store, {
			id: "s1",
			entryId: "e-b",
			statement: "bravo shared",
			evidence: 3,
		});
		seedShared(store, {
			id: "s2",
			entryId: "e-a",
			statement: "alpha shared",
			evidence: 2,
		});
		const writer = new ArtifactWriter(store, "proj-x");
		const proposals = freshCurator(store).propose("agents_md", writer);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].proposedText).toBe(
			"- alpha shared (verified 2\u00d7)\n- bravo shared (verified 3\u00d7)\n",
		);
		// Contributing ids in SELECTION (confidence) order, id order is the
		// rendering contract only.
		expect(proposals[0].memoryIds).toEqual(["e-b", "e-a"]);
		store.close();
	});

	it("the line cap binds identically over the shared source: 20 lines", async () => {
		const store = await freshStore();
		for (let i = 0; i < 25; i++) {
			const n = String(i).padStart(2, "0");
			seedShared(store, {
				id: `cap-${n}`,
				entryId: `e-${n}`,
				statement: `statement ${n}`,
				evidence: 2,
				createdAt: `2026-08-01 10:00:0${i % 10}`,
			});
		}
		expect(freshCurator(store).candidates(undefined, "shared")).toHaveLength(
			20,
		);
		store.close();
	});

	it("the char cap binds identically over the shared source: 4000 chars", async () => {
		const store = await freshStore();
		for (let i = 0; i < 26; i++) {
			seedShared(store, {
				id: `long-${String(i).padStart(2, "0")}`,
				entryId: `e-l${String(i).padStart(2, "0")}`,
				statement: "x".repeat(330),
				evidence: 2,
			});
		}
		// 4000 / 330 = 12.12 — the 13th entry would exceed the char budget.
		expect(freshCurator(store).candidates(undefined, "shared")).toHaveLength(
			12,
		);
		store.close();
	});
});

describe("K8-023 — kevin_audit team block (pure SQL, plan §5.7)", () => {
	it("every number matches its query on a fixture, including hand-computed precision", async () => {
		const store = await freshStore();
		seedShared(store, {
			id: "s1",
			entryId: "e-1",
			statement: "alpha",
			evidence: 3,
			author: "alice",
		});
		seedShared(store, {
			id: "s2",
			entryId: "e-2",
			statement: "beta",
			evidence: 2,
			author: "alice",
		});
		seedShared(store, {
			id: "s3",
			entryId: "e-3",
			statement: "gamma",
			evidence: 4,
			author: "bob",
		});
		seedShared(store, {
			id: "s4",
			entryId: "e-4",
			statement: "delta",
			evidence: 1,
		});
		seedShared(store, {
			id: "t1",
			entryId: "e-5",
			statement: "epsilon",
			evidence: 0,
			op: "tombstone",
		});
		store
			.prepare(
				"INSERT INTO okf_imports (id, repo_id, path, entries_rejected, imported_at) VALUES ('i1', 'repo-x', 'knowledge.okf', 0, '2026-08-01 10:00:00')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO okf_imports (id, repo_id, path, entries_rejected, imported_at) VALUES ('i2', 'repo-x', 'knowledge.okf', 3, '2026-08-02 10:00:00')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO kevin_metrics (key, value) VALUES ('shared_write_refusals', 2)",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, scope, status, layer) VALUES ('m-shared', 'rule', 'shared', 'project', 'active', 'shared')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, scope, status, layer) VALUES ('m-local', 'rule', 'local', 'project', 'active', 'local')",
			)
			.run();
		const insertInjection = store.prepare(
			"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES (?,?,?,?,?,?,?)",
		);
		insertInjection.run(
			"i1",
			"m-shared",
			"f",
			"s",
			"pre_prompt",
			1,
			"effective",
		);
		insertInjection.run(
			"i2",
			"m-shared",
			"f",
			"s",
			"pre_prompt",
			1,
			"effective",
		);
		insertInjection.run(
			"i3",
			"m-shared",
			"f",
			"s",
			"pre_prompt",
			1,
			"ineffective",
		);
		insertInjection.run(
			"i4",
			"m-local",
			"f",
			"s",
			"pre_prompt",
			1,
			"effective",
		);
		insertInjection.run(
			"i5",
			"m-local",
			"f",
			"s",
			"pre_prompt",
			1,
			"ineffective",
		);
		// Reach the maturity floor (100 memories, 50 settled): 98 filler
		// memories and 45 more effective injections on m-local.
		for (let i = 0; i < 98; i++) {
			store
				.prepare(
					"INSERT INTO memories (id, type, content, scope, status) VALUES (?, 'rule', 'filler', 'project', 'active')",
				)
				.run(`filler-${i}`);
		}
		for (let i = 0; i < 45; i++) {
			insertInjection.run(
				`x${i}`,
				"m-local",
				"f",
				"s",
				"pre_prompt",
				1,
				"effective",
			);
		}
		const report = buildAudit(
			store,
			new Metrics(store),
			undefined,
			"proj-x",
			"repo-x",
		);
		expect(report.team).toBeDefined();
		expect(report.team?.write_refusals).toBe(2);
		expect(report.team?.shared_total).toBe(4);
		expect(report.team?.tombstones).toBe(1);
		expect(report.team?.distinct_authors).toBe(2);
		expect(report.team?.last_import_at).toBe("2026-08-02 10:00:00");
		expect(report.team?.last_import_rejected).toBe(3);
		expect(report.team?.reason).toBeUndefined();
		expect(report.team?.precision_shared).toBe(2 / 3);
		expect(report.team?.precision_local).toBe(46 / 47);
		store.close();
	});

	it("reports immature_db below the v0.7.0 maturity floor and omits the precision numbers", async () => {
		const store = await freshStore();
		seedShared(store, {
			id: "s1",
			entryId: "e-1",
			statement: "alpha",
			evidence: 3,
		});
		seedMemory(store, { id: "mem-a", content: "alpha local", evidence: 2 });
		const report = buildAudit(
			store,
			new Metrics(store),
			undefined,
			"proj-x",
			"repo-x",
		);
		expect(report.team?.reason).toBe("immature_db");
		expect(report.team?.shared_total).toBe(1);
		expect(report.team?.precision_shared).toBeUndefined();
		expect(report.team?.precision_local).toBeUndefined();
		store.close();
	});

	it("distinct_authors is 0 when author_identity_mode='none' (imports write NULL)", async () => {
		const store = await freshStore();
		seedShared(store, {
			id: "s1",
			entryId: "e-1",
			statement: "alpha",
			evidence: 3,
		});
		seedShared(store, {
			id: "s2",
			entryId: "e-2",
			statement: "beta",
			evidence: 2,
		});
		store
			.prepare(
				"INSERT INTO okf_imports (id, repo_id, path, imported_at) VALUES ('i1', 'repo-x', 'knowledge.okf', '2026-08-01 10:00:00')",
			)
			.run();
		const report = buildAudit(
			store,
			new Metrics(store),
			undefined,
			"proj-x",
			"repo-x",
		);
		expect(report.team?.distinct_authors).toBe(0);
		store.close();
	});

	it("the team block is gated on migration 009: pre-009 databases keep the K8-018 shape", async () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-curator-pre009-"));
		const dir = join(root, "migrations");
		mkdirSync(dir, { recursive: true });
		for (const file of MIGRATIONS.filter((f) => f !== "009_v08_team.sql")) {
			copyFileSync(join(process.cwd(), "migrations", file), join(dir, file));
		}
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, dir).run();
		store
			.prepare(
				"INSERT INTO kevin_metrics (key, value) VALUES ('shared_write_refusals', 1)",
			)
			.run();
		const report = buildAudit(store, new Metrics(store));
		expect(report.team?.write_refusals).toBe(1);
		expect(report.team?.shared_total).toBeUndefined();
		expect(report.team?.precision_shared).toBeUndefined();
		store.close();
		rmSync(root, { recursive: true, force: true });
	});
});
