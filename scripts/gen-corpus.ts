/**
 * K10-014 — seeded synthetic benchmark corpus generator.
 *
 * Emits bench/corpus/{memories.jsonl,queries.jsonl,README.md}. Deterministic:
 * the same seed produces byte-identical output on any machine (xorshift32,
 * no wall clock, no dependency). The labelling rule is mechanical so the
 * ground truth is reproducible rather than a matter of taste — see
 * bench/corpus/README.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemoryScope } from "@jmtrin/kevin-core";
import { fnv1a64 } from "@jmtrin/kevin-core";

export const CORPUS_SEED = 0x4b455649;
export const MEMORY_COUNT = 400;
export const QUERY_COUNT = 120;

/** One distinct token per topic; must survive tokenizeQuery (no stopwords). */
const TOPICS = [
	"lockfile",
	"migration",
	"timeout",
	"retry",
	"auth",
	"regex",
	"encoding",
	"coverage",
	"fixtures",
	"snapshot",
	"mocks",
	"teardown",
	"pool",
	"backfill",
	"schema",
	"cursor",
	"pagination",
	"webhook",
	"circuit",
	"idempotency",
] as const;

const TYPES = ["decision", "rule", "pattern", "context", "solution"] as const;
type CorpusType = (typeof TYPES)[number];

export interface CorpusMemory {
	id: string;
	statement: string;
	type: CorpusType;
	scope: MemoryScope;
	evidence: number;
	recurrence: number;
	/** Days before the benchmark epoch; 0 is newest. */
	ageDays: number;
}

export interface CorpusQuery {
	id: string;
	context: { query: string; scope: MemoryScope };
	/** Labelled ground truth: memory ids a competent human would surface. */
	relevant: string[];
}

function xorshift32(seed: number): () => number {
	let s = seed >>> 0 || 0x9e3779b9;
	return () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 0x100000000;
	};
}

const TEMPLATES: Record<CorpusType, (t: string) => string> = {
	decision: (t) => `Decision: standardize on ${t} handling across services`,
	rule: (t) => `Rule: never merge while ${t} checks are failing`,
	pattern: (t) =>
		`Pattern: incidents cluster around ${t} after dependency bumps`,
	context: (t) => `Context: ${t} configuration lives beside the deploy scripts`,
	solution: (t) => `Solution: pinned versions resolved the ${t} regression`,
};

const FILLERS = [
	"in the release pipeline",
	"during nightly runs",
	"on the staging cluster",
	"after the last upgrade",
	"under sustained load",
	"in cold-start paths",
	"when the cache is empty",
	"across worker restarts",
];

const QUERY_SHAPES = [
	(t: string) => `${t} keeps failing in the pipeline`,
	(t: string) => `what did we decide about ${t}`,
	(t: string) => `incident follow-up on ${t}`,
	(t: string) => `onboarding notes for ${t}`,
	(t: string) => `how was the ${t} issue fixed`,
];

/**
 * The mechanical labelling rule: a memory is relevant to a query when its
 * statement shares the query's topic token AND its scope admits the query's
 * context (same-scope only, mirroring retrieval's scope filter).
 */
export function labelRelevant(
	memories: readonly CorpusMemory[],
	topicToken: string,
	scope: MemoryScope,
): string[] {
	return memories
		.filter(
			(m) =>
				m.scope === scope &&
				m.statement.toLowerCase().split(/\s+/).includes(topicToken),
		)
		.map((m) => m.id);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
	return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(rng: () => number, arr: readonly T[]): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = out[i];
		out[i] = out[j];
		out[j] = tmp;
	}
	return out;
}

