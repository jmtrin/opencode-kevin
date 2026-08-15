import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ArtifactWriter,
	MARKER_BEGIN,
	MARKER_END,
} from "../../plugin/ArtifactWriter.js";
import {
	ConventionMiner,
	type MinedConvention,
} from "../../plugin/ConventionMiner.js";
import { Curator } from "../../plugin/Curator.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

let tmpRoot: string;
let migrationsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-ccur-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
	]) {
		copyFileSync(
			join(process.cwd(), "migrations", file),
			join(migrationsDir, file),
		);
	}
});

afterEach(() => {
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

function makeStore(): Promise<Store> {
	const store = new Store({ path: ":memory:" });
	return new Migrate(store, migrationsDir).run().then(() => store);
}

function seedRule(
	store: Store,
	id: string,
	content: string,
	opts: {
		evidenceCount?: number;
		curated?: number;
		feedbackPositive?: number;
	} = {},
): void {
	store
		.prepare(
			`INSERT INTO memories
			 (id, type, origin, content, scope, project_id, evidence_count, curated, inferable, status, ignored)
			 VALUES (?, 'rule', 'pattern', ?, 'project', 'proj-x', ?, ?, 0, 'active', 0)`,
		)
		.run(id, content, opts.evidenceCount ?? 0, opts.curated ?? 0);
	// feedback_positive if provided (a separate updated_at guard).
	if (opts.feedbackPositive) {
		store
			.prepare("UPDATE memories SET feedback_positive = ? WHERE id = ?")
			.run(opts.feedbackPositive, id);
	}
}

function conventionWith(content: string, support = 6): MinedConvention {
	return {
		fingerprint: content,
		statement: content,
		support,
		kind: "co_edit",
	};
}

describe("K7-013 — Curator hand-off + whole-file de-duplication", () => {
	it("a mined rule enters Curator.candidates() only when it satisfies the full D6-09 predicate", async () => {
		const store = await makeStore();
		try {
			const svc = new MemoryService(store);
			const curator = new Curator(store, svc, "proj-x");
			// Mined-style rule WITHOUT evidence → not a candidate (fails the
			// evidence-or-feedback disjunction and the confidence floor).
			seedRule(store, "m-noev", "route files come with route tests");
			const before = curator.candidates();
			expect(before.map((c) => c.memoryId)).not.toContain("m-noev");
			// Same rule WITH evidence_count = 2 → clears the predicate.
			seedRule(store, "m-ev", "route files come with route tests", {
				evidenceCount: 2,
			});
			const after = curator.candidates();
			expect(after.map((c) => c.memoryId)).toContain("m-ev");
			expect(after.map((c) => c.memoryId)).not.toContain("m-noev");
		} finally {
			store.close();
		}
	});

	it("a statement already present OUTSIDE Kevin's markers is excluded from the proposal", async () => {
		const store = await makeStore();
		const tmpDir = mkdtempSync(join(tmpRoot, "proj"));
		try {
			const agentsPath = join(tmpDir, "AGENTS.md");
			store
				.prepare(
					"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('agents_md_path', ?)",
				)
				.run(agentsPath);
			const svc = new MemoryService(store);
			const metrics = new Metrics(store);
			const curator = new Curator(store, svc, "proj-x", metrics);
			const writer = new ArtifactWriter(store, "proj-x", metrics);
			seedRule(store, "m-ev", "route files come with route tests", {
				evidenceCount: 2,
			});
			const cand = curator.candidates().find((c) => c.memoryId === "m-ev");
			expect(cand).toBeDefined();
			// The user already wrote this exact bullet OUTSIDE Kevin's markers.
			// `cand.line` already includes the leading "- " (renderBlock shape).
			writeFileSync(
				agentsPath,
				`# Project\n\n${cand?.line}\n\n${MARKER_BEGIN}\n\n${MARKER_END}\n`,
				"utf8",
			);
			const proposals = curator.propose("agents_md", writer);
			// The convention is already present outside the markers, so nothing
			// is proposed back to the user.
			expect(proposals).toHaveLength(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
			store.close();
		}
	});

	it("a statement INSIDE Kevin's markers is still excluded (the curated = 0 clause)", async () => {
		const store = await makeStore();
		try {
			const svc = new MemoryService(store);
			const curator = new Curator(store, svc, "proj-x");
			seedRule(store, "m-early", "already curated rule", {
				evidenceCount: 2,
				curated: 1,
			});
			expect(curator.candidates().map((c) => c.memoryId)).not.toContain(
				"m-early",
			);
		} finally {
			store.close();
		}
	});

	it("no code path publishes a mined rule without a curation_proposals row and explicit approval", async () => {
		const store = await makeStore();
		const tmpDir = mkdtempSync(join(tmpRoot, "proj2"));
		try {
			const agentsPath = join(tmpDir, "AGENTS.md");
			store
				.prepare(
					"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('agents_md_path', ?)",
				)
				.run(agentsPath);
			const svc = new MemoryService(store);
			const metrics = new Metrics(store);
			const miner = new ConventionMiner(store, svc, "proj-x", metrics);
			// A pre-existing file the user owns.
			writeFileSync(agentsPath, "# Project\n\nSome prose.\n", "utf8");
			// Emit a mined rule: this must NOT write to disk's marker block and
			// must NOT create a proposal by itself.
			miner.emit([
				conventionWith(
					"every new file under src/routes/ has a test under tests/routes/",
				),
			]);
			const onDisk = readFileSync(agentsPath, "utf8");
			expect(onDisk.indexOf(MARKER_BEGIN)).toBe(-1);
			expect(onDisk).toBe("# Project\n\nSome prose.\n");
			const proposalRows = store
				.prepare("SELECT COUNT(*) AS c FROM curation_proposals")
				.get() as { c: number };
			expect(proposalRows.c).toBe(0);
			// The mined rule itself is in the memory table (active), only ever
			// surfaced through a proposal, never auto-applied.
			const activeRules = store
				.prepare(
					"SELECT COUNT(*) AS c FROM memories WHERE type = 'rule' AND status = 'active'",
				)
				.get() as { c: number };
			expect(activeRules.c).toBe(1);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
			store.close();
		}
	});
});
