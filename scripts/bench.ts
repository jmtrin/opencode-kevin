/**
 * K10-015/K10-016/K10-017 — the four-arm retrieval benchmark.
 *
 * Runs the committed synthetic corpus (bench/corpus/) through four arms —
 * `none` (control), `recent-k` (trivial baseline), `random-k` (floor) and
 * `kevin` (the real MemoryService path with rankScore) — and reports
 * precision@5, recall@5 and MRR plus per-arm p50/p95 timing.
 *
 * Constraints honoured here: zero network calls; zero reads of the user's
 * real database (the harness builds a temporary store and deletes it); no
 * wall-clock dependence in the retrieval half (`deterministic_retrieval='1'`
 * and `DATE_NOW` as the epoch). The same corpus and seed produce identical
 * retrieval numbers on any machine — asserted by tests/unit/bench_repro.test.
 * Timings are NOT asserted for equality; their gate is the §5.2 budgets,
 * enforced by `npm run bench:check`.
 *
 * What this proves and what it does not: it proves Kevin's ranking does or
 * does not beat recency on a corpus constructed to have a ranked answer. It
 * does not prove real sessions look like this corpus, nor that a surfaced
 * memory changed what the model did.
 */
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATE_NOW, MemoryService } from "../plugin/MemoryService.js";
import { Migrate } from "../plugin/Migrate.js";
import { Store } from "../plugin/Store.js";
import { Perf } from "../plugin/perf.js";
import { type CorpusMemory, loadCorpus } from "./gen-corpus.js";

const K = 5;
const RANDOM_K_SEED = 0x5eed;
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export type BenchArm = "none" | "recent-k" | "random-k" | "kevin";

export const ARMS: readonly BenchArm[] = [
	"none",
	"recent-k",
	"random-k",
	"kevin",
];

export interface ArmResult {
	arm: BenchArm;
	precisionAt5: number;
	recallAt5: number;
	mrr: number;
	p50Ms: number;
	p95Ms: number;
}

export interface BenchRun {
	corpusDigest: string;
	k: number;
	queries: number;
	arms: readonly ArmResult[];
}

/** Nearest-rank percentile — same method as plugin/perf.ts stats(). */
function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return 0;
	return sorted[
		Math.min(sorted.length, Math.ceil((p / 100) * sorted.length)) - 1
	] as number;
}

function xorshift32(seed: number): () => number {
	let s = seed >>> 0 || 0x9e3779b9;
	return () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 0x100000000;
	};
}

