import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

const MIGRATIONS_007 = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
];

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-status-v06-"));
});

afterEach(async () => {
	await hooks.dispose?.();
	rmSync(tmpRoot, { recursive: true, force: true });
});

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

interface StatusPayload {
	tool_count: number;
	v06?: {
		schema_version: string;
		curation_enabled: string;
		skill_emission: string;
		reference_emission: string;
		proposals_pending: number;
	};
}

async function runStatus(ctx: ToolContext): Promise<StatusPayload> {
	const res = (await hooks.tool?.kevin_status.execute({}, ctx)) as {
		output: string;
	};
	return JSON.parse(res.output) as StatusPayload;
}

async function boot(
	migrations: string[],
	input: Record<string, unknown>,
): Promise<void> {
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const name of migrations) {
		copyFileSync(
			join(process.cwd(), "migrations", name),
			join(migrationsDir, name),
		);
	}
	hooks = await KevinPlugin({ directory: tmpRoot, ...input } as PluginInput, {
		dbPath: join(tmpRoot, "kevin.db"),
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
}

describe("K6-024 — kevin_status v0.6 fields", () => {
	it("on a 007 database: tool_count 23, schema 007, curation on, emissions unavailable on a v1 host, zero pending", async () => {
		await boot(MIGRATIONS_007, {});
		const status = await runStatus(makeCtx("s-1"));
		expect(status.tool_count).toBe(26);
		expect(status.v06).toEqual({
			schema_version: "007",
			curation_enabled: "1",
			skill_emission: "unavailable",
			reference_emission: "unavailable",
			proposals_pending: 0,
		});
	});

	it("on a capable v2 host with emissions enabled and a pending proposal: 'on' and pending 1", async () => {
		await boot(MIGRATIONS_007, {
			apiVersion: "2.0",
			skill: { source: () => ({ dispose() {} }) },
			reference: { add: () => ({ dispose() {} }) },
		});
		await hooks.tool?.kevin_config.execute(
			{
				action: "set",
				key: "skill_emission_enabled",
				value: "1",
			},
			makeCtx("s-2"),
		);
		await hooks.tool?.kevin_config.execute(
			{
				action: "set",
				key: "reference_emission_enabled",
				value: "1",
			},
			makeCtx("s-2"),
		);
		// Seed an eligible memory + the artifact target the same way the
		// K6-014 propose fixtures do (second connection over the file DB).
		const s = new Store({ path: join(tmpRoot, "kevin.db") });
		s.prepare(
			"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('agents_md_path', ?)",
		).run(join(tmpRoot, "AGENTS.md"));
		s.prepare(
			`INSERT INTO memories (
			  id, type, content, scope, relevance_score, source_tool, source_session,
			  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
			  evidence_count, last_verified_at, status, recurrence_count, ignored,
			  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
			 VALUES (?, 'rule', ?, 'project', 0.5, NULL, NULL, NULL,
			         datetime('now'), datetime('now'), NULL, NULL, NULL, 'agent',
			         2, datetime('now'), 'active', 0, 0, NULL, 0, 0, 0, NULL, NULL)`,
		).run("mem-1", "npm test must pass before any commit");
		s.close();
		await hooks.tool?.kevin_propose.execute(
			{ kind: "agents_md" },
			makeCtx("s-2"),
		);

		const status = await runStatus(makeCtx("s-2"));
		expect(status.tool_count).toBe(26);
		expect(status.v06?.schema_version).toBe("007");
		expect(status.v06?.skill_emission).toBe("on");
		expect(status.v06?.reference_emission).toBe("on");
		expect(status.v06?.proposals_pending).toBe(1);
	});

	it("on a pre-007 database the v06 block is omitted", async () => {
		await boot(
			[
				"001_initial.sql",
				"003_v02_signal.sql",
				"004_v03_knowledge.sql",
				"005_v04_signal.sql",
				"006_v05_glassbox.sql",
			],
			{},
		);
		const status = await runStatus(makeCtx("s-3"));
		expect(status.tool_count).toBe(26);
		expect(status.v06).toBeUndefined();
	});
});
