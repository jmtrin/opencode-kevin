export interface MemoryBlockItem {
	id?: string;
	type: string;
	content: string;
	protect?: boolean;
	/** v0.4.0 (K4-023) — weak lesson admitted in debug mode: the row is
	 * rendered with a `(low confidence)` marker line. */
	weak?: boolean;
}

export function escapeInjectedText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function typePrefix(m: MemoryBlockItem): string {
	const t = escapeInjectedText(String(m.type));
	return m.weak ? `[${t}] (low confidence)` : `[${t}]`;
}

function formatRow(m: MemoryBlockItem): string {
	const idLine = m.id ? `id: ${escapeInjectedText(m.id)}\n` : "";
	const body = `${idLine}${typePrefix(m)} ${escapeInjectedText(m.content)}`;
	return m.protect === false ? body : `<protect>\n${body}\n</protect>`;
}

/**
 * v0.4.0 (K4-012) — progressive disclosure for injection: a short
 * snippet row instead of the full body. Row = `id:` line + `[type]`
 * prefix + the first 2 non-empty lines of content, wrapped in
 * `<protect>` unless the memory opted out (`protect: false`). The
 * full body stays available via `kevin_get`.
 */
export function formatSnippet(m: MemoryBlockItem): string {
	const lines = m.content
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.slice(0, 2);
	// v0.4.0 (K4-025) — a pattern's `Fixed by:` line is the highest-value
	// payload (plan §5.4 / D4-07); surface it in the snippet even though
	// it sits below the 2-line cut. Only patterns carry the line.
	const fixLine = lines
		.map((l) => l)
		.concat(
			m.content
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter((l) => l.startsWith("Fixed by:")),
		)[2];
	const idLine = m.id ? `id: ${escapeInjectedText(m.id)}\n` : "";
	const bodyLines = fixLine ? [...lines, fixLine] : lines;
	const body =
		bodyLines.length === 0
			? ""
			: `${idLine}${typePrefix(m)} ${escapeInjectedText(bodyLines.join("\n"))}`;
	return m.protect === false ? body : `<protect>\n${body}\n</protect>`;
}

function wrapBlock(body: string, tag: "context" | "memory"): string {
	return tag === "context"
		? `<kevin-context>Lecciones relevantes:\n${body}\n</kevin-context>`
		: `<kevin-memory>\n${body}\n</kevin-memory>`;
}

export function formatMemories(
	memories: MemoryBlockItem[],
	tag: "context" | "memory",
): string {
	if (memories.length === 0) return "";
	return wrapBlock(memories.map(formatRow).join("\n"), tag);
}

export function formatMemorySnippets(
	memories: MemoryBlockItem[],
	tag: "context" | "memory",
): string {
	if (memories.length === 0) return "";
	return wrapBlock(memories.map(formatSnippet).join("\n"), tag);
}
