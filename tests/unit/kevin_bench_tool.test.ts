import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { buildKevinBench } from "@jmtrin/kevin-core";
import { loadCorpus } from "../../scripts/gen-corpus.js";

const REPO_ROOT = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
);
const MIGRATIONS_DIR = join(REPO_ROOT, "packages/core/migrations");

let tmpRoot: string;
let storePath: string;
let store: Store;

function seedRun(overrides?: Partial<{ digest: string; ranAt: string }>): void {
	const digest = overrides?.digest ?? "aaaaaaaaaaaaaaaa";
	const ranAt = overrides?.ranAt ?? "2026-08-21 00:00:00";
	for (const arm of ["none", "recent-k", "random-k", "kevin"]) {
		store
			.prepare(
				"INSERT INTO bench_runs (corpus_digest, contract_digest, package_version, runtime, arm, k, precision_at_k, recall_at_k, mrr, ran_at) VALUES (?, 'dddddddddddddddd', '1.0.0', 'node test', ?, 5, 0.5, 0.4, 1.0, ?)",
			)
			.run(digest, arm, ranAt);
	}
}

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-benchtool-"));
	storePath = join(tmpRoot, "kevin.db");
	store = new Store({ path: storePath });
	await new Migrate(store, MIGRATIONS_DIR).run();
});

afterEach(() => {
	try {
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		// Windows EPERM if a connection lingers; best effort
	}
});

describe("K10-019 — kevin_bench tool", () => {
	it("empty database returns a structured no-runs result naming npm run bench", () => {
		const r = buildKevinBench({ store }, { action: "status" }) as {
			has_runs: boolean;
			hint: string;
		};
		expect(r.has_runs).toBe(false);
		expect(r.hint).toContain("npm run bench");
		const l = buildKevinBench({ store }, { action: "last" }) as {
			has_runs: boolean;
		};
		expect(l.has_runs).toBe(false);
	});

	it("status reports the latest corpus digest and whether it matches the disk corpus", () => {
		const { digest } = loadCorpus(join(REPO_ROOT, "bench", "corpus"));
		seedRun({ digest });
		const r = buildKevinBench(
			{ store, cwd: REPO_ROOT },
			{ action: "status" },
		) as {
			has_runs: boolean;
			corpus_digest: string;
			matches_disk_corpus: boolean;
			total_runs: number;
		};
		expect(r.has_runs).toBe(true);
		expect(r.corpus_digest).toMatch(/^[0-9a-f]{16}$/);
		expect(r.matches_disk_corpus).toBe(true);
		expect(r.total_runs).toBe(4);
	});

	it("status with a stale digest reports matches_disk_corpus false; absent corpus reports null", () => {
		seedRun({ digest: "bbbbbbbbbbbbbbbb" });
		const stale = buildKevinBench(
			{ store, cwd: REPO_ROOT },
			{ action: "status" },
		) as { matches_disk_corpus: boolean };
		expect(stale.matches_disk_corpus).toBe(false);
		const absent = buildKevinBench(
			{ store, cwd: join(tmpRoot, "nope") },
			{ action: "status" },
		) as { corpus_on_disk: string | null };
		expect(absent.corpus_on_disk).toBeNull();
	});

	it("last returns the four arms of the most recent run", () => {
		seedRun({ ranAt: "2026-08-20 00:00:00" });
		seedRun({ ranAt: "2026-08-21 00:00:00" });
		const r = buildKevinBench(
			{ store, cwd: REPO_ROOT },
			{ action: "last" },
		) as {
			has_runs: boolean;
			ran_at: string;
			arms: { arm: string; k: number; precision_at_k: number }[];
		};
		expect(r.has_runs).toBe(true);
		expect(r.ran_at).toBe("2026-08-21 00:00:00");
		expect(r.arms.map((a) => a.arm)).toEqual([
			"none",
			"recent-k",
			"random-k",
			"kevin",
		]);
		expect(r.arms.every((a) => a.k === 5)).toBe(true);
	});
});
