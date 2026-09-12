/**
 * v2.2.0 (K22-003 / plan §4.2) — plugin loader contract.
 *
 * The legacy OpenCode loader passes EVERY entrypoint export through
 * `getServerPlugin` (valid only: `typeof v === "function"` or an object
 * with a `server` function) and throws
 * `TypeError: Plugin export is not a function` on the first violator —
 * which in v2.1.0 meant the plugin never registered any tool (BUG-01/02/03).
 * `verify-pack` measured the package, not this contract (BUG-04).
 *
 * This test imports the COMPILED entrypoint (the bytes the host loads) and
 * replicates the loader predicate over every export. It additionally pins
 * the exact-two-exports / same-reference shape so `performRekey` (or any
 * future metadata) can never again ride the entrypoint as a phantom second
 * plugin. Do not weaken to a source scan: the artifact is the contract.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

function isLoaderValid(value: unknown): boolean {
	if (typeof value === "function") return true;
	if (value === null || typeof value !== "object") return false;
	return typeof (value as Record<string, unknown>).server === "function";
}

describe("K22-003 — plugin loader contract (compiled entrypoint)", () => {
	it("every entrypoint export satisfies getServerPlugin", async () => {
		const entrypoint = join(
			process.cwd(),
			"packages/plugin/dist/plugin/index.js",
		);
		let mod: Record<string, unknown>;
		try {
			mod = (await import(pathToFileURL(entrypoint).href)) as Record<
				string,
				unknown
			>;
		} catch (err) {
			throw new Error(
				`could not import the compiled entrypoint (${entrypoint}): run "npm run build" first — ${(err as Error).message}`,
			);
		}
		const violators = Object.entries(mod)
			.filter(([, v]) => !isLoaderValid(v))
			.map(([k, v]) => `${k} (typeof ${typeof v})`);
		expect(
			violators,
			`entrypoint exports rejected by the host loader: ${violators.join(", ")}`,
		).toEqual([]);
	});

	it("entrypoint exports exactly KevinPlugin + default (same reference)", async () => {
		const entrypoint = join(
			process.cwd(),
			"packages/plugin/dist/plugin/index.js",
		);
		let mod: Record<string, unknown>;
		try {
			mod = (await import(pathToFileURL(entrypoint).href)) as Record<
				string,
				unknown
			>;
		} catch (err) {
			throw new Error(
				`could not import the compiled entrypoint (${entrypoint}): run "npm run build" first — ${(err as Error).message}`,
			);
		}
		expect(Object.keys(mod).sort()).toEqual(["KevinPlugin", "default"]);
		expect(mod.default).toBe(mod.KevinPlugin);
	});
});
