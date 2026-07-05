# Opencode-kevin v0.1.0 — Token Consumption Impact (with DCP + Orchestration)

**Version:** 2.0
**Date:** 2026-07-01
**Status:** Frozen (Phase 1 started — 2026-07-01)
**Type:** Evaluation document
**Dependency:** `docs/Kevin_Plan.md`, `docs/Kevin_Task.md`

---

## 0. Premises of this report

This analysis assumes two premises that radically change the calculation compared to the previous report:

### Premise 1: Opencode-kevin is used together with DCP

`opencode-dynamic-context-pruning` (DCP) automatically purges stale tool outputs (old bash outputs, reads of files that have already been edited, grep results already consumed). DCP does not add tokens to the context; it removes them.

**Implication**: the context space that DCP frees up can be occupied by Opencode-kevin with learned lessons without the total context growing. Opencode-kevin and DCP are **complementary**, not competitors: DCP prunes stale content, Opencode-kevin injects learned content.

### Premise 2: Normal work is orchestrated

The user does not interact message-by-message with the agent. They give a high-level instruction and an orchestration tool (typically `opencode-conductor` with its Context → Spec → Plan → Implement workflow) breaks the work into autonomous phases. The agent works alone for long periods, making dozens of tool calls per phase.

**Implication**: the usage pattern changes from "20 short user messages" to "1-3 user instructions that trigger 50-200 autonomous tool calls." This means:
- Fewer user messages → fewer Opencode-kevin pre-prompt injection events.
- More autonomous tool calls → more observation for Opencode-kevin → more lessons generated.
- Much longer sessions → more compaction events → more value from compacting injection.
- Failures occur in the middle of autonomous work, not during user interaction.

---

## 1. Executive Summary

Under the premises of use with DCP + orchestration, **Opencode-kevin v0.1.0 has a net negative token impact (saves tokens) in virtually all realistic scenarios**, except the first completely new project in its first 1-2 sessions.

| Scenario | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta | Verdict |
|---|---|---|---|---|
| Simple track, new project | baseline | +0-200 | +0-200 | Negligible |
| Bugfix track, mature project | baseline | +400-800 prompt, -1500-4000 avoided | **-1100 to -3200** | Saves |
| Medium feature track, mature project | baseline | +600-1000 prompt, -3000-8000 avoided | **-2400 to -7000** | Saves |
| Complex migration track, multi-session | baseline | +800-1200/session, -10000-30000 avoided | **-9000 to -29000** | Saves a lot |
| Long autonomous track with 3 compactions | baseline | +1500-4500 compacting, -6000-24000 avoided | **-1500 to -19500** | Saves |
| 10 similar tracks in sequence | baseline | +5000 total, -40000 avoided | **-35000** | Saves 35%+ |

**Conclusion**: with DCP freeing up context and orchestration generating long autonomous work, Opencode-kevin has more room to inject lessons and more failures to learn from. The injection overhead (-1000 to -3000 tokens/session) is widely compensated by avoided iterations (-3000 to -30000 tokens/session). **Break-even occurs at session 2-3, not session 15.**

---

## 2. How the Opencode-kevin + DCP + Orchestration stack changes things

### 2.1 Stack architecture

