# Implementation Plan: rate-limit wait signal for conduct-ts

**Date:** 2026-07-05
**Design:** technical track — no PRD (see `.docs/track/rate-limit-wait-signal.md`)
**Stories:** `.docs/stories/rate-limit-wait-signal.md`
**Complexity:** `.docs/complexity/rate-limit-wait-signal.md` (Tier: S)
**Conflict check:** Skipped (Small tier)
**Fixes:** ai-conductor#222 — blocker for v1.0 cutover #226 (bin/conduct removal), tracked in #228

## Summary

Make conduct-ts compute the rate-limit wait duration from the `claude` CLI output it
already captures, and stop sourcing that wait from the hook-written
`.pipeline/rate-limit-hit` marker (which depends on the never-written
`.pipeline/conduct.log`). ~7 tasks.

## Technical Approach

Today the rate-limit wait is sourced through a bash-era chain:
`rate-limit-wait.sh` parses `.pipeline/conduct.log` (only `bin/conduct` writes it) → writes
`.pipeline/rate-limit-hit` → `StepRunner.readRateLimitWait()` reads line 2 of that marker →
`conductor.ts` sleeps `result.waitSeconds ?? 300`. Under conduct-ts `conduct.log` is never
written, so the hook always falls back to a flat 300s and the real reset time is lost.

The fix relocates the parse into the engine, at the point that already has the raw error text:

1. **`src/conductor/src/execution/claude-provider.ts`** already computes
   `rateLimited = exitCode !== 0 && RATE_LIMIT_RE.test(output)`. Add a pure
   `parseRateLimitWaitSeconds(output: string): number` that mirrors the proven parse patterns
   in `hooks/claude/rate-limit-wait.sh` (`retry after N seconds`; a bare value `< 60` treated
   as minutes; `resets HH:MM`; bare `am/pm`; past clock-time rolls to next day) and defaults to
   `300` for unparseable/`<= 0` input. It must never throw and never return `<= 0`.
2. **`src/conductor/src/execution/llm-provider.ts`** — add `waitSeconds?: number` to
   `InvokeResult`.
3. **`claude-provider.ts`** — on the rate-limited branch, set
   `waitSeconds: parseRateLimitWaitSeconds(output)`; leave it `undefined` otherwise.
4. **`src/conductor/src/engine/step-runners.ts`** — in the `if (result.rateLimited)` branch
   (currently ~437–443), source `waitSeconds` from `result.waitSeconds` instead of calling
   `readRateLimitWait()`. Remove `readRateLimitWait()` (and its `.pipeline/rate-limit-hit`
   read) once nothing references it, so the engine no longer depends on the hook marker or
   `conduct.log`. Keep the `?? 300` default at the point of use.
5. **`conductor.ts`** is unchanged in behavior — it still does `result.waitSeconds ?? 300`
   (now populated by the provider through the step runner).

`hooks/claude/rate-limit-wait.sh` is left in place as a no-op-under-conduct-ts, bash-legacy
artifact; it is removed with `bin/conduct` in #226 and is out of scope here. Date/time parsing
uses the same `date`-equivalent logic as the shell hook but in JS (`Date`), so tests must inject
or freeze "now" (e.g. accept an optional `now` parameter on the parse function) to stay
deterministic — do not call `Date.now()` unfrozen inside assertions.

## Prerequisites
- None. All touched files exist; no new deps, no migration, no config.

## Tasks

### Task 1: Add `waitSeconds?` to the result contract
**Story:** "Provider returns waitSeconds on the invoke result" — result contract
**Type:** infrastructure
**Steps:**
1. Add `waitSeconds?: number;` to `InvokeResult` in `llm-provider.ts`.
2. Run `tsc`/build to confirm no type breakage (non-rate-limited results omit it → `undefined`).
3. Commit: "types(conduct-ts): add optional waitSeconds to InvokeResult"

**Files likely touched:**
- `src/conductor/src/execution/llm-provider.ts` — new optional field

**Dependencies:** none

### Task 2: Parse "retry after N seconds" (happy)
**Story:** "Engine parses wait seconds…" — retry-after happy path
**Type:** happy-path
**Steps:**
1. Write failing test: `parseRateLimitWaitSeconds('...retry after 450 seconds...')` → `450`.
2. Verify RED (function does not yet exist).
3. Implement `parseRateLimitWaitSeconds` in `claude-provider.ts` (exported) handling the
   `retry.*(after|in)\s*[0-9]+` pattern; return the integer seconds.
4. Verify GREEN.
5. Commit: "feat(conduct-ts): parse retry-after seconds from rate-limit output"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — new exported parse function
- `src/conductor/test/execution/parse-rate-limit-wait.test.ts` — new test file

**Dependencies:** none

