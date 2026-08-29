import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARKER_BEGIN, MARKER_END } from "@jmtrin/kevin-core";
import { firstSentence } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";
import { classify } from "@jmtrin/kevin-core";

const MEM1_CONTENT =
	"Always run `npm run typecheck` before committing to the shared branch.";
const MEM2_CONTENT =
	"Never use `fs.rmSync` with recursive:true on a path outside the temp dir.";

let tmpRoot: string;
let migrationsDir: string;
let dbPath: string;
let agentsPath: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-v06-loop-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
	]) {
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
			join(migrationsDir, file),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	agentsPath = join(tmpRoot, "AGENTS.md");
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
	// The migration seeds the RELATIVE default 'AGENTS.md'; point the pull
	// channel at the temp file so the approval can never touch the repo.
	await hooks.tool?.kevin_config.execute(
		{ action: "set", key: "agents_md_path", value: agentsPath },
		makeCtx("s-0"),
	);
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

async function call(
	name: string,
	args: unknown,
	sess = "v06-sess",
): Promise<unknown> {
	const tool = (
		hooks.tool as Record<
			string,
			{ execute: (a: unknown, c: ToolContext) => Promise<{ output: string }> }
		>
	)[name];
	const res = await tool.execute(args, makeCtx(sess));
	return JSON.parse(res.output) as unknown;
}

async function idle(sess = "v06-sess"): Promise<void> {
	await hooks.event?.({
		event: { type: "session.idle", properties: { sessionID: sess } } as never,
	});
}

/** Reset the 1-hour idle-curation throttle so the next idle generates. */
async function resetThrottle(): Promise<void> {
	const res = await hooks.tool?.kevin_config.execute(
		{ action: "set", key: "last_curation_at", value: "", strict: false },
		makeCtx("s-0"),
	);
	expect((res as { output: string }).output).toContain("ok");
}

function withStore<T>(fn: (store: Store) => T): T {
	const store = new Store({ path: dbPath });
	try {
		return fn(store);
	} finally {
		store.close();
	}
}

/** Two confirmed fixes — the D6-09 causal-evidence arm, seeded on the row
 * (the same fixture pattern as K6-013/014; no component is mocked). */
function seedEvidence(memoryId: string): void {
	withStore((store) => {
		store
			.prepare(
				"UPDATE memories SET evidence_count = 2, last_verified_at = datetime('now') WHERE id = ?",
			)
			.run(memoryId);
	});
}

describe("K6-025 — v0.6 closed-loop e2e (propose → reject → approve → noop → refuse)", () => {
	it("drives the full pull cycle through the host hooks with no mocks", async () => {
		const sess = "v06-sess";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});

		// Step 0 — the target file exists from the start; capture its
		// bytes for the outside-the-markers comparisons.
		writeFileSync(agentsPath, "user project rule", "utf8");
		const step0 = readFileSync(agentsPath, "utf8");
		expect(step0).toBe("user project rule");

		// 1. Save a decision memory; classify() says non_inferable
		//    (inferable = 0), so it is a curation candidate.
		const saved = (await call("kevin_save", {
			type: "decision",
			content: MEM1_CONTENT,
		})) as { id: string };
		const mem1 = saved.id;
		expect(mem1).toBeTruthy();
		// classify() verdicts the decision as non-inferable (inferable
		// = 0), which is what save() persisted on the row.
		expect(
			classify({ type: "decision", content: MEM1_CONTENT, metadata: null }),
		).toBe("non_inferable");
		expect(
			withStore((s) =>
				s.prepare("SELECT inferable FROM memories WHERE id = ?").get(mem1),
			),
		).toEqual({ inferable: 0 });

		// 2. Two pieces of causal evidence → passes the D6-09
		//    disjunction (evidence_count >= 2; confidence 0.7 >= 0.6).
		seedEvidence(mem1);

		// 3. session.idle generates a pending proposal; disk untouched.
		await idle(sess);
		const pending1 = withStore(
			(s) =>
				s
					.prepare(
						"SELECT id, status, memory_id FROM curation_proposals WHERE status = 'pending' ORDER BY created_at",
					)
					.all() as { id: string; status: string; memory_id: string }[],
		);
		expect(pending1).toHaveLength(1);
		expect(pending1[0].memory_id).toBe(mem1);
		expect(readFileSync(agentsPath, "utf8")).toBe(step0);

		// 4. The persisted diff shows the expected `+` lines.
		const diff = withStore(
			(s) =>
				s
					.prepare("SELECT diff FROM curation_proposals WHERE id = ?")
					.get(pending1[0].id) as { diff: string },
		).diff;
		expect(diff).toContain("--- a/");
		expect(diff).toContain("+++ b/");
		expect(diff).toContain("@@ ");
		expect(diff).toContain(`+- ${firstSentence(MEM1_CONTENT)} (verified`);
		expect(diff).toContain("+<!-- kevin:begin");

		// 5. reject → nothing written, status rejected.
		const rejected = (await call("kevin_approve", {
			proposal_id: pending1[0].id,
			decision: "reject",
		})) as { status: string };
		expect(rejected.status).toBe("rejected");
		expect(readFileSync(agentsPath, "utf8")).toBe(step0);
		expect(
			withStore((s) =>
				s
					.prepare("SELECT status FROM curation_proposals WHERE id = ?")
					.get(pending1[0].id),
			),
		).toEqual({ status: "rejected" });

		// 6. Generate again and approve for real.
		await resetThrottle();
		await idle(sess);
		const pending2 = withStore(
			(s) =>
				s
					.prepare(
						"SELECT id FROM curation_proposals WHERE status = 'pending' ORDER BY created_at",
					)
					.all() as { id: string }[],
		);
		expect(pending2).toHaveLength(1);
		const applied = (await call("kevin_approve", {
			proposal_id: pending2[0].id,
			decision: "approve",
		})) as { status: string; outcome: string; curated: number };
		expect(applied.status).toBe("applied");
		expect(applied.outcome).toBe("written");
		expect(applied.curated).toBe(1);

		const afterWrite = readFileSync(agentsPath, "utf8");
		expect(afterWrite).toContain(MARKER_BEGIN);
		expect(afterWrite).toContain(MARKER_END);
		expect(afterWrite).toContain(`- ${firstSentence(MEM1_CONTENT)} (verified`);
		// Bytes outside the markers are exactly step-0's content plus
		// the block separator blank line; the only trailing byte is
		// the closing line terminator of the END marker line.
		const b0 = afterWrite.indexOf(MARKER_BEGIN);
		const b1 = afterWrite.indexOf(MARKER_END);
		expect(afterWrite.slice(0, b0)).toBe(`${step0}\n\n`);
		expect(afterWrite.slice(b1 + MARKER_END.length)).toBe("\n");
		expect(
			withStore((s) =>
				s.prepare("SELECT curated FROM memories WHERE id = ?").get(mem1),
			),
		).toEqual({ curated: 1 });

		// 7. The whole generation again: the memory is curated, so no
		//    candidate exists and the file is byte-identical (noop).
		const afterStep6 = readFileSync(agentsPath, "utf8");
		await resetThrottle();
		await idle(sess);
		expect(
			withStore(
				(s) =>
					(
						s
							.prepare(
								"SELECT COUNT(*) AS n FROM curation_proposals WHERE status = 'pending'",
							)
							.get() as { n: number }
					).n,
			),
		).toBe(0);
		expect(readFileSync(agentsPath, "utf8")).toBe(afterStep6);

		// 8. Audit: exactly one real write, one reject, one approve.
		const audit = (await call("kevin_audit", { verbose: false })) as {
			channels: {
				pull: {
					artifact_writes_total: number;
					proposals_rejected: number;
					proposals_approved: number;
				};
			};
		};
		expect(audit.channels.pull.artifact_writes_total).toBe(1);
		expect(audit.channels.pull.proposals_rejected).toBe(1);
		expect(audit.channels.pull.proposals_approved).toBe(1);

		// 9. Hand-corrupt the marker block (delete MARKER_END), give
		//    the system a fresh candidate, regenerate, approve: the
		//    outcome is "refused", the file is byte-identical, and the
		//    audit row records the refusal.
		const saved2 = (await call("kevin_save", {
			type: "decision",
			content: MEM2_CONTENT,
		})) as { id: string };
		seedEvidence(saved2.id);
		writeFileSync(
			agentsPath,
			readFileSync(agentsPath, "utf8").replace(MARKER_END, ""),
			"utf8",
		);
		const corrupted = readFileSync(agentsPath, "utf8");
		expect(corrupted).not.toContain(MARKER_END);
		await resetThrottle();
		await idle(sess);
		const pending3 = withStore(
			(s) =>
				s
					.prepare(
						"SELECT id FROM curation_proposals WHERE status = 'pending' ORDER BY created_at",
					)
					.all() as { id: string }[],
		);
		expect(pending3).toHaveLength(1);
		const refused = (await call("kevin_approve", {
			proposal_id: pending3[0].id,
			decision: "approve",
		})) as { status: string; outcome: string };
		expect(refused.status).toBe("applied");
		expect(refused.outcome).toBe("refused");
		expect(readFileSync(agentsPath, "utf8")).toBe(corrupted);
		const lastWrite = withStore(
			(s) =>
				s
					.prepare(
						`SELECT outcome, reason, proposal_id, bytes_before, bytes_after
						 FROM artifact_writes WHERE proposal_id = ?
						 ORDER BY rowid DESC LIMIT 1`,
					)
					.get(pending3[0].id) as {
					outcome: string;
					reason: string;
					proposal_id: string | null;
					bytes_before: number;
					bytes_after: number;
				},
		);
		expect(lastWrite.outcome).toBe("refused");
		expect(lastWrite.reason).toContain("kevin:begin");
		expect(lastWrite.proposal_id).toBe(pending3[0].id);
		expect(lastWrite.bytes_before).toBe(lastWrite.bytes_after);
	}, 30_000);
});
