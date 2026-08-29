// K15-003 — Skill bundle emitter (plan §4.1)
// Writes <projectRoot>/<canonicalDir>/kevin-knowledge/SKILL.md + references/<topic>.md
// Every emitted byte passes through escape helpers (C-09, K15-004).

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { escapeForFence, escapeForMarkerBlock } from "./escape.js";
import { firstSentence } from "./Curator.js";
import { resolveEnv, type KevinEnv } from "./env.js";
import { KEVIN_VERSION } from "./index.js";

export interface TopicBundle {
	topic: string;
	content: string;
	/** optional precomputed summary; derived from content if omitted */
	summary?: string;
}

export interface SkillEmitInput {
	projectRoot: string;
	canonicalDir: string;
	mirrors: Array<"claude" | "cursor">;
	topics: TopicBundle[];
	repoId: string;
	/** injectable for tests; defaults to ~/.opencode-kevin/skills-manifest.json */
	manifestPath?: string;
	env?: KevinEnv;
	metrics?: { incr: (key: string, by?: number) => void };
}

export interface EmitReport {
	written: string[];
	skipped_external: string[];
	noop: string[];
	removed_orphan_manifest: string[];
	external_edits: string[];
}

function sha256Hex(s: string): string {
	return createHash("sha256").update(s, "utf8").digest("hex");
}

function escaped(text: string): string {
	// C-09 funnel: every byte through escape helpers. Apply both fence + marker (orthogonal).
	return escapeForMarkerBlock(escapeForFence(text));
}

function atomicWrite(target: string, content: string): void {
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
	writeFileSync(tmp, content, "utf8");
	try {
		renameSync(tmp, target);
	} catch (e) {
		try { unlinkSync(tmp); } catch {}
		throw e;
	}
}

function buildSkillMd(repoId: string, bundles: TopicBundle[]): string {
	const header = [
		"---",
		"name: kevin-knowledge",
		"description: >-",
		"  Project knowledge curated by opencode-kevin: conventions, decisions and verified",
		"  fixes for this repository. Load when working in this repo and unsure about local",
		"  rules, past failures or team decisions.",
		"metadata:",
		`  generator: opencode-kevin/${KEVIN_VERSION}`,
		`  repo_id: ${escaped(repoId)}`,
		"---",
		"",
	].join("\n");

	let body: string;
	if (bundles.length === 0) {
		body = "No knowledge yet — Kevin has not curated any memories for this repository.\n\nSee `references/` when topics appear.\n";
	} else {
		// index ≤80 lines: one per topic + header
		const indexLines: string[] = [];
		indexLines.push("# Kevin Knowledge");
		indexLines.push("");
		indexLines.push("Topics curated for this repository:");
		indexLines.push("");
		for (const b of bundles) {
			const rawSummary = b.summary ?? firstSentence(b.content.split("\n").find((l) => l.trim().startsWith("-"))?.replace(/^-+\s*/, "") ?? b.content.slice(0, 120));
			const summary = escaped(rawSummary.trim().slice(0, 140));
			// relative link from SKILL.md to references/<topic>.md
			indexLines.push(`- **${escaped(b.topic)}**: ${summary} — [references/${escaped(b.topic)}.md](references/${escaped(b.topic)}.md)`);
		}
		const MAX_INDEX = 78;
		if (indexLines.length > MAX_INDEX) {
			// cap at 78: truncate excess topics, reserve footer lines
			indexLines.splice(MAX_INDEX);
		}
		indexLines.push("");
		indexLines.push("See `references/` for detailed topic files.");
		indexLines.push("");
		body = indexLines.join("\n");
	}
	const full = header + body;
	// enforce <150 lines total; if exceeds, truncate body tail via paragraph truncation
	const lines = full.split("\n");
	if (lines.length >= 150) {
		const headerLines = header.split("\n").length;
		const allowedBody = 149 - headerLines;
		const bodyLines = body.split("\n");
		const truncatedBody = bodyLines.slice(0, Math.max(0, allowedBody)).join("\n");
		const truncated = header + truncatedBody;
		return truncated.endsWith("\n") ? truncated : truncated + "\n";
	}
	return full;
}

