/**
 * v2.2.0 (K22-007 / BUG-11) — public metadata is single-sourced.
 *
 * `KEVIN_CONFIG_KEYS` and `ERROR_LESSON_MODE_VALUES` used to be declared in
 * full in BOTH `@jmtrin/kevin-core` and the plugin entrypoint — any future
 * key edited one and forgot the other. Since K22-002 the `./config` subpath
 * re-exports core's arrays; this test pins the equality so a second
 * declaration can never drift back in. `KEVIN_VERSION` is pinned across all
 * three homes (core, config subpath, plugin package.json).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	KEVIN_CONFIG_KEYS as CORE_KEYS,
	ERROR_LESSON_MODE_VALUES as CORE_MODES,
	KEVIN_VERSION as CORE_VERSION,
} from "@jmtrin/kevin-core";
import { describe, expect, it } from "vitest";
import {
	KEVIN_CONFIG_KEYS as CONFIG_KEYS,
	ERROR_LESSON_MODE_VALUES as CONFIG_MODES,
	KEVIN_VERSION as CONFIG_VERSION,
	REMOVED_SETTINGS,
} from "../../packages/plugin/src/config.js";

describe("K22-007 — metadata single source (BUG-11)", () => {
	it("KEVIN_CONFIG_KEYS is identical in core and the ./config subpath", () => {
		expect([...CONFIG_KEYS]).toEqual([...CORE_KEYS]);
	});

	it("ERROR_LESSON_MODE_VALUES is identical in core and the ./config subpath", () => {
		expect([...CONFIG_MODES]).toEqual([...CORE_MODES]);
	});

	it("KEVIN_VERSION agrees across core, ./config and plugin package.json", () => {
		const pkg = JSON.parse(
			readFileSync(join(process.cwd(), "packages/plugin/package.json"), "utf8"),
		) as { version?: unknown };
		expect(CONFIG_VERSION).toBe(CORE_VERSION);
		expect(pkg.version).toBe(CORE_VERSION);
	});

	it("./config still owns the removed-settings contract", () => {
		expect(REMOVED_SETTINGS.import_host_memory.since).toBe("2.0.0");
	});
});
