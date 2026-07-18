import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../plugin/Store.js";
import { ToolCallObserver } from "../../plugin/ToolCallObserver.js";
import type { Metrics } from "../../plugin/metrics.js";

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
let store: Store;

function makeMigratedStore(): Store {
	const s = new Store({ path: ":memory:" });
	s.exec(SQL_001);
	s.exec(SQL_003);
	return s;
}

function createFakeMetrics() {
	const incr = vi.fn();
	const metrics = {
		incr,
		snapshot: vi.fn(() => ({})),
		get: vi.fn(() => 0),
		flush: vi.fn(),
		close: vi.fn(),
	} as unknown as Metrics;
	return { metrics, incr };
}

function setDedupFlag(s: Store, value: "0" | "1") {
	s.prepare(
		"UPDATE kevin_settings SET value = ? WHERE key = 'tool_calls_dedup_enabled'",
	).run(value);
}

function countToolCalls(): number {
	const row = s_countRow();
	return row?.c ?? 0;
}

function s_countRow(): { c: number } | undefined {
	return store.prepare("SELECT COUNT(*) AS c FROM tool_calls").get() as
		| { c: number }
		| undefined;
}

function fetchFirstRow():
	| {
			id: string;
			tool: string;
			args_summary: string;
			success: number;
			project_id: string | null;
			fingerprint: string | null;
	  }
	| undefined {
	return store
		.prepare(
			"SELECT id, tool, args_summary, success, project_id, fingerprint FROM tool_calls ORDER BY ts ASC LIMIT 1",
		)
		.get() as
		| {
				id: string;
				tool: string;
				args_summary: string;
				success: number;
				project_id: string | null;
				fingerprint: string | null;
		  }
		| undefined;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-tco-dedup-"));
	store = makeMigratedStore();
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ToolCallObserver — v0.2.0 (K2-027) tool_calls dedup opt-in", () => {
	it("default (tool_calls_dedup_enabled='0'): 2 identical invokes both insert", () => {
		const { metrics, incr } = createFakeMetrics();
		const observer = new ToolCallObserver(store, metrics);
		const input = {
			tool: "bash",
			sessionId: "s1",
			args: { command: "npm test" },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		expect(countToolCalls()).toBe(2);
		expect(incr).not.toHaveBeenCalled();
	});

	it("enabled: 2 identical invokes within same minute → only 1 row + tool_calls_deduped bumped", () => {
		const { metrics, incr } = createFakeMetrics();
		const observer = new ToolCallObserver(store, metrics);
		setDedupFlag(store, "1");
		const input = {
			tool: "bash",
			sessionId: "s2",
			args: { command: "npm test" },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		expect(countToolCalls()).toBe(1);
		expect(incr).toHaveBeenCalledWith("tool_calls_deduped", 1);
	});

	it("enabled: different args (different fingerprint) → both insert", () => {
		const { metrics, incr } = createFakeMetrics();
		const observer = new ToolCallObserver(store, metrics);
		setDedupFlag(store, "1");
		const input1 = {
			tool: "bash",
			sessionId: "s3",
			args: { command: "npm test" },
		};
		const input2 = {
			tool: "bash",
			sessionId: "s3",
			args: { command: "npm run lint" },
		};
		observer.onBefore(input1, {});
		observer.onAfter(input1, { success: true, exitCode: 0 });
		observer.onBefore(input2, {});
		observer.onAfter(input2, { success: true, exitCode: 0 });
		expect(countToolCalls()).toBe(2);
		expect(incr).not.toHaveBeenCalled();
	});

	it("enabled: different success state (different fingerprint) → both insert", () => {
		const { metrics, incr } = createFakeMetrics();
		const observer = new ToolCallObserver(store, metrics);
		setDedupFlag(store, "1");
		const input = {
			tool: "bash",
			sessionId: "s4",
			args: { command: "npm test" },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		observer.onBefore(input, {});
		observer.onAfter(input, {
			success: false,
			stderr: "Error: test failed",
			exitCode: 1,
		});
		const n = countToolCalls();
		expect(n).toBe(2);
		expect(incr).not.toHaveBeenCalled();
	});

	it("populates project_id and fingerprint columns on the new INSERT", () => {
		const observer = new ToolCallObserver(store, null);
		const input = {
			tool: "bash",
			sessionId: "s5",
			args: { command: "npm test" },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = fetchFirstRow();
		expect(row).toBeDefined();
		expect(row?.project_id).toBeNull();
		expect(row?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
	});

	it("metrics=null (no Metrics arg): dedup still suppresses duplicate, no crash", () => {
		const observer = new ToolCallObserver(store, null);
		setDedupFlag(store, "1");
		const input = {
			tool: "bash",
			sessionId: "s6",
			args: { command: "npm test" },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		expect(countToolCalls()).toBe(1);
	});
});