function buildToWrite(input: SkillEmitInput): { base: string; skillPath: string; refsDir: string; toWrite: Array<{ path: string; content: string }>; referenceContents: Map<string, string>; skillContent: string; bundles: TopicBundle[] } {
	const canonicalRaw = (input.canonicalDir && input.canonicalDir.trim() !== "") ? input.canonicalDir.trim() : ".agents/skills";
	// H-01: validate canonicalDir is relative and does not escape projectRoot
	if (isAbsolute(canonicalRaw) || canonicalRaw.includes("..")) {
		throw new Error(`unsafe canonicalDir: ${canonicalRaw}`);
	}
	const base = resolve(join(input.projectRoot, canonicalRaw, "kevin-knowledge"));
	const projectRootResolved = resolve(input.projectRoot);
	if (base !== projectRootResolved && !base.startsWith(projectRootResolved + "/") && !base.startsWith(projectRootResolved + "\\")) {
		throw new Error(`canonicalDir escapes projectRoot: ${canonicalRaw}`);
	}
	const skillPath = join(base, "SKILL.md");
	const refsDir = join(base, "references");
	const bundles = [...input.topics].sort((a, b) => a.topic.localeCompare(b.topic));
	const skillContent = buildSkillMd(input.repoId, bundles);
	const referenceContents = new Map<string, string>();
	for (const b of bundles) {
		let body = b.content;
		if (body.length > 4000) body = body.slice(0, 4000);
		const esc = escaped(body);
		referenceContents.set(b.topic, esc + (esc.endsWith("\n") ? "" : "\n"));
	}
	const toWrite: Array<{ path: string; content: string }> = [];
	toWrite.push({ path: skillPath, content: skillContent });
	for (const [topic, content] of referenceContents) {
		// C-01 sanitize topic by replacing [/\\:]/g with "-", replacing ".." and validating
		let safe = topic.replace(/[/\\:]/g, "-").replace(/\.\./g, "-");
		if (safe.includes("/") || safe.includes("\\") || safe.includes("..")) {
			throw new Error(`unsafe topic: ${topic}`);
		}
		if (safe.trim() === "") {
			throw new Error(`unsafe topic: ${topic}`);
		}
		toWrite.push({ path: join(refsDir, `${safe}.md`), content });
	}
	return { base, skillPath, refsDir, toWrite, referenceContents, skillContent, bundles };
}