export function generateCorpus(seed = CORPUS_SEED): {
	memories: CorpusMemory[];
	queries: CorpusQuery[];
} {
	const rng = xorshift32(seed);
	const memories: CorpusMemory[] = [];
	let n = 0;

	const push = (topicIndex: number, scope: MemoryScope) => {
		const topic = TOPICS[topicIndex % TOPICS.length];
		const type = pick(rng, TYPES);
		n += 1;
		memories.push({
			id: `m${String(n).padStart(4, "0")}`,
			statement: `${TEMPLATES[type](topic)} ${pick(rng, FILLERS)}.`,
			type,
			scope,
			evidence:
				rng() < 0.15 ? 3 + Math.floor(rng() * 4) : Math.floor(rng() * 3),
			recurrence: rng() < 0.25 ? 1 + Math.floor(rng() * 4) : 0,
			ageDays: Math.floor(180 * rng() * rng()),
		});
	};

	for (let t = 0; t < TOPICS.length; t++) {
		push(t, "project");
		push(t, "project");
		push(t, "session");
		push(t, "session");
	}
	while (n < MEMORY_COUNT) push(n, rng() < 0.7 ? "project" : "session");

	const queries: CorpusQuery[] = [];
	const pairs = shuffle(
		rng,
		TOPICS.flatMap((t) =>
			(["project", "session"] as const).map((scope) => ({ topic: t, scope })),
		),
	);
	let q = 0;
	const emit = (pair: { topic: string; scope: MemoryScope }) => {
		q += 1;
		queries.push({
			id: `q${String(q).padStart(3, "0")}`,
			context: {
				query: pick(rng, QUERY_SHAPES)(pair.topic),
				scope: pair.scope,
			},
			relevant: labelRelevant(memories, pair.topic, pair.scope),
		});
	};
	for (let i = 0; i < QUERY_COUNT; i++) emit(pairs[i % pairs.length]);

	return { memories, queries };
}

/** fnv1a64 over both JSONL payloads — printed with every bench result. */
export function corpusDigest(
	memoriesJsonl: string,
	queriesJsonl: string,
): string {
	return fnv1a64(`${memoriesJsonl}\n${queriesJsonl}`);
}

export function loadCorpus(dir: string): {
	memories: CorpusMemory[];
	queries: CorpusQuery[];
	digest: string;
} {
	const memoriesJsonl = readFileSync(join(dir, "memories.jsonl"), "utf8");
	const queriesJsonl = readFileSync(join(dir, "queries.jsonl"), "utf8");
	return {
		memories: memoriesJsonl
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l) as CorpusMemory),
		queries: queriesJsonl
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l) as CorpusQuery),
		digest: corpusDigest(memoriesJsonl, queriesJsonl),
	};
}

function readme(seed: number): string {
	return `# Benchmark corpus

Synthetic, committed, generated. Do not hand-edit: regenerate instead.

    npm run gen:corpus

- Seed: \`${seed}\` (xorshift32)
- ${MEMORY_COUNT} memories (\`memories.jsonl\`): statement, type
  (decision/rule/pattern/context/solution), scope (project/session),
  evidence, recurrence, created_at offset in days (0 is newest).
- ${QUERY_COUNT} queries (\`queries.jsonl\`): \`{ id, context: { query, scope },
  relevant: string[] }\`.

## Labelling rule (mechanical)

A memory is **relevant** to a query when:

1. its statement shares the query's topic token (one of ${TOPICS.length}
   fixed single-word topics embedded verbatim in every statement), and
2. its scope admits the query's context — same scope only, mirroring
   retrieval's scope filter.

No human judgement enters the labels; any machine regenerating this
directory derives identical ones.

## What the benchmark does and does not prove

The four-arm harness over this corpus measures whether Kevin's ranking
beats recency and randomness at surfacing labelled-relevant memories. It
does **not** prove that real sessions look like this corpus, nor that a
surfaced memory changed what the model did. Those limits travel with the
result wherever it is published.
`;
}

function main(): void {
	const dir = join(
		fileURLToPath(new URL(".", import.meta.url)),
		"..",
		"bench",
		"corpus",
	);
	const { memories, queries } = generateCorpus();
	mkdirSync(dir, { recursive: true });
	const memoriesJsonl = memories.map((m) => JSON.stringify(m)).join("\n");
	const queriesJsonl = queries.map((q) => JSON.stringify(q)).join("\n");
	writeFileSync(join(dir, "memories.jsonl"), `${memoriesJsonl}\n`);
	writeFileSync(join(dir, "queries.jsonl"), `${queriesJsonl}\n`);
	const digest = corpusDigest(`${memoriesJsonl}\n`, `${queriesJsonl}\n`);
	writeFileSync(join(dir, "README.md"), readme(CORPUS_SEED));
	console.log(
		`gen-corpus: ${memories.length} memories, ${queries.length} queries, seed ${CORPUS_SEED}, digest ${digest}`,
	);
}

if (process.argv[1]?.endsWith("gen-corpus.ts")) main();
