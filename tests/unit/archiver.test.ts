import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Archiver } from "../../plugin/Archiver.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

function sql(name: string): string {
	return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function makeStore(): Store {
	const store = new Store({ path: ":memory:" });
	for (const name of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
	]) {
		store.exec(sql(name));
	}
	return store;
}

/** Insert a memory row directly with explicit timestamps (status included). */
function insertRow(
	store: Store,
	over: { id: string; status: string; updatedAt: string; type?: string },
): void {
	store
		.prepare(
			`INSERT INTO memories
			   (id, type, scope, content, relevance_score, source_tool, source_session,
			    metadata, created_at, updated_at, expires_at, project_id, fingerprint,
			    origin, status)
			 VALUES (?, ?, 'project', ?, 0.5, NULL, NULL, NULL, ?, ?, NULL, NULL, ?, 'agent', ?)`,
		)
		.run(
			over.id,
			over.type ?? "error",
			"bash fails with tsc-1",
			over.updatedAt,
			over.updatedAt,
			`fp-${over.id}`,
			over.status,
		);
}

describe("K5-012 — Archiver stale→archived (D5-05)", () => {
	let store: Store;
	let metrics: Metrics;
	let svc: MemoryService;

	beforeEach(() => {
		store = makeStore();
		metrics = new Metrics(store);
		svc = new MemoryService(store);
	});

	it("archives stale memories older than archive_after_days", () => {
		const archiver = new Archiver(
			store,
			svc,
			metrics,
			() => new Date("2026-09-01T00:00:00Z"),
		);
		insertRow(store, {
			id: "old",
			status: "stale",
			updatedAt: "2026-06-01 00:00:00",
		});
		insertRow(store, {
			id: "fresh",
			status: "stale",
			updatedAt: "2026-08-20 00:00:00",
		});
		const n = archiver.run();
		expect(n).toBe(1);
		const old = store
			.prepare("SELECT status, archived_at FROM memories WHERE id = 'old'")
			.get() as {
			status: string;
			archived_at: string;
		};
		expect(old.status).toBe("archived");
		expect(old.archived_at).toBe("2026-09-01 00:00:00");
		const fresh = store
			.prepare("SELECT status FROM memories WHERE id = 'fresh'")
			.get() as {
			status: string;
		};
		expect(fresh.status).toBe("stale");
		expect(metrics.get("memories_archived")).toBe(1);
	});

	it("never archives patterns (kevin_why contract)", () => {
		const archiver = new Archiver(
			store,
			svc,
			metrics,
			() => new Date("2026-09-01T00:00:00Z"),
		);
		insertRow(store, {
			id: "pat",
			type: "pattern",
			status: "stale",
			updatedAt: "2026-01-01 00:00:00",
		});
		expect(archiver.run()).toBe(0);
		const row = store
			.prepare("SELECT status FROM memories WHERE id = 'pat'")
			.get() as {
			status: string;
		};
		expect(row.status).toBe("stale");
	});

	it("active and already-archived rows are left alone", () => {
		const archiver = new Archiver(
			store,
			svc,
			metrics,
			() => new Date("2026-09-01T00:00:00Z"),
		);
		insertRow(store, {
			id: "active",
			status: "active",
			updatedAt: "2026-01-01 00:00:00",
		});
		insertRow(store, {
			id: "done",
			status: "archived",
			updatedAt: "2026-01-01 00:00:00",
		});
		expect(archiver.run()).toBe(0);
	});

	it("second run archives nothing (idempotent)", () => {
		const archiver = new Archiver(
			store,
			svc,
			metrics,
			() => new Date("2026-09-01T00:00:00Z"),
		);
		insertRow(store, {
			id: "old",
			status: "stale",
			updatedAt: "2026-06-01 00:00:00",
		});
		expect(archiver.run()).toBe(1);
		expect(archiver.run()).toBe(0);
		expect(metrics.get("memories_archived")).toBe(1);
	});

	it("archive_after_days=0 disables archiving", () => {
		store
			.prepare(
				"UPDATE kevin_settings SET value = '0' WHERE key = 'archive_after_days'",
			)
			.run();
		const archiver = new Archiver(
			store,
			svc,
			metrics,
			() => new Date("2026-09-01T00:00:00Z"),
		);
		insertRow(store, {
			id: "old",
			status: "stale",
			updatedAt: "2026-01-01 00:00:00",
		});
		expect(archiver.run()).toBe(0);
	});

	it("pre-006 DB (no archived_at column) degrades to a no-op", () => {
		const preStore = new Store({ path: ":memory:" });
		for (const name of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
		]) {
			preStore.exec(sql(name));
		}
		const archiver = new Archiver(preStore, svc, metrics, () => new Date());
		expect(archiver.run()).toBe(0);
		preStore.close();
	});
});
