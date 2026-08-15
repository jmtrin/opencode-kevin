import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../../plugin/ArtifactWriter.js";
import { Materializer } from "../../plugin/Materializer.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

let tmpRoot: string;
let store: Store;
let metrics: Metrics;
let root: string;

const SQL_001 = readFileSync(
	join(process.cwd(), "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(process.cwd(), "migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(process.cwd(), "migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(process.cwd(), "migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(process.cwd(), "migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(process.cwd(), "migrations", "007_v06_pull.sql"),
	"utf8",
);

function makeMigratedStore(): Store {
	const s = new Store({ path: ":memory:" });
	for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006, SQL_007]) {
		s.exec(sql);
	}
	return s;
}

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

function materializer(): Materializer {
	return new Materializer(store, { root });
}

function writer(): ArtifactWriter {
	return new ArtifactWriter(store, "test-project", metrics);
}

describe("K6-017 — Materializer topic bundles (plan §5.6, D6-14)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-mat-"));
		root = join(tmpRoot, "opencode-kevin");
		// The ArtifactWriter writes next to the target, so the parent
		// directories must exist — production creates them at emission time.
		mkdirSync(join(root, "skills"), { recursive: true });
		mkdirSync(join(root, "refs"), { recursive: true });
		store = makeMigratedStore();
		metrics = new Metrics(store);
	});

	afterEach(() => {
		metrics.close();
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("derives the dominant token stably across 100 runs, ties broken lexicographically", () => {
		seedMemory("m1", "rule", "aaa bbb");
		seedMemory("m2", "rule", "aaa ccc");
		seedMemory("m3", "rule", "bbb ccc");
		const topics: string[] = [];
		for (let i = 0; i < 100; i++) {
			topics.push(materializer().bundleTargets()[1].topic);
		}
		expect(new Set(topics)).toEqual(new Set(["rule-aaa"]));
	});

	it("never derives a topic from a hex-only token of length >= 8 (D6-14)", () => {
		seedMemory("m1", "error", "npm link with a3f9c1d2beef0011");
		seedMemory("m2", "error", "npm build with a3f9c1d2beef0011");
		seedMemory("m3", "error", "npm test with a3f9c1d2beef0011");
		const targets = materializer().bundleTargets();
		expect(targets.length).toBe(2);
		const ref = targets.find((t) => t.topic !== "project-knowledge");
		expect(ref?.topic).toBe("error-npm");
		expect(/[0-9a-f]{8}/.test(ref?.topic ?? "")).toBe(false);
	});

	it("regeneration with unchanged inputs yields noop for every bundle and byte-identical files", () => {
		seedMemory("m1", "rule", "npm test must pass before commit");
		seedMemory("m2", "rule", "npm test runs the vitest suite");
		const first = materializer().materialize(writer());
		expect(first.every((b) => b.outcome === "written")).toBe(true);
		const bytes = new Map(
			first.map((b) => [b.path, readFileSync(b.path, "utf8")]),
		);
		const second = materializer().materialize(writer());
		expect(second.every((b) => b.outcome === "noop")).toBe(true);
		for (const b of second) {
			expect(readFileSync(b.path, "utf8")).toBe(bytes.get(b.path));
		}
	});

	it("renders every bundle ordered by memory id", () => {
		seedMemory("z-mem", "rule", "zzz last");
		seedMemory("a-mem", "rule", "aaa first");
		seedMemory("m-mem", "rule", "mmm middle");
		const first = materializer().materialize(writer());
		const skill = first.find((b) => b.topic === "project-knowledge");
		const body = readFileSync(skill?.path ?? "", "utf8");
		const lines = body
			.split("\n")
			.filter((l) => l.startsWith("- "))
			.map((l) => l.replace(/^- /, ""));
		expect(lines).toEqual(["aaa first", "mmm middle", "zzz last"]);
	});

	it("produces filesystem-safe topic names (no /, \\, :, or leading dot)", () => {
		seedMemory("m1", "decision", "npm audit must pass clean");
		seedMemory("m2", "rule", "cargo build before every merge");
		const refs = materializer()
			.bundleTargets()
			.filter((t) => t.topic !== "project-knowledge");
		for (const ref of refs) {
			expect(/^[a-z0-9-]+$/.test(ref.topic)).toBe(true);
			expect(ref.topic.startsWith(".")).toBe(false);
		}
		expect(refs[0].topic).toBe("decision-audit");
		expect(refs[1].topic).toBe("rule-build");
	});

	it("materializes nothing when no memory is curated", () => {
		store
			.prepare(
				`INSERT INTO memories (
				  id, type, content, scope, relevance_score, source_tool, source_session,
				  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
				  evidence_count, last_verified_at, status, recurrence_count, ignored,
				  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
				 VALUES (?, 'rule', ?, 'project', 0.5, NULL, NULL, NULL,
				         datetime('now'), datetime('now'), NULL, NULL, NULL, 'agent',
				         2, datetime('now'), 'active', 0, 0, NULL, 0, 0, 0, NULL, NULL)`,
			)
			.run("not-curated", "npm test must pass");
		expect(materializer().materialize(writer())).toEqual([]);
	});

	it("module source contains no node:fs import and no direct file-writing calls", () => {
		const src = readFileSync(
			join(process.cwd(), "plugin", "Materializer.ts"),
			"utf8",
		);
		expect(src).not.toMatch(/node:fs/);
		expect(src).not.toMatch(/writeFileSync|appendFileSync|createWriteStream/);
	});

	it("bundle targets are deterministic in order: skill first, refs sorted by topic", () => {
		seedMemory("m1", "decision", "clamp push budget");
		seedMemory("m2", "rule", "npm test must pass");
		const targets = materializer().bundleTargets();
		expect(targets[0].topic).toBe("project-knowledge");
		expect(targets[1].topic).toBe("decision-budget");
		expect(targets[2].topic).toBe("rule-npm");
	});
});
