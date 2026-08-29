import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ArtifactWriter,
	MARKER_BEGIN,
	MARKER_END,
} from "@jmtrin/kevin-core";
import { type CurationCandidate, Curator } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { unifiedDiff } from "@jmtrin/kevin-core";

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

interface MemSeed {
	id: string;
	content: string;
	status?: string;
	ignored?: number;
	curated?: number;
	/** undefined → NULL (unknown); 1 → inferable; 0 → non_inferable. */
	inferable?: number | null;
	evidenceCount?: number;
	recurrenceCount?: number;
	feedbackPositive?: number;
	feedbackNegative?: number;
}

function freshCurator(): { store: Store; curator: Curator } {
	const store = new Store({ path: ":memory:" });
	for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006, SQL_007]) {
		store.exec(sql);
	}
	const svc = new MemoryService(store);
	const curator = new Curator(store, svc, "proj-x");
	return { store, curator };
}

function seed(store: Store, s: MemSeed): void {
	store
		.prepare(
			`INSERT INTO memories (
			  id, type, content, scope, relevance_score, source_tool, source_session,
			  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
			  evidence_count, last_verified_at, status, recurrence_count, ignored,
			  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
			 VALUES (?, 'rule', ?, 'project', 0.5, NULL, NULL, NULL,
			         datetime('now'), datetime('now'), NULL, 'proj-x', NULL, 'agent',
			         ?, datetime('now'), 'active', ?, ?, NULL, ?, ?, ?, NULL, ?)`,
		)
		.run(
			s.id,
			s.content,
			s.evidenceCount ?? 2,
			s.recurrenceCount ?? 0,
			s.ignored ?? 0,
			s.feedbackPositive ?? 0,
			s.feedbackNegative ?? 0,
			s.curated ?? 0,
			s.inferable === undefined ? null : s.inferable,
		);
	if (s.status !== undefined) {
		store
			.prepare("UPDATE memories SET status = ? WHERE id = ?")
			.run(s.status, s.id);
	}
}

function eligible(
	store: Store,
	id: string,
	content = "Run tsc after editing types",
): void {
	seed(store, { id, content });
}

const candidateIds = (cands: CurationCandidate[]): string[] =>
	cands.map((c) => c.memoryId);

const mockService = (): MemoryService => ({}) as unknown as MemoryService;

