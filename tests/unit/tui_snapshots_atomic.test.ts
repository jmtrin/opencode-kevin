import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flushSnapshots, readJsonSafe } from "../../plugin/TuiSnapshots.js";

describe("K12-004 — snapshot atomicity / corruption", () => {
	it("stale .tmp files are overwritten and no .tmp leftovers remain", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-atomic-"));
		const health = {
			verdict: "healthy",
			reason: "ok",
			hooks: [],
			perf: [],
			contract_digest: "abc",
			counters: {},
		};
		// Seed a first flush
		flushSnapshots({ root, proposals: [], conflicts: [], health });
		// Create stale .tmp files manually
		const tuiDir = join(root, "tui");
		writeFileSync(join(tuiDir, "proposals.json.tmp"), "stale", "utf8");
		writeFileSync(join(tuiDir, "health.json.tmp"), "stale", "utf8");
		// Next flush should overwrite and rename, leaving no .tmp
		flushSnapshots({ root, proposals: [], conflicts: [], health });
		// Check no .tmp files remain
		const ents = readdirSync(tuiDir) as string[];
		expect(ents.some((f) => f.endsWith(".tmp"))).toBe(false);
		// Files still valid JSON
		const prop = readJsonSafe(join(tuiDir, "proposals.json")) as {
			data: unknown;
		};
		expect((prop as { data: unknown }).data).toBeDefined();
		rmSync(root, { recursive: true, force: true });
	});

	it("corrupt existing JSON is replaced by next flush (writer never reads)", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-corrupt-"));
		const health = {
			verdict: "healthy",
			reason: "ok",
			hooks: [],
			perf: [],
			contract_digest: "abc",
			counters: {},
		};
		flushSnapshots({ root, proposals: [], conflicts: [], health });
		const tuiDir = join(root, "tui");
		writeFileSync(join(tuiDir, "proposals.json"), "{{{corrupt", "utf8");
		writeFileSync(join(tuiDir, "conflicts.json"), "not json", "utf8");
		// Corrupt files should be reported as corrupt via readJsonSafe
		expect(readJsonSafe(join(tuiDir, "proposals.json"))).toEqual({
			error: "corrupt",
		});
		expect(readJsonSafe(join(tuiDir, "conflicts.json"))).toEqual({
			error: "corrupt",
		});
		// Next flush overwrites them
		flushSnapshots({ root, proposals: [], conflicts: [], health });
		const afterProp = readJsonSafe(join(tuiDir, "proposals.json")) as {
			data: unknown;
		};
		expect(afterProp.data).toBeDefined();
		const afterConf = readJsonSafe(join(tuiDir, "conflicts.json")) as {
			data: unknown;
		};
		expect(afterConf.data).toBeDefined();
		rmSync(root, { recursive: true, force: true });
	});

	it("readJsonSafe missing returns missing, corrupt returns corrupt", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-missing-"));
		const missingPath = join(root, "nope.json");
		expect(readJsonSafe(missingPath)).toEqual({ error: "missing" });
		const corruptPath = join(root, "bad.json");
		writeFileSync(corruptPath, "{ bad", "utf8");
		expect(readJsonSafe(corruptPath)).toEqual({ error: "corrupt" });
		const goodPath = join(root, "good.json");
		writeFileSync(goodPath, JSON.stringify({ a: 1 }), "utf8");
		expect(readJsonSafe(goodPath)).toEqual({ data: { a: 1 } });
		rmSync(root, { recursive: true, force: true });
	});
});
