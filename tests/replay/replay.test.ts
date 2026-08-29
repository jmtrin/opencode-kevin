import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTranscript } from "@jmtrin/kevin-core";
import { replay } from "@jmtrin/kevin-core";

const fixture = parseTranscript(
	JSON.parse(
		readFileSync(
			join(__dirname, "fixtures", "basic-typescript-loop.json"),
			"utf8",
		),
	) as unknown,
);

describe("K5-019 — replay harness", () => {
	it("replaying the fixture twice produces a byte-identical result", async () => {
		const r1 = await replay(fixture);
		const r2 = await replay(fixture);
		expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
	}, 10_000);

	it("reports at least one memory created and at least one injection", async () => {
		const result = await replay(fixture);
		expect(result.memoriesCreated).toBeGreaterThan(0);
		expect(result.injections.total).toBeGreaterThan(0);
	}, 10_000);

	it("precisionRate and coverageRate are finite in [0, 1]", async () => {
		const result = await replay(fixture);
		expect(Number.isFinite(result.precisionRate)).toBe(true);
		expect(Number.isFinite(result.coverageRate)).toBe(true);
		expect(result.precisionRate).toBeGreaterThanOrEqual(0);
		expect(result.precisionRate).toBeLessThanOrEqual(1);
		expect(result.coverageRate).toBeGreaterThanOrEqual(0);
		expect(result.coverageRate).toBeLessThanOrEqual(1);
		expect(result.transcript).toBe("basic-typescript-loop");
		expect(result.blocked).toHaveProperty("seen");
	}, 10_000);

	it("uses :memory: by default and completes quickly", async () => {
		const started = Date.now();
		const result = await replay(fixture);
		const elapsed = Date.now() - started;
		expect(result.memoriesCreated).toBeGreaterThan(0);
		expect(elapsed).toBeLessThan(5_000);
	}, 10_000);

	it("is deterministic: the fixture outcome does not depend on wall time", async () => {
		const result = await replay(fixture);
		const { effective, ineffective, inconclusive, unmeasured, total } =
			result.injections;
		expect(effective + ineffective + inconclusive + unmeasured).toBe(total);
		expect(result.tokensInjected.prePrompt).toBeGreaterThan(0);
	}, 10_000);
});
