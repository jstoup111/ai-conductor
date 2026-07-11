# Plan: retry log lines carry the completion-check reason and progress delta

Source: jstoup111/ai-conductor#546
Tier: S (technical track)

All paths are relative to the repo root. Source under
`src/conductor/src/`, tests under `src/conductor/test/`. Run the suite from
`src/conductor` (`cd src/conductor && npx vitest run <path>`).

---

### Task 1: single-line reason formatter (collapse + truncate)

**Story:** Story 5 (negative — multi-line/oversized reason), Story 4 (fallback).

**Type:** feature (pure helper)

**Steps:**
- RED: create `src/conductor/test/engine/format-retry-line.test.ts`. Import
  `formatRetryReason` from `../../src/engine/format-retry-line.js`. Assert:
  (a) a multi-line input collapses embedded `\n`/`\r` to single-space (one
  line, no newlines in output); (b) an input longer than the max budget is
  truncated with a trailing `…`; (c) an empty/`undefined` input returns the
  fallback `no reason recorded`; (d) a short single-line input is returned
  unchanged. Run — fails (module absent).
- GREEN: create `src/conductor/src/engine/format-retry-line.ts` exporting
  `formatRetryReason(reason: string | undefined, maxLen?: number): string`.
  Replace `/\s*[\r\n]+\s*/g` with a single space, trim, apply a default
  `maxLen` (e.g. 120) truncation with `…`, and return `no reason recorded`
  when the collapsed result is empty. Also export
  `formatProgressDelta(before?: number, after?: number): string` returning
  `''` when either arg is `undefined`, else a compact `` `${before}→${after}
  tasks` `` fragment. Run — passes.
- COMMIT: `feat(engine): single-line retry reason + progress-delta formatter (#546)`

**Files:**
- `src/conductor/src/engine/format-retry-line.ts` (new)
- `src/conductor/test/engine/format-retry-line.test.ts` (new)

**Dependencies:** none

---

### Task 2: extend `step_retry` event + daemon log render line

**Story:** Story 1 (reason on daemon line), Story 2 (progress delta), Story 4
(non-build omits delta), Story 5 (one line).

**Type:** feature

**Steps:**
- RED: extend `src/conductor/test/engine/daemon-render.test.ts`. Add cases that
  call `renderDaemonEvent` with (a) `{ type: 'step_retry', step: 'build',
  attempt: 2, maxAttempts: 3, reason: '5/11 tasks pending/not completed: 3, 6',
  resolvedBefore: 3, resolvedAfter: 5 }` and assert the single output line
  contains `build`, `2/3` (or `try 2/3`), the reason text, and the delta
  `3→5 tasks`; (b) a payload with `resolvedBefore`/`resolvedAfter` omitted and
  a multi-line reason — assert output is exactly one line and contains no
  delta fragment. Run — fails (render still prints bare `retry`).
- GREEN: in `src/conductor/src/types/events.ts`, add optional
  `resolvedBefore?: number;` and `resolvedAfter?: number;` to the `step_retry`
  variant (lines 28-34). In `src/conductor/src/daemon-cli.ts`, update the
  `case 'step_retry'` in `renderDaemonEventUnsafe` (lines 1480-1482) to import
  `formatRetryReason`/`formatProgressDelta` from
  `./engine/format-retry-line.js` and render one line of the form
  `` `${dot} ↻ ${event.step} retry (try ${event.attempt}/${event.maxAttempts}:
  ${formatRetryReason(event.reason)})${delta ? ' ' + delta : ''}` ``. Run —
  passes.
