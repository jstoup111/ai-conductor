# Implementation Plan: Progress-aware build halt (#280)

**Date:** 2026-07-12 · **Tier:** M · **Track:** technical
**Design:** .docs/decisions/adr-2026-07-12-progress-aware-build-halt.md (APPROVED)
**Stories:** .docs/stories/daemon-halts-a-build-that-is-making-forward-progre.md (Accepted, S1–S8)
**Conflict check:** .docs/conflicts/2026-07-12-daemon-halts-a-build-that-is-making-forward-progre.md (clean)

## Summary

Make forward-progress delta the primary continue/halt signal in the build retry loop, keep an
absolute attempt ceiling as a backstop, and add a bounded progress-gated cross-dispatch re-kick.
All paths under `src/conductor/`. Test-first (RED → GREEN): each task names the story behavior it
turns green. Run tests from `src/conductor` (`npm install` per worktree; vitest config lives there).

## Merge-order notes (from conflict check)
- **C1 — retry-as-escalation (unbuilt, plan on main):** edits the same loop. Whichever builds
  second reconciles per the conflict report: progress-bypass and the escalation ladder are
  orthogonal transforms; `attempt_ceiling` is validated against the *resolved* `max_retries`
  (post-escalation if that landed). Standard spec-branch rebase on origin/main applies.