export function emitSkillBundle(input: SkillEmitInput): EmitReport {
	const { base, toWrite } = buildToWrite(input);
	const manifestPath = input.manifestPath ?? join(resolveEnv(input.env).dataRoot, "skills-manifest.json");
	let manifest: Record<string, string> = {};
	let manifestExists = false;
	let manifestCorrupt = false;
	if (existsSync(manifestPath)) {
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
			manifestExists = true;
		} catch {
			manifestCorrupt = true;
			try { input.metrics?.incr("skills_manifest_corrupt_total", 1); } catch {}
			try {
				const corrupt = readFileSync(manifestPath, "utf8");
				writeFileSync(`${manifestPath}.corrupt.${Date.now()}`, corrupt, "utf8");
			} catch {}
			manifest = {};
			manifestExists = false;
		}
	}
	const written: string[] = [];
	const skipped_external: string[] = [];
	const noop: string[] = [];
	const external_edits: string[] = [];
	const removed_orphan_manifest: string[] = [];

	for (const w of toWrite) {
		const freshHash = sha256Hex(w.content);
		const manifestHash = manifest[w.path];
		const diskExists = existsSync(w.path);
		let diskHash: string | null = null;
		if (diskExists) {
			try { diskHash = sha256Hex(readFileSync(w.path, "utf8")); } catch { diskHash = null; }
		}

		if (!diskExists) {
			atomicWrite(w.path, w.content);
			written.push(w.path);
			manifest[w.path] = freshHash;
			continue;
		}
		if (manifestCorrupt) {
			if (diskHash !== null && freshHash === diskHash) {
				noop.push(w.path);
				manifest[w.path] = freshHash;
			} else {
				atomicWrite(w.path, w.content);
				written.push(w.path);
				manifest[w.path] = freshHash;
			}
			continue;
		}
		if (manifestExists) {
			if (manifestHash === undefined) {
				skipped_external.push(w.path);
				external_edits.push(w.path);
				continue;
			}
			if (diskHash !== manifestHash) {
				skipped_external.push(w.path);
				external_edits.push(w.path);
				continue;
			}
		}
		if (diskHash !== null && freshHash === diskHash) {
			noop.push(w.path);
			manifest[w.path] = freshHash;
		} else {
			atomicWrite(w.path, w.content);
			written.push(w.path);
			manifest[w.path] = freshHash;
		}
	}

	// orphan manifest cleanup: entries under base not in current toWrite
	for (const key of Object.keys({ ...manifest })) {
		if (key.startsWith(base) && !toWrite.some((w) => w.path === key)) {
			removed_orphan_manifest.push(key);
			delete manifest[key];
			try { unlinkSync(key); } catch {}
			for (const mirror of input.mirrors) {
				const mirrorBase = mirror === "claude"
					? join(input.projectRoot, ".claude", "skills", "kevin-knowledge")
					: join(input.projectRoot, ".cursor", "skills", "kevin-knowledge");
				const rel = key.slice(base.length);
				const mirrorPath = join(mirrorBase, rel);
				try { unlinkSync(mirrorPath); } catch {}
			}
		}
	}
	// mirror handling — follow canonical state
	for (const mirror of input.mirrors) {
		const mirrorBase = mirror === "claude"
			? join(input.projectRoot, ".claude", "skills", "kevin-knowledge")
			: join(input.projectRoot, ".cursor", "skills", "kevin-knowledge");
		for (const w of toWrite) {
			const rel = w.path.slice(base.length);
			const mirrorPath = join(mirrorBase, rel);
			const wasWritten = written.includes(w.path);
			const wasNoop = noop.includes(w.path);
			const wasSkipped = skipped_external.includes(w.path);
			if (wasSkipped) continue;
			if (wasWritten) {
				atomicWrite(mirrorPath, w.content);
			} else if (wasNoop) {
				if (!existsSync(mirrorPath)) {
					atomicWrite(mirrorPath, w.content);
				}
			}
		}
	}

	try {
		// manifest already built; write LAST
		mkdirSync(dirname(manifestPath), { recursive: true });
		atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
	} catch {}
	try { input.metrics?.incr("skills_emitted_total", 1); } catch {}
	return { written, skipped_external, noop, removed_orphan_manifest, external_edits };
}

