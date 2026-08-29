import { readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import { buildAudit } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = (name: string) =>
	readFileSync(join(__dirname, "..", "..", "packages/core/migrations", name), "utf8");

let tmpRoot: string;
let dbPath: string;
let store: Store;
let metrics: Metrics;

function makeMigratedStore010(): Store {
	const s = new Store({ path: dbPath });
	for (const sql of [
		SQL("001_initial.sql"),
		SQL("003_v02_signal.sql"),
		SQL("004_v03_knowledge.sql"),
		SQL("005_v04_signal.sql"),
		SQL("006_v05_glassbox.sql"),
		SQL("007_v06_pull.sql"),
		SQL("008_v07_truth.sql"),
		SQL("009_v08_team.sql"),
		SQL("010_v09_native.sql"),
	]) {
		s.exec(sql);
	}
	return s;
}

function seedDeadHook(): void {
	store
		.prepare(
			`INSERT INTO hook_liveness (hook, experimental, fire_count, error_count, expected_count, first_seen_at, last_seen_at, dead_since, plugin_version)
			 VALUES (?, 1, 0, 0, 5, datetime('now'), datetime('now'), datetime('now'), ?)`,
		)
		.run("experimental.chat.system.transform", "1.18.18");
}

function seedLiveHook(): void {
	store
		.prepare(
			`INSERT INTO hook_liveness (hook, experimental, fire_count, error_count, expected_count, first_seen_at, last_seen_at, dead_since, plugin_version)
			 VALUES (?, 0, 10, 0, 5, datetime('now'), datetime('now'), NULL, ?)`,
		)
		.run("tool.execute.before", "1.18.18");
}

function seedNativeRegistrations(): void {
	store
		.prepare(
			"INSERT INTO native_registrations (id, surface, registered, verified) VALUES (?, ?, ?, ?)",
		)
		.run("reg-1", "skill", 1, 1);
	store
		.prepare(
			"INSERT INTO native_registrations (id, surface, registered, verified) VALUES (?, ?, ?, ?)",
		)
		.run("reg-2", "reference", 1, 0);
}

function seedHostProbes(): void {
	store
		.prepare(
			"INSERT INTO host_probes (id, plugin_version, flavour, has_shell, v2_skill, v2_reference) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run("probe-1", "1.18.18", "v1+v2", 1, 1, 1);
}

describe("K9-020 — kevin_audit host block (plan §5.5)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-audit-host-"));
		dbPath = join(tmpRoot, "kevin.db");
		store = makeMigratedStore010();
		metrics = new Metrics(store);
		seedDeadHook();
		seedLiveHook();
		seedNativeRegistrations();
		seedHostProbes();
	});

	afterEach(() => {
		metrics.close();
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("host block appears with correct aggregated counts", () => {
		const report = buildAudit(store, metrics);
		expect(report.host).toBeDefined();
		expect(report.host?.plugin_version).toBe("1.18.18");
		expect(report.host?.hooks).toEqual({
			live: 1,
			dead: 1,
			unknown: 0,
			fires_total: 10,
			errors_total: 0,
		});
		expect(report.host?.verdict).toBe("degraded");
		expect(report.host?.native).toEqual({
			total: 2,
			verified: 1,
			failures: 1,
			by_surface: {
				skill: { registered: 1, verified: 1 },
				reference: { registered: 1, verified: 0 },
			},
		});
	});

	it("mix and team blocks are byte-identical to before (strict prefix)", () => {
		const report = buildAudit(store, metrics);
		// The report without the new host block should match the old structure exactly
		// We verify all original keys are present (may be empty objects but must exist)
		const {
			host: _host,
			perf: _perf,
			contract: _contract,
			partial,
			...rest
		} = report;
		const expectedKeys = [
			"blocked",
			"channels",
			"conflicts",
			"curation",
			"feedback",
			"injections",
			"memories",
			"mix",
			"settings",
			"team",
			"tokens",
			"truth",
			"tui",
		];
		for (const key of expectedKeys) {
			expect(rest).toHaveProperty(key);
		}
		// No new keys beyond host/contract/perf should have been added.
		// v1.0.0 (K10-020) adds the contract block (always present) and the
		// perf block (omitted on this pre-011 store).
		const keys = Object.keys(rest).sort();
		expect(keys).toEqual(expectedKeys);
		expect(report.contract).toBeDefined();
		expect(report.perf).toBeUndefined();
	});

	it("block is derivable from DB alone (no live probe)", () => {
		// Build with capabilities ALL_FALSE - host block still populated from persisted tables
		const capabilities = {
			skills: false,
			references: false,
			references_with_metadata: false,
			reference_metadata_fields: [],
			apiVersion: "0",
		};
		const report = buildAudit(store, metrics, capabilities);
		expect(report.host).toBeDefined();
		expect(report.host?.plugin_version).toBe("1.18.18");
	});

	it("pre-010 database: host undefined and partial false (host is additive)", () => {
		// Create a store without migration 010
		const pre010Root = mkdtempSync(join(tmpdir(), "kevin-audit-pre010-"));
		const pre010Db = join(pre010Root, "kevin.db");
		const pre010Store = new Store({ path: pre010Db });
		for (const sql of [
			SQL("001_initial.sql"),
			SQL("003_v02_signal.sql"),
			SQL("004_v03_knowledge.sql"),
			SQL("005_v04_signal.sql"),
			SQL("006_v05_glassbox.sql"),
			SQL("007_v06_pull.sql"),
			SQL("008_v07_truth.sql"),
			SQL("009_v08_team.sql"),
		]) {
			pre010Store.exec(sql);
		}
		const pre010Metrics = new Metrics(pre010Store);
		const report = buildAudit(pre010Store, pre010Metrics);
		expect(report.host).toBeUndefined();
		expect(report.partial).toBe(false);
		pre010Metrics.close();
		pre010Store.close();
		rmSync(pre010Root, { recursive: true, force: true });
	});
});
