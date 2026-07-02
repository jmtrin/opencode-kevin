import type { Memory, MemoryService } from "./MemoryService.js";

export interface ChatMessage {
	role: string;
	content: string;
}

export interface SystemTransformInput {
	sessionID?: string;
	messages: ChatMessage[];
}

export interface SystemTransformOutput {
	system: string[];
}

export interface CompactingInput {
	sessionID: string;
	messages: ChatMessage[];
}

export interface CompactingOutput {
	context: string[];
}

const SYSTEM_TRANSFORM_TOKENS = 1500;
const COMPACTING_TOKENS = 2000;

const STOP_WORDS = new Set<string>([
	"a",
	"an",
	"and",
	"are",
	"at",
	"be",
	"been",
	"but",
	"by",
	"did",
	"do",
	"does",
	"el",
	"eso",
	"for",
	"how",
	"i",
	"if",
	"in",
	"is",
	"it",
	"la",
	"las",
	"los",
	"mi",
	"my",
	"o",
	"of",
	"on",
	"or",
	"para",
	"por",
	"que",
	"she",
	"su",
	"that",
	"the",
	"this",
	"to",
	"tu",
	"un",
	"una",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"who",
	"why",
	"with",
	"y",
	"you",
	"como",
	"con",
	"de",
	"en",
	"he",
	"they",
	"was",
	"sin",
]);

function isWordChar(ch: string): boolean {
	return /[a-z0-9áéíóúüñ]/i.test(ch);
}

export class ContextInjector {
	constructor(private memoryService: MemoryService) {}

	deriveQuery(messages: ChatMessage[]): string {
		let lastUserContent = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				lastUserContent = messages[i].content;
				break;
			}
		}
		if (!lastUserContent) return "";

		const tokens = lastUserContent
			.toLowerCase()
			.split(/\s+/)
			.map((t) => {
				let out = "";
				for (const ch of t) {
					if (isWordChar(ch)) out += ch;
				}
				return out;
			})
			.filter((t) => t.length > 0 && !STOP_WORDS.has(t));
		return tokens.join(" ");
	}

	onSystemTransform(
		input: SystemTransformInput,
		output: SystemTransformOutput,
	): void {
		const query = this.deriveQuery(input.messages);
		if (!query) return;
		const memories = this.memoryService.getRelevant({
			query,
			maxTokens: SYSTEM_TRANSFORM_TOKENS,
		});
		if (memories.length === 0) return;
		output.system.push(this.formatMemories(memories, "context"));
	}

	onCompacting(input: CompactingInput, output: CompactingOutput): void {
		const query = this.deriveQuery(input.messages);
		if (!query) return;
		const memories = this.memoryService.getRelevant({
			query,
			maxTokens: COMPACTING_TOKENS,
		});
		if (memories.length === 0) return;
		output.context.push(this.formatMemories(memories, "memory"));
	}

	private formatMemories(
		memories: Memory[],
		format: "context" | "memory",
	): string {
		const lines = memories.map((m) => `[${m.type}] ${m.content}`);
		const body = lines.join("\n");
		if (format === "context") {
			return `<kevin-context>Lecciones relevantes:\n${body}\n</kevin-context>`;
		}
		return `<kevin-memory>\n${body}\n</kevin-memory>`;
	}
}
