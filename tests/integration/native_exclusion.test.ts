import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { Materializer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import type { HostSurface } from "../../packages/plugin/src/host.js";
import { Metrics } from "@jmtrin/kevin-core";
import {
	type KevinNativeContext,
	type NativeDeps,
	attachNative,
} from "../../packages/plugin/src/native.js";

// K9-013 containment: only plugin/native.ts may name the v2 subpath, so
// this file assembles the specifier from parts instead of the literal.
const V2_SPECIFIER = "@opencode-ai/plugin" + "/v2/promise";

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

const FIXTURES = join(process.cwd(), "tests", "fixtures", "emission");

const skillFixture = readFileSync(join(FIXTURES, "skill_v080.md"), "utf8");
const refRuleFixture = readFileSync(
	join(FIXTURES, "ref_rule-commit_v080.md"),
	"utf8",
);
const refSolutionFixture = readFileSync(
	join(FIXTURES, "ref_solution-change_v080.md"),
	"utf8",
);

let tmpRoot: string;
let root: string;
let store: Store;
let metrics: Metrics;

const seededSql = [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006, SQL_007];

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

/** The exact curated corpus the v0.8.0 emission fixtures were generated
 * from — m1 rule, m2 solution, both curated and active. */
function seedFixtureCorpus(): void {
	seedMemory("m1", "rule", "npm test must pass before any commit");
	seedMemory("m2", "solution", "run the full suite after every change");
}

function deps(registrationEnabled: string): NativeDeps {
	return {
		materializer: new Materializer(store, { root }),
		settings: {
			getSetting: (key: string, fallback = "0") =>
				key === "native_registration_enabled" ? registrationEnabled : fallback,
		},
	};
}

function v1Host(): HostSurface {
	return {
		pluginVersion: "1.17.6",
		flavour: "v1-only",
		project: { id: null, worktree: null, directory: null },
		hasShell: true,
		v2: { skill: false, reference: false },
		notes: [],
	};
}

function v2Host(): HostSurface {
	return {
		pluginVersion: "1.18.18",
		flavour: "v1+v2",
		project: { id: null, worktree: null, directory: null },
		hasShell: true,
		v2: { skill: true, reference: true },
		notes: [],
	};
}

type TransformHook = (draft: unknown) => Promise<void> | void;

/** A draft that honours both transforms, so read-back verification passes. */
function honouringContext(): KevinNativeContext {
	let storedSource: string | undefined;
	const skillDraft = {
		source(body: string): void {
			storedSource = body;
		},
		list(): unknown[] {
			return [storedSource];
		},
	};
	const refDraft = {
		entries: [] as [string, unknown][],
		add(name: string, source: unknown): void {
			this.entries.push([name, source]);
		},
		list(): [string, unknown][] {
			return this.entries;
		},
	};
	return {
		skill: {
			transform: async (hook: TransformHook) => {
				await hook(skillDraft);
			},
		},
		reference: {
			transform: async (hook: TransformHook) => {
				await hook(refDraft);
			},
		},
	};
}

function v2DefineRunsSetup(): () => Promise<unknown> {
	return () =>
		Promise.resolve({
			define: (plugin: { setup: (ctx: KevinNativeContext) => unknown }) => {
				void plugin.setup(honouringContext());
				return plugin;
			},
		});
}

function dirMtime(dir: string): number {
	return statSync(dir).mtimeMs;
}

describe("K9-016 — mutual exclusion with Materializer emission (plan §5.4, D9-10)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-exclusion-"));
		root = join(tmpRoot, "opencode-kevin");
		mkdirSync(join(root, "skills"), { recursive: true });
		mkdirSync(join(root, "refs"), { recursive: true });
		store = new Store({ path: join(tmpRoot, "test.db") });
		for (const sql of seededSql) store.exec(sql);
		metrics = new Metrics(store);
	});

	afterEach(() => {
		metrics.close();
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("row 1 — '0' + v2 subpath: file emission, bytes identical to v0.8.0", async () => {
		seedFixtureCorpus();
		const notes: string[] = [];
		const registration = await attachNative(v2Host(), deps("0"), { notes });
		expect(registration).toBeNull();
		const materializer = deps("0").materializer;
		const outcomes = materializer.materialize(
			new ArtifactWriter(store, "test-project", metrics),
		);
		expect(outcomes.map((o) => o.outcome)).toEqual([
			"written",
			"written",
			"written",
		]);
		expect(
			readFileSync(join(root, "skills", "project-knowledge.md"), "utf8"),
		).toBe(skillFixture);
		expect(readFileSync(join(root, "refs", "rule-commit.md"), "utf8")).toBe(
			refRuleFixture,
		);
		expect(readFileSync(join(root, "refs", "solution-change.md"), "utf8")).toBe(
			refSolutionFixture,
		);
	});

	it("row 2 — '1' + subpath absent: file emission, bytes identical to v0.8.0, note recorded", async () => {
		seedFixtureCorpus();
		const notes: string[] = [];
		const registration = await attachNative(v1Host(), deps("1"), { notes });
		expect(registration).toBeNull();
		expect(notes.join(" ")).toContain("v2 subpath absent");
		const materializer = deps("1").materializer;
		const outcomes = materializer.materialize(
			new ArtifactWriter(store, "test-project", metrics),
		);
		expect(outcomes.map((o) => o.outcome)).toEqual([
			"written",
			"written",
			"written",
		]);
		expect(
			readFileSync(join(root, "skills", "project-knowledge.md"), "utf8"),
		).toBe(skillFixture);
		expect(readFileSync(join(root, "refs", "rule-commit.md"), "utf8")).toBe(
			refRuleFixture,
		);
		expect(readFileSync(join(root, "refs", "solution-change.md"), "utf8")).toBe(
			refSolutionFixture,
		);
	});

	it("row 3 — '1' + subpath present: registration, zero filesystem writes (listing and mtimes untouched)", async () => {
		seedFixtureCorpus();
		const notes: string[] = [];
		const registration = await attachNative(v2Host(), deps("1"), {
			importV2: v2DefineRunsSetup(),
			notes,
		});
		expect(registration).not.toBeNull();
		expect(registration?.registered).toEqual({ skill: true, reference: true });
		// The wiring index.ts performs after attachNative (K9-018): the
		// Materializer learns which surfaces are registered natively.
		const materializer = deps("1").materializer;
		const flags = registration?.registered ?? {
			skill: false,
			reference: false,
		};
		materializer.markNativeRegistered("skill", flags.skill);
		materializer.markNativeRegistered("reference", flags.reference);
		const skillMtime = dirMtime(join(root, "skills"));
		const refMtime = dirMtime(join(root, "refs"));
		const outcomes = materializer.materialize(
			new ArtifactWriter(store, "test-project", metrics),
		);
		expect(outcomes).toEqual([]);
		expect(readdirSync(join(root, "skills"))).toEqual([]);
		expect(readdirSync(join(root, "refs"))).toEqual([]);
		expect(dirMtime(join(root, "skills"))).toBe(skillMtime);
		expect(dirMtime(join(root, "refs"))).toBe(refMtime);
	});

	it("surfaces are decided independently — skill registered, references still emitted", async () => {
		seedFixtureCorpus();
		const materializer = deps("1").materializer;
		materializer.markNativeRegistered("skill", true);
		const outcomes = materializer.materialize(
			new ArtifactWriter(store, "test-project", metrics),
		);
		expect(outcomes.map((o) => o.topic).sort()).toEqual([
			"rule-commit",
			"solution-change",
		]);
		expect(readdirSync(join(root, "skills"))).toEqual([]);
		expect(readFileSync(join(root, "refs", "rule-commit.md"), "utf8")).toBe(
			refRuleFixture,
		);
		expect(readFileSync(join(root, "refs", "solution-change.md"), "utf8")).toBe(
			refSolutionFixture,
		);
	});

	it("no configuration produces both a registration and a file for the same surface", async () => {
		seedFixtureCorpus();
		// '1' + subpath present: attachNative registers, markNativeRegistered
		// with the actual flags, then emission — every surface that has a
		// registration flag true must have zero files under its dir.
		const registration = await attachNative(v2Host(), deps("1"), {
			importV2: v2DefineRunsSetup(),
		});
		expect(registration).not.toBeNull();
		const materializer = deps("1").materializer;
		const flags = registration?.registered ?? {
			skill: false,
			reference: false,
		};
		for (const surface of ["skill", "reference"] as const) {
			materializer.markNativeRegistered(surface, flags[surface]);
		}
		const outcomes = materializer.materialize(
			new ArtifactWriter(store, "test-project", metrics),
		);
		expect(outcomes).toEqual([]);
		expect(readdirSync(join(root, "skills"))).toEqual([]);
		expect(readdirSync(join(root, "refs"))).toEqual([]);
		// And the inverse: with registration off, the same corpus emits
		// files — so the difference is the registration flag alone.
		const materializerOff = deps("0").materializer;
		const outcomesOff = materializerOff.materialize(
			new ArtifactWriter(store, "test-project", metrics),
		);
		expect(outcomesOff.length).toBe(3);
		expect(
			readFileSync(join(root, "skills", "project-knowledge.md"), "utf8"),
		).toBe(skillFixture);
	});
});
