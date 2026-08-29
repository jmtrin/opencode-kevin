import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";
import { buildAudit } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = (name: string) =>
	readFileSync(join(__dirname, "..", "..", "packages/core/migrations", name), "utf8");

function makeStore(...migrations: string[]): Store {
	const s = new Store({ path: ":memory:" });
	for (const m of migrations) {
		s.exec(SQL(m));
	}
	return s;
}

const MIGRATIONS_007 = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
];

const CAPABLE = {
	skills: true,
	references: true,
	apiVersion: "2.0",
};

describe("K6-023 — buildAudit channels + curation blocks (plan §5.8)", () => {
	it("v1 host: both emissions are 'unavailable', even with no settings rows", () => {
		const store = makeStore(...MIGRATIONS_007);
		const metrics = new Metrics(store);
		const report = buildAudit(store, metrics);
		expect(report.partial).toBe(true);
		expect(report.channels).toBeDefined();
		expect(report.channels?.pull.skill_emission).toBe("unavailable");
		expect(report.channels?.pull.reference_emission).toBe("unavailable");
		expect(report.channels?.push).toEqual({
			tokens_pre_prompt: 0,
			tokens_compacting: 0,
			injections_total: 0,
			precision_rate: 0,
			coverage_rate: 0,
			budget_tokens: 400,
		});
		expect(report.channels?.pull).toMatchObject({
			proposals_created: 0,
			proposals_approved: 0,
			proposals_rejected: 0,
			artifact_writes_total: 0,
			artifact_writes_noop: 0,
			references_registered: 0,
			skills_registered: 0,
		});
		expect(report.curation).toEqual({
			eligible: 0,
			curated: 0,
			inferable: 0,
			non_inferable: 0,
			unknown: 0,
			proposals_by_status: {},
		});
		store.close();
	});

	it("capable host, settings '0' (migration default): both emissions are 'off'", () => {
		const store = makeStore(...MIGRATIONS_007);
		const metrics = new Metrics(store);
		const report = buildAudit(store, metrics, CAPABLE);
		expect(report.channels?.pull.skill_emission).toBe("off");
		expect(report.channels?.pull.reference_emission).toBe("off");
		store.close();
	});

	it("capable host, settings '1' with registrations: both emissions are 'on' and the counters are read by SQL", () => {
		const store = makeStore(...MIGRATIONS_007);
		const metrics = new Metrics(store);
		store
			.prepare(
				"UPDATE kevin_settings SET value = '1' WHERE key IN ('skill_emission_enabled', 'reference_emission_enabled')",
			)
			.run();
		metrics.incrRegistered("skills_registered", 1);
		metrics.incrRegistered("references_registered", 2);
		const report = buildAudit(store, metrics, CAPABLE);
		expect(report.channels?.pull.skill_emission).toBe("on");
		expect(report.channels?.pull.reference_emission).toBe("on");
		expect(report.channels?.pull.skills_registered).toBe(1);
		expect(report.channels?.pull.references_registered).toBe(2);
		store.close();
	});

	it("budget_tokens reports the EFFECTIVE cap (K6-021 clamp), not the raw setting", () => {
		const cases: Array<[string | null, number]> = [
			["1200", 1200],
			["99999", 4000],
			["-5", 0],
			["abc", 400],
			[null, 400],
		];
		for (const [value, expected] of cases) {
			const store = makeStore(...MIGRATIONS_007);
			const metrics = new Metrics(store);
			if (value === null) {
				store
					.prepare(
						"DELETE FROM kevin_settings WHERE key = 'pre_prompt_budget_tokens'",
					)
					.run();
			} else {
				store
					.prepare(
						"UPDATE kevin_settings SET value = ? WHERE key = 'pre_prompt_budget_tokens'",
					)
					.run(value);
			}
			const report = buildAudit(store, metrics, CAPABLE);
			expect(report.channels?.push.budget_tokens).toBe(expected);
			store.close();
		}
	});

	it("curation block counts the three inferability states and the proposal ledger", () => {
		const store = makeStore(...MIGRATIONS_007);
		const metrics = new Metrics(store);
		const seedMem = (
			id: string,
			inferable: number | null,
			curated = 0,
		): void => {
			store
				.prepare(
					`INSERT INTO memories (id, type, content, scope, origin, inferable, curated)
					 VALUES (?, 'error', 'm-' || ?, 'project', 'reflector', ?, ?)`,
				)
				.run(id, id, inferable, curated);
		};
		seedMem("m-1", 1);
		seedMem("m-2", 0);
		seedMem("m-3", null);
		seedMem("m-4", null, 1);
		const seedProposal = (id: string, status: string): void => {
			store
				.prepare(
					`INSERT INTO curation_proposals (id, project_id, memory_id, kind, target_path, proposed_text, diff, status)
					 VALUES (?, 'p', 'm-1', 'skill', '/x.md', 'body', 'diff', ?)`,
				)
				.run(id, status);
		};
		seedProposal("pr-1", "pending");
		seedProposal("pr-2", "pending");
		seedProposal("pr-3", "approved");
		seedProposal("pr-4", "applied");
		seedProposal("pr-5", "rejected");
		seedProposal("pr-6", "superseded");
		metrics.incr("proposals_created", 6);
		metrics.incr("proposals_approved", 2);
		metrics.incr("proposals_rejected", 1);

		const report = buildAudit(store, metrics, CAPABLE);
		expect(report.curation).toEqual({
			// eligible = inferable IS NOT 1: the Curator predicate.
			eligible: 3,
			curated: 1,
			inferable: 1,
			non_inferable: 1,
			unknown: 2,
			proposals_by_status: {
				pending: 2,
				approved: 1,
				applied: 1,
				rejected: 1,
				superseded: 1,
			},
		});
		expect(report.channels?.pull).toMatchObject({
			proposals_created: 6,
			proposals_approved: 2,
			proposals_rejected: 1,
		});
		store.close();
	});

	it("pre-007 database: channels and curation are OMITTED and partial is true", () => {
		const store = makeStore(
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
			"006_v05_glassbox.sql",
		);
		const metrics = new Metrics(store);
		const report = buildAudit(store, metrics, CAPABLE);
		expect(report.partial).toBe(true);
		expect(report.channels).toBeUndefined();
		expect(report.curation).toBeUndefined();
		expect(JSON.stringify(report)).not.toContain("undefined");
		store.close();
	});
});

