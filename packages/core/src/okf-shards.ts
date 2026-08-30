// K16-008 — Shard reader/writer (minimal stub, satisfies typecheck and tests for 1999/2000/2001/4500)
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MAX_ENTRIES, type OkfEntry, parse, serialize } from "./okf.js";

export const SHARD_CAP = MAX_ENTRIES; // 2000
export const PRIMARY = "knowledge.okf";

function shardName(n: number): string {
	if (n === 1) return PRIMARY;
	return `knowledge-${String(n).padStart(3, "0")}.okf`;
}

export interface ReadResult {
	entries: OkfEntry[];
	files: string[];
	rejected: ReturnType<typeof parse>["rejected"];
}

export function readShards(dir: string): ReadResult {
	const files: string[] = [];
	const primaryPath = join(dir, PRIMARY);
	if (existsSync(primaryPath)) files.push(primaryPath);
	// lexicographic shards excluding primary
	const all = existsSync(dir)
		? readdirSync(dir)
				.filter((f) => f.startsWith("knowledge-") && f.endsWith(".okf"))
				.sort()
		: [];
	for (const f of all) {
		const p = join(dir, f);
		if (!files.includes(p)) files.push(p);
	}
	const entries: OkfEntry[] = [];
	const seen = new Map<string, string>(); // entry_id -> file
	const rejected: ReturnType<typeof parse>["rejected"] = [];
	for (const file of files) {
		const txt = readFileSync(file, "utf8");
		const res = parse(txt);
		rejected.push(...res.rejected);
		for (const e of res.entries) {
			const prev = seen.get(e.entry_id);
			if (prev) {
				throw new Error(
					`okf-shards: duplicate entry_id ${e.entry_id} in ${prev} and ${file}`,
				);
			}
			seen.set(e.entry_id, file);
			entries.push(e);
		}
	}
	// already sorted? Ensure global sort by entry_id for callers
	entries.sort((a, b) =>
		a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0,
	);
	return { entries, files, rejected };
}

export function writeShards(
	dir: string,
	entries: OkfEntry[],
	repoId: string,
	version: string,
	okfVersion = 2,
): void {
	mkdirSync(dir, { recursive: true });
	// idempotent: pack primary to SHARD_CAP, overflow to shards, collapse sparse gaps, delete empty trailing
	const sorted = [...entries].sort((a, b) =>
		a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0,
	);
	if (okfVersion === 2) {
		// legacy single-file byte-exact
		const txt = serialize(sorted, repoId, version, 2);
		writeFileSync(join(dir, PRIMARY), txt, "utf8");
		// delete any stray shards
		if (existsSync(dir)) {
			for (const f of readdirSync(dir).filter(
				(x) => x.startsWith("knowledge-") && x.endsWith(".okf"),
			)) {
				try {
					unlinkSync(join(dir, f));
				} catch {}
			}
		}
		return;
	}
	// v3 sharded
	let offset = 0;
	let shardIdx = 1;
	const toKeep: string[] = [];
	while (offset < sorted.length || shardIdx === 1) {
		const slice = sorted.slice(offset, offset + SHARD_CAP);
		const name = shardName(shardIdx);
		const path = join(dir, name);
		toKeep.push(path);
		if (slice.length === 0) {
			// delete empty trailing shard if exists
			if (existsSync(path))
				try {
					unlinkSync(path);
				} catch {}
			break;
		}
		const txt = serialize(slice, repoId, version, 3);
		writeFileSync(path, txt, "utf8");
		offset += SHARD_CAP;
		shardIdx++;
		if (offset >= sorted.length) break;
	}
	// delete any shards beyond kept (sparse gaps)
	if (existsSync(dir)) {
		for (const f of readdirSync(dir).filter(
			(x) => x.startsWith("knowledge-") && x.endsWith(".okf"),
		)) {
			const p = join(dir, f);
			if (!toKeep.includes(p) && existsSync(p))
				try {
					unlinkSync(p);
				} catch {}
		}
		// primary must exist even if empty corpus? Write empty header
		if (!existsSync(join(dir, PRIMARY)) && sorted.length === 0) {
			const txt = serialize([], repoId, version, 3);
			writeFileSync(join(dir, PRIMARY), txt, "utf8");
		}
	}
}
