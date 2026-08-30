// K16-016 — OpencodeNativeSource (native opencode memories, e.g. .opencode/memory)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemorySource, SourceEntry } from "./MemorySource.js";

export class OpencodeNativeSource implements MemorySource {
	name = "opencode-native";
	precedence = 40;
	constructor(
		private enabledFlag: () => boolean,
		private projectRoot: string = process.cwd(),
	) {}
	enabled(): boolean {
		return this.enabledFlag();
	}
	async fetch(): Promise<SourceEntry[]> {
		if (!this.enabled()) return [];
		const p = join(this.projectRoot, ".opencode", "memory");
		if (!existsSync(p)) return [];
		try {
			const txt = readFileSync(p, "utf8");
			return txt
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean)
				.slice(0, 100)
				.map((statement) => ({
					statement,
					type: "rule",
					scope: null,
					source: this.name,
				}));
		} catch {
			return [];
		}
	}
}
