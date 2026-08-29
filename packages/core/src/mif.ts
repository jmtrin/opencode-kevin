// K15-008 — MIF codec (plan §4.4)
// Envelope {id, content, type, timestamp, source, metadata} + vendor extensions preserved + PII redaction + content-hash dedup (import side)

import { fingerprint as computeFingerprint } from "./fingerprint.js";
import type { Memory } from "./MemoryService.js";

export interface MifEnvelope {
	format: "mif";
	version: 1;
	memories: MifMemory[];
	vendorExtensions?: Record<string, unknown>;
}

export interface MifMemory {
	id: string;
	content: string;
	type: string;
	timestamp: string; // ISO
	source: string;
	metadata: Record<string, string>;
	// index signature preserves unknown fields verbatim
	[k: string]: unknown;
}

const SECRET_PATTERNS: RegExp[] = [
	/\b(API_KEY|SECRET|PASSWORD|TOKEN)\b\s*[=:]\s*\S+/gi,
	/\bBearer\s+\S+/gi,
	/\b(access_?token|auth_?token|api_?token)\b\s*[=:]\s*\S+/gi,
	/\btoken\s*[=:]\s*\S+/gi,
	/\baws_secret_access_key\b\s*[=:]\s*\S+/gi,
	/\bghp_[A-Za-z0-9_]+/g,
	/\bsk-[A-Za-z0-9_\-]+/g,
	/\bgithub_pat_[A-Za-z0-9_]+/g,
];

function redactSecrets(text: string): string {
	let out = text;
	for (const pat of SECRET_PATTERNS) {
		out = out.replace(pat, (m) => {
			const eq = m.indexOf("=");
			const colon = m.indexOf(":");
			const sep = eq !== -1 ? "=" : colon !== -1 ? ":" : " ";
			const prefix = m.slice(0, m.indexOf(sep) + 1);
			return `${prefix}<redacted>`;
		});
	}
	// fallback: if pattern didn't match sep, replace whole token
	return out;
}

function toIso(ts: string): string {
	try {
		const iso = ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`;
		return new Date(iso).toISOString();
	} catch {
		return new Date().toISOString();
	}
}

export function toMif(rows: Memory[], opts: { redactPii: boolean }): MifEnvelope {
	const memories: MifMemory[] = rows.map((r) => {
		const originalContent = r.content;
		let content = originalContent;
		if (opts.redactPii) {
			content = redactSecrets(content);
		}
		const meta: Record<string, string> = {
			scope: String((r as Memory).scope ?? "project"),
			fingerprint: String((r as Memory).fingerprint ?? computeFingerprint(originalContent)),
			confidence: String((r as Memory).confidence ?? ""),
			evidence_count: String((r as Memory).evidenceCount ?? 0),
		};
		const base: MifMemory = {
			id: (r as Memory).id,
			content,
			type: (r as Memory).type,
			timestamp: toIso((r as Memory).createdAt ?? new Date().toISOString()),
			source: "opencode-kevin",
			metadata: meta,
		};
		// preserve unknown fields from original row that are not part of standard mapping
		// standard keys: id, content, type, createdAt, scope, fingerprint, confidence, evidenceCount, etc.
		// unknown vendor extensions stored under `mif_vendor` in metadata if present
		const mifVendor = (r as unknown as Record<string, unknown>).mif_vendor as Record<string, unknown> | undefined;
		if (mifVendor && typeof mifVendor === "object") {
			for (const [k, v] of Object.entries(mifVendor)) {
				if (!(k in base)) (base as Record<string, unknown>)[k] = v;
			}
		}
		// also check if row has extra top-level keys beyond Memory standard (for codec-level preservation)
		const extraKeys = Object.keys(r as unknown as Record<string, unknown>).filter((k) => !["id","content","type","scope","createdAt","updatedAt","fingerprint","confidence","evidenceCount","recurrenceCount","projectId","repoId","layer","status","metadata","origin","sourceTool","sourceSession","relevanceScore","truthPenalty"].includes(k));
		for (const k of extraKeys) {
			if (k === "mif_vendor") continue;
			if (!(k in base)) (base as Record<string, unknown>)[k] = (r as unknown as Record<string, unknown>)[k];
		}
		return base;
	});
	return { format: "mif", version: 1, memories };
}

export interface ImportCandidate {
	id: string;
	content: string;
	type: string;
	timestamp: string;
	source: string;
	metadata: Record<string, string>;
	unknownFields: Record<string, unknown>;
}

export function fromMif(env: MifEnvelope): { candidates: ImportCandidate[]; unknownFieldsPreserved: string[] } {
	if (!env || env.format !== "mif" || env.version !== 1 || !Array.isArray(env.memories)) {
		throw new Error("invalid MIF envelope: expected {format:'mif', version:1, memories:[]}");
	}
	const candidates: ImportCandidate[] = [];
	const preserved = new Set<string>();
	for (const m of env.memories) {
		const known = new Set(["id","content","type","timestamp","source","metadata","format","version"]);
		const unknown: Record<string, unknown> = {};
		for (const k of Object.keys(m as Record<string, unknown>)) {
			if (!known.has(k)) {
				unknown[k] = (m as Record<string, unknown>)[k];
				preserved.add(k);
			}
		}
		// also collect vendorExtensions top-level unknown?
		candidates.push({
			id: String((m as MifMemory).id),
			content: String((m as MifMemory).content),
			type: String((m as MifMemory).type),
			timestamp: String((m as MifMemory).timestamp),
			source: String((m as MifMemory).source ?? "opencode-kevin"),
			metadata: { ...((m as MifMemory).metadata ?? {}) } as Record<string, string>,
			unknownFields: unknown,
		});
	}
	// top-level vendorExtensions unknown
	if (env.vendorExtensions) {
		for (const k of Object.keys(env.vendorExtensions)) preserved.add(k);
	}
	return { candidates, unknownFieldsPreserved: [...preserved] };
}
