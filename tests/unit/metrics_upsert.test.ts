import { describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

describe("K12-001 — metrics upsert for 1.2.0 counters", () => {
	it("first incr on missing row creates value 1 via flush", () => {
		const store = new Store({ path: ":memory:" });
		// kevin_metrics table created lazily by flush; ensure it exists
		const m = new Metrics(store, 0);
		// tui_snapshots_flushed is new, not seeded by migration on :memory:
		m.incr("tui_snapshots_flushed");
		m.flush();
		const row = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
			.get("tui_snapshots_flushed") as { value: number } | undefined;
		expect(row?.value).toBe(1);
		m.incr("tui_snapshots_flushed");
		m.flush();
		const row2 = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
			.get("tui_snapshots_flushed") as { value: number } | undefined;
		expect(row2?.value).toBe(2);
		store.close();
	});

	it("tui_actions_invoked also upserts on first incr", () => {
		const store = new Store({ path: ":memory:" });
		const m = new Metrics(store, 0);
		m.incr("tui_actions_invoked");
		m.flush();
		const row = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
			.get("tui_actions_invoked") as { value: number } | undefined;
		expect(row?.value).toBe(1);
		store.close();
	});
});
