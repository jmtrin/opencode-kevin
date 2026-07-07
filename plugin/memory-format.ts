export interface MemoryBlockItem {
	type: string;
	content: string;
}

export function escapeInjectedText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function formatMemories(
	memories: MemoryBlockItem[],
	tag: "context" | "memory",
): string {
	if (memories.length === 0) return "";
	const body = memories
		.map(
			(m) =>
				`[${escapeInjectedText(String(m.type))}] ${escapeInjectedText(m.content)}`,
		)
		.join("\n");
	return tag === "context"
		? `<kevin-context>Lecciones relevantes:\n${body}\n</kevin-context>`
		: `<kevin-memory>\n${body}\n</kevin-memory>`;
}
