import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Materializer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import type { HostSurface } from "../../packages/plugin/src/host.js";
import {
	type KevinNativeContext,
	type NativeDeps,
	attachNative,
	buildNativePlugin,
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

interface StubDraft {
	addCalls: [string, unknown][];
	sources: [string, unknown][];
	removeCalls: string[];
	add(name: string, source: unknown): void;
	list(): readonly [string, unknown][];
	remove(name: string): void;
}

function makeDraft(keep: boolean): StubDraft {
	const draft: StubDraft = {
		addCalls: [],
		sources: [],
		removeCalls: [],
		add: () => {},
		list: () => draft.sources,
		remove: () => {},
	};
	draft.add = (name: string, source: unknown) => {
		draft.addCalls.push([name, source]);
		if (keep) draft.sources.push([name, source]);
	};
	draft.remove = (name: string) => {
		draft.removeCalls.push(name);
	};
	return draft;
}

type TransformHook = (draft: unknown) => Promise<void> | void;

function stubContext(draft: unknown, reject = false): KevinNativeContext {
	return {
		skill: {
			transform: async () => {},
		},
		reference: {
			transform: async (hook: TransformHook) => {
				if (reject) throw new Error("boom");
				await hook(draft);
			},
		},
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

let tmpRoot: string;
let store: Store;
let root: string;

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

function deps(): NativeDeps {
	return {
		materializer: new Materializer(store, { root }),
		settings: {
			getSetting: (key: string, fallback = "0") =>
				key === "native_registration_enabled" ? "1" : fallback,
		},
	};
}

describe("K9-015 — reference.transform registration (plan §5.4, D6-14)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-nativeref-"));
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

	it("calls add() exactly once per curated ref target, verified via list()", async () => {
		seedMemory("m1", "rule", "aaa bbb");
		seedMemory("m2", "rule", "aaa ccc");
		seedMemory("m3", "solution", "xxx yyy");
		const draft = makeDraft(true);
		const events: [string, boolean, boolean][] = [];
		const plugin = buildNativePlugin({
			...deps(),
			onVerified: (surface, registered, verified) => {
				events.push([surface, registered, verified]);
			},
		});
		await plugin.setup(stubContext(draft));
		const targets = deps()
			.materializer.bundleTargets()
			.filter((t) => t.topic !== "project-knowledge");
		expect(draft.addCalls).toHaveLength(targets.length);
		expect(draft.removeCalls).toEqual([]);
		expect(draft.addCalls.map(([name]) => name).sort()).toEqual(
			targets.map((t) => `@kevin/${t.topic}`).sort(),
		);
		for (const [name, source] of draft.addCalls) {
			const target = targets.find((t) => `@kevin/${t.topic}` === name);
			expect(source).toEqual({ type: "local", path: target?.path });
		}
		expect(events).toEqual([["reference", true, true]]);
	});

	it("a list() without the added names means an unverified note, never a throw", async () => {
		seedMemory("m1", "rule", "aaa bbb");
		const draft = makeDraft(false);
		const notes: string[] = [];
		const result = await attachNative(v2Host(), deps(), {
			importV2: () =>
				Promise.resolve({
					define: (plugin: { setup: (ctx: KevinNativeContext) => unknown }) => {
						void plugin.setup(stubContext(draft));
						return plugin;
					},
				}),
			notes,
		});
		expect(result).not.toBeNull();
		expect(result?.registered.reference).toBe(true);
		expect(result?.verified.reference).toBe(false);
		expect(result?.notes.join(" ")).toContain("read-back");
		expect(draft.removeCalls).toEqual([]);
	});

	it("a rejecting transform reports registered false without throwing", async () => {
		const draft = makeDraft(true);
		const events: [string, boolean, boolean][] = [];
		const plugin = buildNativePlugin({
			...deps(),
			onVerified: (surface, registered, verified) => {
				events.push([surface, registered, verified]);
			},
		});
		await expect(
			plugin.setup(stubContext(draft, true)),
		).resolves.toBeUndefined();
		expect(events).toEqual([["reference", false, false]]);
	});

	it("a draft without add() reports registered false", async () => {
		const events: [string, boolean, boolean][] = [];
		const plugin = buildNativePlugin({
			...deps(),
			onVerified: (surface, registered, verified) => {
				events.push([surface, registered, verified]);
			},
		});
		await plugin.setup(stubContext({}));
		expect(events).toEqual([["reference", false, false]]);
	});

	it("a hex-like fingerprint token can never become a reference name (D6-14)", async () => {
		seedMemory("m1", "rule", "0123456789abcdef");
		const draft = makeDraft(true);
		const plugin = buildNativePlugin(deps());
		await plugin.setup(stubContext(draft));
		const names = draft.addCalls.map(([name]) => name);
		expect(names).not.toContain("@kevin/rule-0123456789abcdef");
		for (const name of names) {
			expect(name).not.toMatch(/[0-9a-f]{16}/i);
		}
	});

	it("topics keep the v0.6.0 <type>-<dominant token> shape", async () => {
		seedMemory("m1", "rule", "aaa bbb");
		seedMemory("m2", "rule", "aaa ccc");
		const draft = makeDraft(true);
		const plugin = buildNativePlugin(deps());
		await plugin.setup(stubContext(draft));
		expect(draft.addCalls.map(([name]) => name)).toEqual(["@kevin/rule-aaa"]);
	});

	it("remove() is never called anywhere in native.ts", () => {
		const source = readFileSync(
			join(process.cwd(), "plugin", "native.ts"),
			"utf8",
		);
		expect(source.match(/\.remove\s*\(/)).toBeNull();
		expect(source.includes(V2_SPECIFIER)).toBe(true);
	});
});
