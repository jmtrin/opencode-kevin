/**
 * K9-004 — v0.9.0 native — host probe contract (plan §5.1, D9-12).
 *
 * probeHost() must never throw, must duck-type only, must run once (cached +
 * frozen), must read pluginVersion from the resolved package.json and must
 * record which v2 domains the resolved package actually exposes. The v2
 * assertions that depend on the installed package use the `importV2` seam so
 * the v1-only path (pre-v2 hosts, e.g. 1.17.6) is exercised deterministically.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import {
	type HostSurface,
	probeHost,
	resetHostProbeCache,
	summarize,
} from "../../plugin/host.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
// plan §3: package exports map has no "./package.json" subpath; derive the
// root from the repo layout under vitest (same as host_contract.test.ts).
const PLUGIN_PKG = join(REPO_ROOT, "node_modules", "@opencode-ai", "plugin");

const realVersion = ((): string | null => {
	const pkgPath = join(PLUGIN_PKG, "package.json");
	if (!existsSync(pkgPath)) return null;
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
		version?: unknown;
	};
	return typeof pkg.version === "string" ? pkg.version : null;
})();

const V2_JS = join(PLUGIN_PKG, "dist", "v2", "promise", "index.js");
const V2_PRESENT = existsSync(V2_JS);

const rejectImport = (): Promise<never> =>
	Promise.reject(new Error("simulated pre-v2 host: no such subpath"));

describe("probeHost", () => {
	beforeEach(() => {
		resetHostProbeCache();
	});

	it("resolves and never throws against a stub input missing every field", async () => {
		// plan §5.1 / D9-12 — a throw here takes down the host's plugin load
		const surface = await probeHost(undefined, { importV2: rejectImport });
		expect(surface.flavour).toBe("v1-only");
		expect(surface.project).toEqual({
			id: null,
			worktree: null,
			directory: null,
		});
		expect(surface.hasShell).toBe(false);
		expect(surface.v2).toEqual({ skill: false, reference: false });
		expect(surface.notes.length).toBeGreaterThan(0);
	});

	it("never throws against non-object input", async () => {
		const surface = await probeHost(42 as unknown, { importV2: rejectImport });
		expect(surface.flavour).toBe("v1-only");
		expect(surface.notes.some((n) => n.includes("not an object"))).toBe(true);
	});

	it("reflects project/worktree/directory and $ from the input", async () => {
		// plan §5.1 — PluginInput carries project, directory, worktree and $
		const input = {
			project: {
				id: "proj-1",
				worktree: "/work/tree",
				directory: "/work/tree",
			},
			$: { spawn: () => undefined },
		};
		const surface = await probeHost(input, { importV2: rejectImport });
		expect(surface.project).toEqual({
			id: "proj-1",
			worktree: "/work/tree",
			directory: "/work/tree",
		});
		expect(surface.hasShell).toBe(true);
	});

	it("falls back to top-level worktree/directory when the project object lacks them", async () => {
		const surface = await probeHost(
			{ project: { id: "proj-2" }, worktree: "/top/wt", directory: "/top/dir" },
			{ importV2: rejectImport },
		);
		expect(surface.project).toEqual({
			id: "proj-2",
			worktree: "/top/wt",
			directory: "/top/dir",
		});
	});

	it("reports a pre-v2 host package (import rejection) as v1-only with a note", async () => {
		// plan §5.1 / K9-002 assertion 2 — the subpath is absent from 1.17.6's
		// exports map; rejection IS the answer. Here via the seam.
		const surface = await probeHost({}, { importV2: rejectImport });
		expect(surface.flavour).toBe("v1-only");
		expect(surface.v2.skill).toBe(false);
		expect(surface.v2.reference).toBe(false);
		expect(surface.notes.some((n) => n.includes("rejected"))).toBe(true);
	});

	it("treats a v2 module without define as v1-only", async () => {
		const surface = await probeHost({}, { importV2: async () => ({}) });
		expect(surface.flavour).toBe("v1-only");
		expect(surface.notes.some((n) => n.includes("no define"))).toBe(true);
	});

	it("records which v2 domains the resolved package exposes", async () => {
		// plan §5.1 — record domains rather than assuming both. The promise
		// subpath exports define at runtime; skill/reference are verified
		// against the resolved package's declaration files.
		const surface = await probeHost(
			{},
			{ importV2: async () => ({ define: () => undefined }) },
		);
		expect(surface.flavour).toBe(V2_PRESENT ? "v1+v2" : "v1-only");
		if (V2_PRESENT) {
			expect(surface.v2.skill).toBe(true);
			expect(surface.v2.reference).toBe(true);
		} else {
			expect(surface.v2.skill).toBe(false);
			expect(surface.v2.reference).toBe(false);
		}
	});

	it("probes the real package without throwing in this environment", async () => {
		const surface = await probeHost(undefined);
		expect(surface.flavour).toBe(V2_PRESENT ? "v1+v2" : "v1-only");
	});

	it("reads pluginVersion from the resolved package.json, never the declared range", async () => {
		// plan §3.4 / trap 26 — the declared range is exactly what proved
		// untrustworthy; 1.17.13 resolved under ^1.17.6.
		const surface = await probeHost({}, { importV2: rejectImport });
		expect(realVersion).not.toBeNull();
		expect(surface.pluginVersion).toBe(realVersion);
		expect(surface.pluginVersion).not.toMatch(/^\^/);
	});

	it("returns the same frozen object on the second call; mutation throws in strict mode", async () => {
		// plan §5.1 / trap 25 — probe once, freeze, restart to re-probe
		const first = await probeHost({}, { importV2: rejectImport });
		const second = await probeHost({}, { importV2: rejectImport });
		expect(second).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(() => {
			(first as { flavour: string }).flavour = "v1+v2";
		}).toThrow(TypeError);
	});
});

describe("summarize", () => {
	it("matches the stable charset and carries version, flavour and flags", async () => {
		resetHostProbeCache();
		const surface: HostSurface = await probeHost(
			{},
			{ importV2: rejectImport },
		);
		const text = summarize(surface);
		// plan §5.1 — no paths, no identifiers; safe to paste into an issue
		expect(text).toMatch(/^[\w .,:()+-]+$/);
		expect(text).not.toMatch(/[/\\]/);
		expect(text).toContain(surface.pluginVersion ?? "unknown");
		expect(text).toContain(surface.flavour);
	});
});
