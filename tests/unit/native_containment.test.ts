// v0.9.0 (K9-013 / plan §5.4, D9-02/D9-10/D9-11)
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Materializer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import type { HostSurface } from "../../packages/plugin/src/host.js";
import { attachNative, buildNativePlugin } from "../../packages/plugin/src/native.js";
import type { NativeDeps } from "../../packages/plugin/src/native.js";

// v0.9.0 (K9-013 / plan §5.4) — the only file allowed to name the v2
// subpath, and only inside a dynamic import().
const V2_SPECIFIER = "@opencode-ai/plugin/v2/promise";

function collectFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			collectFiles(full, acc);
		} else if (/\.(ts|mjs|cjs|js)$/.test(entry)) {
			acc.push(full);
		}
	}
	return acc;
}

function v1OnlyHost(): HostSurface {
	return {
		pluginVersion: "1.17.6",
		flavour: "v1-only",
		project: { id: null, worktree: null, directory: null },
		hasShell: false,
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

describe("K9-013 — dynamic-import containment", () => {
	let tmpRoot: string;
	let store: Store;

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-native-"));
		store = new Store({ path: join(tmpRoot, "test.db") });
	});

	afterEach(() => {
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	const deps = (): NativeDeps => ({
		// Materializer needs a real Store; the skill body is empty for a
		// fresh database, which is fine for these tests.
		materializer: new Materializer(store, { root: tmpRoot }),
		settings: {
			getSetting: (key: string, fallback = "0") => {
				if (key === "native_registration_enabled") return "0";
				return fallback;
			},
		},
	});

	it("exactly one file names the v2 specifier, and it is plugin/native.ts", () => {
		// v0.9.0 (K9-013 / plan §5.4, property 4) — containment is a source
		// property: a second file naming the subpath would be an outage
		// waiting for a host upgrade. The test file itself is excluded
		// (SELF), the same precedent as no_zod_import.test.ts: the guard
		// does not inspect its own definition.
		const root = join(process.cwd());
		const hits: string[] = [];
		for (const file of collectFiles(root, [])) {
			const rel = relative(root, file).replaceAll("\\", "/");
			if (rel.startsWith("node_modules/") || rel.startsWith("dist/")) continue;
			if (file === __filename) continue;
			const text = readFileSync(file, "utf8");
			if (text.includes(V2_SPECIFIER)) hits.push(rel);
		}
		expect(hits).toEqual(["plugin/native.ts"]);
	});

	it("the specifier appears only inside a dynamic import() — a static import fails the scan", () => {
		// v0.9.0 (K9-013 / plan §5.4, property 4; D9-11) — a top-level
		// `import ... from` would be a module-resolution failure on every
		// host older than the subpath: an optional enhancement turned into
		// a hard requirement. The literal lives in native.ts on the
		// constant-definition line; every other occurrence must be a
		// dynamic `import(` usage of that constant.
		const source = readFileSync(
			join(process.cwd(), "packages/plugin/src", "native.ts"),
			"utf8",
		);
		const lines = source.split("\n");
		const offenders: string[] = [];
		let constantLine = -1;
		lines.forEach((line, i) => {
			if (line.includes(V2_SPECIFIER)) {
				if (/^\s*export const V2_SPECIFIER\s*=/.test(line)) {
					constantLine = i;
					return;
				}
				if (/import\s*\(/.test(line)) return;
				offenders.push(`${i + 1}: ${line.trim()}`);
			}
		});
		expect(constantLine).toBeGreaterThan(-1);
		expect(offenders).toEqual([]);
		const staticImport =
			/^\s*import\b[^\n]*["']@opencode-ai\/plugin\/v2\/promise["']/m;
		expect(source.match(staticImport)).toBeNull();
	});

	it("attachNative returns null when the setting is off, and never throws", async () => {
		// v0.9.0 (K9-013 / plan §5.4) — '0' + any host → null, no side
		// effects: the default release behaviour is byte-identical to
		// v0.8.0.
		const notes: string[] = [];
		await expect(attachNative(v2Host(), deps(), { notes })).resolves.toBeNull();
		expect(notes).toEqual([]);
	});

	it("attachNative returns null with a note on a v1-only host", async () => {
		// v0.9.0 (K9-013 / plan §5.4) — '1' + no subpath → null + note; the
		// file-emission path stays, exactly as v0.6.0.
		const notes: string[] = [];
		const settings = {
			getSetting: (key: string, fallback = "0") =>
				key === "native_registration_enabled" ? "1" : fallback,
		};
		const d = { ...deps(), settings };
		await expect(attachNative(v1OnlyHost(), d, { notes })).resolves.toBeNull();
		expect(notes.length).toBe(1);
		expect(notes[0]).toContain("v2 subpath absent");
	});

	it("attachNative never throws when the v2 import rejects — null plus a note", async () => {
		// v0.9.0 (K9-013 / plan §5.4) — an import failure on a host that
		// advertises v2 must degrade, not crash construction.
		const notes: string[] = [];
		const settings = {
			getSetting: (key: string, fallback = "0") =>
				key === "native_registration_enabled" ? "1" : fallback,
		};
		const d = { ...deps(), settings };
		const importV2 = () => Promise.reject(new Error("boom"));
		await expect(
			attachNative(v2Host(), d, { importV2, notes }),
		).resolves.toBeNull();
		expect(notes.length).toBe(1);
		expect(notes[0]).toContain("import rejected");
	});

	it("a stub module missing define() yields null and a note", async () => {
		// v0.9.0 (K9-013 AC) — a stub host whose v2 module lacks the
		// surface yields null + note; attachNative never throws.
		const notes: string[] = [];
		const settings = {
			getSetting: (key: string, fallback = "0") =>
				key === "native_registration_enabled" ? "1" : fallback,
		};
		const d = { ...deps(), settings };
		const importV2 = () => Promise.resolve({});
		await expect(
			attachNative(v2Host(), d, { importV2, notes }),
		).resolves.toBeNull();
		expect(notes.length).toBe(1);
		expect(notes[0]).toContain("no define()");
	});

	it("attachNative returns a registration when the host exposes v2", async () => {
		// v0.9.0 (K9-013 / plan §5.4) — '1' + subpath → registration; the
		// surfaces the host exposes are the ones Kevin registered.
		const notes: string[] = [];
		const settings = {
			getSetting: (key: string, fallback = "0") =>
				key === "native_registration_enabled" ? "1" : fallback,
		};
		const d = { ...deps(), settings };
		const importV2 = () => Promise.resolve({ define: (p: unknown) => p });
		const registration = await attachNative(v2Host(), d, { importV2, notes });
		expect(registration).not.toBeNull();
		expect(registration?.registered).toEqual({ skill: true, reference: true });
		expect(registration?.verified).toEqual({ skill: false, reference: false });
	});

	it("buildNativePlugin returns a v2-shaped plugin whose setup is a function", () => {
		// v0.9.0 (K9-013 / plan §5.4, D9-02) — define() is the identity
		// function, so the literal object satisfies the contract already.
		const plugin = buildNativePlugin(deps());
		expect(plugin.id).toBe("opencode-kevin");
		expect(typeof plugin.setup).toBe("function");
	});
});
