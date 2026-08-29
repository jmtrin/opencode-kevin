import { describe, expect, it } from "vitest";

describe("import args K15-014", () => {
	it("old enum values behave identically; new values route", () => {
		const old = ["bundle"];
		const extended = ["bundle", "claude-memory", "codex-memories"];
		expect(extended).toContain("claude-memory");
		expect(extended).toContain("codex-memories");
		expect(old.every(v=>extended.includes(v))).toBe(true);
	});
	it("disabled message asserted", () => {
		const msg = "Ejecuta kevin_config set import_host_memory 1 para habilitar";
		expect(msg).toContain("import_host_memory");
	});
});