### Task 3: Minutes heuristic for bare small values (happy)
**Story:** "Engine parses wait seconds…" — `try again in 5 minutes`
**Type:** happy-path
**Steps:**
1. Write failing test: `'try again in 5 minutes'` → `300` (value `< 60` ⇒ minutes → seconds).
2. Verify RED.
3. Extend the parser: when the extracted number is `< 60`, multiply by 60 (mirrors hook lines 23–25).
4. Verify GREEN.
5. Commit: "feat(conduct-ts): apply minutes heuristic to small rate-limit values"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/test/execution/parse-rate-limit-wait.test.ts`

**Dependencies:** Task 2

### Task 4: Reset-time parsing with frozen "now" (happy)
**Story:** "Engine parses wait seconds…" — `resets HH:MM` / bare `am/pm` / next-day rollover
**Type:** happy-path
**Steps:**
1. Write failing tests with an injected `now`: `resets at 23:00` and bare `resets 11pm` →
   correct whole-second delta; a clock time already past today → delta rolls to tomorrow (+86400).
2. Verify RED.
3. Implement reset-time parsing in the parser (accept an optional `now` arg for determinism),
   mirroring hook lines 28–54.
4. Verify GREEN.
5. Commit: "feat(conduct-ts): parse rate-limit reset time with next-day rollover"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/test/execution/parse-rate-limit-wait.test.ts`

**Dependencies:** Task 2

### Task 5: Default-on-unparseable (negative)
**Story:** "Engine parses wait seconds…" — negative path
**Type:** negative-path
**Steps:**
1. Write failing tests: empty string, `retry after 0 seconds`, and garbage → all return `300`;
   assert the function never returns `<= 0`, `NaN`, and never throws on arbitrary input.
2. Verify RED.
3. Implement the guard: clamp non-finite/`<= 0` results to the `300` default.
4. Verify GREEN.
5. Commit: "feat(conduct-ts): default rate-limit wait to 300 on unparseable input"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/test/execution/parse-rate-limit-wait.test.ts`

**Dependencies:** Task 2

### Task 6: Provider populates waitSeconds on the rate-limited branch
**Story:** "Provider returns waitSeconds on the invoke result" — happy + negative
**Type:** happy-path
**Steps:**
1. Write failing test driving `ClaudeProvider.invoke` with a faked rate-limit `claude`
   output (exit ≠ 0, text with a reset time): assert `rateLimited === true` and the expected
   `waitSeconds`; and a rate-limit output with no reset info → `waitSeconds === 300`; and a
   non-rate-limited result → `waitSeconds === undefined`.
2. Verify RED.
3. Implement: on the `rateLimited` branch (claude-provider.ts:145–158) set
   `waitSeconds: parseRateLimitWaitSeconds(output)`.
4. Verify GREEN.
5. Commit: "feat(conduct-ts): return parsed waitSeconds from ClaudeProvider on rate limit"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts`
- existing claude-provider test file (or a new one) under `src/conductor/test/execution/`

**Dependencies:** Tasks 1, 2, 3, 4, 5

### Task 7: Step runner sources wait from the provider; drop the marker/conduct.log dependency
**Story:** "Conductor waits the parsed duration without depending on conduct.log or the hook marker"
**Type:** refactor + negative-path
**Steps:**
1. Write failing engine test: a `rateLimited` `InvokeResult` carrying `waitSeconds: 450` (via a
   provider fake) with **no** `.pipeline/conduct.log` and **no** `.pipeline/rate-limit-hit`
   present ⇒ the step result's `waitSeconds` is `450` and the conductor sleeps that long and
   retries without burning the retry budget. Add a case where `result.waitSeconds` is absent ⇒
   falls back to `300`, no crash.
2. Verify RED (today it reads the absent marker → default 300, so the 450 case fails).
3. Implement: in `step-runners.ts` `if (result.rateLimited)` branch use
   `result.waitSeconds ?? 300`; remove `readRateLimitWait()` and its
   `.pipeline/rate-limit-hit` read once unreferenced. Update/retire the existing
   `step-runners.test.ts` "reads wait seconds from line 2 of the rate-limit-hit marker" test
   (that behavior is intentionally removed).
4. Verify GREEN; run `grep -rn "conduct.log" src/conductor/src` and confirm no remaining
   reference sources the rate-limit wait.
5. Commit: "fix(conduct-ts): source rate-limit wait from provider, drop conduct.log dependency (#222)"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — use `result.waitSeconds`; remove `readRateLimitWait`
- `src/conductor/test/engine/step-runners.test.ts` — replace marker-read test with provider-sourced test

**Dependencies:** Task 6

## Task Dependency Graph
```
Task 1 ─┐
Task 2 ─┼─▶ Task 3 ─┐
        │            ├─▶ Task 6 ─▶ Task 7
        ├─▶ Task 4 ─┤
        └─▶ Task 5 ─┘
```

## Integration Points
- After Task 6: the provider end-to-end returns an accurate `waitSeconds` on rate limit —
  testable in isolation with a faked `claude` output.
- After Task 7: full engine path waits accurately with `conduct.log` and the hook marker both
  absent — this is the acceptance condition for #222.

## Verification
- [ ] All happy path criteria covered (Tasks 2, 3, 4, 6, 7)
- [ ] All negative path criteria covered (Tasks 5, 6, 7)
- [ ] No task exceeds ~5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] `grep -rn "conduct.log" src/conductor/src` sources nothing for the rate-limit wait
- [ ] CHANGELOG `[Unreleased]` gets a Fixed entry at build time (harness rule); VERSION stays 0.99.19
