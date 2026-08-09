import type { Memory } from "./MemoryService.js";
import type { Store } from "./Store.js";
import { computeConfidence } from "./confidence.js";

const EXPORT_TYPES = new Set(["decision", "rule", "pattern"]);

function formatTimestamp(ts: string): string {
	try {
		// SQLite `datetime('now')` is UTC without a zone suffix; parse as
		// UTC so a round-trip never shifts the value by the local offset.
		const iso = ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`;
		return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
	} catch {
		return ts;
	}
}

interface ExportRow {
	id: string;
	type: string;
	content: string;
	scope: string;
	relevance_score: number;
	fingerprint: string | null;
	evidence_count: number;
	recurrence_count: number;
	last_verified_at: string | null;
	status: string;
	source_tool: string | null;
	source_session: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * BUG-008 — select export rows including `recurrence_count` (the v0.4.0
 * demotion signal, column from migration 005). DBs that predate 005 have
 * no such column; the SELECT is retried without it and recurrences
 * degrade to 0 (legacy confidence formula applies — see below).
 */
function selectExportRows(store: Store): {
	rows: ExportRow[];
	hasRecurrence: boolean;
} {
	try {
		return {
			hasRecurrence: true,
			rows: store
				.prepare(
					`SELECT id, type, content, scope, relevance_score, fingerprint,
					        evidence_count, recurrence_count, last_verified_at, status,
					        source_tool, source_session, created_at, updated_at
					 FROM memories
					 WHERE status = 'active'
					 ORDER BY type, created_at DESC`,
				)
				.all() as ExportRow[],
		};
	} catch {
		const legacy = store
			.prepare(
				`SELECT id, type, content, scope, relevance_score, fingerprint,
				        evidence_count, last_verified_at, status,
				        source_tool, source_session, created_at, updated_at
				 FROM memories
				 WHERE status = 'active'
				 ORDER BY type, created_at DESC`,
			)
			.all() as Array<Omit<ExportRow, "recurrence_count">>;
		return {
			hasRecurrence: false,
			rows: legacy.map((r) => ({ ...r, recurrence_count: 0 })),
		};
	}
}

/**
 * BUG-008 — the exported confidence must match the two-sided v0.4.0
 * formula (K4-010), demoting lessons with recurrences. Pre-005 DBs (no
 * `recurrence_count` column) keep the legacy one-sided formula.
 */
function exportConfidence(
	row: { evidence_count: number; recurrence_count: number },
	hasRecurrence: boolean,
): string {
	const confidence = hasRecurrence
		? computeConfidence(row.evidence_count, row.recurrence_count)
		: Math.min(1, 0.5 + 0.1 * row.evidence_count);
	return confidence.toFixed(2);
}

export function exportOkf(store: Store): string {
	const { rows: allRows, hasRecurrence } = selectExportRows(store);
	const filtered = allRows.filter((r) => EXPORT_TYPES.has(r.type));
	if (filtered.length === 0) return "<!-- No exportable memories found. -->\n";

	const blocks: string[] = [];
	for (const m of filtered) {
		const fm: string[] = [];
		fm.push("---");
		fm.push(`id: ${m.id}`);
		fm.push(`type: ${m.type}`);
		fm.push(`confidence: ${exportConfidence(m, hasRecurrence)}`);
		fm.push(`evidence_count: ${m.evidence_count}`);
		if (m.recurrence_count > 0) {
			fm.push(`recurrence_count: ${m.recurrence_count}`);
		}
		if (m.last_verified_at) {
			fm.push(`last_verified_at: ${formatTimestamp(m.last_verified_at)}`);
		}
		if (m.fingerprint) {
			fm.push(`fingerprint: ${m.fingerprint}`);
		}
		fm.push(`created: ${formatTimestamp(m.created_at)}`);
		fm.push(`scope: ${m.scope}`);
		fm.push("---");
		fm.push("");
		fm.push(m.content);
		blocks.push(fm.join("\n"));
	}

	return `${blocks.join("\n\n")}\n`;
}

export function exportMarkdown(store: Store): string {
	const { rows: allRows, hasRecurrence } = selectExportRows(store);
	const filtered = allRows.filter((r) => EXPORT_TYPES.has(r.type));
	if (filtered.length === 0)
		return "# Kevin Knowledge Export\n\n_No exportable memories found._\n";

	const lines: string[] = [];
	lines.push("# Kevin Knowledge Export");
	lines.push("");
	lines.push(
		`Exported: ${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
	);
	lines.push(`Total entries: ${filtered.length}`);
	lines.push("");

	for (const m of filtered) {
		lines.push(`## ${m.type}: \`${m.fingerprint ?? m.id.slice(0, 8)}\``);
		lines.push("");
		lines.push(`- **ID:** \`${m.id}\``);
		lines.push(`- **Confidence:** ${exportConfidence(m, hasRecurrence)}`);
		lines.push(`- **Evidence count:** ${m.evidence_count}`);
		if (m.recurrence_count > 0) {
			lines.push(`- **Recurrence count:** ${m.recurrence_count}`);
		}
		if (m.last_verified_at) {
			lines.push(`- **Last verified:** ${formatTimestamp(m.last_verified_at)}`);
		}
		if (m.fingerprint) {
			lines.push(`- **Fingerprint:** \`${m.fingerprint}\``);
		}
		lines.push(`- **Scope:** ${m.scope}`);
		lines.push(`- **Created:** ${formatTimestamp(m.created_at)}`);
		lines.push("");
		lines.push(m.content);
		lines.push("");
		lines.push("---");
		lines.push("");
	}

	return lines.join("\n");
}
