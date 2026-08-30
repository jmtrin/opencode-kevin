import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactWriter, MARKER_BEGIN, MARKER_END } from "@jmtrin/kevin-core";
import { type CurationProposal, Curator } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";
import { afterEach, describe, expect, it, vi } from "vitest";

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

interface Env {
	store: Store;
	svc: MemoryService;
	curator: Curator;
	writer: ArtifactWriter;
	metrics: Metrics;
	tmpDir: string;
	agentsPath: string;
}

let env: Env | null = null;

function freshEnv(): Env {
	const store = new Store({ path: ":memory:" });
	for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006, SQL_007]) {
		store.exec(sql);
	}
	const tmpDir = mkdtempSync(join(tmpdir(), "kevin-proposals-"));
	const agentsPath = join(tmpDir, "AGENTS.md");
	store
		.prepare(
			"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('agents_md_path', ?)",
		)
		.run(agentsPath);
	const svc = new MemoryService(store);
	const metrics = new Metrics(store);
	const curator = new Curator(store, svc, "proj-x", metrics);
	const writer = new ArtifactWriter(store, "proj-x", metrics);
	env = { store, svc, curator, writer, metrics, tmpDir, agentsPath };
	return env;
}

function seedMemory(
	store: Store,
	id: string,
	content: string,
	opts: {
		evidenceCount?: number;
		feedbackPositive?: number;
		curated?: number;
	} = {},
): void {
	store
		.prepare(
			`INSERT INTO memories (
			  id, type, content, scope, relevance_score, source_tool, source_session,
			  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
			  evidence_count, last_verified_at, status, recurrence_count, ignored,
			  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
			 VALUES (?, 'rule', ?, 'project', 0.5, NULL, NULL, NULL,
			         datetime('now'), datetime('now'), NULL, 'proj-x', NULL, 'agent',
			         ?, datetime('now'), 'active', 0, 0, NULL, ?, 0, ?, NULL, NULL)`,
		)
		.run(
			id,
			content,
			opts.evidenceCount ?? 2,
			opts.feedbackPositive ?? 0,
			opts.curated ?? 0,
		);
}

function rows(store: Store): { id: string; status: string }[] {
	return store
		.prepare("SELECT id, status FROM curation_proposals ORDER BY created_at")
		.all() as { id: string; status: string }[];
}

afterEach(() => {
	vi.restoreAllMocks();
	if (env) {
		rmSync(env.tmpDir, { recursive: true, force: true });
		env = null;
	}
});

