// K16-016 — OpencodeNativeSource (native opencode memories, e.g. .opencode/memory)
// K21-006 — Relay probe activation: single-source location list, absent-safe
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MemorySource, SourceEntry } from "./MemorySource.js";

export const NATIVE_CANDIDATE_PATHS = [
	".opencode/memory/*.md",
	".opencode/MEMORY.md",
] as const;

function globMdFiles(dir: string): string[] {
	try {
		const entries = readdirSync(dir);
		return entries.filter((f) => f.endsWith(".md")).map((f) => join(dir, f));
	} catch {
		return [];
	}
}

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
		const out: SourceEntry[] = [];
		const seen = new Set<string>();
		for (const pattern of NATIVE_CANDIDATE_PATHS) {
			try {
				if (pattern.includes("*")) {
					// e.g. .opencode/memory/*.md
					const base = pattern.split("*")[0].replace(/\/$/, "");
					const dir = join(this.projectRoot, base);
					let st: ReturnType<typeof statSync> | null = null;
					try {
						st = statSync(dir);
					} catch {
						continue;
					}
					if (!st.isDirectory()) continue;
					for (const file of globMdFiles(dir)) {
						if (seen.has(file)) continue;
						seen.add(file);
						try {
							const txt = readFileSync(file, "utf8");
							for (const line of txt.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50)) {
								if (out.length >= 100) break;
								out.push({ statement: line, type: "rule", scope: null, source: this.name });
							}
						} catch {
							// absent-safe: skip unreadable file
						}
					}
				} else {
					const abs = join(this.projectRoot, pattern);
					let st: ReturnType<typeof statSync> | null = null;
					try {
						st = statSync(abs);
					} catch {
						continue;
					}
					if (!st.isFile()) continue;
					if (seen.has(abs)) continue;
					seen.add(abs);
					try {
						const txt = readFileSync(abs, "utf8");
						for (const line of txt.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 100)) {
							if (out.length >= 100) break;
							out.push({ statement: line, type: "rule", scope: null, source: this.name });
						}
					} catch {
						// skip
					}
				}
			} catch {
				// never throw
			}
		}
		return out;
	}

	health(): { status: "ok" | "absent"; detail: string } {
		let found = 0;
		for (const pattern of NATIVE_CANDIDATE_PATHS) {
			try {
				if (pattern.includes("*")) {
					const base = pattern.split("*")[0].replace(/\/$/, "");
					const dir = join(this.projectRoot, base);
					try {
						const st = statSync(dir);
						if (!st.isDirectory()) continue;
						found += globMdFiles(dir).length;
					} catch {
						continue;
					}
				} else {
					const abs = join(this.projectRoot, pattern);
					try {
						const st = statSync(abs);
						if (st.isFile()) found++;
					} catch {
						continue;
					}
				}
			} catch {}
		}
		if (found > 0) return { status: "ok", detail: `found ${found} files` };
		return { status: "absent", detail: "no native memory found at probe paths" };
	}
}
