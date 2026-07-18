import type { MemoryService } from "./MemoryService.js";
import type { MemoryBlockItem } from "./memory-format.js";
import { formatMemories } from "./memory-format.js";
import { type Metrics, estimateTokens } from "./metrics.js";

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
	constructor(
		private memoryService: MemoryService,
		private metrics: Metrics | null = null,
	) {}

	/**
	 * v0.2.0 (K2-024): origin-aware ranking at injection time is delegated
	 * to `MemoryService.getRelevant()` (K2-023, D2-13). The injector does
	 * NOT re-rank on its own — it consumes the already-ranked slice and
	 * applies the conditional-budget guard for opt-out (`protect: false`)
	 * callers. Plan §B6.5: "apply the same multiplier as
	 * MemoryService.recall so reflector lessons outrank agent-saved notes
	 * at injection time" — satisfied transitively via the getRelevant call.
	 */
	private inject(
		query: string,
		tag: "context" | "memory",
		cap: number,
		metricKey: "tokens_injected_pre_prompt" | "tokens_injected_compacting",
	): string {
		let memories = this.memoryService.getRelevant({ query, maxTokens: cap });
		if (memories.length === 0) return "";
		const firstBlock = formatMemories(memories, tag);
		const aggregateTokens = estimateTokens(firstBlock);
		const firstRowProtect = (memories[0] as unknown as MemoryBlockItem)
			?.protect;
		const noProtectAboveTheFold = firstRowProtect === false;
		if (aggregateTokens > 0.8 * cap && noProtectAboveTheFold) {
			const lowerCap = Math.max(1, Math.round(0.8 * cap));
			memories = this.memoryService.getRelevant({
				query,
				maxTokens: lowerCap,
			});
			if (memories.length === 0) return "";
		}
		const block = formatMemories(memories, tag);
		this.metrics?.incr(metricKey, estimateTokens(block));
		return block;
	}

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
		const block = this.inject(
			query,
			"context",
			SYSTEM_TRANSFORM_TOKENS,
			"tokens_injected_pre_prompt",
		);
		if (block) output.system.push(block);
	}

	onCompacting(input: CompactingInput, output: CompactingOutput): void {
		const query = this.deriveQuery(input.messages);
		if (!query) return;
		const block = this.inject(
			query,
			"memory",
			COMPACTING_TOKENS,
			"tokens_injected_compacting",
		);
		if (block) output.context.push(block);
	}
}
