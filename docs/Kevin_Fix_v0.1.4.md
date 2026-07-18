# Opencode-kevin — Fix v0.1.4

**Version:** 0.1.4
**Date:** 2026-07-07
**Status:** Draft for implementation
**Depends on:** `docs/Kevin_Plan.md`, `docs/Kevin_Task.md`, `CHANGELOG.md` (0.1.3 entry)
**Convention ID:** `K-046`…`K-050` (continues the numbering from `Kevin_Task.md`)
**Type:** Fix document — robust failure detection independent of the v2 event

---

## 1. Executive Summary

The **v0.1.3** fix attempted to correct F#1 (failure detection → reflection) by changing the precedence of the `tool.execute.after` hook to scan `output.output` when `metadata.success === true`. The author's empirical assumption was: *"opencode's bash tool returns `metadata.success === true` even when the wrapping subprocess exits with a non-zero exit code"*. **That assumption was not verified against opencode's real bash tool** (the `plugin-tools.test.ts:236-297` tests use mocks with `metadata:{success:true}`; the e2e `plugin-complete.test.ts:282` uses `metadata:{}` + `output:"command finished"` and relies on the `session.next.tool.failed` event to rescue the case).

Manual validation K-045 in `C:\Desarrollo\Misc\0-undefined` demonstrated that **F#1 is still broken in production**: after a `tsc` with `error TS2304`, `kevin_status` reports `memories: 0`. The investigation (diagnostic session) concluded that opencode's bash tool populates the command text in `output.output` (top-level string, per the `@opencode-ai/plugin` SDK contract `index.d.ts:249-258`) and `output.metadata` does **not** contain `success:false`, nor a numeric `exitCode`, nor `stderr` with error markers — that is, `metadata` arrives empty or without the expected keys.

When `metadata = {}`, the v0.1.3 heuristic falls into the `else` branch (`index.ts:291`) and returns `success = true` **without scanning `output.output`** → the Reflector is never invoked → 0 memories. The only remaining safety net is the `session.next.tool.failed` event, which is **v2-only** in the SDK typings and, in production, **is not emitted for a bash exit-1** (a non-zero command is a *successful* tool call that returns error content, not a tool execution failure).

**The v0.1.4 fix makes the heuristic self-sufficient**: it scans `output.output`/`stdout` with **strong** (non-ambiguous) markers in ALL cases without a definitive signal, regardless of the shape of `metadata` and without depending on the v2 event. This covers both possible empirical scenarios (`metadata:{success:true}` or `metadata:{}`) while preserving the F#28 false-positive guard.

| Dimension | Value |
|---|---|
| Files modified | 2 (`plugin/index.ts`, `plugin/Reflector.ts`) |
| Test files modified | 2 (`tests/unit/plugin-tools.test.ts`, `tests/e2e/plugin-complete.test.ts`) |
| Tasks | K-046…K-050 (5) |
| Risk | 🟡 medium (changes failure detection; false-positive risk mitigated by strong regex) |
| Breaking | No (the event safety net is preserved; existing tests pass unchanged) |

**Exit criterion**: after a failed `npm run typecheck` in the K-045 project, `kevin_status` reports `memories ≥ 1`, `kevin_query "typecheck"` returns the lesson `When bash fails with typecheck: …`, and in a new session `system.transform` injects it into `<kevin-context>` — all without manual intervention and without depending on `session.next.tool.failed`.

---

## 2. Context — why v0.1.3 was not enough

### 2.1 SDK contract of the `tool.execute.after` hook

`@opencode-ai/plugin` (`dist/index.d.ts:249-258`) defines:

```typescript
"tool.execute.after"?: (input: {
    tool; sessionID; callID; args
}, output: {
    title: string;
    output: string;     // the command text goes HERE (top-level)
    metadata: any;       // shape depends on each tool; keys NOT guaranteed
}) => Promise<void>;
```

The top level of `output` **only** has `title`, `output` (string) and `metadata` (any). There are **no** `output.success`, `output.stderr`, `output.stdout`, `output.exitCode` at the top level. The heuristic must read everything from `output.metadata` (unguaranteed keys) and/or from `output.output` (the command text, always present).

### 2.2 What v0.1.3 does today (`plugin/index.ts:271-293`)

```typescript
"tool.execute.after": async (hookInput, output) => {
    const meta = (output.metadata ?? {}) as Record<string, unknown>;
    const outputText = String(output.output ?? "");
    const stderr = String(meta.stderr ?? "");
    const stdout = String(meta.stdout ?? outputText);
    const exitCode = typeof meta.exitCode === "number" ? meta.exitCode : undefined;
    let success: boolean;
    if (meta.success === false) {
        success = false;
    } else if (exitCode !== undefined) {
        success = exitCode === 0;
    } else if (meta.success === true) {          // ← ONLY here does it scan output.output
        const stream = stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : outputText;
        success = !(stream.length > 0 && ERROR_LINE_RE.test(stream));
    } else {
        success = true;                           // ← empty metadata: does NOT scan
    }
    // … observer.onAfter + if(!success) → reflector.invoke
}
```

