import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "@jmtrin/kevin-core";
import { contractDigest, describeContract } from "@jmtrin/kevin-core";
import { buildAudit } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";
import { BUDGETS } from "@jmtrin/kevin-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
);
const MIGRATIONS_DIR = join(REPO_ROOT, "packages/core/migrations");
const PRE_011 = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
	"008_v07_truth.sql",
	"009_v08_team.sql",
	"010_v09_native.sql",
];

function seedSample(
	store: Store,
	scope: string,
	p95: number,
	withinBudget: number,
): void {
	store
		.prepare(
			"INSERT INTO perf_samples (scope, sample_count, p50_ms, p95_ms, max_ms, budget_p95_ms, within_budget) VALUES (?, 10, ?, ?, ?, ?, ?)",
		)
		.run(scope, p95 * 0.5, p95, p95 * 1.2, p95, withinBudget);
}

let tmpRoot: string;
let storePath: string;
let store: Store;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-audit-pc-"));
	storePath = join(tmpRoot, "kevin.db");
	store = new Store({ path: storePath });
});

afterEach(() => {
	try {
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		// Windows EPERM if a connection lingers; best effort
	}
});

describe("K10-020 — kevin_audit perf and contract blocks", () => {
	it("both blocks appear in the report", async () => {
		const { Migrate } = await import("@jmtrin/kevin-core");
		await new Migrate(store, MIGRATIONS_DIR).run();
		const report = buildAudit(store, new Metrics(store));
		expect(report.contract).toEqual({
			contract_version: 2,
			digest: contractDigest(describeContract()),
			clause_count: describeContract().clauses.length,
			deprecated_count: 0,
		});
		expect(Object.keys(report.perf?.scopes ?? {})).toHaveLength(BUDGETS.length);
	});

	it("an empty perf_samples table reports eight zero-count scopes, never NULL or NaN", async () => {
		const { Migrate } = await import("@jmtrin/kevin-core");
		await new Migrate(store, MIGRATIONS_DIR).run();
		const report = buildAudit(store, new Metrics(store));
		for (const b of BUDGETS) {
			const s = report.perf?.scopes[b.scope];
			expect(s).toBeDefined();
			expect(s?.count).toBe(0);
			expect(s?.p50).toBe(0);
			expect(s?.p95).toBe(0);
			expect(s?.max).toBe(0);
			expect(s?.budget_p95).toBe(b.p95Ms);
			expect(s?.within_budget).toBe(true);
		}
		const out = JSON.stringify(report.perf);
		expect(out).not.toContain("null");
		expect(out.toLowerCase()).not.toContain("nan");
	});

	it("within_budget uses the stored aggregates directly and agrees with bench:check", async () => {
		const { Migrate } = await import("@jmtrin/kevin-core");
		await new Migrate(store, MIGRATIONS_DIR).run();
		const breached = BUDGETS[0].scope;
		const ok = BUDGETS[1].scope;
		seedSample(store, breached, 999, 0);
		seedSample(store, ok, 1, 1);
		const report = buildAudit(store, new Metrics(store));
		expect(report.perf?.scopes[breached]?.within_budget).toBe(false);
		expect(report.perf?.scopes[ok]?.within_budget).toBe(true);
		expect(report.perf?.scopes[breached]?.p95).toBe(999);

		const rows = store
			.prepare(
				"SELECT id, scope, p50_ms, p95_ms, max_ms, budget_p95_ms, within_budget FROM perf_samples",
			)
			.all() as {
			id: number;
			scope: string;
			p50_ms: number;
			p95_ms: number;
			max_ms: number;
			budget_p95_ms: number;
			within_budget: number;
		}[];
		const { checkRows } = await import("../../scripts/bench-check.js");
		const checked = checkRows(rows);
		expect(checked.breaches.map((b) => b.scope)).toEqual([breached]);
	});

	it("a pre-011 database omits the perf block without marking partial", () => {
		for (const name of PRE_011) {
			store.exec(
				readFileSync(join(REPO_ROOT, "packages/core/migrations", name), "utf8"),
			);
		}
		const report = buildAudit(store, new Metrics(store));
		expect(report.perf).toBeUndefined();
		expect(report.contract).toBeDefined();
		// v1.4.0: mcp gated on 013 channel column, so pre-011 (up to 010) is partial true
		expect(report.partial).toBe(true);
	});
});
