# Benchmark corpus

Synthetic, committed, generated. Do not hand-edit: regenerate instead.

    npm run gen:corpus

- Seed: `1262835273` (xorshift32)
- 400 memories (`memories.jsonl`): statement, type
  (decision/rule/pattern/context/solution), scope (project/session),
  evidence, recurrence, created_at offset in days (0 is newest).
- 120 queries (`queries.jsonl`): `{ id, context: { query, scope },
  relevant: string[] }`.

## Labelling rule (mechanical)

A memory is **relevant** to a query when:

1. its statement shares the query's topic token (one of 20
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