### 2.3 The gap

| Real bash tool `metadata` | Branch executed | Scans `output.output`? | Reflector invoked? |
|---|---|---|---|
| `{success:false}` | branch 1 | — | ✅ yes (definitive) |
| `{exitCode:2}` | branch 2 | — | ✅ yes (exitCode≠0) |
| `{success:true}` + error in output | branch 3 | ✅ yes (broad ERROR_LINE_RE) | ✅ yes |
| `{success:true}` no error | branch 3 | ✅ yes (no match) | ❌ no (correct) |
| **`{}` (empty)** + error in output | **`else`** | **❌ NO** | **❌ no (BUG)** |
| **`{}` (empty)** no error | **`else`** | ❌ no | ❌ no (correct) |

The two highlighted rows are the bug. Validation K-045 fell into row 5 (`metadata` empty + `error TS2304` in `output.output`) → 0 memories.

### 2.4 Why the event safety net does not rescue in production

The e2e `plugin-complete.test.ts:282-330` tests exactly row 5 **by manually simulating** the `session.next.tool.failed` event with `error.message` containing the TS error. That test passes **because the test emits the event by hand**. In production:

1. The `session.next.tool.failed` event belongs to the SDK's **v2** contract (`sdk/dist/v2/gen/types.gen.d.ts:898, 3812`). The plugin's `event` hook is typed with **v1** `Event` (`sdk/dist/gen/types.gen.d.ts:602`), whose union does **not include** `session.next.tool.*`. (Note: the code already does untyped access — `index.ts:357-359` uses `(event as {type?:string})` — so v1 typing does NOT block runtime reception; the real blocker is point 2.)
2. **Opencode does not classify a bash exit-1 as a tool failure**: the tool executed correctly and returned a result (with error content). `session.next.tool.failed` is reserved for tool *execution* failures (permission denied, tool throws, tool timeout). A non-zero subprocess does **not** trigger this event.

⇒ In production row 5 is not rescued by the event ⇒ the heuristic must be self-sufficient.

### 2.5 The unverified assumption of v0.1.3

The `CHANGELOG.md` (0.1.3 entry) states: *"opencode's bash tool returns `metadata.success === true` even when the executed process exits non-zero"*. No test verifies this against the real bash tool; all use mocks. The K-045 evidence (0 memories) is consistent with `metadata = {}` (empty), **not** with `metadata = {success:true}` (which would have triggered branch 3 and persisted the lesson). The v0.1.4 fix is **robust to both shapes** so as not to depend on verifying which is real — but it includes an empirical diagnostic step (§7) to confirm it and, if `metadata:{success:true}` is confirmed, document it.

---

## 3. Fix Design

### 3.1 Principles

