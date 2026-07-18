import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import { METRIC_KEYS, type Metrics } from "../../plugin/metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-mem-v02-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

/** Builds a fake Metrics with a spy on incr so tests can assert calls. */
function makeFakeMetrics(): {
	metrics: Metrics;
	incrSpy: ReturnType<typeof vi.fn>;
} {
	const calls: { key: string; by: number }[] = [];
	const incrSpy = vi.fn((key: string, by = 1) => {
		calls.push({ key, by });
	});
	const snapshot = vi.fn(() => {
		const out = {} as Record<string, number>;
		for (const k of METRIC_KEYS) out[k] = 0;
		// reflect observed duplicate_suppressions
		const dup = calls.filter((c) => c.key === "duplicate_suppressions");
		if (dup.length > 0) out.duplicate_suppressions = dup.length;
		return out;
	});
	const metrics = {
		incr: incrSpy,
		snapshot,
		get: vi.fn(() => 0),
		flush: vi.fn(),
		close: vi.fn(),
	} as unknown as Metrics & {
		incr: typeof incrSpy;
		snapshot: typeof snapshot;
	};
	return { metrics, incrSpy };
}

describe("MemoryService v0.2.0 — origin/project/fingerprint/dedup (K2-006)", () => {
	it("defaults origin='agent' when not provided", () => {
		const svc = new MemoryService(store);
		const id = svc.save({ type: "error", content: "boom" });
		const mem = svc.getById(id);
		expect(mem?.origin).toBe("agent");
	});

	it("persists projectId and origin when provided", () => {
		const svc = new MemoryService(store);
		const id = svc.save({
			type: "error",
			content: "boom",
			projectId: "proj-A",
			origin: "reflector",
		});
		const mem = svc.getById(id);
		expect(mem?.origin).toBe("reflector");
		expect(mem?.projectId).toBe("proj-A");
	});

	it("auto-derives fingerprint for type='error' reflecting normalized content + project", () => {
		const svc = new MemoryService(store);
		const id = svc.save({
			type: "error",
			content: "TypeScript error TS2304 in src/foo.ts:42",
			projectId: "proj-A",
			origin: "reflector",
		});
		const mem = svc.getById(id);
		expect(mem?.fingerprint).toBeTruthy();
		expect(typeof mem?.fingerprint).toBe("string");
		expect(mem?.fingerprint?.length).toBeGreaterThan(0);
	});

	it("does NOT compute fingerprint for non-error types (NULL)", () => {
		const svc = new MemoryService(store);
		const id = svc.save({
			type: "decision",
			content: "use vitest",
			projectId: "proj-A",
		});
		const mem = svc.getById(id);
		expect(mem?.fingerprint).toBeNull();
	});

	it("dedups reflector-sourced identical error within same project and returns existing id", () => {
		const { metrics, incrSpy } = makeFakeMetrics();
		const svc = new MemoryService(store, metrics);
		const first = svc.save({
			type: "error",
			content: "TS2304 cannot find name 'foo'",
			projectId: "proj-A",
			origin: "reflector",
		});
		const second = svc.save({
			type: "error",
			content: "TS2304 cannot find name 'foo'",
			projectId: "proj-A",
			origin: "reflector",
		});
		expect(second).toBe(first);
		const count = store
			.prepare(
				"SELECT COUNT(*) AS c FROM memories WHERE type='error' AND origin='reflector'",
			)
			.get() as { c: number };
		expect(count.c).toBe(1);
		expect(incrSpy).toHaveBeenCalledWith("duplicate_suppressions", 1);
	});

	it("agent-origin identical error does NOT collide (partial unique is reflector-only)", () => {
		const svc = new MemoryService(store);
		const a1 = svc.save({
			type: "error",
			content: "identical boom",
			projectId: "proj-A",
			origin: "agent",
		});
		const a2 = svc.save({
			type: "error",
			content: "identical boom",
			projectId: "proj-A",
			origin: "agent",
		});
		expect(a1).not.toBe(a2);
		const count = store
			.prepare(
				"SELECT COUNT(*) AS c FROM memories WHERE type='error' AND origin='agent'",
			)
			.get() as { c: number };
		expect(count.c).toBe(2);
	});

	it("identical reflector error across different projects does NOT collide (project_id participates in unique index)", () => {
		const svc = new MemoryService(store);
		const a = svc.save({
			type: "error",
			content: "TS2304 cannot find 'x'",
			projectId: "proj-A",
			origin: "reflector",
		});
		const b = svc.save({
			type: "error",
			content: "TS2304 cannot find 'x'",
			projectId: "proj-B",
			origin: "reflector",
		});
		expect(a).not.toBe(b);
	});

	it("fingerprint collisions respect whitespace/path normalization (src/foo.ts:4 == src/bar.ts:9 with same body)", () => {
		const svc = new MemoryService(store);
		const a = svc.save({
			type: "error",
			content: "TS2304 cannot find 'x' at src/foo.ts:4",
			projectId: "proj-A",
			origin: "reflector",
		});
		const b = svc.save({
			type: "error",
			content: "TS2304 cannot find 'x' at src/bar.ts:9",
			projectId: "proj-A",
			origin: "reflector",
		});
		// Path/line refs stripped during fingerprinting → same fp → dedup path
		expect(b).toBe(a);
	});

	it("save() with explicit fingerprint provided bypasses re-computation", () => {
		const svc = new MemoryService(store);
		const id = svc.save({
			type: "error",
			content: "boom A",
			projectId: "proj-X",
			origin: "reflector",
			fingerprint: "deadbeefdeadbeef",
		});
		const mem = svc.getById(id);
		expect(mem?.fingerprint).toBe("deadbeefdeadbeef");
	});

	it("query/getRelevant return rows exposing the new fields", () => {
		const svc = new MemoryService(store);
		svc.save({
			type: "error",
			content: "typecheck failure for foo",
			projectId: "proj-A",
			origin: "reflector",
		});
		const rows = svc.query({ text: "typecheck", full: true });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0].origin).toBe("reflector");
		expect(rows[0].projectId).toBe("proj-A");
		expect(rows[0].fingerprint).toBeTruthy();
	});

	it("MemoryRow mapping falls back to null for projectId/fingerprint on legacy-style inserts (origin defaults to 'agent' per migration 003 DEFAULT)", () => {
		// Insert a row that doesn't populate the new v0.2.0 columns at all
		// (mimicking a pre-003 INSERT into a post-003 DB). Migration 003
		// declares `origin TEXT NOT NULL DEFAULT 'agent' CHECK(...)`, so
		// origin coerces to 'agent' but projectId/fingerprint stay NULL.
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score,
				        source_tool, source_session, metadata, expires_at)
				    VALUES ('legacy-1', 'context', 'legacy', 'project', 0.5, NULL, NULL, NULL, NULL)`,
			)
			.run();
		const svc = new MemoryService(store);
		const mem = svc.getById("legacy-1");
		expect(mem).not.toBeNull();
		expect(mem?.origin).toBe("agent");
		expect(mem?.projectId).toBeNull();
		expect(mem?.fingerprint).toBeNull();
	});
});
