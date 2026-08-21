// v1.0.0 (K10-011 / plan §5.2) — the bench:check gate.
// Reads the most recent perf_samples row per scope, compares against BUDGETS,
// prints a table, exits non-zero on any p95 breach naming the scope, its p95
// and its budget.
import { homedir } from "node:os";
import { join } from "node:path";
import { Store } from "../plugin/Store.js";
import { BUDGETS } from "../plugin/perf.js";

interface Row {
	id: number;
	scope: string;
	p50_ms: number;
	p95_ms: number;
	max_ms: number;
	budget_p95_ms: number;
	within_budget: number;
}

function resolveDbPath(): string {
	return join(homedir(), ".opencode-kevin", "kevin.db");
}

export function checkRows(rows: readonly Row[]): {
	breaches: readonly Row[];
	lines: readonly string[];
} {
	const lines: string[] = [];
	const breaches: Row[] = [];
	lines.push(
		"scope                     count-p50-p95-max (ms)   budget_p95  within",
	);
	for (const b of BUDGETS) {
		// Most recent row per scope — by insertion id, never by a value
		// column: ordering on p50 let an old slow period shadow the latest
		// good sample (review fix, v1.0.0).
		const row = rows
			.filter((r) => r.scope === b.scope)
			.sort((a, b2) => a.id - b2.id)
			.at(-1);
		if (!row) {
			lines.push(
				`${b.scope.padEnd(25)} no samples              ${String(b.p95Ms).padStart(6)} ms   true`,
			);
			continue;
		}
		const within = row.within_budget === 1;
		lines.push(
			`${row.scope.padEnd(25)} p50=${String(row.p50_ms).padStart(8)} p95=${String(row.p95_ms).padStart(8)} max=${String(row.max_ms).padStart(8)}  budget=${String(b.p95Ms).padStart(4)} ms  within_budget=${within}`,
		);
		if (!within) breaches.push(row);
	}
	return { breaches, lines };
}

function main(): void {
	const dbPath = resolveDbPath();
	let rows: Row[] = [];
	try {
		const store = new Store({ path: dbPath });
		try {
			rows = store
				.prepare(
					"SELECT id, scope, p50_ms, p95_ms, max_ms, budget_p95_ms, within_budget FROM perf_samples",
				)
				.all() as Row[];
		} finally {
			store.close();
		}
	} catch {
		console.error(
			"bench:check — cannot open perf database at ~/.opencode-kevin/kevin.db",
		);
		process.exit(1);
	}
	const { breaches, lines } = checkRows(rows);
	for (const l of lines) console.log(l);
	if (breaches.length > 0) {
		for (const r of breaches) {
			const budget = BUDGETS.find((b) => b.scope === r.scope);
			console.error(
				`BREACH: ${r.scope} p95=${r.p95_ms} ms exceeds budget ${budget?.p95Ms ?? r.budget_p95_ms} ms`,
			);
		}
		process.exit(1);
	}
	console.log("bench:check — all scopes within budget");
}

if (
	import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
	process.argv[1]?.endsWith("bench-check.ts")
) {
	main();
}