1. **Self-sufficiency**: the `tool.execute.after` heuristic must detect the failure on its own, without depending on the v2 event.
2. **Empirical robustness**: it must work whether `metadata = {}`, `metadata = {success:true}`, or `{exitCode:N}`.
3. **No false positives in stdout**: the output of a successful command may mention "error"/"panic"/"fail" in prose (F#28 case, `plugin-complete.test.ts:380`). Scanning stdout with the *broad* `ERROR_LINE_RE` would break F#28. ⇒ stdout is scanned with a **strong** regex (non-ambiguous markers).
4. **stderr is a strong signal**: stderr content rarely appears in successful commands. stderr is scanned with the broad `ERROR_LINE_RE` (as in v0.1.1 F#28).
5. **Preserve the event safety net**: `handleToolFailed` (via `session.next.tool.failed`) is kept for real tool *execution* failures (not for bash exit-1). It is not removed.
6. **Minimality**: 2 source files changed, no DB migration, no schema changes.

### 3.2 New detection precedence

```
1. metadata.success === false                         → FAIL (definitive)
2. exitCode (numeric, alternate keys) !== undefined   → exitCode === 0 ? OK : FAIL
3. stderr non-empty + ERROR_LINE_RE (broad)           → FAIL
4. stream(stdout|output.output) + STRONG_ERROR_RE     → FAIL if match, else OK
   (covers metadata={success:true} AND metadata={} )
```

Branch 4 replaces both branch 3 (`meta.success===true`) and the `else` of v0.1.3. We no longer branch on `meta.success` to decide whether to scan: we **always** scan stdout with strong markers when there is no definitive signal.

### 3.3 Strong vs broad regex

**`ERROR_LINE_RE` (broad, existing in `Reflector.ts:30-31`)** — kept, used **only for stderr**:
```typescript
/\b(error|failed|fail|cannot find|cannot resolve|TS\d{4,}|exception|traceback|panic|fatal|referenceerror|typeerror|syntaxerror|command failed|non-zero exit)\b/i
```

**`STRONG_ERROR_RE` (NEW, for stdout/output.output)** — non-ambiguous markers that do not appear in success prose:
```typescript
/\b(cannot find|cannot resolve|TS\d{4,}|error TS\d|command failed|non-zero exit|exit code [1-9]\d*|traceback|referenceerror|typeerror|syntaxerror|fatal error|exception|failed to compile|build failed|compilation failed)\b/i
```

Key differences vs `ERROR_LINE_RE`:
- **Removed** (ambiguous in prose): `error`, `fail`, `failed`, `panic`, `fatal` (the bare word).
- **Kept/Specialized**: `fatal error` (with "error"), `error TS\d` (tsc), `exit code [1-9]` (numeric exit in text), `build failed` / `failed to compile` / `compilation failed` (explicit build errors).

Verification against existing tests:

| Test | `metadata` | `output.output` | `STRONG_ERROR_RE` match? | expected `success` | Test passes? |
|---|---|---|---|---|---|
| `plugin-tools:237` "0 errors" | `{success:true}` | `"0 errors"` | ❌ ("error" bare not in strong) | true → 0 mem | ✅ |
| `plugin-tools:252` bash+tsc | `{success:true}` | `"...error TS2304: Cannot find name 'foo'."` | ✅ (`TS2304`, `cannot find`) | false → ≥1 mem | ✅ |
| `plugin-tools:284` exitCode=2 | `{success:true,exitCode:2}` | `"ok"` | — (branch 2) | false → ≥1 mem | ✅ |
| `plugin-complete:380` F#28 | `{}` | `"Build succeeded. Note: avoid panic in error paths."` | ❌ ("panic" not in strong; "build failed" doesn't match "Build succeeded") | true → 0 mem | ✅ |
| `plugin-complete:282` event-fail | `{}` | `"command finished"` | ❌ | true → 0 mem (rescued by event) | ✅ |
| **NEW** K-048 regression | `{}` | `"...error TS2304: Cannot find name 'foo'."` | ✅ | false → ≥1 mem | ✅ (new) |

The last row is the K-045 production case that v0.1.3 does not cover and v0.1.4 does.

> **Documented trade-off**: `STRONG_ERROR_RE` does not detect a bare Go `panic` (excluded to avoid breaking F#28). A real Go panic prints `panic:` or `panic: ...` — to detect it, add `panic:` with careful boundaries (the `:` breaks the trailing `\b`; use `(?<![A-Za-z])panic:`). Left as optional refinement; the core of the fix (tsc/build/JS runtime) is covered.

### 3.4 Alternate exit code keys

The bash tool might name the exit code differently in `metadata`. For defensive robustness, `pickExitCode(meta)` checks `exitCode`, `exit_code`, `exit` (in that order) and returns the first **numeric** value. `code`/`status` are excluded (they can be legitimate HTTP statuses or strings). This is **speculative** — the primary anchor is branch 4 (strong stdout scan), which does not depend on exit code.

---

## 4. Implementation — changes per file

### 4.1 `plugin/Reflector.ts`

**Add** the exported `STRONG_ERROR_RE` constant, alongside `ERROR_LINE_RE` (lines 30-31):

```typescript
export const ERROR_LINE_RE =
    /\b(error|failed|fail|cannot find|cannot resolve|TS\d{4,}|exception|traceback|panic|fatal|referenceerror|typeerror|syntaxerror|command failed|non-zero exit)\b/i;

export const STRONG_ERROR_RE =
    /\b(cannot find|cannot resolve|TS\d{4,}|error TS\d|command failed|non-zero exit|exit code [1-9]\d*|traceback|referenceerror|typeerror|syntaxerror|fatal error|exception|failed to compile|build failed|compilation failed)\b/i;
```

No other changes in `Reflector.ts`. `ERROR_LINE_RE` is preserved as-is (used by `extractFirstErrorLine` in `Reflector.ts:145-158` over the `sourceOutput`, which is already stderr-or-stdout of the confirmed failure — there the broad regex is correct because it is only reached after confirming `success=false`).

### 4.2 `plugin/index.ts`

**Add import** of `STRONG_ERROR_RE` (line 10):

```typescript
import { ERROR_LINE_RE, STRONG_ERROR_RE, Reflector } from "./Reflector.js";
```

**Add helper** `pickExitCode` (alongside `handleToolFailed`, ~line 86):

```typescript
function pickExitCode(meta: Record<string, unknown>): number | undefined {
    for (const k of ["exitCode", "exit_code", "exit"]) {
        const v = meta[k];
        if (typeof v === "number") return v;
    }
    return undefined;
}
```

**Replace** the `success` computation block in `tool.execute.after` (`index.ts:271-293`). Current state:

```typescript
"tool.execute.after": async (hookInput, output) => {
    const meta = (output.metadata ?? {}) as Record<string, unknown>;
    const outputText = String(output.output ?? "");
    const stderr = String(meta.stderr ?? "");
    const stdout = String(meta.stdout ?? outputText);
    const exitCode =
        typeof meta.exitCode === "number" ? meta.exitCode : undefined;
    let success: boolean;
    if (meta.success === false) {
        success = false;
    } else if (exitCode !== undefined) {
        success = exitCode === 0;
    } else if (meta.success === true) {
        const stream =
            stderr.length > 0
                ? stderr
                : stdout.length > 0
                    ? stdout
                    : outputText;
        success = !(stream.length > 0 && ERROR_LINE_RE.test(stream));
    } else {
        success = true;
    }
    // … (rest unchanged: observer.onAfter + if(!success) reflector.invoke)
```

Proposed state:

```typescript
"tool.execute.after": async (hookInput, output) => {
    const meta = (output.metadata ?? {}) as Record<string, unknown>;
    const outputText = String(output.output ?? "");
    const stderr = String(meta.stderr ?? "");
    const stdout = String(meta.stdout ?? outputText);
    const exitCode = pickExitCode(meta);
    let success: boolean;
    if (meta.success === false) {
        success = false;
    } else if (exitCode !== undefined) {
        success = exitCode === 0;
    } else if (stderr.length > 0 && ERROR_LINE_RE.test(stderr)) {
        // stderr is a strong failure signal → broad regex OK (F#28 only restricts stdout)
        success = false;
    } else {
        // No definitive signal: scan stdout/output.output with STRONG markers.
        // Covers metadata={} (real bash tool) and metadata={success:true} (v0.1.3 case).
        // STRONG_ERROR_RE avoids false positives in success prose (F#28: "panic"/"error").
        const stream = stdout.length > 0 ? stdout : outputText;
        success = !(stream.length > 0 && STRONG_ERROR_RE.test(stream));
    }
    observer.onAfter(
        {
            tool: hookInput.tool,
            args: hookInput.args as Record<string, unknown>,
            sessionId: hookInput.sessionID,
            callID: hookInput.callID,
        },
        { success, stdout, stderr, exitCode },
    );
    if (!success) {
        const errorType = observer.inferErrorType(stderr, stdout, exitCode);
        fireAndForget(
            reflector.invoke({
                toolName: hookInput.tool,
                argsSummary: observer.summarizeArgs(
                    hookInput.args as Record<string, unknown>,
                ),
                stderr,
                stdout,
                exitCode,
                errorType,
                sessionId: hookInput.sessionID,
            }),
        );
    }
},
```

**Notes**:
- The explicit `meta.success === true` branch **disappears**: it falls into the `else` and is scanned with `STRONG_ERROR_RE`. If the stream has a strong marker → fail; if not → success (correct: `meta.success:true` + clean output = success).
- The new branch 3 (stderr + broad `ERROR_LINE_RE`) is **additive** vs v0.1.3 (which did not scan stderr in the `else`). It is safe: stderr with an error marker is a failure. And it does not break F#28 because F#28 has `stderr=""`.
- `inferErrorType(stderr, stdout, exitCode)` (`ToolCallObserver.ts:117-138`) receives `stdout = outputText` when `meta.stdout` is absent → sees `error TS2304` → returns `"typecheck"` ✅. No changes in `ToolCallObserver.ts`.
- The Reflector (`Reflector.ts:73-74`) does `sourceOutput = stderr if non-empty else stdout` → with `stderr=""` uses `stdout=outputText` → `extractFirstErrorLine` finds the `error TS2304` line → the lesson is correct. No changes in the Reflector.

**Unchanged**: `tool.execute.before`, `chat.message`, `experimental.chat.system.transform`, `experimental.session.compacting`, `event` (the event safety net is preserved intact), `dispose`, nor any `kevin_*` tool.

---

## 5. Tasks (K-046…K-050)

### K-046 — Add `STRONG_ERROR_RE` in `Reflector.ts`

- **Priority:** P0
- **Estimate:** S (30m)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/Reflector.ts`
- **Description:** Export the `STRONG_ERROR_RE` constant (§3.3) alongside `ERROR_LINE_RE` (lines 30-31). Do not touch `extractFirstErrorLine` (it still uses `ERROR_LINE_RE` over `sourceOutput` post-confirmation).
- **Acceptance criteria:**
  - `STRONG_ERROR_RE` is exported and matches the §3.3 specification.
  - `npm run typecheck` passes.
  - `npx vitest run tests/unit/reflector.test.ts` passes (no regression).
- **Verification:** `npm run typecheck && npx vitest run tests/unit/reflector.test.ts`

### K-047 — Robust heuristic in `index.ts` + `pickExitCode`

- **Priority:** P0
- **Estimate:** M (2h)
- **Dependencies:** K-046
- **Risk:** 🟡
- **Files:** `plugin/index.ts`
- **Description:** (1) Import `STRONG_ERROR_RE`. (2) Add `pickExitCode` helper (§4.2). (3) Replace the `success` computation in `tool.execute.after` (lines 271-293) with the new precedence from §3.2/§4.2. Keep `observer.onAfter` and `if(!success) reflector.invoke` unchanged.
- **Acceptance criteria:**
  - `npm run typecheck` passes.
  - All existing tests pass unmodified (`npm test`).
  - The `else` branch now scans `stdout`/`output.output` with `STRONG_ERROR_RE`.
- **Verification:** `npm run typecheck && npm run lint && npm test`

### K-048 — Regression tests in `plugin-tools.test.ts`

- **Priority:** P0
- **Estimate:** S (1h)
- **Dependencies:** K-047
- **Risk:** 🟢
- **Files:** `tests/unit/plugin-tools.test.ts`
- **Description:** Add to the `describe("tool.execute.after — …")` (line 236) the missing cases from the §3.3 table:
  1. **K-045 regression (core of the fix)**: `metadata:{}`, `output.output = "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'."` → `kevin_status.memories ≥ 1` AND `kevin_query("typecheck")` returns a lesson with `"Verify types and imports"`.
  2. **Negative empty-metadata**: `metadata:{}`, `output.output = "0 errors"` → `memories == 0`.
  3. **Negative F#28 empty variant**: `metadata:{}`, `output.output = "Build succeeded. Note: avoid panic in error paths."` → `memories == 0` (false-positive guard in the default branch).
  4. **Alternate exit_code**: `metadata:{exit_code:2}`, `output.output="ok"` → `memories ≥ 1` (verifies `pickExitCode`).
- **Acceptance criteria:**
  - The 4 tests pass.
  - The existing tests (lines 237-297) still pass unchanged.
- **Verification:** `npx vitest run tests/unit/plugin-tools.test.ts`

### K-049 — e2e test: full cycle with empty metadata (no event)

- **Priority:** P0
- **Estimate:** M (2h)
- **Dependencies:** K-047
- **Risk:** 🟡
- **Files:** `tests/e2e/plugin-complete.test.ts`
- **Description:** Add an e2e test that reproduces the real K-045 scenario **without emitting** `session.next.tool.failed`:
  - `tool.execute.before` (bash, `npx tsc --noEmit`) → `tool.execute.after` with `metadata:{}` and `output.output = "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'."`.
  - `waitForAsync` until `kevin_query("typecheck")` returns a lesson with `"Verify types and imports"`.
  - `chat.message` with text "fix the typecheck error" → `system.transform` → assert `<kevin-context>` contains the lesson.
  - **Do not** emit `session.next.tool.failed` in this test (demonstrate the heuristic is self-sufficient).
  - Mirror of `plugin-complete.test.ts:82-171` but with `metadata:{}` instead of `metadata:{success:false,stderr,exitCode}`.
- **Acceptance criteria:**
  - Lesson persisted without event.
  - Injection in `system.transform` works.
  - The existing `plugin-complete.test.ts:282` test (which does use the event) still passes.
- **Verification:** `npx vitest run tests/e2e/plugin-complete.test.ts`

### K-050 — Bump 0.1.4 + CHANGELOG + README-K045

- **Priority:** P0
- **Estimate:** S (30m)
- **Dependencies:** K-048, K-049
- **Risk:** 🟢
- **Files:** `package.json`, `CHANGELOG.md`, `C:\Desarrollo\Misc\0-undefined\README-K045.md`
- **Description:**
  1. `package.json` `version`: `0.1.3` → `0.1.4`.
  2. Add `## [0.1.4] — 2026-07-07` entry in `CHANGELOG.md` (see §10 draft).
  3. Fix `README-K045.md` (§9): DB path `~/.opencode-kevin/kevin.db` (not `.kevin/kevin.db`), plugin `@jmtrin/opencode-kevin@latest` (not `opencode-kevin@0.1.1`), and replace the `npx better-sqlite3 …` diagnostic with `kevin_status` (better-sqlite3 does not expose a CLI binary).
- **Acceptance criteria:**
  - `node -e "console.log(require('./package.json').version)"` → `0.1.4`.
  - CHANGELOG entry present.
  - `README-K045.md` consistent with the plugin README.
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## 6. Tests — detail of new cases

### 6.1 K-048 case 1 (K-045 regression, core of the fix)

```typescript
it("empty metadata + TS2304 error in output.output triggers reflection without event (K-045)", async () => {
    const sess = "empty-meta-sess";
    await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: sess, callID: "em1" },
        { args: { command: "npx tsc --noEmit" } },
    );
    await hooks["tool.execute.after"]?.(
        {
            tool: "bash",
            sessionID: sess,
            callID: "em1",
            args: { command: "npx tsc --noEmit" },
        },
        {
            title: "bash",
            output: "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'.",
            metadata: {},                       // ← the real bash tool case
        },
    );
    await new Promise((r) => setTimeout(r, 10));
    const status = await hooks.tool?.kevin_status.execute({}, ctx);
    const parsed = parse(status as { output: string }) as { memories: number };
    expect(parsed.memories).toBeGreaterThanOrEqual(1);
    const query = await hooks.tool?.kevin_query.execute(
        { query: "typecheck", limit: 10 },
        ctx,
    );
    const mems = parse(query as { output: string }) as Array<{ content: string }>;
    expect(mems.some((m) => m.content.includes("Verify types and imports"))).toBe(true);
    expect(mems.some((m) => m.content.includes("TS2304"))).toBe(true);
});
```

### 6.2 K-048 case 3 (false-positive guard, default branch)

```typescript
it("empty metadata + prose with 'panic'/'error' without strong marker → success=true (F#28 in default branch)", async () => {
    const sess = "fp-default-sess";
    await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: sess, callID: "fpd1" },
        { args: { command: "npm run build" } },
    );
    await hooks["tool.execute.after"]?.(
        { tool: "bash", sessionID: sess, callID: "fpd1", args: {} },
        {
            title: "bash",
            output: "Build succeeded. Note: avoid panic in error paths.",
            metadata: {},
        },
    );
    await new Promise((r) => setTimeout(r, 10));
    const status = await hooks.tool?.kevin_status.execute({}, ctx);
    const parsed = parse(status as { output: string }) as { memories: number };
    expect(parsed.memories).toBe(0);
});
```

> Note: the existing `plugin-complete.test.ts:380` test ("F#28 heuristic") already covers `metadata:{}` + output with "panic"/"error" but does **not** explicitly assert the default branch. New case 3 makes it explicit in `plugin-tools.test.ts` (unit) to pin the `STRONG_ERROR_RE` semantics.

### 6.3 K-049 e2e (self-sufficient cycle, no event)

Model on `plugin-complete.test.ts:82-171`, but the failure `tool.execute.after` uses `metadata:{}` and `output.output` with the TS error. **Omit** the `hooks.event?.({ event: { type: "session.next.tool.failed", … } })` block (lines 304-316 of the existing test). The `waitForAsync` must succeed without the event. This proves the `tool.execute.after` heuristic is sufficient.

---

## 7. Empirical diagnosis (pre-implementation, optional but recommended)

Before implementing K-047, confirm the real shape of `output.metadata` from opencode's bash tool. This turns the fix from "robust to both possibilities" into "evidence-based".

### 7.1 Probe the metadata

Temporarily add in `plugin/index.ts` inside `tool.execute.after` (line 271), at the start:

```typescript
try {
    const fs = await import("node:fs");
    fs.appendFileSync(
        join(homedir(), ".opencode-kevin", "debug-metadata.log"),
        `[${new Date().toISOString()}] tool=${hookInput.tool} meta=${JSON.stringify(meta)} outputText=${JSON.stringify(outputText.slice(0, 200))}\n`,
    );
} catch {}
```

Then:
1. `npm run build` in `C:\opencode-kevin`.
2. Clear opencode cache (§8) and restart opencode.
3. In the K-045 project (`C:\Desarrollo\Misc\0-undefined`), run `npm run typecheck` (fails with TS2304).
4. Inspect `~/.opencode-kevin/debug-metadata.log`:

```
tool=bash meta={} outputText="src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'."
```

or

```
tool=bash meta={"success":true,"exitCode":2} outputText="…"
```

### 7.2 Decision per finding

- If `meta={}` (expected per K-045 evidence) → the §4.2 fix is **necessary and sufficient** (branch 4 catches it).
- If `meta={success:true}` → branch 4 also catches it (and v0.1.3's branch 3 already did, but now unified and without stdout false positives). The fix remains correct and more robust.
- If `meta={exitCode:2}` (numeric) → branch 2 already caught it in v0.1.3; if K-045 showed 0 memories, this is NOT the case. (If it were, the bug would be elsewhere — investigate why `reflector.invoke` does not persist.)

**Remove** the debug probe before the final commit (K-050). The §4.2 fix is valid without this step, but the evidence documents the root cause in the CHANGELOG.

---

## 8. Deployment — refresh opencode cache

**Critical**: the opencode cache at `~/.cache/opencode/packages/@jmtrin/opencode-kevin@latest/` can be **stale** after publishing 0.1.4. The original K-045 validation ran against the **cached v0.1.2** (not against the published v0.1.3), so even the 0.1.3 fix never executed locally. Without refreshing the cache, v0.1.4 will not run either.

### 8.1 Procedure (Windows / PowerShell)

```powershell
# 1. Publish 0.1.4 (maintainer)
cd C:\opencode-kevin
npm run build
npm publish --access public

# 2. Fully close opencode

# 3. Clear the stale plugin cache
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\@jmtrin\opencode-kevin*"

# 4. (Optional) verify no residue remains
Get-ChildItem "$env:USERPROFILE\.cache\opencode\packages\@jmtrin\" -ErrorAction SilentlyContinue

# 5. Restart opencode — re-resolves @latest → downloads 0.1.4
```

### 8.2 Verify the correct version loaded

After restarting opencode, in the K-045 project:

```
kevin_status   # → { memories: 0, tool_calls: N, retrospectives: 0 }  (global DB, N accumulated)
```

Inspect the version of the freshly downloaded cache:

```powershell
Get-Content "$env:USERPROFILE\.cache\opencode\packages\@jmtrin\opencode-kevin@latest\node_modules\@jmtrin\opencode-kevin\package.json" | Select-String '"version"'
# → "version": "0.1.4"
```

### 8.3 Local development without publishing

To iterate without `npm publish`, use the plugin repo's `opencode.json` with a local path:

```jsonc
// C:\opencode-kevin\opencode.json
{ "$schema": "https://opencode.ai/config.json", "plugin": ["./plugin/index.ts"] }
```

And launch opencode with `--config` pointing to `C:\opencode-kevin\opencode.json` (opencode loads the `.ts` via tsx). This avoids the stale cache during development.

> **User config**: `~/.config/opencode/opencode.jsonc` must **always** declare `"@jmtrin/opencode-kevin@latest"` (not pin `@0.1.4`) to receive future versions automatically.

---

## 9. Documentation fixes (K-050 c)

The validation project's `README-K045.md` (`C:\Desarrollo\Misc\0-undefined\README-K045.md`) has three discrepancies that prevent even diagnostics. Fix:

| Section | Current (incorrect) | Fix to |
|---|---|---|
| DB path | `.kevin/kevin.db` (inside project) | `~/.opencode-kevin/kevin.db` (global, fixed in `index.ts:43`) |
| Plugin | `opencode-kevin@0.1.1` | `@jmtrin/opencode-kevin@latest` (currently v0.1.4) |
| DB diagnostic | `npx better-sqlite3 .kevin/kevin.db "SQL"` | `kevin_status` (better-sqlite3 does not expose a CLI binary; the plugin exposes the `kevin_status` tool for counts) |

The plugin's `README.md` (`C:\opencode-kevin\README.md`) is **already correct** (says `~/.opencode-kevin/kevin.db`, `@jmtrin/opencode-kevin@latest`, `node:sqlite`). No changes.

---

## 10. CHANGELOG entry (draft)

```markdown
## [0.1.4] — 2026-07-07

### Fixed

- **F#1-v2 — self-sufficient failure detection (without depending on the v2 event)**: the
  v0.1.3 fix only scanned `output.output` when `metadata.success === true`. Validation K-045
  demonstrated that opencode's bash tool delivers `metadata = {}` (empty) with the command
  text in `output.output` (top-level string of the SDK contract), so the heuristic fell into
  the `else` and returned `success = true` without scanning → 0 memories after a guaranteed
  failed `tsc`.
  The `session.next.tool.failed` event safety net (v2-only) does not rescue this case in
  production: opencode does not emit that event for a bash exit-1 (it is a successful tool
  call that returns error content, not an execution failure).
  - New precedence in `tool.execute.after`: `meta.success===false` → fail;
    numeric `exitCode` (keys `exitCode`/`exit_code`/`exit` via `pickExitCode`) → fail if ≠0;
    non-empty `stderr` + `ERROR_LINE_RE` (broad) → fail; **always** scan
    `stdout`/`output.output` with `STRONG_ERROR_RE` (non-ambiguous markers) as fallback.
  - `STRONG_ERROR_RE` excludes ambiguous bare words (`error`, `fail`, `failed`,
    `panic`, `fatal`) to avoid false positives in success prose (F#28 guard kept);
    retains `TS\d{4,}`, `cannot find`, `error TS\d`, `command failed`, `non-zero exit`,
    `exit code [1-9]`, `traceback`, `referenceerror`, `typeerror`, `syntaxerror`,
    `fatal error`, `build failed`, `failed to compile`, `compilation failed`, `exception`.
  - stderr still uses the broad `ERROR_LINE_RE` (stderr is a strong signal; F#28 only
    restricts stdout).
  - The `session.next.tool.failed` event safety net is preserved for real tool
    execution failures (not bash exit-1).

### Tests

- `plugin-tools.test.ts +4`: (1) `metadata:{}` + `error TS2304` in `output.output`
  → reflection without event (K-045 regression, core of the fix); (2) `metadata:{}` + `"0 errors"`
  → 0 memories (negative); (3) `metadata:{}` + prose with `panic`/`error` → 0 memories
  (F#28 guard in default branch); (4) `metadata:{exit_code:2}` → reflection (verifies
  `pickExitCode`).
- `plugin-complete.test.ts +1`: full cycle (before → after with `metadata:{}` → lesson
  → `system.transform` injects) **without** emitting `session.next.tool.failed` (self-sufficiency).

### Changed

- `package.json` version `0.1.3` → `0.1.4`.
- `README-K045.md` (validation project): DB path `~/.opencode-kevin/kevin.db`,
  plugin `@jmtrin/opencode-kevin@latest`, diagnostic via `kevin_status` (not `npx better-sqlite3`).
```

---

## 11. Out of scope (deferred)

| Item | Reason | Destination |
|---|---|---|
| Detect bare Go `panic` | Excluded from `STRONG_ERROR_RE` to avoid breaking F#28; needs `panic:` with careful boundaries | v0.1.5 (regex refinement) |
| Per-tool throttle (not global 60s) | The global throttle (`Reflector.ts:65`) may skip a second distinct failure within 60s; does not affect K-045 (single failure) | v0.2 |
| `handleToolFailed` with generic `error.message` | If the v2 event is emitted with `message="Command exited with code 1"`, `inferErrorType` returns `unknown` (low-specificity lesson). Improvable by passing cached output to the event. | v0.2 |
| Typed subscription to v2 events | The current untyped access (`event as {type?:string}`) already receives v2 events at runtime if opencode emits them. No change required. | — |
| Embeddings / semantic search | ABI complexity | v0.2 (roadmap `Kevin_Plan.md` §14) |

---

## 12. Final verification

```bash
cd C:\opencode-kevin
npm run typecheck   # tsc --noEmit (strict) — must pass
npm run lint        # biome check .
npm test            # vitest run (unit + integration + e2e) — includes K-048 and K-049
npm run verify      # post-install verification
```

Then, manual K-045 validation in `C:\Desarrollo\Misc\0-undefined` (after §8 cache refresh):

1. `npm run typecheck` → fails with `error TS2304: Cannot find name 'foo'`.
2. `kevin_status` → `memories ≥ 1` (was 0 before the fix).
3. `kevin_query({ query: "typecheck" })` → returns lesson `When bash fails with typecheck: error TS2304: Cannot find name 'foo'… / Suggestion: Verify types and imports before running.`
4. New session → first prompt mentioning "typecheck" → `system.transform` injects `<kevin-context>` with the lesson (verify in log or via `experimental.chat.system.transform`).

**Exit criterion met** when the 4 steps pass without manual intervention.

---

## 13. Change summary

| File | Change | Approx. lines |
|---|---|---|
| `plugin/Reflector.ts` | +`export const STRONG_ERROR_RE` | +2 (alongside line 31) |
| `plugin/index.ts` | +import `STRONG_ERROR_RE`; +`pickExitCode`; replaces `success` computation in `tool.execute.after` | ~271-293 (±5 net) |
| `tests/unit/plugin-tools.test.ts` | +4 tests in existing `describe` | +~80 |
| `tests/e2e/plugin-complete.test.ts` | +1 self-sufficient e2e test | +~60 |
| `package.json` | `version` 0.1.3→0.1.4 | 1 |
| `CHANGELOG.md` | +entry `[0.1.4]` | +~30 |
| `C:\Desarrollo\Misc\0-undefined\README-K045.md` | 3 fixes (DB path, plugin, diagnostic) | 3 lines |

**Total**: 2 source files, 2 test files, 3 meta/doc files. No DB migration. No breaking change.

---

## 14. References

- `docs/Kevin_Plan.md` — architecture, schema, decisions (D5 storage, D6 throttle)
- `docs/Kevin_Task.md` — tasks K-001…K-045 (K-045 = manual validation)
- `CHANGELOG.md` — entries 0.1.1 (F#1, F#28), 0.1.3 (F#1-fix success=true override)
- `plugin/index.ts:271-293` — current heuristic (to be replaced)
- `plugin/Reflector.ts:30-31` — `ERROR_LINE_RE` (to be accompanied by `STRONG_ERROR_RE`)
- `plugin/ToolCallObserver.ts:117-138` — `inferErrorType` (unchanged; receives stdout=outputText)
- `tests/unit/plugin-tools.test.ts:236-297` — 0.1.3 tests (must pass unchanged)
- `tests/e2e/plugin-complete.test.ts:282-330` — event test (must pass unchanged)
- `tests/e2e/plugin-complete.test.ts:380-407` — F#28 guard (must pass unchanged)
- SDK contract: `@opencode-ai/plugin` `dist/index.d.ts:249-258` (`output: {title, output, metadata}`)
- v1 vs v2 events: `@opencode-ai/sdk` `dist/gen/types.gen.d.ts:602` (v1, no `session.next.tool.*`) vs `dist/v2/gen/types.gen.d.ts:898, 3812` (v2, with `SessionNextToolFailed`)