describe("K6-012 — Curator.candidates() + renderBlock() (plan §5.4)", () => {
	it("a fully eligible row is selected", () => {
		const { store, curator } = freshCurator();
		eligible(store, "m1");
		const cands = curator.candidates();
		expect(candidateIds(cands)).toEqual(["m1"]);
		const today = new Date().toISOString().slice(0, 10);
		expect(cands[0]?.line).toBe(
			`- Run tsc after editing types (verified 2×, last ${today})`,
		);
		expect(cands[0]?.confidence).toBe(0.7);
	});

	it("clause status='active' — a stale row failing only that clause is excluded", () => {
		const { store, curator } = freshCurator();
		eligible(store, "m1");
		eligible(store, "m2");
		store.prepare("UPDATE memories SET status = 'stale' WHERE id = 'm2'").run();
		expect(candidateIds(curator.candidates())).toEqual(["m1"]);
	});

	it("clause ignored=0 — an ignored row failing only that clause is excluded", () => {
		const { store, curator } = freshCurator();
		eligible(store, "m1");
		seed(store, { id: "m2", content: "ignored", ignored: 1 });
		expect(candidateIds(curator.candidates())).toEqual(["m1"]);
	});

	it("clause curated=0 — a curated row failing only that clause is excluded", () => {
		const { store, curator } = freshCurator();
		eligible(store, "m1");
		seed(store, { id: "m2", content: "curated", curated: 1 });
		expect(candidateIds(curator.candidates())).toEqual(["m1"]);
	});

	it("clause inferable — NULL is included, 1 is excluded", () => {
		const { store, curator } = freshCurator();
		eligible(store, "m1");
		seed(store, { id: "m2", content: "inferable", inferable: 1 });
		expect(candidateIds(curator.candidates())).toEqual(["m1"]);
		const { store: s2, curator: c2 } = freshCurator();
		seed(s2, { id: "m3", content: "unknown", inferable: null });
		expect(candidateIds(c2.candidates())).toEqual(["m3"]);
	});

	it("clause confidence>=0.6 — a row failing only that clause is excluded", () => {
		const { store, curator } = freshCurator();
		eligible(store, "m1");
		// evidence 2, recurrence 2 → 0.5 + 0.2 - 0.3 = 0.4 < 0.6; clause 6
		// (evidence >= 2) still passes — only the floor excludes this row.
		seed(store, { id: "m2", content: "low confidence", recurrenceCount: 2 });
		expect(candidateIds(curator.candidates())).toEqual(["m1"]);
	});

	it("clause 6 disjunction — evidence=2/fb=0 and evidence=0/fb=1 included, evidence=1/fb=0 excluded", () => {
		const { store, curator } = freshCurator();
		seed(store, {
			id: "m1",
			content: "causal",
			evidenceCount: 2,
			feedbackPositive: 0,
		});
		seed(store, {
			id: "m2",
			content: "feedback",
			evidenceCount: 0,
			feedbackPositive: 1,
		});
		seed(store, {
			id: "m3",
			content: "nothing",
			evidenceCount: 1,
			feedbackPositive: 0,
		});
		const ids = candidateIds(curator.candidates()).sort();
		expect(ids).toEqual(["m1", "m2"]);
	});

	it("the 20-line cap binds before content length with short memories", () => {
		const { store, curator } = freshCurator();
		for (let i = 0; i < 25; i++) {
			eligible(store, `m${String(i).padStart(2, "0")}`, "Short memory");
		}
		const cands = curator.candidates();
		expect(cands.length).toBe(20);
		expect(curator.renderBlock(cands).split("\n")).toHaveLength(21);
	});

	it("the 4000-character cap binds with 5 very long memories", () => {
		const { store, curator } = freshCurator();
		const long = "A".repeat(1000);
		for (let i = 0; i < 5; i++) {
			eligible(store, `m${i}`, long);
		}
		const cands = curator.candidates();
		expect(cands.length).toBe(4);
		const rawTotal = cands.reduce((sum, c) => sum + c.line.length, 0);
		expect(rawTotal).toBeLessThanOrEqual(4000);
	});

	it("renderBlock sorts by memory id, not confidence", () => {
		const cands: CurationCandidate[] = [
			{
				memoryId: "m-z",
				line: "- z (verified 2×)",
				confidence: 0.9,
				evidence: "verified 2×",
			},
			{
				memoryId: "m-a",
				line: "- a (verified 2×)",
				confidence: 0.6,
				evidence: "verified 2×",
			},
			{
				memoryId: "m-m",
				line: "- m (verified 2×)",
				confidence: 0.7,
				evidence: "verified 2×",
			},
		];
		expect(
			new Curator(
				new Store({ path: ":memory:" }),
				mockService(),
				"p",
			).renderBlock(cands),
		).toBe("- a (verified 2×)\n- m (verified 2×)\n- z (verified 2×)\n");
	});

	it("adding one candidate to a set of ten changes exactly one line of the block", () => {
		const ten: CurationCandidate[] = [];
		for (let i = 0; i < 10; i++) {
			const id = `m${String(i).padStart(2, "0")}`;
			ten.push({
				memoryId: id,
				line: `- line ${id} (verified 2×)`,
				confidence: 0.7,
				evidence: "verified 2×",
			});
		}
		const curator = new Curator(
			new Store({ path: ":memory:" }),
			mockService(),
			"p",
		);
		const before = curator.renderBlock(ten);
		const after = curator.renderBlock([
			...ten,
			{
				memoryId: "m-new",
				line: "- line m-new (verified 2×)",
				confidence: 0.7,
				evidence: "verified 2×",
			},
		]);
		const diff = unifiedDiff("AGENTS.md", before, after);
		const added = diff
			.split("\n")
			.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
		const removed = diff
			.split("\n")
			.filter((l) => l.startsWith("-") && !l.startsWith("---"));
		expect(added).toHaveLength(1);
		expect(removed).toHaveLength(0);
	});

	it("propose merge dedups a line already in the block on CRLF files", () => {
		const { store, curator } = freshCurator();
		const dir = mkdtempSync(join(tmpdir(), "kevin-curator-crlf-"));
		const target = join(dir, "AGENTS.md");
		store
			.prepare(
				"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('agents_md_path', ?)",
			)
			.run(target);
		seed(store, { id: "mem-a", content: "Run tsc after editing types" });
		// Deterministic evidence string: no last-verified date in the line.
		store
			.prepare("UPDATE memories SET last_verified_at = NULL WHERE id = 'mem-a'")
			.run();
		const line = "- Run tsc after editing types (verified 2\u00d7)";
		// The candidate line sits in the MIDDLE of a CRLF block — the line
		// after it is what used to keep its trailing "\r" after split("\n"),
		// defeating the merge dedup and duplicating the line (regression
		// found before the v0.6.0 tag; fixed with split(/\r?\n/)).
		const block = `${MARKER_BEGIN}\r\n${line}\r\n- Older line from a previous approval (verified 2\u00d7)\r\n${MARKER_END}\r\n`;
		writeFileSync(target, `# Project\r\n\r\n${block}`, "utf8");

		const writer = new ArtifactWriter(store, "proj-x");
		const proposals = curator.propose("agents_md", writer);

		expect(proposals).toHaveLength(1);
		const text = proposals[0].proposedText;
		// The line is not proposed doubled.
		expect(text.split(/\r?\n/).filter((l) => l === line)).toHaveLength(1);
		// The older line survives untouched.
		expect(text).toContain(
			"- Older line from a previous approval (verified 2\u00d7)",
		);
		// No orphan "\r" characters (mixed endings) in the merged block.
		expect(text).not.toMatch(/\r[^\n]/);
	});

	it("the module imports no filesystem module", () => {
		const source = readFileSync(
			join(process.cwd(), "plugin", "Curator.ts"),
			"utf8",
		);
		expect(source).not.toContain("node:fs");
		expect(source).not.toContain('require("fs")');
	});
});
