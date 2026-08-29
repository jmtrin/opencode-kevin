import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>> | undefined;
let dbPath: string;
let agentsPath: string;

interface ProposalPayload {
	proposals: {
		id: string;
		kind: string;
		targetPath: string;
		memoryIds: string[];
		status: string;
		createdAt: string;
		diff: string;
	}[];
}

async function proposePayload(): Promise<ProposalPayload> {
	return (await callTool("kevin_propose", {
		kind: "agents_md",
	})) as unknown as ProposalPayload;
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

async function callTool(
	tool: "kevin_propose" | "kevin_approve" | "kevin_status",
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const res = (await requireHooks().tool?.[tool].execute(
		args,
		makeCtx("s-cur"),
	)) as { output: string };
	return JSON.parse(res.output) as Record<string, unknown>;
}

async function bootPlugin(): Promise<void> {
	const migrationsDir = join(tmpRoot, "m007");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
	]) {
		await import("node:fs/promises").then(({ copyFile }) =>
			copyFile(
				join(__dirname, "..", "..", "packages/core/migrations", file),
				join(migrationsDir, file),
			),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
}

function secondStore(): Store {
	return new Store({ path: dbPath });
}

function seedMemoryAndSetting(): void {
	const s = secondStore();
	agentsPath = join(tmpRoot, "AGENTS.md");
	s.prepare(
		"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('agents_md_path', ?)",
	).run(agentsPath);
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
}

function requireHooks(): NonNullable<typeof hooks> {
	if (!hooks) throw new Error("plugin not booted");
	return hooks;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-curation-"));
});

