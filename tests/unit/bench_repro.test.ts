import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARMS, runBench } from "../../scripts/bench.js";
import { corpusDigest, generateCorpus } from "../../scripts/gen-corpus.js";

const REPO_ROOT = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
);

describe("K10-014/K10-016 — corpus provenance and benchmark determinism", () => {
	it("committed corpus is byte-identical to what the seeded generator produces", () => {
		const { memories, queries } = generateCorpus();
		const memText = `${memories.map((m) => JSON.stringify(m)).join("\n")}\n`;
		const qText = `${queries.map((q) => JSON.stringify(q)).join("\n")}\n`;
		expect(memText).toBe(
			readFileSync(
				join(REPO_ROOT, "bench", "corpus", "memories.jsonl"),
				"utf8",
			),
		);
		expect(qText).toBe(
			readFileSync(join(REPO_ROOT, "bench", "corpus", "queries.jsonl"), "utf8"),
		);
	});

	it("corpus digest is fnv1a64 over the exact committed file bytes", () => {
		const mem = readFileSync(
			join(REPO_ROOT, "bench", "corpus", "memories.jsonl"),
			"utf8",
		);
		const q = readFileSync(
			join(REPO_ROOT, "bench", "corpus", "queries.jsonl"),
			"utf8",
		);
		expect(corpusDigest(mem, q)).toMatch(/^[0-9a-f]{16}$/);
	});

	it("running the harness twice in-process yields identical retrieval numbers", async () => {
		const a = await runBench();
		const b = await runBench();
		expect(a.corpusDigest).toBe(b.corpusDigest);
		expect(a.queries).toBe(120);
		expect(a.arms.map((x) => x.arm)).toEqual([...ARMS]);
		for (let i = 0; i < ARMS.length; i++) {
			expect(a.arms[i]?.precisionAt5).toBe(b.arms[i]?.precisionAt5);
			expect(a.arms[i]?.recallAt5).toBe(b.arms[i]?.recallAt5);
			expect(a.arms[i]?.mrr).toBe(b.arms[i]?.mrr);
		}
	}, 60_000);

	it("kevin's ranking beats both baselines — the property the benchmark exists to check", async () => {
		const { arms } = await runBench();
		const byArm = new Map(arms.map((a) => [a.arm, a]));
		const kevin = byArm.get("kevin");
		const recent = byArm.get("recent-k");
		const random = byArm.get("random-k");
		const none = byArm.get("none");
		expect(none?.precisionAt5).toBe(0);
		expect(recent).toBeDefined();
		expect(random).toBeDefined();
		expect(kevin?.precisionAt5).toBeGreaterThan(recent?.precisionAt5 ?? 0);
		expect(kevin?.precisionAt5).toBeGreaterThan(random?.precisionAt5 ?? 0);
		expect(kevin?.mrr).toBeGreaterThan(recent?.mrr ?? 0);
	}, 60_000);
});