- **C2 — event-driven-wake (#329, merged):** D2 re-kick reuses the existing daemon idle-loop /
  Waker and the `started`/`parked`/`isParked`/`isHalted` guards — no parallel wake path.

## Technical Approach
- Ground truth is `task-status.json` (resolved count via existing `countResolvedTasks` /
  `task-progress.ts countFromParsed`) plus the durable `TaskEvidence` sidecar. One additive sidecar
  field `lastResolvedCount` (tolerant `|| 0`). New optional `build_progress_halt` config block
  mirrors the `OtelConfig` pattern; `enabled:false` is an exact revert.
- The within-dispatch change gates the loop-continuation condition: a positive-delta completion miss
  re-dispatches without consuming the halt budget, bounded by `attempt_ceiling`. The zero-progress
  path (`noEvidenceAttempts` → `checkAndAutoPark`) is untouched.
- The cross-dispatch change adds progress-gated re-kick eligibility to the daemon idle tick, bounded
  by `dispatch_ceiling`, routed through existing double-dispatch guards.

## Tasks

### T1 — Config type: `build_progress_halt` block
Add `BuildProgressHaltConfig { enabled?: boolean; attempt_ceiling?: number; dispatch_ceiling?: number }`
to `src/conductor/src/types/config.ts` (pattern: `OtelConfig`); wire into `HarnessConfig`.
**Test:** type-level shape + defaults resolution unit.
**Dependencies:** none.

### T2 — Config validation
In `src/conductor/src/engine/config.ts validateConfig`: positive integers only; reject
`attempt_ceiling < resolved max_retries`; reject non-positive/non-integer ceilings; unknown keys
rejected. Defaults: enabled true, attempt_ceiling 30, dispatch_ceiling 20.
**Test (S7):** invalid (`attempt_ceiling:1` with `max_retries:3`; `attempt_ceiling:0`) fail; valid passes.
**Dependencies:** T1.

### T3 — Sidecar field `lastResolvedCount`
Add `lastResolvedCount: number` to `TaskEvidence` (`task-evidence.ts`) with tolerant parse (`|| 0`)
and round-trip in read/write; backward-compatible with sidecars missing the field.
**Test:** round-trip + missing-field defaults to 0.
**Dependencies:** none.

### T4 — Within-dispatch progress-bypass gate
In the build branch of the retry loop (`conductor.ts` ~2093–2160/2428), when a completion-gate miss
coincides with `resolvedTasksAfter > resolvedTasksBefore` and progress attempts `< attempt_ceiling`,
re-dispatch WITHOUT counting the attempt toward `stepMaxRetries` halt/park; reset `noEvidenceAttempts`
(as today). Introduce a bounded progress-attempt counter distinct from `stepMaxRetries`.
**Test (S1):** stub runner resolving +1 task/attempt performs > max_retries attempts and succeeds.
**Dependencies:** T1, T2.

### T5 — Absolute attempt-ceiling backstop + distinct reason
When progress attempts reach `attempt_ceiling` while still progressing, park with an explicit reason
(`build progressing but hit absolute attempt ceiling N`), never "tasks not completed".
**Test (S4):** `attempt_ceiling:5` + +1/attempt over 100 tasks stops at 5 with progressing-ceiling reason.
**Dependencies:** T4.

### T6 — Zero-progress path regression lock
Assert the zero-progress branch (`resolvedTasksAfter <= resolvedTasksBefore`) still increments
`noEvidenceAttempts` and reaches `checkAndAutoPark` at the same threshold as today.
**Test (S3):** zero-task runner parks at the unchanged `noEvidenceAttempts` count.
**Dependencies:** T4.

### T7 — Record `lastResolvedCount` at dispatch end
At build-step exit (all paths: success, park, ceiling), write the ending resolved count to the sidecar.
**Test:** sidecar reflects ending resolved count after a dispatch.
**Dependencies:** T3.

### T8 — Cross-dispatch progress-gated re-kick eligibility
In the daemon idle/poll tick, mark a parked/halted build re-kick-eligible when its sidecar shows
last-dispatch progress (ending > starting resolved count) even with no base advance; dispatch via the
existing idle-loop path.
**Test (S2):** seeded sidecar w/ progress + unchanged base sha → progress-gated re-kick dispatches.
**Dependencies:** T3, T7.

### T9 — Per-spec dispatch-ceiling bound + reason
Bound progress-gated re-kicks per spec by `dispatch_ceiling`; on reaching it, stop re-kicking with an
explicit recorded reason; spec stays eligible for base-advance `rekickSweep` / operator unpark.
**Test (S5):** `dispatch_ceiling:3` + always-progress sidecar → exactly 3 re-kicks then stop.
**Dependencies:** T8.

### T10 — Double-dispatch guard integration
Route T8 through the existing `started`/`parked`/`isParked`/`isHalted` guards (`daemon.ts:125-140`);
never dispatch a second concurrent build for a live slug.
**Test (S6):** slug in `started` set is never re-dispatched by the progress-gated path.
**Dependencies:** T8.

### T11 — Tolerant reads (robustness)
Corrupt/missing `task-status.json` or sidecar → treated as zero delta / no change; no exception
escapes the loop or the daemon tick.
**Test (S8):** truncated task-status → zero delta, routes to zero-progress path, no throw.
**Dependencies:** T4, T8.

### T12 — Kill switch wiring
`build_progress_halt.enabled:false` makes the ceiling + re-kick inert; behavior is exactly today's
fixed-budget halt.
**Test (S7 kill-switch):** disabled reproduces the pre-change halt.
**Dependencies:** T4, T8.

### T13 — Docs + changelog
Update `README.md` + `src/conductor/README.md` (new `build_progress_halt` config + progress-aware
halt behavior), add a `CHANGELOG.md` `[Unreleased]` entry under Fixed/Added. No migration block
(additive, opt-in-on-by-default config with exact-revert kill switch; internal daemon behavior — no
CLI/hook/schema-breaking surface). If the self-host release gate flags a surface, add a waiver per
CLAUDE.md; otherwise none needed.
**Dependencies:** T1–T12.

## Task Dependency Graph

```
T1 ─┬─ T2 ─┐
    │       ├─ T4 ─┬─ T5
    │       │      ├─ T6
    │       │      ├─ T11
    │       │      └─ T12
T3 ─┴─ T7 ─┴─ T8 ─┬─ T9
                  ├─ T10
                  ├─ T11
                  └─ T12
(T13 depends on T1–T12)
```

**Dependencies summary:**
- T1: (none)
- T2: T1
- T3: (none)
- T4: T1, T2
- T5: T4
- T6: T4
- T7: T3
- T8: T3, T7
- T9: T8
- T10: T8
- T11: T4, T8
- T12: T4, T8
- T13: T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12

## Prerequisites
None — no migrations, no new dependencies. `npm install` inside `src/conductor` per worktree; run
tests from `src/conductor`.
