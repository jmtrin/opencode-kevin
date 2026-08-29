import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("K12-010 — tui module isolation", () => {
	it("imports only allowlist", () => {
		const src = readFileSync(join(process.cwd(), "packages/tui/src/tui.ts"), "utf8");
		// Reconstruct import statements (handles biome-split multiline imports) by joining
		// lines until a semicolon-terminated statement. This is robust to formatting.
		const statements: string[] = [];
		let buf = "";
		for (const raw of src.split(/\r?\n/)) {
			const trimmed = raw.trim();
			if (!buf && !trimmed.startsWith("import ")) continue;
			buf += (buf ? " " : "") + trimmed;
			if (trimmed.endsWith(";")) {
				statements.push(buf);
				buf = "";
			}
		}
		if (buf) statements.push(buf);
		const allow = [
			/^import .* from "@opencode-ai\/plugin\/tui"/,
			/^import .* from "node:(fs|path|os)"/,
			/^import type .* from "\.\/tui-types\.js"/,
		];
		const offending: string[] = [];
		for (const stmt of statements) {
			if (!allow.some((re) => re.test(stmt))) {
				offending.push(stmt);
			}
		}
		expect(offending, `offending imports: ${offending.join(", ")}`).toEqual([]);
	});
});
