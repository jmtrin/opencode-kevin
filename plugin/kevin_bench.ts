/**
 * K10-019 — kevin_bench: reports what `npm run bench` recorded.
 *
 * It NEVER runs the benchmark — running it from inside a live session
 * would measure the session and pollute the user's database. The module
 * imports nothing from scripts/bench.ts; the corpus digest of the on-disk
 * corpus is recomputed here with the same fnv1a64 discipline so a result
 * computed from a different corpus is visibly a different measurement.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./Store.js";
import { fnv1a64 } from "./fingerprint.js";

export interface KevinBenchDeps {
	store: Store;
	/** Working directory used to locate bench/corpus (defaults process.cwd()). */
	cwd?: string;
}

export interface KevinBenchArgs {
	action: "status" | "last";
}

interface BenchRow {
	arm: string;
	k: number;
	precision_at_k: number;
	recall_at_k: number;
	mrr: number;
}

function onDiskCorpusDigest(
	cwd: string,
): { digest: string; queries: number } | null {
	try {
		const dir = join(cwd, "bench", "corpus");
		statSync(dir);
		const mem = readFileSync(join(dir, "memories.jsonl"), "utf8");
		const q = readFileSync(join(dir, "queries.jsonl"), "utf8");
		return {
			digest: fnv1a64(`${mem}\n${q}`),
			queries: q.split("\n").filter((l) => l.trim().length > 0).length,
		};
	} catch {
		return null;
	}
}

function noRuns(): Record<string, unknown> {
	return {
		has_runs: false,
		hint: "npm run bench",
	};
}

export function buildKevinBench(
	deps: KevinBenchDeps,
	args: KevinBenchArgs,
): Record<string, unknown> {
	if (args.action === "status") {
		const count = deps.store
			.prepare("SELECT COUNT(*) AS c FROM bench_runs")
			.get() as { c: number };
		if (!count || count.c === 0) return noRuns();
		const latest = deps.store
			.prepare(
				"SELECT corpus_digest, contract_digest, package_version, runtime, ran_at FROM bench_runs ORDER BY id DESC LIMIT 1",
			)
			.get() as
			| {
					corpus_digest: string;
					contract_digest: string;
					package_version: string;
					runtime: string;
					ran_at: string;
			  }
			| undefined;
		if (!latest) return noRuns();
		const disk = onDiskCorpusDigest(deps.cwd ?? process.cwd());
		return {
			has_runs: true,
			total_runs: count.c,
			corpus_digest: latest.corpus_digest,
			contract_digest: latest.contract_digest,
			package_version: latest.package_version,
			runtime: latest.runtime,
			last_ran_at: latest.ran_at,
			corpus_on_disk: disk === null ? null : disk.digest,
			matches_disk_corpus:
				disk !== null && disk.digest === latest.corpus_digest,
		};
	}

	const latest = deps.store
		.prepare(
			"SELECT corpus_digest, contract_digest, package_version, runtime, ran_at FROM bench_runs ORDER BY id DESC LIMIT 1",
		)
		.get() as
		| {
				corpus_digest: string;
				contract_digest: string;
				package_version: string;
				runtime: string;
				ran_at: string;
		  }
		| undefined;
	if (!latest) return noRuns();
	const rows = deps.store
		.prepare(
			"SELECT arm, k, precision_at_k, recall_at_k, mrr FROM bench_runs WHERE corpus_digest = ? AND ran_at = ?",
		)
		.all(latest.corpus_digest, latest.ran_at) as BenchRow[];
	return {
		has_runs: true,
		corpus_digest: latest.corpus_digest,
		contract_digest: latest.contract_digest,
		package_version: latest.package_version,
		runtime: latest.runtime,
		ran_at: latest.ran_at,
		arms: rows.map((r) => ({
			arm: r.arm,
			k: r.k,
			precision_at_k: r.precision_at_k,
			recall_at_k: r.recall_at_k,
			mrr: r.mrr,
		})),
	};
}
