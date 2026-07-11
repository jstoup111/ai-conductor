# Architecture Review: Mid-loop `.pipeline` wipe / kickback crash (ai-conductor#549)

**Date:** 2026-07-11
**Mode:** Lightweight (Technical track, Medium tier — Feasibility + Alignment only)
**Track:** technical (no PRD)
**Input reviewed:** issue #549, architecture diagram
`.docs/architecture/mid-loop-pipeline-wipe-549.md`, verified source sites in
`src/conductor/src/engine/`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ Pure engine change in existing TS conductor. No new deps, services, or infra. |
| Prerequisites | ✅ None. All target files exist; the fix edits `step-runners.ts`, `conductor.ts`, and the `mutation-gate-probe` test/helper. |
| Integration surface | ✅ Bounded. Touches the `.pipeline` write choke points + the crash handler + one test helper. Does not cross into daemon-runner, routing, or intake. |
| Data implications | ✅ None (no schema; `.pipeline` is gitignored run-state). |
| Performance risk | ✅ Negligible — one `mkdir` before a handful of writes; one log branch. |
| Worktree isolation | ✅ Improves it — D2 forbids test cleanup from resolving to a live worktree's `.pipeline`, which is the suspected cross-worktree corruption vector. |

The three guard zones are each independently implementable and testable. The root-cause
regression test (Guard 3 / outcome #1) pins the finish→build kickback transition; it is
feasible to construct deterministically because the transition is engine-driven
(navigateBack → build stale → re-dispatch → marker persist), reproducible without an LLM
by injecting a `.pipeline`-removing step between kickback and the persist write.

## Alignment

- **Deterministic-first principle (CLAUDE.md core rule):** ✅ The design is machinery, not
  prompt discipline — ensure-dir + crash-handler reorder + scoped-delete + a loud log,
  all deterministic and failing at the point of violation. It explicitly rejects a
  silent `mkdir -p` band-aid in favour of fail-loud.
- **Defense-in-depth vs "fix the one bug":** ✅ Validated. The ADR keeps D1 (never crash)
  and D2 (fix the actual unscoped delete) as complementary layers, matching the issue's
  demand for both a root cause AND graceful degradation. Neither substitutes for the other.
- **Existing fail-closed gates:** ✅ D3 reuses the evidence/completion gates' existing
  fail-closed behavior for empty state rather than inventing a parallel halt subsystem —
  consistent with the harness's "derive from committed evidence" precedents.
- **Commit-trailer evidence redundancy:** ✅ The design complements (does not duplicate)
  the deterministic-attribution recovery layer that made #549 recoverable at all.
- **No prior ADR conflict:** the `.pipeline`/HALT ADRs on file
  (`adr-2026-06-30-halt-based-release-gates`, `adr-2026-07-04-event-driven-halt-clear-wake`,
  `adr-2026-07-05-engine-owned-task-status`, `adr-2026-07-10-session-hook-task-stamping`)
  govern HALT semantics and task-status ownership; none constrains `.pipeline` write
  crash-safety or cleanup scoping. This ADR is additive, not superseding.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| BUILD guards the write but never pins the real deleter → class silently regresses | Knowledge | Medium | High | Guard 3 regression test is a hard story acceptance criterion; the ADR flags the deleter as a known-unknown BUILD must confirm. |
| D3's loud-recreate is treated as routine and ignored | Process | Low | Medium | Log line is greppable + distinct; fail-closed gates still refuse empty state, so a real wipe cannot ship green. |
| Reorder of the crash handler subtly changes an existing exit path | Technical | Low | Medium | Covered by a story asserting the crash handler flushes state before mkdir; existing conductor tests exercise the outer catch. |
| The actual deleter is NOT mutation-gate-probe → D2 aimed at the wrong actor | Knowledge | Low-Med | Low | D2 is a general rule ("no cleanup removes the root"); it applies to whichever actor Guard 3 identifies. |

## ADRs Created

- `adr-2026-07-11-pipeline-state-durability.md` — **APPROVED**. Defense-in-depth,
  fail-loud-not-crash stance for `.pipeline` run-state (D1 write crash-safety +
  crash-handler reorder, D2 scoped cleanup, D3 loud-recreate on missing root).

## Load-bearing assumption (flagged, non-blocking)

The exact `.pipeline` deleter is ~60% inferred to be the `mutation-gate-probe` temp-dir
cleanup under host load (adjacent to commit 9209d7d2). This is a **known-unknown handed to
BUILD** as outcome #1 (root cause + regression test), **not** a blocking assumption: every
decision in the ADR holds regardless of which actor deleted the directory. No operator
hard-block is required to proceed to stories.

## Verdict

**APPROVED.** Proceed to `/stories`. One new ADR was drafted and is recorded APPROVED; a
High-impact risk (knowledge — deleter unpinned) is registered, so the review marker is
written for operator visibility.