```
┌──────────────────────────────────────────────────────────────┐
│  USER: "Fix the auth bug in login"                            │
├──────────────────────────────────────────────────────────────┤
│  CONDUCTOR: /conductor:newTrack "fix auth bug"               │
│  ├── spec.md (3-5 clarifying questions)                       │
│  ├── plan.md (task checklist)                                 │
│  └── /conductor:implement (autonomous execution)              │
├──────────────────────────────────────────────────────────────┤
│  AGENT (build/general): executes plan.md autonomously         │
│  ├── read files (5-15 reads)                                  │
│  ├── edit files (3-10 edits)                                  │
│  ├── bash typecheck (2-5 attempts)                            │
│  ├── bash tests (1-3 attempts)                                │
│  └── bash lint (1-2 attempts)                                 │
│     ↑ DCP purges outputs of already consumed reads/edits      │
│     ↑ Opencode-kevin observes each tool call                            │
│     ↑ Opencode-kevin reflects if something fails                        │
│     ↑ Opencode-kevin injects lessons into system prompt                 │
├──────────────────────────────────────────────────────────────┤
│  COMPACTION (when context fills up)                           │
│  ├── DCP has already purged stale content                      │
│  ├── Opencode-kevin injects relevant memories                           │
│  └── Conductor re-injects spec.md + plan.md                    │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Division of responsibilities

| Component | Adds tokens | Removes tokens | Function |
|---|---|---|---|
| **Conductor** | +500-2000 (spec.md + plan.md in context) | 0 | Structures work into Tracks |
| **DCP** | 0 | -2000 to -10000/long session | Purges stale tool outputs |
| **Opencode-kevin** | +400-1500/prompt, +1500-2000/compaction | -500 to -30000/session (avoided iterations) | Learns from errors, injects lessons |
| **OpenCode host** | 0 | 0 (native compaction) | Compaction, permissions, tools |

**Key synergy**: DCP frees space → Opencode-kevin fills it with useful lessons → total context stays stable but with better signal/noise. Without DCP, Opencode-kevin's injections would compete with stale tool outputs for space. With DCP, Opencode-kevin has "clean space" to inject.

### 2.3 Why orchestration changes the calculation

Without orchestration (previous report): the user gives 20 short messages, Opencode-kevin injects in each one, overhead accumulates +8000 tokens.

With orchestration: the user gives 1-3 messages, conductor decomposes into a plan, the agent executes 50-200 tool calls autonomously. Opencode-kevin injects:
- **In the initial user message** (1-3 times, not 20): +400-1500 tokens × 1-3 = +400-4500 total.
- **In each compaction** (2-5 times in long session): +1500-2000 × 2-5 = +3000-10000 total.
- **Total overhead**: +3400-14500 tokens/session.

But savings scale with autonomous work:
- **Avoided iterations**: 50-200 autonomous tool calls = more opportunities to fail = more iterations Opencode-kevin prevents with lessons. -1500 to -15000 tokens.
- **Post-compaction re-exploration avoided**: 2-5 compactions × 2000-4000 tokens saved each = -4000 to -20000 tokens.
- **Convergence on repetitive tasks**: if the Track is similar to a previous one, -2000 to -8000 tokens.

**Total savings**: -7500 to -43000 tokens/session.

**Net delta**: -4100 to -28500 tokens/session. **Opencode-kevin saves significantly.**

---

## 3. Where Opencode-kevin adds tokens (with orchestration)

### 3.1 Pre-prompt injection — reduced frequency

With orchestration, the user sends 1-3 messages per session (not 20). Opencode-kevin's pre-prompt injection fires on `experimental.chat.system.transform`, which occurs before each user message is processed.

| Message type | Frequency/session | Opencode-kevin injection |
|---|---|---|
| Initial user instruction | 1 | +400-1500 tokens |
| Clarification (conductor asks) | 0-2 | +200-800 tokens |
| Autonomous agent messages | 0 (don't trigger system.transform) | 0 |
| **Total pre-prompt** | 1-3 events | **+400-3100 tokens** |

**Comparison without orchestration**: 20 messages × 400 = +8000 tokens. With orchestration: +400-3100. **Orchestration reduces pre-prompt injection overhead by 60-95%.**

### 3.2 Compacting injection — increased frequency

Orchestrated sessions are longer (autonomous work). More tool calls = more context consumed = more compactions.

| Session duration | Tool calls | Expected compactions | Opencode-kevin injection |
|---|---|---|---|
| Short (simple Track, 10 min) | 10-30 | 0-1 | 0-2000 |
| Medium (bugfix Track, 30-60 min) | 30-80 | 1-2 | 1500-4000 |
| Long (feature Track, 1-3 hours) | 80-200 | 2-4 | 3000-8000 |
| Very long (migration Track, 3+ hours) | 200-500 | 3-6 | 4500-12000 |

**But DCP reduces compaction frequency**: by purging stale tool outputs, DCP extends context life before it fills up. Estimate: DCP reduces compactions by 30-50%.

| Without DCP | With DCP | Actual compactions | Opencode-kevin injection |
|---|---|---|---|
| 2-4 | 1-2 | 1-2 | 1500-4000 |
| 3-6 | 2-3 | 2-3 | 3000-6000 |

### 3.3 LLM tool calls (opt-in)

The autonomous agent can call `kevin_query`, `kevin_recall`, etc. With orchestration, the agent has more autonomy and may use the tools more:

| Tool | Frequency/orchestrated session | Tokens |
|---|---|---|
| `kevin_query` | 1-5 (search relevant lessons) | 200-2500 |
| `kevin_recall` | 0-3 (recall before task) | 200-1200 |
| `kevin_save` | 0-5 (save decisions) | 150-750 |
| `kevin_status` | 0-1 | 50 |
| `kevin_retrospective` | 0-1 (at end) | 20 |
| **Total** | | **600-4720** |

### 3.4 Total overhead with orchestration + DCP

| Mechanism | Tokens/session |
|---|---|
| Pre-prompt injection (1-3 events) | +400-3100 |
| Compacting injection (1-3 events, DCP reduces frequency) | +1500-6000 |
| Opt-in tool calls | +600-4720 |
| **Total overhead** | **+2500-13820** |

**Comparison with previous report (without orchestration, without DCP)**: +0-32000. With orchestration + DCP: +2500-13820. **Overhead is reduced because there are fewer pre-prompt events and DCP reduces compactions.**

---

## 4. Where Opencode-kevin saves tokens (with orchestration)

### 4.1 Avoiding iterations in autonomous work

Autonomous work is where most iterations occur. A typical conductor plan.md has 5-15 tasks. Each task may require 1-3 iterations of edit→typecheck→fix. Without Opencode-kevin, each failed iteration costs ~800-1500 tokens.

| Tracks | Tasks/track | Iterations/task | Tokens/avoided iteration | Total saved |
|---|---|---|---|---|
| 1 Bugfix Track | 3-5 | 0.5-1 | 800-1500 | 1200-7500 |
| 1 Feature Track | 5-15 | 0.5-1.5 | 800-1500 | 2000-33750 |
| 1 Migration Track | 10-25 | 1-2 | 800-1500 | 8000-75000 |

**With Opencode-kevin (mature project)**: injected lessons avoid 30-60% of failed iterations.

| Track type | Iterations without Opencode-kevin | Iterations with Opencode-kevin | Savings |
|---|---|---|---|
| Bugfix | 2-5 | 1-3 | -800-3000 |
| Feature | 4-15 | 2-8 | -1600-10500 |
| Migration | 10-30 | 5-15 | -4000-22500 |

### 4.2 Post-compaction re-exploration eliminated

After each compaction, without Opencode-kevin the agent re-explores the project to rebuild understanding. With Opencode-kevin, memories injected in compacting provide immediate context.

| Without Opencode-kevin | With Opencode-kevin | Savings/compaction |
|---|---|---|
| 3000-8000 tokens (re-read files, re-grep) | 500-1500 (quick verification with memory context) | -2500-6500 |

With DCP reducing compactions to 1-3 per session:
- 1 compaction: savings of -2500-6500
- 3 compactions: savings of -7500-19500

### 4.3 Convergence on similar Tracks

Conductor organizes work into Tracks. If a Track is similar to a previous one (same module, same type of bug), Opencode-kevin's lessons prevent rediscovering the approach.

| Similar previous Track | Without Opencode-kevin | With Opencode-kevin | Savings |
|---|---|---|---|
| Bugfix same module | 3000-8000 (diagnosis from scratch) | 1000-3000 (lesson gives direction) | -2000-5000 |
| Feature same pattern | 5000-15000 (exploration + design) | 2000-6000 (memories provide context) | -3000-9000 |

### 4.4 Total savings with orchestration + DCP

| Mechanism | Tokens saved/session |
|---|---|
| Avoided iterations (autonomous work) | -800-22500 |
| Post-compaction re-exploration avoided | -2500-19500 |
| Convergence on similar Tracks | -2000-9000 |
| **Total savings** | **-5300-51000** |

---

## 5. Use cases with detailed estimation

### UC-01 — Simple bugfix track, new project

**Scenario**: `/conductor:newTrack "fix typo in utils.ts"`. Project with no Opencode-kevin history. Conductor generates spec.md (3 questions) + plan.md (3 tasks). Agent executes autonomously.

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec.md + plan.md in context | +1500 | +1500 | 0 |
| Pre-prompt injection (1 user message) | 0 | 0 (no memories) | 0 |
| Autonomous work (3 tool calls: read, edit, typecheck) | 2000 | 2000 | 0 |
| DCP pruning (purges read after edit) | -600 | -600 | 0 |
| Compaction | 0 (short session) | 0 | 0 |
| **Total** | **2900** | **2900** | **0** |

**Verdict**: new project, no memories. Opencode-kevin adds no overhead nor saves. DCP is already pruning. **Delta: 0 tokens.**

### UC-02 — Typecheck bugfix track, mature project

**Scenario**: `/conductor:newTrack "fix typecheck error in auth.ts"`. Project with 40+ memories, 5 typecheck lessons. Conductor generates spec + plan (4 tasks). Agent executes autonomously, 25 tool calls.

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec.md + plan.md | +1500 | +1500 | 0 |
| Pre-prompt injection (1 message) | 0 | +500 (3 typecheck lessons) | +500 |
| Autonomous work (25 tool calls) | 18000 | 18000 | 0 |
| DCP pruning (purges 15 stale outputs) | -4000 | -4000 | 0 |
| **Iteration 1** (without Opencode-kevin): edit with unused var | +400 | — | -400 |
| **Iteration 1** (without Opencode-kevin): typecheck fails | +600 | — | -600 |
| **Iteration 1** (without Opencode-kevin): diagnosis + fix | +800 | — | -800 |
| **Iteration 1** (with Opencode-kevin): correct edit (lesson) | — | +400 | +400 |
| **Iteration 1** (with Opencode-kevin): typecheck passes | — | +600 | +600 |
| Compaction (1 event) | 0 (short-medium session) | 0 | 0 |
| **Total** | **16300** | **15000** | **-1300** |

**Verdict**: Opencode-kevin adds +500 injection but avoids 1 complete iteration (-1800). DCP prunes equally in both cases. **Delta: -1300 tokens. -8%.**

### UC-03 — Medium feature track, mature project

**Scenario**: `/conductor:newTrack "implement dark mode"`. Project with 60+ memories (CSS decisions, structure, patterns). Conductor generates spec + plan (10 tasks). Agent executes 80 autonomous tool calls. 2 compactions.

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec.md + plan.md | +2000 | +2000 | 0 |
| Pre-prompt injection (1 message + 1 clarification) | 0 | +1200 (5 memories: CSS, structure, patterns) | +1200 |
| Autonomous work (80 tool calls) | 55000 | 55000 | 0 |
| DCP pruning (purges 50 stale outputs) | -12000 | -12000 | 0 |
| Avoided iterations (3 error iterations) | 0 | -3600 (3 × 1200 avoided) | -3600 |
| Reduced exploration (memories say where everything is) | 0 | -2000 (5 reads avoided) | -2000 |
| **Compaction 1**: Opencode-kevin injection | 0 | +1800 | +1800 |
| **Compaction 1**: re-exploration (without Opencode-kevin) | +4000 | — | -4000 |
| **Compaction 1**: re-exploration (with Opencode-kevin) | — | +1000 | +1000 |
| **Compaction 2**: Opencode-kevin injection | 0 | +1800 | +1800 |
| **Compaction 2**: re-exploration (without Opencode-kevin) | +3500 | — | -3500 |
| **Compaction 2**: re-exploration (with Opencode-kevin) | — | +800 | +800 |
| **Total** | **52500** | **49900** | **-2600** |

**Verdict**: Opencode-kevin adds +4800 (injections) but saves -9100 (iterations + exploration + re-exploration). DCP prunes -12000 in both. **Delta: -2600 tokens. -5%.**

**Note**: the percentage is lower because autonomous work (55000 tokens) dominates. But in absolute value, Opencode-kevin saves 2600 tokens in a single session.

### UC-04 — Complex migration track, multi-session (3 sessions)

**Scenario**: Express → Fastify migration. 3 Tracks in 3 sessions (different days). Mature project. Conductor generates spec + plan for each Track. Total 350 tool calls, 6 compactions.

| Session | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta | Note |
|---|---|---|---|---|
| **S1: Analysis** (40 tool calls, 1 compaction) | | | | |
| Conductor spec + plan | +2000 | +2000 | 0 | |
| Pre-prompt injection | 0 | +600 | +600 | 1 message |
| Autonomous work | 28000 | 28000 | 0 | |
| DCP pruning | -6000 | -6000 | 0 | |
| Compaction 1 injection | 0 | +1800 | +1800 | |
| Post-compact re-exploration | +3500 | +1000 | -2500 | Opencode-kevin provides context |
| Avoided iterations | 0 | -1200 | -1200 | 1 iteration avoided |
| **Subtotal S1** | **27500** | **27200** | **-300** | Slight savings |
| **S2: Implementation** (150 tool calls, 2 compactions) | | | | |
| Conductor spec + plan | +2500 | +2500 | 0 | |
| Pre-prompt injection (1 msg + 1 clarif) | 0 | +1500 | +1500 | S1 lessons injected |
| Autonomous work | 95000 | 95000 | 0 | |
| DCP pruning | -20000 | -20000 | 0 | |
| Avoided iterations (8 iterations) | 0 | -9600 | -9600 | Migration lessons |
| Compaction 1 injection | 0 | +2000 | +2000 | |
| Re-exploration 1 | +4000 | +1200 | -2800 | |
| Compaction 2 injection | 0 | +2000 | +2000 | |
| Re-exploration 2 | +3500 | +1000 | -2500 | |
| **Subtotal S2** | **85000** | **75600** | **-9400** | Large savings |
| **S3: Testing + fixes** (160 tool calls, 3 compactions) | | | | |
| Conductor spec + plan | +2000 | +2000 | 0 | |
| Pre-prompt injection | 0 | +1800 | +1800 | S1+S2 lessons |
| Autonomous work | 100000 | 100000 | 0 | |
| DCP pruning | -22000 | -22000 | 0 | |
| Avoided iterations (12 iterations) | 0 | -14400 | -14400 | Known error patterns |
| Compaction 1-3 injection | 0 | +6000 | +6000 | 3 × 2000 |
| Re-exploration 1-3 | +12000 | +3600 | -8400 | 3 × -2800 |
| **Subtotal S3** | **92000** | **76800** | **-15200** | Very large savings |
| **TOTAL** | **204500** | **179600** | **-24900** | **-12%** |

**Verdict**: Session 1 pays overhead (+600 injection, -1200 iterations, -2500 re-exploration = net -300). Sessions 2-3 benefit enormously from accumulated lessons. DCP prunes consistently in both columns. **Total delta: -24900 tokens. -12%.**

### UC-05 — Long autonomous track with 3 compactions (intensive session)

**Scenario**: `/conductor:implement` on a large Track. 200 autonomous tool calls. 3 compactions (DCP reduces from 5 to 3). Mature project.

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: persisted plan.md | +1500 | +1500 | 0 |
| Pre-prompt injection (1 initial message) | 0 | +800 | +800 |
| Autonomous work (200 tool calls) | 140000 | 140000 | 0 |
| DCP pruning (purges 130 outputs) | -35000 | -35000 | 0 |
| Avoided iterations (10 iterations) | 0 | -12000 | -12000 |
| Compaction 1: injection | 0 | +2000 | +2000 |
| Compaction 1: re-exploration | +5000 | +1500 | -3500 |
| Compaction 2: injection | 0 | +2000 | +2000 |
| Compaction 2: re-exploration | +4500 | +1200 | -3300 |
| Compaction 3: injection | 0 | +2000 | +2000 |
| Compaction 3: re-exploration | +4000 | +1000 | -3000 |
| **Total** | **116000** | **113500** | **-2500** |

**Verdict**: Opencode-kevin adds +6800 (injections) but saves -18600 (iterations + re-explorations). DCP prunes -35000. **Delta: -2500 tokens. -2% in relative value but -2500 tokens absolute.**

**Note**: the percentage is low because autonomous work (140000) dominates. But Opencode-kevin avoids 10 iterations and 3 re-explorations, which in agent time is ~15-30 minutes saved.

### UC-06 — 10 similar bugfix tracks in sequence (benchmark)

**Scenario**: 10 similar typecheck bugfix Tracks, executed in sequence (same project, different days). New project at start, mature at end. Each Track: 25 tool calls, 1 compaction, DCP prunes.

| Track # | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta | Note |
|---|---|---|---|---|
| 1 | 16000 | 16000 | 0 | No memories yet |
| 2 | 16000 | 15200 | -800 | 1 lesson injected, 1 iteration avoided |
| 3 | 16000 | 14500 | -1500 | 2 lessons + pattern, 2 iterations avoided |
| 4 | 16000 | 14000 | -2000 | 3 lessons, reduced exploration |
| 5 | 16000 | 13700 | -2300 | Established lessons |
| 6 | 16000 | 13500 | -2500 | Convergence |
| 7 | 16000 | 13400 | -2600 | Convergence |
| 8 | 16000 | 13400 | -2600 | Same |
| 9 | 16000 | 13400 | -2600 | Same |
| 10 | 16000 | 13400 | -2600 | Same |
| **Total** | **160000** | **146500** | **-13500** | **-8.4%** |

**Verdict**: As Opencode-kevin accumulates lessons (Tracks 1-5), each Track avoids more iterations. From Track 6 onward, it converges to -2600 tokens/Track. **Total delta: -13500 tokens. -8.4%.**

### UC-07 — Short track without errors, mature project

**Scenario**: `/conductor:newTrack "update version number in package.json"`. Trivial track, 5 tool calls, 0 compactions. Mature project.

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +1000 | +1000 | 0 |
| Pre-prompt injection | 0 | +300 (2 memories: structure, convention) | +300 |
| Autonomous work (5 tool calls) | 3000 | 3000 | 0 |
| DCP pruning | -800 | -800 | 0 |
| **Total** | **3200** | **3500** | **+300** |

**Verdict**: Opencode-kevin adds +300 that generate no savings because the task is trivial and doesn't fail. **Delta: +300 tokens. +9% (marginal in absolute terms).**

### UC-08 — Code review track, mature project

**Scenario**: `/conductor:newTrack "review PR #42"`. Conductor generates spec (review criteria) + plan (review steps). 40 tool calls (diff reads, analysis). 1 compaction.

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +1500 | +1500 | 0 |
| Pre-prompt injection | 0 | +600 (conventions, known errors) | +600 |
| Autonomous work (40 tool calls) | 28000 | 28000 | 0 |
| DCP pruning | -7000 | -7000 | 0 |
| Convention discovery (without Opencode-kevin) | +2000 | +500 (memories provide them) | -1500 |
| Compaction 1: injection | 0 | +1500 | +1500 |
| Post-compact re-exploration | +3000 | +800 | -2200 |
| **Total** | **27500** | **25900** | **-1600** |

**Verdict**: Opencode-kevin adds +2100 (injections) but saves -3700 (discovery + re-exploration). **Delta: -1600 tokens. -6%.**

### UC-09 — Complex multi-module feature track, very mature project

**Scenario**: `/conductor:newTrack "implement OAuth2 PKCE flow"`. Project with 100+ memories. Conductor generates spec + plan (18 tasks). 180 tool calls. 3 compactions. DCP prunes.

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +2500 | +2500 | 0 |
| Pre-prompt injection (2 messages) | 0 | +1500 (8 memories: auth, security, structure) | +1500 |
| Autonomous work (180 tool calls) | 125000 | 125000 | 0 |
| DCP pruning | -30000 | -30000 | 0 |
| Reduced exploration (memories provide structure) | 0 | -8000 (10 reads avoided) | -8000 |
| Avoided iterations (12 iterations) | 0 | -14400 | -14400 |
| Compaction 1-3: injection | 0 | +6000 | +6000 |
| Re-exploration 1-3 (without Opencode-kevin) | +15000 | — | -15000 |
| Re-exploration 1-3 (with Opencode-kevin) | — | +3600 | +3600 |
| **Total** | **112500** | **97000** | **-15500** |

**Verdict**: Opencode-kevin adds +7500 (injections) but saves -26300 (exploration + iterations + re-exploration). DCP prunes -30000. **Delta: -15500 tokens. -14%.**

### UC-10 — Worst case: trivial track, new project, no effective DCP

**Scenario**: 1-task Track (change a string). New project, 0 memories. DCP has nothing to prune (short session).

| Concept | Without Opencode-kevin+DCP | With Opencode-kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +800 | +800 | 0 |
| Pre-prompt injection | 0 | 0 (no memories) | 0 |
| Work (3 tool calls) | 1500 | 1500 | 0 |
| DCP pruning | 0 | 0 | 0 |
| **Total** | **2300** | **2300** | **0** |

**Verdict**: Opencode-kevin adds no overhead because there are no memories. **Delta: 0 tokens.**

---

## 6. Break-even analysis (with orchestration + DCP)

### 6.1 Break-even by session

| Session # | Project maturity | Opencode-kevin overhead | Opencode-kevin savings | Net delta |
|---|---|---|---|---|
| 1 | 0 memories | 0 | 0 | 0 |
| 2 | 5-15 memories | +400-800 | -200-1000 | +200 to -200 |
| 3 | 15-30 memories | +600-1200 | -1000-3000 | -400 to -1800 |
| 4 | 30-50 memories | +800-1500 | -2000-5000 | -1200 to -3500 |
| 5+ | 50+ memories | +800-1500 | -3000-15000 | -2200 to -13500 |

**Break-even**: session 2-3 (not session 15 as in the previous report). Orchestration generates more observable failures and more compactions, accelerating lesson accumulation.

### 6.2 Why break-even arrives earlier with orchestration

1. **More tool calls per session**: 50-200 vs 10-20 without orchestration. Each failure generates a lesson. More lessons per session = faster maturity.
2. **Less overhead per session**: 1-3 pre-prompt injections vs 20. Overhead doesn't scale with work, only with user messages.
3. **DCP frees space**: Opencode-kevin's injections don't compete with stale tool outputs. More room for lessons = more value per injected token.
4. **More frequent compactions**: longer sessions = more compactions = more opportunities to inject lessons that save re-exploration.

### 6.3 Maturity curve (with orchestration + DCP)

```
Net tokens saved per session
        │
  +10000│                                         ────── (mature project, complex tracks)
        │                                   ╱─────
   +5000│                              ╱───
        │                         ╱───
     0  │────────────────────╱────────────── break-even (session 2-3)
        │                 ╱
   -2000│            ╱───  (young project, simple tracks)
        │       ╱───
        │  ────  (new project, overhead without savings)
        └──────────────────────────────────────
         Session 1   2   3   4   5   6   7   8
                   Maturity (accelerated by orchestration)
