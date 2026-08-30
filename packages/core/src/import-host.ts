// K15-011/012/013 — Host importers (plan §4.5)
// Defensive markdown parsers, no YAML lib, same naive parser as validator.

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MemoryService } from "./MemoryService.js";
import { QualityGate } from "./QualityGate.js";
import type { Store } from "./Store.js";
import { type KevinEnv, resolveEnv } from "./env.js";
import { fingerprint as computeFingerprint } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";

const MAX_FILE_BYTES = 1 * 1024 * 1024;
const MAX_CANDIDATES = 5000;

const CLAUDE_TYPE_MAP: Record<string, string> = {
	user_preference: "context",
	project_context: "context",
	correction: "rule",
	code_pattern: "pattern",
};

export interface HostImportReport {
	files_scanned: number;
	candidates: number;
	saved: number;
	duplicates: number;
	skipped_weak: number;
	error?: string;
	hint?: string;
	truncated?: boolean;
	skipped_files?: number;
}

// naive frontmatter parse for Claude topic files: extract type field
function parseFrontmatterType(content: string): string | null {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	if (lines[0]?.trim() !== "---") return null;
	let type: string | null = null;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") break;
		const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (m && m[1].toLowerCase() === "type") {
			type = m[2].trim().replace(/^["']|["']$/g, "");
		}
	}
	return type;
}

function extractBullets(content: string): string[] {
	// remove frontmatter block first
	const withoutFm = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
	const lines = withoutFm.split("\n");
	const out: string[] = [];
	for (const line of lines) {
		const m = line.match(/^\s*[-*]\s+(.*)$/);
		if (m) {
			const trimmed = m[1].trim();
			if (trimmed !== "") out.push(trimmed);
		} else {
			// also handle heading/bullet? codex may have headings
			const hm = line.match(/^\s*#{1,6}\s+(.*)$/);
			if (hm && hm[1].trim() !== "") {
				// treat heading text as candidate? For codex, headings+bulles both
				// but we will extract bullets only for claude; codex extractor handles headings separately
			}
		}
	}
	return out;
}

function safeRead(filePath: string): string | null {
	try {
		const st = lstatSync(filePath);
		if (st.isSymbolicLink()) return null;
		if (!st.isFile()) return null;
		if (st.size > MAX_FILE_BYTES) return null;
		return readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}

export function parseClaudeMemory(
	dataRoot: string,
	env?: KevinEnv,
): {
	candidates: { content: string; type: string }[];
	files_scanned: number;
	skipped_files: number;
	truncated: boolean;
} {
	const root = join(resolveEnv(env).dataRoot ?? dataRoot, "claude", "projects");
	// but dataRoot is already resolveEnv(...).dataRoot; we accept direct
	const scanRoot = join(dataRoot, "claude", "projects");
	const candidates: { content: string; type: string }[] = [];
	let files_scanned = 0;
	let skipped_files = 0;
	if (!existsSync(scanRoot))
		return { candidates, files_scanned, skipped_files, truncated: false };
	let projectDirs: string[] = [];
	try {
		projectDirs = readdirSync(scanRoot);
	} catch {
		return { candidates, files_scanned, skipped_files, truncated: false };
	}
	for (const proj of projectDirs) {
		const memDir = join(scanRoot, proj, "memory");
		if (!existsSync(memDir)) continue;
		let files: string[] = [];
		try {
			files = readdirSync(memDir);
		} catch {
			continue;
		}
		for (const f of files) {
			if (!f.endsWith(".md")) continue;
			const full = join(memDir, f);
			files_scanned++;
			if (f === "MEMORY.md") {
				// index only, skip harvesting
				continue;
			}
			const content = safeRead(full);
			if (content === null) {
				skipped_files++;
				continue;
			}
			// M-04: frontmatter without closing --- should skip
			if (content.trimStart().startsWith("---")) {
				const fmLines = content.replace(/\r\n/g, "\n").split("\n");
				let hasClosing = false;
				for (let i = 1; i < fmLines.length; i++) {
					if (fmLines[i].trim() === "---") {
						hasClosing = true;
						break;
					}
				}
				if (!hasClosing) {
					skipped_files++;
					continue;
				}
			}
			const rawType = parseFrontmatterType(content);
			if (rawType === null) {
				// check if frontmatter missing or malformed: count as skipped but continue
				// if file has no frontmatter, we still skip but not throw
				// For test: one malformed topic file should be counted as skipped
				if (!content.trim().startsWith("---")) {
					skipped_files++;
					continue;
				}
				// if frontmatter exists but type missing, map to context
			}
			const mapped = rawType
				? (CLAUDE_TYPE_MAP[rawType.toLowerCase()] ?? "context")
				: "context";
			// bullets
			const bullets = extractBullets(content);
			if (bullets.length === 0) {
				// no bullets -> skip but not error
				continue;
			}
			for (const b of bullets) {
				if (candidates.length >= MAX_CANDIDATES) break;
				candidates.push({ content: b, type: mapped });
			}
		}
	}
	const truncated = candidates.length >= MAX_CANDIDATES;
	return { candidates, files_scanned, skipped_files, truncated };
}

export function parseCodexMemories(
	dataRoot: string,
	env?: KevinEnv,
): {
	candidates: { content: string; type: string }[];
	files_scanned: number;
	skipped_files: number;
	truncated: boolean;
} {
	const scanRoot = join(dataRoot, "codex", "memories");
	const candidates: { content: string; type: string }[] = [];
	let files_scanned = 0;
	let skipped_files = 0;
	if (!existsSync(scanRoot))
		return { candidates, files_scanned, skipped_files, truncated: false };
	let files: string[] = [];
	try {
		files = readdirSync(scanRoot);
	} catch {
		return { candidates, files_scanned, skipped_files, truncated: false };
	}
	const targets = ["memory_summary.md", "MEMORY.md"];
	for (const t of targets) {
		if (!files.includes(t)) continue;
		const full = join(scanRoot, t);
		files_scanned++;
		const content = safeRead(full);
		if (content === null) {
			skipped_files++;
			continue;
		}
		// extract headings and bullets: both become candidates type context
		const lines = content.split("\n");
		for (const line of lines) {
			const bullet = line.match(/^\s*[-*]\s+(.*)$/);
			if (bullet && bullet[1].trim() !== "") {
				if (candidates.length >= MAX_CANDIDATES) break;
				candidates.push({ content: bullet[1].trim(), type: "context" });
				continue;
			}
			const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
			if (heading && heading[1].trim() !== "") {
				// heading text as candidate (avoid duplicates where heading is also bullet)
				// we treat heading as candidate as well
				if (candidates.length >= MAX_CANDIDATES) break;
				candidates.push({ content: heading[1].trim(), type: "context" });
			}
		}
	}
	const truncated2 = candidates.length >= MAX_CANDIDATES;
	return { candidates, files_scanned, skipped_files, truncated: truncated2 };
}

export function importHostMemories(opts: {
	store: Store;
	memoryService: MemoryService;
	metrics?: Metrics;
	env?: KevinEnv;
	dataRoot?: string;
	source: "claude-memory" | "codex-memories";
}): HostImportReport {
	const dataRoot = opts.dataRoot ?? resolveEnv(opts.env).dataRoot;
	// gate — v2.0.0 retired import_host_memory (K16-005); check sources framework.
	// Legacy fallback kept for pre-014 DBs that still carry the key before migration 014 deletes it.
	const legacy = opts.memoryService.getSetting("import_host_memory", "0");
	if (legacy === "1") {
		// translated by 014; allow but hint new path
	} else {
		const master =
			opts.memoryService.getSetting("sources_enabled", "0") === "1";
		const perKey =
			opts.source === "claude-memory"
				? "source_claude_memory"
				: "source_codex_memories";
		const per = opts.memoryService.getSetting(perKey, "0") === "1";
		if (!master || !per) {
			return {
				files_scanned: 0,
				candidates: 0,
				saved: 0,
				duplicates: 0,
				skipped_weak: 0,
				error: "disabled",
				hint:
					opts.source === "claude-memory"
						? "Enable with kevin_config set sources_enabled 1 and kevin_config set source_claude_memory 1"
						: "Enable with kevin_config set sources_enabled 1 and kevin_config set source_codex_memories 1",
			};
		}
	}
	let parsed: {
		candidates: { content: string; type: string }[];
		files_scanned: number;
		skipped_files: number;
		truncated: boolean;
	};
	if (opts.source === "claude-memory") {
		parsed = parseClaudeMemory(dataRoot, opts.env);
	} else {
		parsed = parseCodexMemories(dataRoot, opts.env);
	}
	let candidates = parsed.candidates;
	// M-05: propagate truncated correctly from parsers
	const truncated =
		(parsed.truncated ?? false) || candidates.length >= MAX_CANDIDATES;
	if (candidates.length > MAX_CANDIDATES)
		candidates = candidates.slice(0, MAX_CANDIDATES);

	// pipeline per candidate: redact -> fingerprint dedup (existing rows) -> quality-gate classification -> save
	let saved = 0;
	let duplicates = 0;
	let skipped_weak = 0;

	// dedup intra-run via fingerprint set
	const seenFingerprints = new Set<string>();
	// existing fingerprints from DB
	const existingRows = opts.store
		.prepare("SELECT fingerprint FROM memories WHERE fingerprint IS NOT NULL")
		.all() as { fingerprint: string }[];
	for (const r of existingRows) seenFingerprints.add(r.fingerprint);

	for (const c of candidates) {
		// redact (paths and private)
		let content = c.content;
		// simple redact paths: reuse import? For now strip private blocks
		content = content.replace(
			/<private\b[^>]*>[\s\S]*?<\/private>/gi,
			(m) => `<private: redacted ${m.length} chars>`,
		);
		// fingerprint dedup
		const fp = computeFingerprint(content);
		if (seenFingerprints.has(fp)) {
			duplicates++;
			continue;
		}
		seenFingerprints.add(fp);

		// quality-gate classification: weak stored-not-injected naturally
		// We simulate: isActionable and strength via QualityGate.evaluate
		// For host import, we consider type context is weak if generic? But we will use evaluate to decide
		const q = QualityGate.evaluate(
			{ errorType: "unknown", suggestion: content },
			null,
			"unknown",
		);
		// If weak and not actionable, count as skipped_weak but still store? Plan says weak entries stored-but-NOT-injected
		// So we still save but count as weak
		const isWeak = q.strength === "weak" && !q.isActionable;
		if (isWeak) skipped_weak++;

		// save
		try {
			opts.memoryService.save({
				type: c.type as "context" | "rule" | "pattern" | "decision",
				content,
				scope: "project",
				origin: "imported",
				fingerprint: fp,
				metadata: { source: opts.source },
				// evidence_count 0 => confidence low naturally, stored but not injected
			});
			saved++;
		} catch {
			// skip on error
		}
	}

	return {
		files_scanned: parsed.files_scanned,
		candidates: parsed.candidates.length,
		saved,
		duplicates,
		skipped_weak,
		truncated: truncated || undefined,
		skipped_files: parsed.skipped_files || undefined,
	};
}