function toSqliteUtc(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

interface LoadedCorpus {
	store: Store;
	service: MemoryService;
	perf: Perf;
	byId: Map<string, CorpusMemory>;
	scopeIds: Map<string, string[]>;
	dir: string;
	digest: string;
}

async function openCorpusStore(corpusDir: string): Promise<LoadedCorpus> {
	const { memories, digest } = loadCorpus(corpusDir);
	const tmp = mkdtempSync(join(tmpdir(), "kevin-bench-"));
	const store = new Store({ path: join(tmp, "bench.db") });
	await new Migrate(store, join(corpusDir, "..", "..", "migrations")).run();
	store
		.prepare(
			"INSERT INTO kevin_settings (key, value) VALUES ('deterministic_retrieval', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
		)
		.run();

	const service = new MemoryService(store, null, null);
	const byId = new Map<string, CorpusMemory>();
	const epochMs = Date.parse(DATE_NOW);

	store.transaction(() => {
		for (const m of memories) {
			byId.set(m.id, m);
			const createdAt = toSqliteUtc(epochMs - m.ageDays * 86_400_000);
			service.save({
				id: m.id,
				type: m.type,
				content: m.statement,
				scope: m.scope,
				evidenceCount: m.evidence,
				recurrenceCount: m.recurrence,
			});
			store
				.prepare(
					"UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?",
				)
				.run(createdAt, createdAt, m.id);
		}
	});

	const scopeIds = new Map<string, string[]>();
	for (const scope of ["project", "session"] as const) {
		const rows = store
			.prepare(
				"SELECT id FROM memories WHERE scope = ? AND status = 'active' ORDER BY created_at DESC",
			)
			.all(scope) as { id: string }[];
		scopeIds.set(
			scope,
			rows.map((r) => r.id),
		);
	}

	return {
		store,
		service,
		perf: new Perf({ enabled: true }),
		byId,
		scopeIds,
		dir: tmp,
		digest,
	};
}

function closeCorpusStore(c: LoadedCorpus): void {
	c.perf.reset();
	c.store.close();
	rmSync(c.dir, { recursive: true, force: true });
}

function retrieve(
	c: LoadedCorpus,
	arm: BenchArm,
	query: string,
	scope: string,
	queryIndex: number,
): string[] {
	if (arm === "none") return [];
	if (arm === "recent-k") {
		return (c.scopeIds.get(scope) ?? []).slice(0, K);
	}
	if (arm === "random-k") {
		const pool = [...(c.scopeIds.get(scope) ?? [])];
		const rng = xorshift32(RANDOM_K_SEED + queryIndex * 2654435761);
		for (let i = pool.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			const t = pool[i];
			pool[i] = pool[j];
			pool[j] = t;
		}
		return pool.slice(0, K);
	}
	// kevin — the real path. Deterministic mode freezes the clock at DATE_NOW.
	const hits = c.perf.measure("chat.system.transform", () =>
		c.service.getRelevant({
			query,
			scope: scope as "project" | "session",
			bump: false,
			now: new Date(DATE_NOW),
		}),
	);
	return hits.slice(0, K).map((m) => m.id);
}

function scoreRelevant(
	top: readonly string[],
	relevant: readonly string[],
): {
	precision: number;
	recall: number;
	mrr: number;
} {
	const rel = new Set(relevant);
	let hits = 0;
	let firstRank = 0;
	for (let i = 0; i < top.length; i++) {
		if (rel.has(top[i] as string)) {
			hits += 1;
			if (firstRank === 0) firstRank = i + 1;
		}
	}
	return {
		precision: hits / Math.max(1, top.length),
		recall: rel.size === 0 ? 0 : hits / rel.size,
		mrr: firstRank === 0 ? 0 : 1 / firstRank,
	};
}

export async function runBench(corpusDir?: string): Promise<BenchRun> {
	const dir =
		corpusDir ??
		join(fileURLToPath(new URL(".", import.meta.url)), "..", "bench", "corpus");
	const c = await openCorpusStore(dir);
	try {
		const { queries } = loadCorpus(dir);
		const scores = new Map<BenchArm, { p: number; r: number; m: number }>();
		const times = new Map<BenchArm, number[]>();
		for (const arm of ARMS) {
			scores.set(arm, { p: 0, r: 0, m: 0 });
			times.set(arm, []);
		}
		queries.forEach((q, qi) => {
			for (const arm of ARMS) {
				const t0 = performance.now();
				const top = retrieve(c, arm, q.context.query, q.context.scope, qi);
				times.get(arm)?.push(performance.now() - t0);
				const s = scoreRelevant(top, q.relevant);
				const agg = scores.get(arm) as { p: number; r: number; m: number };
				agg.p += s.precision;
				agg.r += s.recall;
				agg.m += s.mrr;
			}
		});
		const n = queries.length || 1;
		const arms = ARMS.map((arm) => {
			const agg = scores.get(arm) as { p: number; r: number; m: number };
			const ts = [...(times.get(arm) as number[])].sort((a, b) => a - b);
			return {
				arm,
				precisionAt5: agg.p / n,
				recallAt5: agg.r / n,
				mrr: agg.m / n,
				p50Ms: percentile(ts, 50),
				p95Ms: percentile(ts, 95),
			};
		});
		return { corpusDigest: c.digest, k: K, queries: queries.length, arms };
	} finally {
		closeCorpusStore(c);
	}
}

export function shouldPersist(argv: readonly string[]): boolean {
	return !argv.some((a) => a === "--no-persist");
}

/**
 * K10-017 — one bench_runs row per arm in the real Kevin store (the table
 * `kevin_bench` reports from), plus the committed results JSON. The
 * retrieval half never touches this store; persistence is write-only.
 */
export async function persistResult(
	result: BenchRun,
	opts?: {
		storePath?: string | null;
		resultsDir?: string | null;
		ranAt?: Date;
	},
): Promise<{ rows: number; file: string | null }> {
	const { contractDigest, describeContract } = await import(
		"../plugin/contract.js"
	);
	const ranAt = opts?.ranAt ?? new Date();
	let packageVersion = "0.0.0";
	try {
		packageVersion =
			(
				JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
					version?: string;
				}
			).version ?? packageVersion;
	} catch {
		// keep the placeholder; the digest and metrics are the identity
	}
	const payload = {
		corpus_digest: result.corpusDigest,
		contract_digest: contractDigest(describeContract()),
		package_version: packageVersion,
		runtime: `node ${process.version}`,
		k: result.k,
		queries: result.queries,
		ran_at: ranAt.toISOString(),
		arms: result.arms,
	};
	if (opts?.resultsDir === null) return { rows: 0, file: null };

	const rows = ARMS.length;
	const storePath =
		opts?.storePath ?? join(homedir(), ".opencode-kevin", "kevin.db");
	if (storePath !== null) {
		mkdirSync(dirname(storePath), { recursive: true });
		const store = new Store({ path: storePath });
		try {
			await new Migrate(store, join(REPO_ROOT, "migrations")).run();
			store.transaction(() => {
				const ins = store.prepare(
					"INSERT INTO bench_runs (corpus_digest, contract_digest, package_version, runtime, arm, k, precision_at_k, recall_at_k, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				);
				for (const a of result.arms) {
					ins.run(
						payload.corpus_digest,
						payload.contract_digest,
						payload.package_version,
						payload.runtime,
						a.arm,
						result.k,
						a.precisionAt5,
						a.recallAt5,
						a.mrr,
					);
				}
			});
			store
				.prepare(
					"UPDATE kevin_metrics SET value = value + 1 WHERE key = 'bench_runs_total'",
				)
				.run();
		} finally {
			store.close();
		}
	}

	const resultsDir = opts?.resultsDir ?? join(REPO_ROOT, "bench", "results");
	mkdirSync(resultsDir, { recursive: true });
	const file = join(
		resultsDir,
		`${ranAt.toISOString().slice(0, 10)}-${result.corpusDigest}.json`,
	);
	writeFileSync(file, `${JSON.stringify(payload, null, "\t")}\n`);
	return { rows, file };
}

async function main(): Promise<void> {
	console.log(
		"Kevin benchmark - four arms over the committed synthetic corpus\n",
	);
	const noPersist = !shouldPersist(process.argv);
	const result = await runBench();
	console.log(
		`corpus digest: ${result.corpusDigest}   k=${result.k}   queries=${result.queries}\n`,
	);
	console.log("arm       precision@5  recall@5   MRR     p50(ms)  p95(ms)");
	for (const a of result.arms) {
		console.log(
			a.arm.padEnd(10) +
				a.precisionAt5.toFixed(4).padStart(8) +
				a.recallAt5.toFixed(4).padStart(10) +
				a.mrr.toFixed(4).padStart(8) +
				a.p50Ms.toFixed(3).padStart(9) +
				a.p95Ms.toFixed(3).padStart(9),
		);
	}
	console.log(
		"\nLimits: synthetic corpus; proves ranking vs recency/random on this corpus only.",
	);
	console.log(
		"It does not prove real sessions resemble it, nor that a surfaced memory changed model behaviour.",
	);
	if (noPersist) {
		console.log("\n--no-persist: no bench_runs rows, no results file.");
		return;
	}
	const saved = await persistResult(result);
	console.log(
		`\npersisted ${saved.rows} bench_runs rows; results file: ${saved.file}`,
	);
}

if (process.argv[1]?.endsWith("bench.ts")) void main();