describe("proposal lifecycle (K6-013)", () => {
	it("propose() creates a pending row and never writes", () => {
		const { store, curator, writer, metrics, agentsPath } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const applySpy = vi.spyOn(writer, "apply").mockImplementation(() => {
			throw new Error("apply must never be called by propose()");
		});

		const proposals = curator.propose("agents_md", writer);

		expect(proposals).toHaveLength(1);
		expect(applySpy).not.toHaveBeenCalled();
		expect(existsSync(agentsPath)).toBe(false);
		expect(existsSync(`${agentsPath}.kevin.tmp`)).toBe(false);

		const p = proposals[0];
		expect(p.kind).toBe("agents_md");
		expect(p.targetPath).toBe(agentsPath);
		expect(p.memoryIds).toEqual(["mem-1"]);
		expect(p.status).toBe("pending");
		expect(p.createdAt).toBeTruthy();
		expect(p.diff).not.toBe("");
		expect(p.proposedText).toContain("npm test must pass before any commit");
		expect(p.proposedText).not.toContain("kevin:begin");

		const all = rows(store);
		expect(all).toHaveLength(1);
		expect(all[0].status).toBe("pending");
		expect(metrics.get("proposals_created")).toBe(1);
		expect(metrics.get("artifact_writes_total")).toBe(0);
	});

	it("a second propose() for the same triple supersedes; rows are 2, not 1", () => {
		const { store, curator, writer, metrics } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");

		const first = curator.propose("agents_md", writer);
		const second = curator.propose("agents_md", writer);

		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		expect(second[0].id).not.toBe(first[0].id);

		const all = rows(store);
		expect(all).toHaveLength(2);
		const pending = all.filter((r) => r.status === "pending");
		const superseded = all.filter((r) => r.status === "superseded");
		expect(pending).toHaveLength(1);
		expect(superseded).toHaveLength(1);
		expect(superseded[0].id).toBe(first[0].id);
		expect(metrics.get("proposals_created")).toBe(2);
	});

	it("the persisted diff is non-empty and reproduces byte-identically", () => {
		const { store, curator, writer } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");

		const first = curator.propose("agents_md", writer);
		const second = curator.propose("agents_md", writer);

		expect(first[0].diff).not.toBe("");
		expect(second[0].diff).toBe(first[0].diff);

		const row1 = store
			.prepare("SELECT diff FROM curation_proposals WHERE id = ?")
			.get(first[0].id) as { diff: string };
		const row2 = store
			.prepare("SELECT diff FROM curation_proposals WHERE id = ?")
			.get(second[0].id) as { diff: string };
		expect(row1.diff).toBe(first[0].diff);
		expect(row2.diff).toBe(second[0].diff);
	});

	it("the diff is empty when the proposed text already matches the current block", () => {
		const { store, curator, writer, agentsPath } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const first = curator.propose("agents_md", writer);
		// The user (or an approval) already applied the exact proposed block.
		writeFileSync(
			agentsPath,
			`${MARKER_BEGIN}\n${first[0].proposedText}\n${MARKER_END}\n`,
		);

		const again = curator.propose("agents_md", writer);

		expect(again).toHaveLength(1);
		expect(again[0].proposedText).toBe(first[0].proposedText);
		expect(again[0].diff).toBe("");
	});

	it("propose() never plans a file write; artifact metrics stay untouched", () => {
		const { store, curator, writer, metrics } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		curator.propose("agents_md", writer);
		expect(metrics.get("artifact_writes_total")).toBe(0);
		expect(metrics.get("artifact_writes_noop")).toBe(0);
	});

	it("no code path deletes a curation_proposals row", () => {
		for (const dir of ["packages/core/src", "packages/core/migrations"]) {
			for (const file of readdirSync(join(process.cwd(), dir)).filter(
				(f) => !statSync(join(process.cwd(), dir, f)).isDirectory(),
			)) {
				const src = readFileSync(join(process.cwd(), dir, file), "utf8");
				expect(src).not.toMatch(/DELETE FROM curation_proposals/i);
			}
		}
	});

	it("state machine: legal transitions advance with timestamps", () => {
		const { store, curator, writer } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const [p] = curator.propose("agents_md", writer);

		expect(curator.transition(p.id, "approve")).toBe("approved");
		expect(curator.transition(p.id, "apply")).toBe("applied");

		const applied = store
			.prepare(
				"SELECT status, decided_at, applied_at FROM curation_proposals WHERE id = ?",
			)
			.get(p.id) as {
			status: string;
			decided_at: string | null;
			applied_at: string | null;
		};
		expect(applied.status).toBe("applied");
		expect(applied.decided_at).toBeTruthy();
		expect(applied.applied_at).toBeTruthy();
	});

	it("state machine: reject then supersede both stamp decided_at", () => {
		const { store, curator, writer } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const [p] = curator.propose("agents_md", writer);

		expect(curator.transition(p.id, "reject")).toBe("rejected");
		expect(curator.transition(p.id, "supersede")).toBe("superseded");
		const row = store
			.prepare("SELECT status FROM curation_proposals WHERE id = ?")
			.get(p.id) as { status: string };
		expect(row.status).toBe("superseded");
	});

	it("state machine: illegal and unknown transitions throw", () => {
		const { store, curator, writer } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const [p] = curator.propose("agents_md", writer);

		expect(() => curator.transition(p.id, "apply")).toThrow(
			/illegal transition/,
		);
		curator.transition(p.id, "approve");
		expect(() => curator.transition(p.id, "reject")).toThrow(
			/illegal transition/,
		);
		curator.transition(p.id, "apply");
		expect(() => curator.transition(p.id, "approve")).toThrow(
			/illegal transition/,
		);
		expect(() => curator.transition(p.id, "supersede")).toThrow(
			/illegal transition/,
		);
		expect(() => curator.transition(p.id, "delete" as never)).toThrow(
			/unknown transition/,
		);
		expect(() => curator.transition("nope", "approve")).toThrow(/not found/);

		const row = store
			.prepare("SELECT status FROM curation_proposals WHERE id = ?")
			.get(p.id) as { status: string };
		expect(row.status).toBe("applied");
	});

	it("propose() returns [] when no candidate clears the floor", () => {
		const { store, curator, writer } = freshEnv();
		seedMemory(store, "mem-1", "low signal", { evidenceCount: 0 });
		expect(curator.propose("agents_md", writer)).toEqual([]);
		expect(rows(store)).toHaveLength(0);
	});

	it("target path honors the agents_md_path setting and the returned proposal is the row", () => {
		const { store, curator, writer, agentsPath } = freshEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const [p] = curator.propose("agents_md", writer);
		expect(p.targetPath).toBe(agentsPath);
		const row = store
			.prepare(
				"SELECT id, kind, target_path, proposed_text, status FROM curation_proposals WHERE id = ?",
			)
			.get(p.id) as {
			id: string;
			kind: string;
			target_path: string;
			proposed_text: string;
			status: string;
		};
		expect(row.id).toBe(p.id);
		expect(row.kind).toBe("agents_md");
		expect(row.target_path).toBe(agentsPath);
		expect(row.proposed_text).toBe(p.proposedText);
		expect(row.status).toBe("pending");
	});
});
