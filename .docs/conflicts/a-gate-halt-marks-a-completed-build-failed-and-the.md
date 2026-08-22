# Conflict Check: A gate halt marks a completed build failed, and the residue blocks every later resume

**Date:** 2026-08-21
**Stories checked:** `.docs/stories/a-gate-halt-marks-a-completed-build-failed-and-the.md` (Stories 1–5) against each other and against the 311 existing story files, with full reads of the ones sharing the engine area: `rekick-resume-runs-finish-while-the-build-gate-ver.md` (resume entry clamp), `manual-rebase-strands-protected-artifact-seal.md` and `2026-07-26-rebased-features-stale-protected-artifact-seal-976.md` (seal verdict composition), `daemon-reaps-a-feature-worktree-at-pr-open-before-.md` (missing worktree on resume), `build-halts-when-a-branch-inherits-an-older-revisi.md`.
**ADR corpus:** `conflict_check.adr_corpus` unset → `change_set`. This spec creates no ADR; the governing ADRs were compared against the design in the architecture review and its six conditions are encoded in the stories.
**Result:** Conflict check passed — 0 blocking, 0 degrading.

## Pairs examined in both directions

| Pair | Shared surface | A→B | B→A | Verdict |
|---|---|---|---|---|
| Story 1 vs Story 5 | seal verdict / `build` status | refusal never stamps failed; genuine failure still does | genuine failure path never sets the refused facet | compatible — disjoint triggers (pre-dispatch verdict vs provider result) |
| Story 3 vs Story 4 | `build = failed`, `test_suite` selection | walk-back dispatches `build` when it is admitted | residual halt only when no admitted step exists | compatible after tightening Story 4's precondition (`build` itself not runnable) — no oscillation: the two paths are partitioned by "is there an admitted prerequisite" |
| Story 3 vs `rekick-resume-runs-finish…` | resume clamp | unconditional walk-back is backward-only, `--from-step` exempt | existing story asserts backward-only + exemption + `failed` unsatisfied → start at `build` | compatible; Story 3 generalises the same predicate to the unclamped path (adr-2026-08-03-build-repair D4 grant) |
| Story 1/2 vs `manual-rebase-strands…`, `…seal-976` | seal verdict | step status untouched on refusal | seal composes its own verdict/escalation classes, says nothing about step status | compatible — different layer |
| Story 2 vs `daemon-reaps-a-feature-worktree…` | missing worktree on resume | prior status unchanged, HALT written | retained/reaped feature reports malformed state explicitly | compatible; Story 2 preserves today's missing-worktree early return |
| Story 2 vs Story 4 | HALT class vocabulary | closed set only | `needs-human` for the gate residual | compatible |
| Story 4 vs Story 5 | `failed` blocks dependents | halt names `build (status: failed)` | `failed` still gates `test_suite` | compatible — Story 4 describes the reporting of Story 5's state |

## Conflicts

None.

## Assumptions surfaced (verify-claims)

- Story 3's unclamped-resume gap is inferred (~60%); its own negative path makes the resume change conditional on a failing pinning test, so no story depends on the hypothesis being true.
