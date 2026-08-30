// K16-015 — CodexMemoriesSource (mirror of ~/.codex/memories)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemorySource, SourceEntry } from "./MemorySource.js";

export class CodexMemoriesSource implements MemorySource {
	name = "codex-memories";
	precedence = 30;
	constructor(
		private enabledFlag: () => boolean,
		private root: string = join(homedir(), ".codex", "memories"),
	) {}
	enabled(): boolean {
		return this.enabledFlag();
	}
	async fetch(): Promise<SourceEntry[]> {
		if (!this.enabled()) return [];
		if (!existsSync(this.root)) return [];
		const out: SourceEntry[] = [];
		try {
			for (const f of readdirSync(this.root)) {
				if (!f.endsWith(".md") && !f.endsWith(".txt")) continue;
				try {
					const txt = readFileSync(join(this.root, f), "utf8");
					for (const line of txt
						.split("\n")
						.map((s) => s.trim())
						.filter(Boolean)
						.slice(0, 50)) {
						out.push({
							statement: line,
							type: "rule",
							scope: null,
							source: this.name,
						});
					}
				} catch {}
			}
		} catch {}
		return out;
	}
}