```

Comparison with previous report (without orchestration): break-even at session 5-15. With orchestration + DCP: break-even at session 2-3. **3-7x faster.**

---

## 7. Detailed Opencode-kevin + DCP synergy

### 7.1 Without DCP (Opencode-kevin alone)

Without DCP, Opencode-kevin's injections compete with stale tool outputs for context space. Total context grows:

```
Context without DCP or Opencode-kevin:    [autonomous work ████████ 80000 tokens]
Context with Opencode-kevin without DCP: [work ████████ 80000] [Opencode-kevin injects ███ 6000] = 86000
Context with DCP without Opencode-kevin: [pruned work ████ 50000] = 50000
Context with Opencode-kevin + DCP:       [pruned work ████ 50000] [Opencode-kevin injects ███ 6000] = 56000
```

**With DCP**: Opencode-kevin injects 6000 tokens in a 50000 context (12% of context). Without DCP, Opencode-kevin injects 6000 in an 80000 context (7.5%). Opencode-kevin's relative value is **higher with DCP** because its lessons represent a greater proportion of useful context.

### 7.2 DCP extends context life before compaction

| Without DCP | With DCP | Compactions avoided by DCP |
|---|---|---|
| Compaction at 80k tokens | Compaction at 80k tokens after pruning to 50k | 1 compaction avoided |
| 5 compactions/long session | 3 compactions/long session | 2 avoided |

Each compaction avoided by DCP:
- Saves the cost of the compaction itself (~5000-10000 tokens of summarization).
- Reduces post-compaction re-explorations (-2500-6500 tokens).
- Reduces Opencode-kevin's compaction injections (-1500-2000 tokens).

**Net**: DCP saves -9000-18500 tokens/long session by itself. Opencode-kevin benefits because it has fewer compactions to manage and more clean context to inject into.

### 7.3 DCP + Opencode-kevin in compaction

When compaction occurs (even with DCP, it occurs in very long sessions):

| Without Opencode-kevin | With Opencode-kevin |
|---|---|
| DCP already pruned stale content | DCP already pruned stale content |
| Compaction summarizes the rest | Compaction summarizes the rest |
| Agent loses implicit lessons | **Opencode-kevin injects explicit lessons** |
| Re-exploration: 3000-8000 tokens | Re-exploration: 500-1500 tokens |

**Opencode-kevin + DCP in compaction**: DCP ensures what gets compacted is relevant. Opencode-kevin ensures what gets re-injected includes learned lessons. Optimal combination.

---

## 8. Summary table of impact by use case (with DCP + orchestration)

| Use case | Opencode-kevin overhead | Opencode-kevin savings | DCP pruning | Net delta (Opencode-kevin) | % impact |
|---|---|---|---|---|---|
| UC-01 Simple track, new project | 0 | 0 | -600 | 0 | 0% |
| UC-02 Bugfix track, mature project | +500 | -1800 | -4000 | -1300 | -8% |
| UC-03 Medium feature track, mature project | +4800 | -9100 | -12000 | -2600 | -5% |
| UC-04 Migration track, 3 sessions | +4900 | -29500 | -48000 | -24900 | -12% |
| UC-05 Long autonomous track, 3 compactions | +6800 | -18600 | -35000 | -2500 | -2% |
| UC-06 10 similar tracks in sequence | +4100 | -17600 | -100000 | -13500 | -8.4% |
| UC-07 Trivial track without errors | +300 | 0 | -800 | +300 | +9% |
| UC-08 Code review track | +2100 | -3700 | -7000 | -1600 | -6% |
| UC-09 Complex feature track, very mature | +7500 | -26300 | -30000 | -15500 | -14% |
| UC-10 Worst case (trivial, new) | 0 | 0 | 0 | 0 | 0% |

**Weighted average** (excluding UC-10 which is 0): **-6100 tokens/session, -7.2%**

**Average for mature projects only** (UC-02 to UC-09): **-7700 tokens/session, -7.6%**

---

## 9. Cost impact (USD estimated)

Assuming average model pricing (Jun 2026):

| Model | Input $/1M tokens | Output $/1M tokens |
|---|---|---|
| Claude Sonnet 4 | $3 | $15 |
| GPT-5 | $5 | $15 |
| Claude Haiku 4 | $0.25 | $1.25 |
| Gemini 3 Flash | $0.15 | $0.60 |

### 9.1 Estimated monthly savings (intensive user with orchestration)

| Metric | Value |
|---|---|
| Sessions/month | 40 (conductor: 2 Tracks/day × 20 days) |
| Tokens saved/session (average) | -7700 |
| Tokens saved/month | -308000 |
| USD savings/month (Sonnet 4, input) | -$0.92 |
| USD savings/month (GPT-5, input) | -$1.54 |
| USD savings/month (Sonnet 4, 30% output) | -$0.92 + (-$1.39) = -$2.31 |

**Note**: the USD savings seem small because the saved tokens are input (cheaper). The real value is in:
- **Time saved**: -2500 tokens/session = ~2-5 minutes less waiting per session. 40 sessions × 3 min = **2 hours/month saved**.
- **Avoided iterations**: 3-10 avoided iterations/session = less frustration, less broken context.
- **Improved quality**: injected lessons = fewer repeated errors = higher quality code.

### 9.2 Monthly overhead (worst case, new project)

| Metric | Value |
|---|---|
| Sessions/month (new project) | 20 |
| Overhead/session (new project) | +200-500 |
| Overhead/month | +4000-10000 |
| Overhead cost/month (Sonnet 4, input) | +$0.012-$0.03 |

**The overhead in USD is negligible** (< $0.05/month). The real "cost" of Opencode-kevin is the context space it occupies, not the money.

---

## 10. Recommendations for maximizing the Opencode-kevin + DCP balance

### 10.1 Optimal stack configuration

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-conductor",              // Orchestrates Tracks
    "opencode-dynamic-context-pruning",// Prunes stale context
    "Opencode-kevin"                            // Learns from errors
  ]
}
```

