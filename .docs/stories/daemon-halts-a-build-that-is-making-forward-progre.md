# Stories: Progress-aware build halt (#280)

**Track:** technical · **Tier:** M · **Design:** adr-2026-07-12-progress-aware-build-halt.md (APPROVED)
**Status: Accepted**

Acceptance criteria live here (technical track — no PRD). Each story is testable against the
conductor build retry loop and the daemon re-kick path using a real (or faithfully seeded) build
worktree with a `task-status.json` and a `TaskEvidence` sidecar.

---

## S1 — Progress retry does not exhaust the halt budget (happy, within-dispatch)

**Given** a build step under an isolated repo with a plan of N tasks and `max_retries = 3`,
**and** each dispatched attempt resolves at least one additional task (`resolvedTasksAfter >
resolvedTasksBefore`) but the completion gate still reports tasks pending,
**When** the retry loop runs,
**Then** the loop keeps re-dispatching past attempt 3 instead of marking the step `failed`,
**and** `noEvidenceAttempts` is reset on each progress attempt,
**and** the step is bounded by the absolute attempt ceiling, not by `max_retries`.

**Acceptance:**
- With a stub runner that resolves +1 task per attempt, the loop performs > `max_retries` attempts
  and eventually succeeds when all tasks are resolved.
- The step never enters the `!succeeded` / `step_failed` branch while the per-attempt delta is > 0.

## S2 — Progressing parked build is re-kicked without a base advance (happy, cross-dispatch)

**Given** a build that parked/halted at the end of a dispatch whose ending resolved count exceeds
its starting resolved count (`lastResolvedCount` recorded in the `TaskEvidence` sidecar),
**and** `origin/main` has NOT advanced since (a quiet main),
**When** the daemon runs an idle/poll tick,
**Then** the build is re-kick-eligible and is re-dispatched,
**and** the re-kick is counted against the per-spec dispatch ceiling.

**Acceptance:**
- With a seeded sidecar showing last-dispatch progress and an unchanged base sha, the progress-gated
  re-kick dispatches the build; `rekickSweep`'s base-advance path is not required to fire.

## S3 — Zero-progress still parks at the existing threshold (negative, no regression)

**Given** a build attempt that completes with `resolvedTasksAfter <= resolvedTasksBefore` (zero net
progress) and no HALT marker,
**When** the retry loop evaluates the attempt,
**Then** `noEvidenceAttempts` increments and, at the existing threshold, `checkAndAutoPark` parks
the run exactly as it does today,
**and** the absolute attempt ceiling does not change the zero-progress park threshold.

**Acceptance:**
- A stub runner that resolves zero tasks reaches `checkAndAutoPark` at the same `noEvidenceAttempts`
  count as before this change (threshold unchanged).

## S4 — Absolute attempt ceiling backstops slow-drip within a dispatch (negative)

**Given** a build where every attempt resolves exactly one task (never wedged, never completing),
**When** the number of progress attempts reaches `attempt_ceiling`,
**Then** the run parks (does not loop forever),
**and** the park reason explicitly states the build was progressing but hit the absolute attempt
ceiling — never the misleading "tasks not completed" wording.

**Acceptance:**
- With `attempt_ceiling = 5` and a +1-per-attempt runner over a 100-task plan, the loop stops at 5
  and the emitted reason contains the progressing-hit-ceiling phrasing.

## S5 — Per-spec dispatch ceiling bounds cross-dispatch re-kick (negative)

**Given** a build that keeps making small progress across many daemon dispatches,
**When** the per-spec re-kick count reaches `dispatch_ceiling`,
**Then** the daemon stops progress-gated re-kicking that spec,
**and** the stop is recorded with an explicit self-explaining reason,
**and** the spec remains eligible for the normal base-advance `rekickSweep` and operator unpark.

**Acceptance:**
- With `dispatch_ceiling = 3` and a sidecar that always shows last-dispatch progress, exactly 3
  progress-gated re-kicks occur, then no more (until a base advance or operator action).

## S6 — Re-kick never double-dispatches a live build (negative, safety)

**Given** a build that is currently `started`/live (not parked/halted),
**When** the daemon idle tick evaluates progress-gated re-kick,
**Then** it does not dispatch a second concurrent build for that slug,
**and** it honors the same `started`/`parked`/`isParked`/`isHalted` guards used by the base-advance
re-kick path.

**Acceptance:**
- A slug in the `started` set is never re-dispatched by the progress-gated path; a test asserts a
  single in-flight dispatch per slug.

## S7 — Kill switch and config validation (negative, config)

**Given** `build_progress_halt.enabled = false`,
**When** a build makes progress but does not complete within `max_retries`,
**Then** behavior is exactly today's fixed-budget halt (ceiling and re-kick inert).

**And given** an invalid config (`attempt_ceiling < max_retries`, or a non-positive / non-integer
ceiling),
**When** the config is validated,
**Then** `validateConfig` rejects it with a clear message and the daemon does not start on it.

**Acceptance:**
- `enabled: false` reproduces the pre-change halt in a test.
- `attempt_ceiling: 1` with `max_retries: 3` fails validation; `attempt_ceiling: 0` fails
  validation; a valid block passes.

## S8 — Corrupt/missing progress inputs never crash the decision (negative, robustness)

**Given** a missing or corrupt `task-status.json` or `TaskEvidence` sidecar,
**When** the progress-delta gate or the re-kick eligibility check reads it,
**Then** the read is treated as "no change / zero progress" (tolerant parse, `|| 0`),
**and** no exception propagates out of the retry loop or the daemon tick.

**Acceptance:**
- With a truncated `task-status.json`, the gate returns zero delta and the loop routes to the
  existing zero-progress path without throwing.
