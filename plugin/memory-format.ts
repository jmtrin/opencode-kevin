export interface MemoryBlockItem {
	id?: string;
	type: string;
	content: string;
	protect?: boolean;
}

export function escapeInjectedText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function formatRow(m: MemoryBlockItem): string {
	const idLine = m.id ? `id: ${escapeInjectedText(m.id)}\n` : "";
	const body = `${idLine}[${escapeInjectedText(String(m.type))}] ${escapeInjectedText(
		m.content,
	)}`;
	return m.protect === false ? body : `<protect>\n${body}\n</protect>`;
}

export function formatMemories(
	memories: MemoryBlockItem[],
	tag: "context" | "memory",
): string {
	if (memories.length === 0) return "";
	const body = memories.map(formatRow).join("\n");
	return tag === "context"
		? `<kevin-context>Lecciones relevantes:\n${body}\n</kevin-context>`
		: `<kevin-memory>\n${body}\n</kevin-memory>`;
}
