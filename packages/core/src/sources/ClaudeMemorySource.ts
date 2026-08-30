// K16-014 — ClaudeMemorySource (read-only mirror of ~/.claude/memory)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
		if (!existsSync(memPath)) return [];
		const out: SourceEntry[] = [];
		try {
			const st = statSync(memPath);
			if (st.isDirectory()) {
				for (const f of readdirSync(memPath)) {
					if (!f.endsWith(".md") && !f.endsWith(".txt")) continue;
					try {
						const txt = readFileSync(join(memPath, f), "utf8");
						for (const line of txt.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50)) {
							if (out.length >= 100) break;
							out.push({ statement: line, type: "rule", scope: null, source: this.name });
						}
					} catch {}
				}
				return out;
			}
			if (st.isFile()) {
				const txt = readFileSync(memPath, "utf8");
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
			}
		} catch {
			return out;
		}
		return out;
	}
}
