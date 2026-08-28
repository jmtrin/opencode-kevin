import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactWriter } from "../../plugin/ArtifactWriter.js";
import { ConflictDetector } from "../../plugin/ConflictDetector.js";
import { Curator } from "../../plugin/Curator.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";
import {
	consumeMailbox,
	processActions,
	proposalToken,
	readMailbox,
} from "../../plugin/TuiActions.js";
import { kevinApprove } from "../../plugin/kevin_approve.js";
import { Metrics } from "../../plugin/metrics.js";

function setupEnv(): {
	store: Store;
	svc: MemoryService;
	curator: Curator;
	writer: ArtifactWriter;
	metrics: Metrics;
	detector: ConflictDetector;
	tmpDir: string;
	agentsPath: string;
	materializerRoot: string;
} {
	const store = new Store({ path: ":memory:" });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
		"009_v08_team.sql",
	]) {
		store.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
	}
	const tmpDir = mkdtempSync(join(tmpdir(), "tui-proc-"));
	const agentsPath = join(tmpDir, "AGENTS.md");
	const materializerRoot = mkdtempSync(join(tmpdir(), "mat-"));
	store
		.prepare(
			"INSERT OR REPLACE INTO kevin_settings (key,value) VALUES ('agents_md_path',?)",
		)
		.run(agentsPath);
	const svc = new MemoryService(store);
	const metrics = new Metrics(store, 100000);
	const curator = new Curator(store, svc, "proj-x", metrics);
	const writer = new ArtifactWriter(store, "proj-x", metrics);
	const detector = new ConflictDetector(store, "proj-x", metrics);
	return {
		store,
		svc,
		curator,
		writer,
		metrics,
		detector,
		tmpDir,
		agentsPath,
		materializerRoot,
	};
}

function seedMemory(store: Store, id: string, content: string) {
	store
		.prepare(
			`INSERT INTO memories (id, type, content, scope, relevance_score, project_id, fingerprint, origin, evidence_count, last_verified_at, status, recurrence_count, ignored, feedback_positive, feedback_negative, curated, inferable)
			 VALUES (?, 'rule', ?, 'project', 0.5, 'proj-x', NULL, 'agent', 2, datetime('now'), 'active', 0, 0, 0, 0, 0, NULL)`,
		)
		.run(id, content);
}

