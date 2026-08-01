import type { Memory } from "./MemoryService.js";
import type { Store } from "./Store.js";

const EXPORT_TYPES = new Set(["decision", "rule", "pattern"]);

function formatTimestamp(ts: string): string {
	try {
		return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
	} catch {
		return ts;
	}
}

export function exportOkf(store: Store): string {
	const rows = store
		.prepare(
			`SELECT id, type, content, scope, relevance_score, fingerprint,
			        evidence_count, last_verified_at, status,
			        source_tool, source_session, created_at, updated_at
			 FROM memories
			 WHERE status = 'active'
			 ORDER BY type, created_at DESC`,
		)
		.all() as Array<{
		id: string;
		type: string;
		content: string;
		scope: string;
		relevance_score: number;
		fingerprint: string | null;
		evidence_count: number;
		last_verified_at: string | null;
		status: string;
		source_tool: string | null;
		source_session: string | null;
		created_at: string;
		updated_at: string;
	}>;

	const filtered = rows.filter((r) => EXPORT_TYPES.has(r.type));
	if (filtered.length === 0) return "<!-- No exportable memories found. -->\n";

	const blocks: string[] = [];
	for (const m of filtered) {
		const fm: string[] = [];
		fm.push("---");
		fm.push(`id: ${m.id}`);
		fm.push(`type: ${m.type}`);
		fm.push(
			`confidence: ${Math.min(1, 0.5 + 0.1 * m.evidence_count).toFixed(2)}`,
		);
		fm.push(`evidence_count: ${m.evidence_count}`);
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
	const rows = store
		.prepare(
			`SELECT id, type, content, scope, relevance_score, fingerprint,
			        evidence_count, last_verified_at, status,
			        created_at, updated_at
			 FROM memories
			 WHERE status = 'active'
			 ORDER BY type, created_at DESC`,
		)
		.all() as Array<{
		id: string;
		type: string;
		content: string;
		scope: string;
		relevance_score: number;
		fingerprint: string | null;
		evidence_count: number;
		last_verified_at: string | null;
		status: string;
		created_at: string;
	}>;

	const filtered = rows.filter((r) => EXPORT_TYPES.has(r.type));
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
		const conf = Math.min(1, 0.5 + 0.1 * m.evidence_count);
		lines.push(`## ${m.type}: \`${m.fingerprint ?? m.id.slice(0, 8)}\``);
		lines.push("");
		lines.push(`- **ID:** \`${m.id}\``);
		lines.push(`- **Confidence:** ${conf.toFixed(2)}`);
		lines.push(`- **Evidence count:** ${m.evidence_count}`);
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
