import { describe, expect, it, vi } from "vitest";
import { Reflector } from "../../plugin/Reflector.js";

function memoryService(mode: string, save = vi.fn()) {
	const service = {
		getSetting: vi.fn(() => mode),
		save,
	};
	return service as never;
}

const input = {
	toolName: "tsc",
	argsSummary: "command: tsc",
	stderr: "error TS2304: Cannot find name 'x'",
	stdout: "",
	errorType: "typecheck",
	sessionId: "s",
	projectId: "P",
};

describe("K7-017/018 — Reflector error_lesson_mode", () => {
	it("all preserves v0.6 behavior", async () => {
		const save = vi.fn(() => "m1");
		const reflector = new Reflector(memoryService("all", save));
		expect(await reflector.invoke(input)).toBe("m1");
		expect(save).toHaveBeenCalledOnce();
	});

	it("triage_only suppresses an inferable error and reads the setting once", async () => {
		const save = vi.fn(() => "m1");
		const service = memoryService("triage_only", save) as never as {
			getSetting: ReturnType<typeof vi.fn>;
		};
		const reflector = new Reflector(service as never);
		expect(await reflector.invoke(input)).toBeNull();
		expect(save).not.toHaveBeenCalled();
		expect(service.getSetting).toHaveBeenCalledTimes(1);
	});

	it("triage_only keeps a project-specific error lesson", async () => {
		const save = vi.fn(() => "m1");
		const reflector = new Reflector(memoryService("triage_only", save));
		const result = await reflector.invoke({
			...input,
			stderr: "error TS2307: Cannot find module './project-only-file'",
		});
		expect(result).toBe("m1");
		expect(save).toHaveBeenCalledOnce();
	});

	it.each(["0", "false", "ALL", ""])(
		"does not treat %s as triage_only",
		async (mode) => {
			const save = vi.fn(() => "m1");
			const reflector = new Reflector(memoryService(mode, save));
			expect(await reflector.invoke(input)).toBe("m1");
			expect(save).toHaveBeenCalledOnce();
		},
	);
});