describe("K12-007 — processActions executing existing handlers", () => {
	it("approve via mailbox writes AGENTS.md through ArtifactWriter and results applied", () => {
		const {
			store,
			svc,
			curator,
			writer,
			metrics,
			tmpDir,
			agentsPath,
			materializerRoot,
		} = setupEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const [prop] = curator.propose("agents_md", writer);
		const token = proposalToken(prop.id, prop.proposedText);
		// Write mailbox
		mkdirSync(join(materializerRoot, "tui"), { recursive: true });
		writeFileSync(
			join(materializerRoot, "tui", "actions.json"),
			JSON.stringify({
				issuedAt: new Date().toISOString(),
				actions: [{ type: "approve", proposalId: prop.id, token }],
			}),
			"utf8",
		);
		const pending = () => {
			const rows = store
				.prepare(
					"SELECT id, proposed_text FROM curation_proposals WHERE status='pending'",
				)
				.all() as { id: string; proposed_text: string }[];
			return rows.map((r) => ({ id: r.id, proposedText: r.proposed_text }));
		};
		const deps = {
			getPending: pending,
			approve: (id: string) =>
				kevinApprove(store, svc, curator, writer, metrics, {
					proposalId: id,
					decision: "approve",
				}),
			reject: (id: string) => curator.transition(id, "reject"),
			acknowledge: (id: string) => require("../../plugin/ConflictDetector.js"), // dummy
			metrics,
		};
		// Use non-throw acknowledge
		(deps as unknown as { acknowledge: (id: string) => void }).acknowledge = (
			id: string,
		) => {};
		const results = consumeMailbox(materializerRoot, deps);
		metrics.flush();
		expect(results[0].status).toBe("applied");
		// AGENTS.md written through ArtifactWriter
		expect(existsSync(agentsPath)).toBe(true);
		const content = readFileSync(agentsPath, "utf8");
		expect(content).toContain("npm test must pass");
		// results.json exists, queue deleted
		expect(existsSync(join(materializerRoot, "tui", "results.json"))).toBe(
			true,
		);
		expect(existsSync(join(materializerRoot, "tui", "actions.json"))).toBe(
			false,
		);
		// Counter
		const row = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='tui_actions_invoked'",
			)
			.get() as { value: number } | undefined;
		expect(row?.value).toBe(1);
		rmSync(tmpDir, { recursive: true, force: true });
		rmSync(materializerRoot, { recursive: true, force: true });
		metrics.close();
		store.close();
	});

	it("reject path transitions state without touching disk artifacts", () => {
		const { store, svc, curator, writer, metrics, tmpDir, materializerRoot } =
			setupEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const [prop] = curator.propose("agents_md", writer);
		const token = proposalToken(prop.id, prop.proposedText);
		mkdirSync(join(materializerRoot, "tui"), { recursive: true });
		writeFileSync(
			join(materializerRoot, "tui", "actions.json"),
			JSON.stringify({
				issuedAt: new Date().toISOString(),
				actions: [{ type: "reject", proposalId: prop.id, token }],
			}),
			"utf8",
		);
		const pending = () => {
			const rows = store
				.prepare(
					"SELECT id, proposed_text FROM curation_proposals WHERE status='pending'",
				)
				.all() as { id: string; proposed_text: string }[];
			return rows.map((r) => ({ id: r.id, proposedText: r.proposed_text }));
		};
		const deps = {
			getPending: pending,
			approve: (id: string) =>
				kevinApprove(store, svc, curator, writer, metrics, {
					proposalId: id,
					decision: "approve",
				}),
			reject: (id: string) => curator.transition(id, "reject"),
			acknowledge: () => {},
			metrics,
		};
		const results = consumeMailbox(materializerRoot, deps);
		expect(results[0].status).toBe("rejected");
		const row = store
			.prepare("SELECT status FROM curation_proposals WHERE id=?")
			.get(prop.id) as { status: string };
		expect(row.status).toBe("rejected");
		expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(false);
		rmSync(tmpDir, { recursive: true, force: true });
		rmSync(materializerRoot, { recursive: true, force: true });
		metrics.close();
		store.close();
	});

	it("double-approve second run stale_skipped", () => {
		const { store, svc, curator, writer, metrics, materializerRoot } =
			setupEnv();
		seedMemory(store, "mem-1", "npm test must pass before any commit");
		const [prop] = curator.propose("agents_md", writer);
		const token = proposalToken(prop.id, prop.proposedText);
		mkdirSync(join(materializerRoot, "tui"), { recursive: true });
		const pending = () => {
			const rows = store
				.prepare(
					"SELECT id, proposed_text FROM curation_proposals WHERE status='pending'",
				)
				.all() as { id: string; proposed_text: string }[];
			return rows.map((r) => ({ id: r.id, proposedText: r.proposed_text }));
		};
		const deps = {
			getPending: pending,
			approve: (id: string) =>
				kevinApprove(store, svc, curator, writer, metrics, {
					proposalId: id,
					decision: "approve",
				}),
			reject: (id: string) => curator.transition(id, "reject"),
			acknowledge: () => {},
			metrics,
		};
		// First
		writeFileSync(
			join(materializerRoot, "tui", "actions.json"),
			JSON.stringify({
				issuedAt: new Date().toISOString(),
				actions: [{ type: "approve", proposalId: prop.id, token }],
			}),
			"utf8",
		);
		const r1 = consumeMailbox(materializerRoot, deps);
		expect(r1[0].status).toBe("applied");
		// Second with same token (now pending empty)
		writeFileSync(
			join(materializerRoot, "tui", "actions.json"),
			JSON.stringify({
				issuedAt: new Date().toISOString(),
				actions: [{ type: "approve", proposalId: prop.id, token }],
			}),
			"utf8",
		);
		const r2 = consumeMailbox(materializerRoot, deps);
		expect(r2[0].status).toBe("stale_skipped");
		rmSync(materializerRoot, { recursive: true, force: true });
		metrics.close();
		store.close();
	});

	it("one failing action never aborts siblings and error status", () => {
		const storeTmp = new Store({ path: ":memory:" });
		const metrics = new Metrics(storeTmp, 100000);
		const actions = [
			{
				type: "approve" as const,
				proposalId: "p1",
				token: proposalToken("p1", "text1"),
			},
			{
				type: "approve" as const,
				proposalId: "p2",
				token: proposalToken("p2", "text2"),
			},
		];
		const pending = [
			{ id: "p1", proposedText: "text1" },
			{ id: "p2", proposedText: "text2" },
		];
		const deps = {
			getPending: () => pending,
			approve: (id: string) => {
				if (id === "p1") throw new Error("boom");
				return {};
			},
			reject: () => {},
			acknowledge: () => {},
			metrics,
		};
		const results = processActions(actions, deps);
		expect(results[0].status).toBe("error");
		expect(results[0].detail).toMatch(/boom/);
		expect(results[1].status).toBe("applied");
		metrics.close();
		storeTmp.close();
	});
});
