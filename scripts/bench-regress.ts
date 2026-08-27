#!/usr/bin/env tsx
// v1.1.0 (K11-009 / plan §5.4, D11-03/D11-10) — benchmark regression gate
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type BenchPoint, compareResults } from "./bench-compare.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

function parseBenchFile(filePath: string): BenchPoint[] {
	const raw = readFileSync(filePath, "utf8");
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (e) {
		console.error(`Failed to parse ${filePath}: ${(e as Error).message}`);
		process.exit(2);
	}
	const obj = json as Record<string, unknown>;
	const arms = (obj.arms ?? obj.results ?? []) as Array<
		Record<string, unknown>
	>;
	if (!Array.isArray(arms)) {
		console.error(`Invalid bench file ${filePath}: missing arms array`);
		process.exit(2);
	}
	return arms.map((a) => {
		const arm = String(a.arm ?? a.name ?? "unknown");
		// tolerate both camelCase (bench.ts) and snake_case (bench-compare)
		const precision = (a.precisionAt5 ?? a.precision_at_k ?? a.precision) as
			| number
			| undefined;
		const recall = (a.recallAt5 ?? a.recall_at_k ?? a.recall) as
			| number
			| undefined;
		const mrr = a.mrr as number | undefined;
		if (
			typeof precision !== "number" ||
			typeof recall !== "number" ||
			typeof mrr !== "number"
		) {
			console.error(
				`Invalid bench file ${filePath}: arm ${arm} missing metrics`,
			);
			process.exit(2);
		}
		return { arm, precision_at_k: precision, recall_at_k: recall, mrr };
	});
}

function listResultFiles(resultsDir: string): string[] {
	if (!existsSync(resultsDir)) return [];
	const files = readdirSync(resultsDir).filter((f) => f.endsWith(".json"));
	files.sort(); // ascending by filename (date-prefixed)
	return files.map((f) => join(resultsDir, f));
}

export async function main(
	argv: readonly string[] = process.argv,
): Promise<number> {
	let resultsDir = join(REPO_ROOT, "bench", "results");
	const dirIdx = argv.indexOf("--results-dir");
	if (dirIdx !== -1 && argv[dirIdx + 1]) {
		resultsDir = argv[dirIdx + 1];
	}

	const files = listResultFiles(resultsDir);
	if (files.length < 2) {
		console.log(
			`bench:regress — only ${files.length} result file(s) in ${resultsDir}; nothing to compare (need ≥2).`,
		);
		return 0;
	}
	const prevFile = files[files.length - 2] as string;
	const currFile = files[files.length - 1] as string;

	let prev: BenchPoint[];
	let curr: BenchPoint[];
	try {
		prev = parseBenchFile(prevFile);
		curr = parseBenchFile(currFile);
	} catch (e) {
		console.error(`Corrupted JSON: ${(e as Error).message}`);
		return 2;
	}

	// Print fixed-width table
	console.log(`Comparing ${prevFile} → ${currFile}`);
	console.log("arm        metric        prev    curr    delta");
	console.log("------------------------------------------------");
	const prevMap = new Map(prev.map((p) => [p.arm, p]));
	const currMap = new Map(curr.map((c) => [c.arm, c]));
	const arms = new Set([...prevMap.keys(), ...currMap.keys()]);
	for (const arm of [...arms].sort()) {
		const p = prevMap.get(arm);
		const c = currMap.get(arm);
		if (!p || !c) {
			console.log(`${arm.padEnd(10)} missing in ${!p ? "prev" : "curr"}`);
			continue;
		}
		for (const [metric, pv, cv] of [
			["precision@k", p.precision_at_k, c.precision_at_k],
			["recall@k", p.recall_at_k, c.recall_at_k],
			["mrr", p.mrr, c.mrr],
		] as const) {
			const delta = cv - pv;
			console.log(
				`${arm.padEnd(10)} ${metric.padEnd(12)} ${pv.toFixed(4).padStart(7)} ${cv.toFixed(4).padStart(7)} ${delta.toFixed(4).padStart(7)}`,
			);
		}
	}

	const result = compareResults(prev, curr);
	if (!result.ok) {
		// filter warnings: only real failures cause exit 1
		const realFailures = result.failures.filter(
			(f) => !f.startsWith("warning:"),
		);
		if (realFailures.length > 0) {
			console.error("\nRegression failures:");
			for (const f of realFailures) console.error(`  - ${f}`);
			// Best-effort metric increment when KEVIN_REGRESS_DB=1
			if (process.env.KEVIN_REGRESS_DB === "1") {
				try {
					const { Store } = await import("../plugin/Store.js");
					const { homedir } = await import("node:os");
					const dbPath = join(homedir(), ".opencode-kevin", "kevin.db");
					if (existsSync(dbPath)) {
						const store = new Store({ path: dbPath });
						try {
							store
								.prepare(
									`INSERT INTO kevin_metrics (key, value, updated_at) VALUES ('bench_regression_failures', 1, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = value + 1, updated_at = datetime('now')`,
								)
								.run();
						} finally {
							store.close();
						}
					}
				} catch {
					// never block gate on DB errors
				}
			}
			return 1;
		}
	}
	console.log("\nNo regression detected.");
	return 0;
}

if (process.argv[1]?.endsWith("bench-regress.ts")) {
	void main().then((code) => process.exit(code));
}