- COMMIT: `feat(daemon): step_retry log line carries reason + progress delta (#546)`

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/daemon-render.test.ts`

**Dependencies:** Task 1

---

### Task 3: populate reason + progress counts at the two conductor emit sites

**Story:** Story 3 (emit sites attach in-scope values), Story 2 (delta source).

**Type:** feature

**Steps:**
- RED: extend `src/conductor/test/engine/conductor.test.ts` (or add a focused
  spec beside it) with a test that drives the build completion-check-failed
  retry path and captures emitted events via the events bus/spy already used in
  that suite; assert the `step_retry` event carries a non-empty `reason` and
  numeric `resolvedBefore`/`resolvedAfter`. Run — fails (fields absent).
- GREEN: in `src/conductor/src/engine/conductor.ts`:
  - completion-check-failed emit (~lines 2365-2371): add
    `resolvedBefore: resolvedTasksBefore` (function-scoped `let`, line 1563) and
    `resolvedAfter: resolvedTasksAfter` (`const`, line 2065, same block) to the
    `step_retry` payload; keep `reason: completion.reason ?? 'completion check failed'`.
  - session-ended-with-error emit (~lines 1847-1853): keep `reason: lastError`;
    for the build step add `resolvedBefore: resolvedTasksBefore` and leave
    `resolvedAfter` undefined (not yet computed on this path — renderer omits
    the delta per Task 2).
  Run — passes.
- COMMIT: `feat(engine): thread resolved-task counts into step_retry emits (#546)`

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/conductor.test.ts`

**Dependencies:** Task 2

---

### Task 4: surface progress delta in the interactive renderers

**Story:** Story 2 (delta visible in terminal too), Story 4 (omit when absent).

**Type:** feature

**Steps:**
- RED: in `src/conductor/test/engine/create-renderer-progress.test.ts` (existing
  progress-render suite) add a `step_retry` case with `resolvedBefore`/
  `resolvedAfter` set and assert the rendered string includes the delta
  fragment; add a case with them omitted and assert no delta text and no crash.
  Run — fails (renderers ignore the new fields).
- GREEN: update the `case 'step_retry'` in
  `src/conductor/src/ui/create-renderer.ts` (lines 130-134) and
  `src/conductor/src/ui/terminal-renderer.ts` (lines 146-150) to append
  `formatProgressDelta(event.resolvedBefore, event.resolvedAfter)` (from
  `../engine/format-retry-line.js`) when non-empty. Keep the existing
  `reason` interpolation. Run — passes.
- COMMIT: `feat(ui): show retry progress delta in terminal renderers (#546)`

**Files:**
- `src/conductor/src/ui/create-renderer.ts`
- `src/conductor/src/ui/terminal-renderer.ts`
- `src/conductor/test/engine/create-renderer-progress.test.ts`

**Dependencies:** Task 3

---

## Task Dependency Graph

```
Task 1 (formatter helper)
   └─> Task 2 (event type + daemon render line)
          └─> Task 3 (conductor emit sites)
                 └─> Task 4 (terminal/create renderers)
```

Strictly linear: the helper underpins the daemon render (Task 2), which
establishes the extended event shape consumed by the emit sites (Task 3) and
the interactive renderers (Task 4).

## Verification

- `cd src/conductor && npx vitest run test/engine/format-retry-line.test.ts
  test/engine/daemon-render.test.ts test/engine/conductor.test.ts
  test/engine/create-renderer-progress.test.ts` — all green.
- `cd src/conductor && npx tsc --noEmit` — the extended `step_retry` variant
  and all four render/emit call sites typecheck.
- Manual read-back: a simulated build retry with `reason: "5/11 tasks
  pending/not completed: 3, 6"`, `resolvedBefore: 3`, `resolvedAfter: 5`
  produces exactly one `.daemon/daemon.log` line containing the reason and
  `3→5 tasks`; a multi-line reason collapses to one line; a non-build retry
  omits the delta and does not crash.
- Log-noise bar (#521): each retry yields exactly one line — assert single-line
  output in the render tests (no `\n` in the rendered string).

## Coverage Mapping (story → tasks)

- Story 1 (daemon line carries reason) → Task 2
- Story 2 (progress delta distinguishes progress) → Task 2, Task 3, Task 4
- Story 3 (emit sites attach in-scope values) → Task 3
- Story 4 (reason absent / delta omitted — no crash) → Task 1, Task 2, Task 4
- Story 5 (multi-line/oversized reason collapsed, one line) → Task 1, Task 2
