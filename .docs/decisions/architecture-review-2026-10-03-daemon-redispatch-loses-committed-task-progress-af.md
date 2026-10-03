# Architecture Review: Task-status recovery after abrupt daemon death

**Date:** 2026-10-03
**Mode:** Lightweight (Medium tier) — Sections 2 and 4 only
**Input:** explore output + technical intent (technical track; stories not yet written), intake
jstoup111/ai-conductor#2673, approved diagram
[`daemon-redispatch-loses-committed-task-progress-af`](../architecture/daemon-redispatch-loses-committed-task-progress-af.md)
**Scope boundary (binding, from `.docs/track/`):** minimal — single-row trailer restore on every
reseed, stale `in_progress` reset at the pre-BUILD dispatch seed, restored acceptance assertions.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. Reuses `trailerProvenCompletions` (branch-scoped, fail-closed git trailer scan) already in `task-seed.ts`. Verified (100%): function exists and is called today only on the `reconstructing` path. |
| Prerequisites | None. No migration, config key, or schema change; `restored_from: 'task-trailer'` already exists on restored rows. |
| Integration surface | Two modules: `engine/task-seed.ts` (`seedTaskStatus`) and `engine/conductor.ts` (`seedBuildTaskTelemetry`). |
| Data implications | `.pipeline/task-status.json` gains rows only for plan tasks with no row; `in_progress` rows flip to `pending` only at the dispatch seed. No existing completed/skipped row, `.pipeline/events.jsonl`, or DECIDE state is written. |
| Performance risk | One `git merge-base` + bounded `git log` per seed, and only when a plan task lacks a row (or, at the dispatch seed, when an `in_progress` row exists). Today the common path pays nothing; that stays true. |
| Worktree isolation | Per-worktree `.pipeline/` only; no shared resource. |

**Seed callers verified (95%, read in this checkout):** `seedBuildTaskTelemetry` (pre-BUILD
dispatch), the `build` completion predicate in `artifacts.ts`, remediation append in
`conductor.ts`, and `repair-restage.ts`. Only the first is guaranteed to run with no live build
session. I did not prove the completion-predicate seeds never overlap a live session (~60%), which
is why the `in_progress` reset is confined to the dispatch seed.

## Alignment

**Governing ADRs (reused, not duplicated):**
- `adr-2026-09-06-reopened-task-resolution` — owns shared resolver/reconstruction behavior and
  restart recovery. Its Local Pattern Basis note ("reconstruction is distinct from ordinary
  reseeding") is the constraint this change relaxes. Its D6 already claims recovery of "missing
  task-status rows while engine state survives", so per-row restore matches its intent. Amended
  additively with **decision 12** and a note beside the pattern-basis line; decisions 1-11 unchanged.
- `adr-2026-07-23-trailer-union-build-step-routing` — D4 forbids sha reachability inside
  `resolveTaskIds`. Not touched: this change lives in seeding, and `resolveTaskIds` already unions
  trailers for routing (#859). After the change, the build agent's row view and the gate agree.
- `adr-2026-07-11-attribution-abstain-or-loud` — deleted the unique-`in_progress` attribution
  fallback; commit attribution reads the `.pipeline/current-task` stamp, not the row. Resetting a
  stale row does not change attribution.
- `adr-2026-09-06` D11 (`plan_amendment`, #2014) — reopened tasks are open obligations, and the
  open-repair override runs after restore, so a rewritten task is never re-closed by a pre-change
  trailer.

**Pattern consistency:** additive restore mirrors the existing reconstruction branch (same
function, same fail-closed range, same `restored_from` marker). The dispatch-only reset follows
the existing "seed best-effort before every BUILD dispatch" seam rather than adding a new hook.

**State management:** no new statuses. Transitions added: *(absent) → completed* (trailer-proven)
on any seed; *in_progress → pending* (no trailer) at the dispatch seed only.

**Diagram accuracy:** the approved feature diagram reflects the planned flow; no container or
external integration changes.

**Security / DI defaults:** not applicable (no endpoint, no DI registration).

**Event spine:** no new observation channel. The existing `console.warn` restore line is retained;
no sidecar or poller is introduced.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| Per-row trailer restore inside `seedTaskStatus` | Every existing `seedTaskStatus` caller; the daemon reaches it through `seedBuildTaskTelemetry` before every BUILD dispatch and through the `build` completion predicate in `artifacts.ts`. |
| Dispatch-boundary recovery option on `seedTaskStatus` | Passed only by `seedBuildTaskTelemetry` in `engine/conductor.ts`, the existing pre-BUILD dispatch seed. |

Advisory overlap scan (`ai-conductor overlap-scan` over `task-seed.ts`, `conductor.ts`, the
acceptance test): no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A trailer on a multi-commit task restores a missing row as completed before the task is done | Data | Low | Medium | Same semantics `resolveTaskIds` already applies for routing; `build_review` completeness re-judges the diff. Restore applies only to rows that are missing. |
| A future in-session caller passes the dispatch option and resets a live `in_progress` row | Technical | Low | Medium | Option is passed only by `seedBuildTaskTelemetry`; a unit test pins that non-dispatch seeds preserve `in_progress`. |
| A stale `.pipeline/current-task` stamp survives the reset | Technical | Low | Low | Out of scope by operator decision; the session hook rewrites the stamp on each subagent dispatch. |
| Per-row restore resurrects a row deliberately deleted by some writer | Data | Low | Medium | Verified no engine writer removes rows (restage flips to `pending`; reopen uses obligations). |

## ADRs Created

None. Amended `adr-2026-09-06-reopened-task-resolution` with decision 12 (additive).

## Conditions

1. An `in_progress` row is reset to `pending` at the dispatch seed **only when no branch-scoped
   `Task:` trailer exists for it**; an `in_progress` row with a trailer is left unchanged (scope
   excludes upgrading it to `completed`). Operator-confirmed load-bearing assumption.
2. Non-dispatch seeds preserve `in_progress` rows exactly as today.
3. Existing rows of any status are never upgraded from a trailer outside wholesale reconstruction.
4. The original #2673 assertions are restored in
   `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts`: single-row loss from an
   otherwise usable file is restored from its trailer, and a stale `in_progress` row with no trailer
   becomes `pending` after the dispatch seed.