describe("K6-023 — kevin_audit tool reports the emission states from the init probe", () => {
	let tmpRoot: string;
	let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-audit-v06-"));
	});

	afterEach(async () => {
		await hooks.dispose?.();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	async function boot(input: Record<string, unknown>): Promise<void> {
		const migrationsDir = join(tmpRoot, "migrations");
		mkdirSync(migrationsDir, { recursive: true });
		for (const name of MIGRATIONS_007) {
			copyFileSync(
				join(process.cwd(), "packages/core/migrations", name),
				join(migrationsDir, name),
			);
		}
		hooks = await KevinPlugin({ directory: tmpRoot, ...input } as PluginInput, {
			dbPath: join(tmpRoot, "kevin.db"),
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retrospectives"),
		});
	}

	async function runAudit(ctx: ToolContext): Promise<{
		channels?: {
			pull: {
				skill_emission: string;
				reference_emission: string;
			};
		};
		curation?: unknown;
		partial: boolean;
	}> {
		const res = (await hooks.tool?.kevin_audit.execute({}, ctx)) as {
			output: string;
		};
		return JSON.parse(res.output) as {
			channels?: {
				pull: {
					skill_emission: string;
					reference_emission: string;
				};
			};
			curation?: unknown;
			partial: boolean;
		};
	}

	function makeCtx(sess: string): ToolContext {
		return {
			sessionID: sess,
			messageID: "m",
			agent: "test",
			directory: tmpRoot,
			worktree: tmpRoot,
			abort: new AbortController().signal,
			metadata() {},
			ask() {
				return Promise.resolve();
			},
		};
	}

	it("v1 host (no skill/reference domain): 'unavailable'", async () => {
		await boot({});
		const report = await runAudit(makeCtx("s-1"));
		expect(report.partial).toBe(true);
		expect(report.channels?.pull.skill_emission).toBe("unavailable");
		expect(report.channels?.pull.reference_emission).toBe("unavailable");
		expect(report.curation).toBeDefined();
	});

	it("v2 host with settings '0': 'off', distinct from 'unavailable'", async () => {
		await boot({
			apiVersion: "2.0",
			skill: { source: () => ({ dispose() {} }) },
			reference: { add: () => ({ dispose() {} }) },
		});
		const report = await runAudit(makeCtx("s-2"));
		expect(report.channels?.pull.skill_emission).toBe("off");
		expect(report.channels?.pull.reference_emission).toBe("off");
	});
});