export function refreshSkillBundle(input: SkillEmitInput): EmitReport {
	const { base, refsDir, toWrite, referenceContents } = buildToWrite(input);
	const manifestPath = input.manifestPath ?? join(resolveEnv(input.env).dataRoot, "skills-manifest.json");
	let manifest: Record<string, string> = {};
	let manifestExists = false;
	let manifestCorrupt = false;
	if (existsSync(manifestPath)) {
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>;
			manifestExists = true;
		} catch {
			manifestCorrupt = true;
			try { input.metrics?.incr("skills_manifest_corrupt_total", 1); } catch {}
			try {
				const corrupt = readFileSync(manifestPath, "utf8");
				writeFileSync(`${manifestPath}.corrupt.${Date.now()}`, corrupt, "utf8");
			} catch {}
			manifest = {};
			manifestExists = false;
		}
	}
	const written: string[] = [];
	const skipped_external: string[] = [];
	const noop: string[] = [];
	const external_edits: string[] = [];
	const removed_orphan_manifest: string[] = [];

	// three-state per managed path
	for (const w of toWrite) {
		const freshHash = sha256Hex(w.content);
		const manifestHash = manifest[w.path];
		const diskExists = existsSync(w.path);
		let diskHash: string | null = null;
		if (diskExists) {
			try { diskHash = sha256Hex(readFileSync(w.path, "utf8")); } catch { diskHash = null; }
		}

		if (!diskExists) {
			// deleted-file reconciliation: manifest entry without disk file → rewrite (STALE)
			atomicWrite(w.path, w.content);
			written.push(w.path);
			manifest[w.path] = freshHash;
			continue;
		}
		// disk exists
		if (manifestHash === undefined) {
			if (manifestExists && !manifestCorrupt) {
				// missing manifest + existing file = EXTERNAL domain → skip
				skipped_external.push(w.path);
				external_edits.push(w.path);
				continue;
			}
			// if manifest corrupt or missing (bootstrap), treat as stale: allow write below
			if (!manifestExists && !manifestCorrupt) {
				// no manifest yet - bootstrap case: if we are in refresh with no manifest but file exists,
				// original behavior was EXTERNAL. Keep external for refresh when not corrupt.
				// But for corrupt we already handled; for bootstrap we should still consider external.
				// To preserve original spec for refresh: when manifest missing, existing file is EXTERNAL
				if (!manifestCorrupt) {
					skipped_external.push(w.path);
					external_edits.push(w.path);
					continue;
				}
			}
		}
		if (manifestExists && diskHash !== manifestHash) {
			// EXTERNAL_EDIT: disk ≠ manifest → skip
			skipped_external.push(w.path);
			external_edits.push(w.path);
			continue;
		}
		// disk == manifest (or manifest corrupt/missing and we allowed)
		if (diskHash !== null && freshHash === diskHash) {
			noop.push(w.path);
			manifest[w.path] = freshHash;
		} else {
			// STALE: disk == manifest but inputs changed → rewrite
			// Also for corrupt bootstrap, rewrite
			atomicWrite(w.path, w.content);
			written.push(w.path);
			manifest[w.path] = freshHash;
		}
	}

	// orphan manifest cleanup: entries under base not in current toWrite
	for (const key of Object.keys({ ...manifest })) {
		if (key.startsWith(base) && !toWrite.some((w) => w.path === key)) {
			removed_orphan_manifest.push(key);
			delete manifest[key];
			try { unlinkSync(key); } catch {}
			for (const mirror of input.mirrors) {
				const mirrorBase = mirror === "claude"
					? join(input.projectRoot, ".claude", "skills", "kevin-knowledge")
					: join(input.projectRoot, ".cursor", "skills", "kevin-knowledge");
				const rel = key.slice(base.length);
				const mirrorPath = join(mirrorBase, rel);
				try { unlinkSync(mirrorPath); } catch {}
			}
		}
	}
	// mirror handling — follow canonical state
	for (const mirror of input.mirrors) {
		const mirrorBase = mirror === "claude"
			? join(input.projectRoot, ".claude", "skills", "kevin-knowledge")
			: join(input.projectRoot, ".cursor", "skills", "kevin-knowledge");
		for (const w of toWrite) {
			const rel = w.path.slice(base.length);
			const mirrorPath = join(mirrorBase, rel);
			const wasWritten = written.includes(w.path);
			const wasNoop = noop.includes(w.path);
			const wasSkipped = skipped_external.includes(w.path);
			if (wasSkipped) continue;
			if (wasWritten) {
				// canonical changed → mirror must match (discard external edits on mirror)
				atomicWrite(mirrorPath, w.content);
			} else if (wasNoop) {
				// canonical unchanged → don't touch mirror (preserve if externally edited, per spec)
				// but if mirror missing, create it (stale projection)
				if (!existsSync(mirrorPath)) {
					atomicWrite(mirrorPath, w.content);
				}
			}
		}
	}

	// manifest written LAST
	try {
		mkdirSync(dirname(manifestPath), { recursive: true });
		atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
	} catch {}
	if (written.length > 0) {
		try { input.metrics?.incr("skills_emitted_total", 1); } catch {}
	}
	return { written, skipped_external, noop, removed_orphan_manifest, external_edits };
}

// Utility for tests: expose header builder and escaping
export const _internal = { buildSkillMd, sha256Hex, escaped };
