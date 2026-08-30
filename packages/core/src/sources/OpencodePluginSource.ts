// K16-013 — OpencodePluginSource (native Kevin store, precedence 10, always enabled when sources_enabled)
import type { MemorySource, SourceEntry } from "./MemorySource.js";

export class OpencodePluginSource implements MemorySource {
	name = "opencode-plugin";
	precedence = 10;
	constructor(private enabledFlag: () => boolean) {}
	enabled(): boolean {
		return this.enabledFlag();
	}
	async fetch(): Promise<SourceEntry[]> {
		// Plugin source is the local DB itself — no fetch, handled elsewhere
		return [];
	}
}