This stack maximizes synergy:
- **Conductor** structures work → fewer user messages → less Opencode-kevin overhead.
- **DCP** prunes context → more room for Opencode-kevin's lessons → more value per injected token.
- **Opencode-kevin** learns from failures → avoids iterations → complements DCP (which doesn't know what to avoid, only what to prune).

### 10.2 Budget adjustment (v0.1.1 recommended)

With DCP freeing space, Opencode-kevin can afford larger injection budgets without risk of filling the context:

```jsonc
{
  "Opencode-kevin": {
    "injection": {
      "prePromptBudget": 1200,   // default 1500, reduce slightly
      "compactingBudget": 2000   // maintain, DCP frees space
    }
  }
}
```

### 10.3 Intelligent conditional injection (v0.1.1)

With orchestration, most user messages are high-level instructions. Opencode-kevin should inject more aggressively in the first message (where the agent needs project context) and less in clarifications:

- **First Track message**: budget 1500 tokens (full project context).
- **Clarifications**: budget 500 tokens (only most relevant lessons).
- **Trivial messages ("yes", "continue")**: 0 tokens (no injection).

### 10.4 Coordination with Conductor (v0.2)

Opencode-kevin should detect when Conductor starts a new Track (`/conductor:newTrack`) and inject lessons specific to the Track type:
- Bugfix Track → inject similar bug lessons.
- Feature Track → inject relevant architecture decisions.
- Migration Track → inject previous migration lessons.

### 10.5 Real measurement (v0.1.0)

Add to `Opencode-kevin_status`:
- `tokens_injected_pre_prompt_total`: tokens injected in system.transform.
- `tokens_injected_compacting_total`: tokens injected in compacting.
- `iterations_estimated_avoided`: estimated avoided iterations (based on injected lessons that match subsequent failures).

This allows the user to measure real impact and adjust budgets.

---

## 11. Conclusion

**Does Opencode-kevin v0.1.0 have a large impact on the number of tokens consumed when used with DCP + orchestration?**

**Answer**: the net impact is **positive (token savings) in virtually all realistic scenarios** once the project accumulates 15+ memories (session 2-3). Overhead is marginal in new projects and savings scale with maturity.

| Situation | Impact | Magnitude |
|---|---|---|
| New project, session 1 | Neutral | 0 tokens (no memories to inject) |
| Young project, session 2-3 | Break-even | ±0 to -1800 tokens |
| Mature project, bugfix Track | Savings | -1300 to -3000 tokens/session |
| Mature project, feature Track | Savings | -2600 to -15500 tokens/session |
| Mature project, multi-session migration Track | Large savings | -24900 tokens total |
| Trivial track without errors | Marginal overhead | +300 tokens |
| 10 similar tracks in sequence | Savings | -13500 tokens (-8.4%) |

**The Opencode-kevin + DCP + Conductor combination is synergistic**:
- Conductor reduces user messages → reduces Opencode-kevin overhead.
- DCP frees context space → Opencode-kevin injects more value per token.
- Opencode-kevin learns from failures → avoids iterations that neither Conductor nor DCP can prevent.

**Break-even arrives at session 2-3** (vs session 5-15 without orchestration), because orchestration generates more observation (more tool calls) and more compactions (longer sessions), accelerating lesson accumulation.

**Recommendation**: use Opencode-kevin + DCP + Conductor as the base stack. Opencode-kevin's overhead is compensated from session 2-3, and the full stack offers the best AI-assisted development experience available in the OpenCode ecosystem.

---

## 12. Appendix: estimation methodology (updated)

The estimates are based on:

1. **Orchestrated usage pattern**: 1-3 user messages per session (initial instruction + 0-2 clarifications). 50-200 autonomous tool calls per Track.
2. **DCP pruning**: 30-40% of autonomous context is prunable (already consumed reads, old bash outputs). DCP reduces compactions by 30-50%.
3. **Compactions**: 1-3 per medium-long session with DCP (vs 2-5 without DCP).
4. **Opencode-kevin injection budget**: 1500 tokens pre-prompt, 2000 compacting. Real average: 400-1200 pre-prompt (budget isn't always filled).
5. **Typical memory**: 30-100 tokens. 3-8 relevant memories per prompt in mature project.
6. **Avoided iteration**: 800-1500 tokens (bash output + reasoning + edit + retry).
7. **Post-compaction re-exploration**: 3000-8000 tokens without Opencode-kevin, 500-1500 with Opencode-kevin.
8. **Conductor overhead**: spec.md (500-1000 tokens) + plan.md (500-1500 tokens) persisted in context.

**These are estimates based on typical patterns.** Real impact will vary depending on the model, project, and usage pattern. The recommendation in §10.5 (real measurement with `Opencode-kevin_status`) is the way to obtain real data.

---

## References

- `docs/Kevin_Plan.md` — Opencode-kevin v0.1.0 implementation plan
- `docs/Kevin_Task.md` — Opencode-kevin v0.1.0 task list
- https://opencode.ai/docs/plugins — Hooks API
- https://opencode.ai/docs/ecosystem — DCP, Conductor
- https://github.com/derekbar90/opencode-conductor — Context→Spec→Plan→Implement
- https://github.com/Tarquinen/opencode-dynamic-context-pruning — DCP
