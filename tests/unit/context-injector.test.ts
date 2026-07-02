import { describe, expect, it } from "vitest";
import { ContextInjector } from "../../plugin/ContextInjector.js";
import type {
	GetRelevantInput,
	Memory,
	MemoryService,
} from "../../plugin/MemoryService.js";

function createMock(memories: Memory[]) {
	const calls: GetRelevantInput[] = [];
	const service = {
		getRelevant(input: GetRelevantInput): Memory[] {
			calls.push(input);
			return memories;
		},
	} as unknown as MemoryService;
	return { calls, service };
}

function mem(type: Memory["type"], content: string): Memory {
	return {
		id: `id-${type}-${content.slice(0, 8)}`,
		type,
		content,
		scope: "project",
		relevanceScore: 0.8,
		createdAt: "2026-01-01 00:00:00",
		updatedAt: "2026-01-01 00:00:00",
	} as Memory;
}

const noopService = {} as unknown as MemoryService;

describe("ContextInjector.deriveQuery", () => {
	const injector = new ContextInjector(noopService);

	it("extracts keywords filtering english stop words", () => {
		const q = injector.deriveQuery([
			{ role: "user", content: "how do I handle authentication?" },
		]);
		expect(q).toBe("handle authentication");
	});

	it("keeps spanish keywords intact", () => {
		const q = injector.deriveQuery([
			{ role: "user", content: "implementa dark mode" },
		]);
		expect(q).toBe("implementa dark mode");
	});

	it("filters 'the' from a fix request", () => {
		const q = injector.deriveQuery([
			{ role: "user", content: "fix the typecheck error" },
		]);
		expect(q).toBe("fix typecheck error");
	});

	it("uses only the last user message", () => {
		const q = injector.deriveQuery([
			{ role: "user", content: "auth login" },
			{ role: "assistant", content: "sure" },
			{ role: "user", content: "fix typecheck" },
		]);
		expect(q).toBe("fix typecheck");
	});

	it("returns empty string when no user messages", () => {
		expect(injector.deriveQuery([])).toBe("");
		expect(
			injector.deriveQuery([{ role: "assistant", content: "hello" }]),
		).toBe("");
	});

	it("returns empty string for empty user content", () => {
		expect(injector.deriveQuery([{ role: "user", content: "" }])).toBe("");
	});
});

describe("ContextInjector.onSystemTransform", () => {
	it("injects <kevin-context> when relevant memories exist", () => {
		const memories = [
			mem("error", "When bash fails with typecheck: TS2304"),
			mem("pattern", "Run typecheck before commit"),
		];
		const { service, calls } = createMock(memories);
		const injector = new ContextInjector(service);
		const output = { system: ["base prompt"] };

		injector.onSystemTransform(
			{ messages: [{ role: "user", content: "fix the typecheck error" }] },
			output,
		);

		expect(output.system.length).toBe(2);
		expect(output.system[1]).toContain("<kevin-context>");
		expect(output.system[1]).toContain("Lecciones relevantes:");
		expect(output.system[1]).toContain(
			"[error] When bash fails with typecheck",
		);
		expect(output.system[1]).toContain("[pattern] Run typecheck before commit");
		expect(output.system[1]).toContain("</kevin-context>");
		expect(calls[0]?.maxTokens).toBe(1500);
		expect(calls[0]?.query).toBe("fix typecheck error");
	});

	it("does not inject when no relevant memories", () => {
		const { service } = createMock([]);
		const injector = new ContextInjector(service);
		const output = { system: ["base prompt"] };

		injector.onSystemTransform(
			{ messages: [{ role: "user", content: "fix typecheck" }] },
			output,
		);
		expect(output.system.length).toBe(1);
	});

	it("does not inject when no user query can be derived", () => {
		const { service, calls } = createMock([mem("error", "x")]);
		const injector = new ContextInjector(service);
		const output = { system: ["base"] };

		injector.onSystemTransform({ messages: [] }, output);
		expect(output.system.length).toBe(1);
		expect(calls.length).toBe(0);
	});
});

describe("ContextInjector.onCompacting", () => {
	it("injects <kevin-memory> into output.context when memories exist", () => {
		const memories = [mem("decision", "use vitest for tests")];
		const { service, calls } = createMock(memories);
		const injector = new ContextInjector(service);
		const output = { context: ["existing"] };

		injector.onCompacting(
			{
				sessionID: "s1",
				messages: [{ role: "user", content: "how do I handle tests" }],
			},
			output,
		);

		expect(output.context.length).toBe(2);
		expect(output.context[1]).toContain("<kevin-memory>");
		expect(output.context[1]).toContain("[decision] use vitest for tests");
		expect(output.context[1]).toContain("</kevin-memory>");
		expect(calls[0]?.maxTokens).toBe(2000);
	});

	it("does not inject when no memories", () => {
		const { service } = createMock([]);
		const injector = new ContextInjector(service);
		const output = { context: [] };

		injector.onCompacting(
			{
				sessionID: "s1",
				messages: [{ role: "user", content: "fix typecheck" }],
			},
			output,
		);
		expect(output.context.length).toBe(0);
	});
});
