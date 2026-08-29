import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Materializer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import type { HostSurface } from "../../packages/plugin/src/host.js";
import type { KevinNativeContext } from "../../packages/plugin/src/native.js";
import { type NativeDeps, attachNative } from "../../packages/plugin/src/native.js";

const SQL_001 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "007_v06_pull.sql"),
	"utf8",
);
const SQL_010 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "010_v09_native.sql"),
	"utf8",
);

/** Both surfaces honour the read-back: skill list() returns the stored
 * source, reference list() returns the added names. */
function honouringContext(): KevinNativeContext {
	let storedSource: string | null = null;
	const added: Array<[string, unknown]> = [];
	return {
		skill: {
			transform: async (hook) => {
				await hook({
					source: (s: string) => {
						storedSource = s;
					},
					list: () => (storedSource === null ? [] : [storedSource]),
				});
			},
		},
		reference: {
			transform: async (hook) => {
				await hook({
					add: (name: string, source: unknown) => {
						added.push([name, source]);
					},
					list: () => [...added],
				});
			},
		},
	};
}

/** The skill draft accepts source() but has no list() — registered but
 * unverified. */
function unverifyingContext(): KevinNativeContext {
	return {
		skill: {
			transform: async (hook) => {
				await hook({ source: () => {} });
			},
		},
		reference: { transform: async () => {} },
	};
}

function v2Host(skill: boolean, reference: boolean): HostSurface {
	return {
		pluginVersion: "1.18.18",
		flavour: "v1+v2",
		project: { id: null, worktree: null, directory: null },
		hasShell: true,
		v2: { skill, reference },
		notes: [],
	};
}

function defineRunsSetup(ctx: KevinNativeContext): {
	loader: () => Promise<unknown>;
	wait: () => Promise<unknown>;
} {
	let settled: Promise<unknown> = Promise.resolve();
	return {
		loader: () =>
			Promise.resolve({
				define: (plugin: {
					setup: (c: KevinNativeContext) => unknown;
				}) => {
					// The host runs setup() asynchronously; the test awaits
					// the settled promise so onVerified (and persistence)
					// have definitely run before the assertions.
					settled = Promise.resolve(plugin.setup(ctx));
					return plugin;
				},
			}),
		wait: () => settled,
	};
}

let tmpRoot: string;
let store: Store;
let root: string;

const seededSql = [
	SQL_001,
	SQL_003,
	SQL_004,
	SQL_005,
	SQL_006,
	SQL_007,
	SQL_010,
];

function seedMemory(id: string, type: string, content: string): void {
	store
		.prepare(
			`INSERT INTO memories (
			  id, type, content, scope, relevance_score, source_tool, source_session,
			  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
			  evidence_count, last_verified_at, status, recurrence_count, ignored,
			  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
			 VALUES (?, ?, ?, 'project', 0.5, NULL, NULL, NULL,
			         datetime('now'), datetime('now'), NULL, NULL, NULL, 'agent',
			         2, datetime('now'), 'active', 0, 0, NULL, 0, 0, 1, NULL, NULL)`,
		)
		.run(id, type, content);
}

function deps(enabled = "1"): NativeDeps {
	return {
		materializer: new Materializer(store, { root }),
		settings: {
			getSetting: (key: string, fallback = "0") =>
				key === "native_registration_enabled" ? enabled : fallback,
		},
		store,
	};
}

function registrationRows(): {
	surface: string;
	registered: number;
	verified: number;
	attached_at: string | null;
	note: string | null;
}[] {
	return store
		.prepare(
			"SELECT surface, registered, verified, attached_at, note FROM native_registrations ORDER BY surface",
		)
		.all() as {
		surface: string;
		registered: number;
		verified: number;
		attached_at: string | null;
		note: string | null;
	}[];
}

function metricValue(key: string): number {
	const row = store
		.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
		.get(key) as { value: number } | undefined;
	return row?.value ?? 0;
}

describe("K9-017 — native_registrations persistence and metrics (plan §6.2)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-persist-"));
		root = join(tmpRoot, "opencode-kevin");
		mkdirSync(join(root, "skills"), { recursive: true });
		mkdirSync(join(root, "refs"), { recursive: true });
		store = new Store({ path: join(tmpRoot, "test.db") });
		for (const sql of seededSql) store.exec(sql);
	});

	afterEach(() => {
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("appends one row per surface per attach, attached_at populated", async () => {
		seedMemory("m1", "rule", "aaa bbb");
		const drs = defineRunsSetup(honouringContext());
		const result = await attachNative(v2Host(true, true), deps(), {
			importV2: drs.loader,
		});
		await drs.wait();
		expect(result).not.toBeNull();
		const rows = registrationRows();
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.surface)).toEqual(["reference", "skill"]);
		for (const row of rows) {
			expect(row.registered).toBe(1);
			expect(row.verified).toBe(1);
			expect(row.attached_at).not.toBeNull();
			expect(row.note).toBeNull();
		}
	});

	it("a verified skill registration increments native_registrations_total by exactly 1", async () => {
		seedMemory("m1", "rule", "aaa bbb");
		const drs = defineRunsSetup(honouringContext());
		await attachNative(v2Host(true, false), deps(), {
			importV2: drs.loader,
		});
		await drs.wait();
		expect(metricValue("native_registrations_total")).toBe(1);
		expect(metricValue("native_registration_failures")).toBe(0);
	});

	it("registered=1, verified=0 increments native_registration_failures", async () => {
		seedMemory("m1", "rule", "aaa bbb");
		const drs = defineRunsSetup(unverifyingContext());
		const result = await attachNative(v2Host(true, false), deps(), {
			importV2: drs.loader,
		});
		await drs.wait();
		expect(result?.registered.skill).toBe(true);
		expect(result?.verified.skill).toBe(false);
		expect(metricValue("native_registration_failures")).toBe(1);
		expect(metricValue("native_registrations_total")).toBe(0);
		const rows = registrationRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ registered: 1, verified: 0 });
	});

	it("INSERT with surface='agent' throws a constraint error", () => {
		expect(() =>
			store
				.prepare("INSERT INTO native_registrations (id, surface) VALUES (?, ?)")
				.run("row-agent", "agent"),
		).toThrow();
	});

	it("with native_registration_enabled='0', attachNative returns null and zero rows", async () => {
		seedMemory("m1", "rule", "aaa bbb");
		const notes: string[] = [];
		const drs = defineRunsSetup(honouringContext());
		const result = await attachNative(v2Host(true, true), deps("0"), {
			importV2: drs.loader,
			notes,
		});
		await drs.wait();
		expect(result).toBeNull();
		expect(registrationRows()).toHaveLength(0);
	});
});
