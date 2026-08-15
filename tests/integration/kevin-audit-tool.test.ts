import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { buildAudit } from "../../plugin/kevin_audit.js";
import { Metrics } from "../../plugin/metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = (name: string) =>
	readFileSync(join(__dirname, "..", "..", "migrations", name), "utf8");

function makeMigratedStore(): Store {
	const s = new Store({ path: ":memory:" });
	for (const sql of [
		SQL("001_initial.sql"),
		SQL("003_v02_signal.sql"),
		SQL("004_v03_knowledge.sql"),
		SQL("005_v04_signal.sql"),
		SQL("006_v05_glassbox.sql"),
	]) {
		s.exec(sql);
	}
	return s;
}

function seedInjection(store: Store, outcome: string, id: string): void {
	store
		.prepare(
			`INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, outcome, tokens)
			 VALUES (?, 'mem-x', 'fp-x', 's-1', 'pre_prompt', ?, 1)`,
		)
		.run(id, outcome);
}

function seedFeedback(store: Store, verdict: string, id: string): void {
	store
		.prepare(
			`INSERT INTO memory_feedback (id, memory_id, verdict, session_id)
			 VALUES (?, 'mem-x', ?, 's-1')`,
		)
		.run(id, verdict);
}

describe("K5-016 — buildAudit (kevin_audit)", () => {
	it("fresh migrated DB: every numeric field is 0, no undefined/NaN", () => {
		const store = makeMigratedStore();
		const metrics = new Metrics(store);
		const report = buildAudit(store, metrics);
		// v0.6.0 (K6-023): this fixture is a pre-007 database, so the
		// channels/curation blocks are OMITTED and the report is flagged
		// partial — a scoreboard that cannot be computed must say so.
		expect(report.partial).toBe(true);
		expect(report.channels).toBeUndefined();
		expect(report.curation).toBeUndefined();
		expect(report.memories.total).toBe(0);
		expect(report.memories.by_status).toEqual({});
		expect(report.memories.ignored).toBe(0);
		expect(report.injections.total).toBe(0);
		expect(report.injections.precision_rate).toBe(0);
		expect(report.injections.coverage_rate).toBe(0);
		expect(report.blocked).toEqual({
			seen: 0,
			weak: 0,
			recurrence: 0,
			stale: 0,
			ignored: 0,
			confidence: 0,
		});
		expect(report.feedback.positive).toBe(0);
		expect(report.feedback.by_verdict).toEqual({});
		expect(report.tokens.pre_prompt).toBe(0);
		expect(report.tokens.compacting).toBe(0);
		expect(JSON.stringify(report)).not.toContain("undefined");
		expect(JSON.stringify(report)).not.toContain("NaN");
		expect(JSON.stringify(report)).not.toContain("kevin_context_ratio");
	});

	it("reports precision_rate ≈ 0.667 and coverage_rate = 0.3 after seeding", () => {
		const store = makeMigratedStore();
		const metrics = new Metrics(store);
		seedInjection(store, "effective", "inj-1");
		seedInjection(store, "effective", "inj-2");
		seedInjection(store, "ineffective", "inj-3");
		for (let i = 0; i < 7; i++) {
			seedInjection(store, "inconclusive", `inj-c-${i}`);
		}
		metrics.incr("injections_total", 10);
		metrics.incr("injections_effective", 2);
		metrics.incr("injections_ineffective", 1);
		metrics.incr("injections_inconclusive", 7);
		metrics.flush();
		const report = buildAudit(store, metrics);
		expect(report.injections.total).toBe(10);
		expect(report.injections.effective).toBe(2);
		expect(report.injections.ineffective).toBe(1);
		expect(report.injections.inconclusive).toBe(7);
		expect(report.injections.precision_rate).toBeCloseTo(0.667, 2);
		expect(report.injections.coverage_rate).toBe(0.3);
	});

	it("feedback.by_verdict aggregates after useful/wrong/ignore calls", () => {
		const store = makeMigratedStore();
		const metrics = new Metrics(store);
		seedFeedback(store, "useful", "fb-1");
		seedFeedback(store, "wrong", "fb-2");
		seedFeedback(store, "ignore", "fb-3");
		metrics.incr("feedback_positive_total", 1);
		metrics.incr("feedback_negative_total", 1);
		metrics.flush();
		const report = buildAudit(store, metrics);
		expect(report.feedback.by_verdict).toEqual({
			useful: 1,
			wrong: 1,
			ignore: 1,
		});
		expect(report.feedback.positive).toBe(1);
		expect(report.feedback.negative).toBe(1);
	});

	it("memories block counts status/origin/type, ignored, archived, superseded", () => {
		const store = makeMigratedStore();
		store
			.prepare(
				`INSERT INTO memories (id, type, origin, content, fingerprint, status, ignored, feedback_positive, superseded_by, archived_at)
				 VALUES ('m-1', 'error', 'reflector', 'l1', 'f1', 'archived', 0, 0, NULL, '2026-01-01'),
				        ('m-2', 'decision', 'agent', 'l2', 'f2', 'superseded', 0, 0, 'm-3', NULL),
				        ('m-3', 'rule', 'pattern', 'l3', 'f3', 'active', 1, 2, NULL, NULL)`,
			)
			.run();
		const metrics = new Metrics(store);
		const report = buildAudit(store, metrics);
		expect(report.memories.total).toBe(3);
		expect(report.memories.by_status).toEqual({
			archived: 1,
			superseded: 1,
			active: 1,
		});
		expect(report.memories.by_origin).toEqual({
			reflector: 1,
			agent: 1,
			pattern: 1,
		});
		expect(report.memories.by_type).toEqual({
			error: 1,
			decision: 1,
			rule: 1,
		});
		expect(report.memories.ignored).toBe(1);
		expect(report.memories.archived).toBe(1);
		expect(report.memories.with_feedback).toBe(1);
		expect(report.memories.superseded_with_target).toBe(1);
	});

	it("blocked reflects the six counters", () => {
		const store = makeMigratedStore();
		const metrics = new Metrics(store);
		metrics.incr("injections_blocked_seen", 3);
		metrics.incr("injections_blocked_weak", 2);
		metrics.incr("injections_blocked_recurrence", 1);
		metrics.incr("injections_blocked_stale", 4);
		metrics.incr("injections_blocked_ignored", 5);
		metrics.incr("injections_blocked_confidence", 6);
		metrics.flush();
		const report = buildAudit(store, metrics);
		expect(report.blocked).toEqual({
			seen: 3,
			weak: 2,
			recurrence: 1,
			stale: 4,
			ignored: 5,
			confidence: 6,
		});
	});

	it("read-only: two calls return identical output and change nothing", () => {
		const store = makeMigratedStore();
		const metrics = new Metrics(store);
		seedInjection(store, "effective", "inj-1");
		seedFeedback(store, "useful", "fb-1");
		metrics.incr("injections_effective", 1);
		metrics.incr("feedback_positive_total", 1);
		metrics.flush();
		const before = store
			.prepare("SELECT COUNT(*) AS n FROM kevin_injections")
			.get() as { n: number };
		const report1 = buildAudit(store, metrics);
		const report2 = buildAudit(store, metrics);
		const after = store
			.prepare("SELECT COUNT(*) AS n FROM kevin_injections")
			.get() as { n: number };
		expect(report1).toEqual(report2);
		expect(JSON.stringify(report1)).toBe(JSON.stringify(report2));
		expect(after.n).toBe(before.n);
	});

	it("degrades with partial=true on a pre-006 database", () => {
		const store = new Store({ path: ":memory:" });
		for (const sql of [
			SQL("001_initial.sql"),
			SQL("003_v02_signal.sql"),
			SQL("004_v03_knowledge.sql"),
			SQL("005_v04_signal.sql"),
		]) {
			store.exec(sql);
		}
		store
			.prepare(
				"INSERT INTO memories (id, type, origin, content, fingerprint, status) VALUES ('m-1', 'error', 'agent', 'l1', 'f1', 'active')",
			)
			.run();
		const metrics = new Metrics(store);
		const report = buildAudit(store, metrics);
		expect(report.partial).toBe(true);
		expect(report.memories.total).toBe(1);
		expect(report.memories.ignored).toBe(0);
		expect(report.injections.total).toBe(0);
		expect(report.feedback.by_verdict).toEqual({});
	});
});