afterEach(async () => {
	await hooks?.dispose?.();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("K6-014 — kevin_propose / kevin_approve", () => {
	it("kevin_propose returns a unified diff and leaves the target byte-identical", async () => {
		await bootPlugin();
		seedMemoryAndSetting();

		const out = await proposePayload();

		expect(out.proposals).toHaveLength(1);
		const p = out.proposals[0];
		expect(p.kind).toBe("agents_md");
		expect(p.targetPath).toBe(agentsPath);
		expect(p.memoryIds).toEqual(["mem-1"]);
		expect(p.status).toBe("pending");
		expect(p.diff).toContain("--- a/");
		expect(p.diff).toContain("@@");
		expect(p.diff).toContain("npm test must pass before any commit");
		// Byte-identical: nothing was written.
		expect(existsSync(agentsPath)).toBe(false);
		expect(existsSync(`${agentsPath}.kevin.tmp`)).toBe(false);

		const s = secondStore();
		const row = s
			.prepare("SELECT status FROM curation_proposals WHERE id = ?")
			.get(p.id) as { status: string };
		expect(row.status).toBe("pending");
		s.close();
	});

	it("kevin_approve with reject leaves the file byte-identical and sets rejected", async () => {
		await bootPlugin();
		seedMemoryAndSetting();
		const out = await proposePayload();
		const id = out.proposals[0].id;

		const res = await callTool("kevin_approve", {
			proposal_id: id,
			decision: "reject",
		});

		expect(res).toEqual({ proposalId: id, status: "rejected" });
		expect(existsSync(agentsPath)).toBe(false);

		const s = secondStore();
		const row = s
			.prepare("SELECT status, decided_at FROM curation_proposals WHERE id = ?")
			.get(id) as { status: string; decided_at: string | null };
		expect(row.status).toBe("rejected");
		expect(row.decided_at).toBeTruthy();
		s.close();
	});

	it("kevin_approve with approve writes the file, applies, and curates the memories", async () => {
		await bootPlugin();
		seedMemoryAndSetting();
		const out = await proposePayload();
		const id = out.proposals[0].id;

		const res = await callTool("kevin_approve", {
			proposal_id: id,
			decision: "approve",
		});

		expect(res).toMatchObject({
			proposalId: id,
			status: "applied",
			outcome: "written",
			curated: 1,
		});
		expect(existsSync(agentsPath)).toBe(true);
		const file = readFileSync(agentsPath, "utf8");
		expect(file).toContain("<!-- kevin:begin");
		expect(file).toContain("<!-- kevin:end -->");
		expect(file).toContain("npm test must pass before any commit");

		const s = secondStore();
		const prop = s
			.prepare("SELECT status, applied_at FROM curation_proposals WHERE id = ?")
			.get(id) as { status: string; applied_at: string | null };
		expect(prop.status).toBe("applied");
		expect(prop.applied_at).toBeTruthy();
		const mem = s
			.prepare("SELECT curated, curated_at FROM memories WHERE id = 'mem-1'")
			.get() as { curated: number; curated_at: string | null };
		expect(mem.curated).toBe(1);
		expect(mem.curated_at).toBeTruthy();
		const writes = s.prepare("SELECT outcome FROM artifact_writes").all() as {
			outcome: string;
		}[];
		expect(writes).toHaveLength(1);
		expect(writes[0].outcome).toBe("written");
		s.close();
	});

	it("approving twice errors on the second call and produces a single written row", async () => {
		await bootPlugin();
		seedMemoryAndSetting();
		const out = await proposePayload();
		const id = out.proposals[0].id;

		const first = await callTool("kevin_approve", {
			proposal_id: id,
			decision: "approve",
		});
		expect(first.status).toBe("applied");

		const second = await callTool("kevin_approve", {
			proposal_id: id,
			decision: "approve",
		});
		expect(second).toMatchObject({
			error: "not_pending",
			proposalId: id,
			status: "applied",
		});

		const before = readFileSync(agentsPath, "utf8");
		const s = secondStore();
		const writes = s.prepare("SELECT outcome FROM artifact_writes").all() as {
			outcome: string;
		}[];
		expect(writes).toHaveLength(1);
		expect(writes[0].outcome).toBe("written");
		s.close();
		expect(readFileSync(agentsPath, "utf8")).toBe(before);
	});

	it("a newer proposal supersedes the pending one; reject still lands in the ledger", async () => {
		await bootPlugin();
		seedMemoryAndSetting();
		const first = await proposePayload();
		const second = await proposePayload();
		expect(second.proposals[0].id).not.toBe(first.proposals[0].id);

		// The first proposal was superseded: approving or rejecting it now is
		// a structured error, not a state change.
		const stale = await callTool("kevin_approve", {
			proposal_id: first.proposals[0].id,
			decision: "reject",
		});
		expect(stale).toMatchObject({
			error: "not_pending",
			proposalId: first.proposals[0].id,
			status: "superseded",
		});

		const res = await callTool("kevin_approve", {
			proposal_id: second.proposals[0].id,
			decision: "reject",
		});
		expect(res).toEqual({
			proposalId: second.proposals[0].id,
			status: "rejected",
		});

		const s = secondStore();
		const rows = s
			.prepare("SELECT id, status FROM curation_proposals ORDER BY created_at")
			.all() as { id: string; status: string }[];
		expect(rows.map((r) => r.status).sort()).toEqual([
			"rejected",
			"superseded",
		]);

		const statusOut = (await callTool("kevin_status", {})) as {
			metrics: Record<string, number>;
		};
		const m = statusOut.metrics;
		expect(m.proposals_created).toBe(2);
		expect(m.proposals_rejected).toBe(1);
		expect(m.proposals_approved).toBe(0);
		expect(m.proposals_approved + m.proposals_rejected).toBeLessThanOrEqual(
			m.proposals_created,
		);
		s.close();
	});

	it("approving an unknown proposal returns a structured error", async () => {
		await bootPlugin();
		seedMemoryAndSetting();
		const res = await callTool("kevin_approve", {
			proposal_id: "no-such-id",
			decision: "approve",
		});
		expect(res).toMatchObject({ error: "not_found", proposalId: "no-such-id" });
		expect(existsSync(agentsPath)).toBe(false);
	});

	it("a failed approve (filesystem error) leaves the proposal pending and retryable", async () => {
		await bootPlugin();
		seedMemoryAndSetting();
		const out = await proposePayload();
		const id = out.proposals[0].id;

		// Replace the target file with a directory so plan() throws (EISDIR/
		// EPERM) before anything is transitioned. With the pre-tag ordering
		// the row was already 'approved' at this point and stuck forever:
		// kevin_approve only accepts pending rows. The disk write must
		// happen BEFORE the state transitions (regression found before the
		// v0.6.0 tag).
		rmSync(agentsPath, { force: true });
		mkdirSync(agentsPath);

		await expect(
			callTool("kevin_approve", { proposal_id: id, decision: "approve" }),
		).rejects.toThrow();

		const s = secondStore();
		const row = s
			.prepare("SELECT status FROM curation_proposals WHERE id = ?")
			.get(id) as { status: string };
		expect(row.status).toBe("pending");
		s.close();

		// Retry after clearing the obstruction succeeds.
		rmSync(agentsPath, { recursive: true, force: true });
		const res = await callTool("kevin_approve", {
			proposal_id: id,
			decision: "approve",
		});
		expect(res).toMatchObject({
			proposalId: id,
			status: "applied",
			outcome: "written",
		});
		expect(readFileSync(agentsPath, "utf8")).toContain(
			"npm test must pass before any commit",
		);
	});
});
