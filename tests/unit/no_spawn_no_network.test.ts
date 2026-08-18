import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * K8-026 / plan §3.5, §11.2 check 10 — the no-spawn, no-network property
 * as a test rather than a memory. The plugin is a pure observer of the
 * host: it never spawns a process and never opens a socket, on any path.
 */
describe("K8-026 — the plugin never spawns processes or touches the network", () => {
	it("a source scan of plugin/ finds no spawn and no network primitives", () => {
		const files: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name.endsWith(".ts")) files.push(full);
			}
		};
		walk(join(process.cwd(), "plugin"));
		expect(files.length).toBeGreaterThan(40);

		// Strip comments first — prose may mention `https://` or the word
		// "spawn"; executable code may not.
		const stripComments = (src: string): string =>
			src
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "")
				.replace(/^\s*\*.*$/gm, "");

		const forbidden =
			/\b(child_process|execSync|execFile|spawn|fork)\b|\bfetch\s*\(|https?:\/\/|node:http|node:net|node:https|WebSocket/;
		const offenders: string[] = [];
		for (const file of files) {
			const src = stripComments(readFileSync(file, "utf8"));
			for (const line of src.split(/\r?\n/)) {
				if (forbidden.test(line)) {
					offenders.push(`${file}: ${line.trim()}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
