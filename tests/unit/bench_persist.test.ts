import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import {
	ARMS,
	persistResult,
	runBench,
	shouldPersist,
} from "../../scripts/bench.js";

const REPO_ROOT = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
);
const MIGRATIONS = readdirSync(join(REPO_ROOT, "packages/core/migrations")).filter((f) =>
	f.endsWith(".sql"),
);

let tmpRoot: string;
let storePath: string;
let resultsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-benchpersist-"));
	storePath = join(tmpRoot, "kevin.db");
	resultsDir = join(tmpRoot, "results");
	mkdirSync(resultsDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		// Windows EPERM if a connection lingers; best effort
	}
});

describe("K10-017 — bench result persistence", () => {
	it("writes four bench_runs rows sharing a corpus digest and increments bench_runs_total", async () => {
		const result = await runBench();
		const saved = await persistResult(result, {
			storePath,
			resultsDir,
			ranAt: new Date("2026-08-21T00:00:00.000Z"),
		});
		expect(saved.rows).toBe(ARMS.length);
		const store = new Store({ path: storePath });
		try {
			const rows = store
				.prepare(
					"SELECT corpus_digest, contract_digest, package_version, arm, k, precision_at_k, recall_at_k, mrr FROM bench_runs ORDER BY id",
				)
				.all() as {
				corpus_digest: string;
				contract_digest: string;
				package_version: string;
				arm: string;
				k: number;
			}[];
			expect(rows.length).toBe(4);
			expect(new Set(rows.map((r) => r.corpus_digest)).size).toBe(1);
			expect(rows.map((r) => r.arm)).toEqual([...ARMS]);
			expect(rows.every((r) => r.k === 5)).toBe(true);
			expect(rows[0]?.package_version).toBe("1.2.0");
			const total = store
				.prepare(
					"SELECT value FROM kevin_metrics WHERE key = 'bench_runs_total'",
				)
				.get() as { value: number };
			expect(Number(total.value)).toBe(1);
		} finally {
			store.close();
		}
	}, 60_000);

	it("the results file is valid JSON with all four arms and timings", async () => {
		const result = await runBench();
		const saved = await persistResult(result, { storePath, resultsDir });
		expect(saved.file).toBeTruthy();
		const parsed = JSON.parse(readFileSync(saved.file as string, "utf8")) as {
			corpus_digest: string;
			arms: { arm: string; p50Ms: number; p95Ms: number }[];
		};
		expect(parsed.corpus_digest).toBe(result.corpusDigest);
		expect(parsed.arms.map((a) => a.arm)).toEqual([...ARMS]);
		for (const a of parsed.arms) {
			expect(typeof a.p50Ms).toBe("number");
			expect(typeof a.p95Ms).toBe("number");
		}
	}, 60_000);

	it("--no-persist is honoured: no rows, no file", async () => {
		expect(shouldPersist(["bench.ts", "--no-persist"])).toBe(false);
		expect(shouldPersist(["bench.ts"])).toBe(true);
		const result = await runBench();
		const saved = await persistResult(result, {
			storePath: null,
			resultsDir: null,
		});
		expect(saved.rows).toBe(0);
		expect(saved.file).toBeNull();
	}, 60_000);
});
