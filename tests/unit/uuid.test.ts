import { describe, expect, it } from "vitest";
import { uuidv7 } from "../../plugin/uuid.js";

describe("uuidv7", () => {
	it("returns a 36-char string with dashes in the right positions", () => {
		const id = uuidv7();
		expect(id).toHaveLength(36);
		expect(id[8]).toBe("-");
		expect(id[13]).toBe("-");
		expect(id[18]).toBe("-");
		expect(id[23]).toBe("-");
	});

	it("sets version nibble to 7 at position 14", () => {
		const id = uuidv7();
		expect(id[14]).toBe("7");
	});

	it("produces temporally ordered ids (second > first)", async () => {
		const a = uuidv7();
		await new Promise((r) => setTimeout(r, 5));
		const b = uuidv7();
		expect(b > a).toBe(true);
	});

	it("produces unique ids across many calls", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i++) ids.add(uuidv7());
		expect(ids.size).toBe(1000);
	});
});
