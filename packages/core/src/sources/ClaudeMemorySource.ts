// K16-014 — ClaudeMemorySource (read-only mirror of ~/.claude/memory)
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemorySource, SourceEntry } from "./MemorySource.js";

export class ClaudeMemorySource implements MemorySource {
	name = "claude-memory";
	precedence = 20;
	constructor(
		private enabledFlag: () => boolean,
		private root: string = join(homedir(), ".claude"),
	) {}
	enabled(): boolean {
		return this.enabledFlag();
	}
	async fetch(): Promise<SourceEntry[]> {
		if (!this.enabled()) return [];
		const memPath = join(this.root, "memory");
		// Could be directory of markdown files or single file — best-effort
		if (!existsSync(memPath)) return [];
		try {
			const txt = readFileSync(memPath, "utf8");
			// naive: split lines non-empty as statements
			return txt
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean)
				.slice(0, 100)
				.map((statement) => ({
					statement,
					type: "rule" as const,
					scope: null,
					source: this.name,
				}));
		} catch {
			return [];
		}
	}
}
