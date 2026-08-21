# Token impact — measured, not guessed

**Status:** Replaced by measurement (K10-028; see the roadmap's v1.0.0 scope section)

This document previously carried token-consumption guesses from the
earliest release era. A document of unmeasured claims must not survive
next to a measurement — a reader who finds both will not know which to
believe. Those figures are gone.

## What is published instead

The only quantitative claims Kevin publishes are the measured,
reproducible benchmark results committed at:

    bench/results/2026-08-21-adecbdf4c7af82e2.json

regenerated any time with `npm run bench` over the seeded corpus in
`bench/corpus/` (seed 1262835273). The four-arm outcome recorded there:

| Arm      | precision@5 | recall@5 | MRR  |
| -------- | ----------- | -------- | ---- |
| none     | 0           | 0        | 0    |
| recent-k | 0.05        | 0.026    | 0.109|
| random-k | 0.048       | 0.028    | 0.093|
| kevin    | 0.95        | 0.546    | 1    |

Per-scope latency budgets live in `plugin/perf.ts` (`BUDGETS`) and are
enforced by `npm run bench:check` against real `perf_samples`.

Both limits stated beside the number: the corpus is synthetic, so the
result does not prove real sessions look like it; and retrieval quality
does not prove a surfaced memory changed what the model did.
