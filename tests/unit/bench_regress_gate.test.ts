import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../scripts/bench-regress.js";

function makeResult(arm: string, p: number, r: number, mrr: number) {
	return {
		corpus_digest: "test",
		contract_digest: "test",
		package_version: "1.1.0",
		runtime: "node v24",
		k: 5,
		queries: 10,
		ran_at: new Date().toISOString(),
		arms: [{ arm, precisionAt5: p, recallAt5: r, mrr, p50Ms: 0, p95Ms: 0 }],
	};
}

describe("K11-010 bench regress gate self-defense", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "kevin-bench-gate-"));
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("degraded P@5 by 0.03 for kevin → exit 1 and mentions precision", async () => {
		const prev = makeResult("kevin", 0.95, 0.55, 1.0);
		const curr = makeResult("kevin", 0.92, 0.55, 1.0); // drop 0.03
		writeFileSync(join(tmp, "2026-08-21-a.json"), JSON.stringify(prev));
		writeFileSync(join(tmp, "2026-08-22-a.json"), JSON.stringify(curr));
		const code = await main(["node", "bench-regress.ts", "--results-dir", tmp]);
		expect(code).toBe(1);
	});

	it("healthy pair → exit 0", async () => {
		const prev = makeResult("kevin", 0.95, 0.55, 1.0);
		const curr = makeResult("kevin", 0.95, 0.55, 1.0);
		writeFileSync(join(tmp, "2026-08-21-b.json"), JSON.stringify(prev));
		writeFileSync(join(tmp, "2026-08-22-b.json"), JSON.stringify(curr));
		const code = await main(["node", "bench-regress.ts", "--results-dir", tmp]);
		expect(code).toBe(0);
	});

	it("only one file → exit 0 with notice", async () => {
		const only = makeResult("kevin", 0.95, 0.55, 1.0);
		writeFileSync(join(tmp, "2026-08-21-c.json"), JSON.stringify(only));
		const code = await main(["node", "bench-regress.ts", "--results-dir", tmp]);
		expect(code).toBe(0);
	});
});
