import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Materializer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import type { HostSurface } from "../../packages/plugin/src/host.js";
import {
	type KevinNativeContext,
	type NativeDeps,
	buildNativePlugin,
	kevinSkillSource,
} from "../../packages/plugin/src/native.js";

// Built by concatenation so this test file never names the literal:
// K9-013's containment scan allows exactly one file to name the
// v2 subpath, and that file is plugin/native.ts.
const V2_SPECIFIER = "@opencode-ai/plugin" + "/v2/promise";

// The migrated subset used by materializer.test.ts: the tables the
// Materializer reads (curated memories) live in 001/003+.
const MIGRATED_SQL = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
].map((name) => readFileSync(join(process.cwd(), "packages/core/migrations", name), "utf8"));

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

interface StubDraft {
	sourceCalls: string[];
	sources: unknown[];
	source?: (s: string) => void;
	list(): readonly unknown[];
}

function makeDraft(keep: boolean): StubDraft {
	const draft: StubDraft = {
		sourceCalls: [],
		sources: [],
		list() {
			return draft.sources;
		},
	};
	draft.source = (s: string) => {
		draft.sourceCalls.push(s);
		if (keep) draft.sources.push(s);
	};
	return draft;
}

type TransformHook = (draft: StubDraft) => Promise<void> | void;

function stubContext(draft: StubDraft, reject = false): KevinNativeContext {
	return {
		skill: {
			transform: async (hook: TransformHook) => {
				if (reject) throw new Error("transform rejected");
				await hook(draft);
			},
		},
		reference: {
			transform: async () => {},
		},
	};
}

let tmpRoot: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-native-skill-"));
	store = new Store({ path: join(tmpRoot, "test.db") });
	for (const sql of MIGRATED_SQL) {
		store.exec(sql);
	}
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function deps(): NativeDeps {
	return {
		materializer: new Materializer(store, { root: tmpRoot }),
		settings: {
			getSetting: () => "0",
		},
	};
}

describe("K9-014 — native skill registration with read-back verification", () => {
	it("draft.source() is called exactly once with the Materializer body and the read-back verifies it", async () => {
		const d = deps();
		const events: Array<[string, boolean, boolean]> = [];
		const plugin = buildNativePlugin({
			...d,
			onVerified: (surface, registered, verified) => {
				events.push([surface, registered, verified]);
			},
		});
		const draft = makeDraft(true);
		await plugin.setup(stubContext(draft));

		expect(draft.sourceCalls).toHaveLength(1);
		expect(draft.sourceCalls[0]).toBe(kevinSkillSource(d.materializer));
		expect(events).toEqual([["skill", true, true]]);
	});

	it("a list() without the source means unverified: verified false, note recorded, no throw", async () => {
		const notes: string[] = [];
		const d = deps();
		const plugin = buildNativePlugin({
			...d,
			onVerified: (surface, registered, verified) => {
				if (!verified) {
					notes.push(
						`${surface} read-back does not contain the provided source — unverified registration`,
					);
				}
			},
		});
		const draft = makeDraft(false);
		await plugin.setup(stubContext(draft));

		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("read-back");
		expect(draft.sourceCalls).toHaveLength(1);
	});

	it("a rejecting transform reports registered=false and never throws", async () => {
		const d = deps();
		const events: Array<[string, boolean, boolean]> = [];
		const plugin = buildNativePlugin({
			...d,
			onVerified: (surface, registered, verified) => {
				events.push([surface, registered, verified]);
			},
		});
		const draft = makeDraft(true);
		await expect(
			plugin.setup(stubContext(draft, true)),
		).resolves.toBeUndefined();
		expect(events).toEqual([["skill", false, false]]);
	});

	it("a draft without source() reports registered=false", async () => {
		const d = deps();
		const events: Array<[string, boolean, boolean]> = [];
		const plugin = buildNativePlugin({
			...d,
			onVerified: (surface, registered, verified) => {
				events.push([surface, registered, verified]);
			},
		});
		const ctx = {
			skill: { transform: async (hook: (draft: unknown) => void) => hook({}) },
			reference: { transform: async () => {} },
		} as unknown as KevinNativeContext;
		await plugin.setup(ctx);
		expect(events).toEqual([["skill", false, false]]);
	});

	it("the source bytes are exactly what the Materializer would write", () => {
		const d = deps();
		expect(kevinSkillSource(d.materializer)).toBe(d.materializer.skillBody());
	});

	it("the draft never escapes the transform callback (source scan)", () => {
		const source = readFileSync(
			join(process.cwd(), "packages/plugin/src", "native.ts"),
			"utf8",
		);
		const lines = source.split("\n");
		// Ranges of the transform callbacks: from each `async (draft)`
		// line to the line where the brace balance closes (K9-015 nests
		// object literals whose `});` would otherwise truncate the range).
		const ranges: Array<[number, number]> = [];
		lines.forEach((line, i) => {
			if (!line.includes("async (draft)")) return;
			let depth = 0;
			let end = -1;
			for (let j = i + 1; j < lines.length; j += 1) {
				depth +=
					(lines[j].match(/{/g)?.length ?? 0) -
					(lines[j].match(/}/g)?.length ?? 0);
				if (depth < 0) {
					end = j;
					break;
				}
			}
			expect(end).toBeGreaterThan(i);
			ranges.push([i, end]);
		});
		expect(ranges.length).toBeGreaterThan(0);
		// Every mention of "draft" in code outside the callbacks is an
		// offender. Exemptions: comment lines, and the hook parameter type
		// declaration `(draft: unknown)` in KevinNativeContext — a type
		// annotation, not an escape.
		const offenders: Array<{ line: number; text: string }> = [];
		lines.forEach((line, i) => {
			const trimmed = line.trimStart();
			if (
				trimmed.startsWith("//") ||
				trimmed.startsWith("/*") ||
				trimmed.startsWith("*")
			) {
				return;
			}
			if (!line.includes("draft")) return;
			if (line.includes("(draft:")) return;
			const inRange = ranges.some(([start, end]) => i >= start && i <= end);
			if (!inRange) offenders.push({ line: i + 1, text: line.trim() });
		});
		expect(offenders).toEqual([]);
	});

	it("the v2 specifier stays contained in native.ts (dynamic import only)", () => {
		const source = readFileSync(
			join(process.cwd(), "packages/plugin/src", "native.ts"),
			"utf8",
		);
		expect(source.includes(V2_SPECIFIER)).toBe(true);
		const staticImport = new RegExp(
			`^\\s*import\\b[^\\n]*["']${V2_SPECIFIER.replace(/[/\\]/g, "\\$&")}["']`,
			"m",
		);
		expect(source.match(staticImport)).toBeNull();
	});
});
