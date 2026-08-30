// K16-013 — Source framework
export interface MemorySource {
	name: string;
	precedence: number; // lower wins attribution (10 opencode-plugin, 20 claude, 30 codex, 40 native)
	enabled(): boolean;
	fetch(): Promise<SourceEntry[]>;
}

export interface SourceEntry {
	statement: string;
	type: "decision" | "rule" | "pattern" | "solution";
	scope: string | null;
	source: string; // source name
	updatedAt?: string;
}

export interface SourceSyncResult {
	source: string;
	fetched: number;
	dedupSkipped: number;
	inserted: number;
}
