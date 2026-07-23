# ADR: build_review grades against a verified-fresh base; scope FAILs get a bounded deterministic disposition

**Status: APPROVED**
**Date:** 2026-07-23
**Feature:** `build-review-grades-plan-vs-diff-against-a-stale-o`

## Context

`assembleBuildReviewInputs` computes the graded diff as
`merge-base(refs/remotes/origin/<default>, HEAD)..HEAD` without any freshness
guarantee on the tracking ref. Other engine paths (the 9.0 rebase's `resolveBase`)
fetch before acting; the grader does not. When a branch's base is ahead of the
tracking ref, main's own merged work appears inside the graded diff and the grader
issues a false out-of-scope FAIL whose retry hint ("fix in build") dispatches an
agent to mutate git history on a healthy branch. Observed live 2026-07-23 (verdict
naming merged PRs #870/#872; incident resolved benignly only because the rework
agent chose backup-branch + rebase over deletion).

## Decision

1. **Fresh-base resolution (A).** Before computing the merge-base, probe the remote
   default head with `git ls-remote origin <default>`; if the tracking ref differs,
   `git fetch origin <default>` and recompute. Share the fetch/derivation seam with
   `rebase.ts#resolveBase` rather than duplicating it. On no-remote or probe/fetch
   failure, degrade to the current local behavior and log an advisory — offline
   grading semantics are unchanged.
2. **Bounded disposition on scope FAIL (B).** A build_review FAIL is not routed to
   rework until the engine deterministically re-verifies the base: refresh, recompute
   the diff, then
   - recomputed diff no longer contains the flagged content → the verdict graded a
     stale view → discard it and re-run build_review (the rebase/refresh path);
   - content persists under a fresh base → genuine out-of-scope work → kick to build
     (today's routing).
   A persisted per-feature-session regrade counter caps invalidation at ONE; a second
   stale detection HALTs with the sha evidence. The engine never rebases or deletes
   in this path — history mutation stays with the existing re-kick machinery.
3. **Telemetry.** Grading emits base-freshness evidence (tracking-ref sha, remote
   head sha, merge-base, fresh flag) to confirm the residual open question of which
   path leaves tracking refs stale.

## Alternatives considered

- **Fetch inside detectDefaultBranch only (no disposition layer):** fixes the trigger
  but leaves the "fix in build" surgery prompt reachable by any future base-skew
  variant; rejected as incomplete for the stated risk (removal of merged work).
- **LLM judge decides stale-vs-real on FAIL:** violates the repo design principle —
  the staleness question is mechanically decidable (byte-presence under a fresh
  base); no judgement needed.
- **Merged-content deletion guard (commit-level):** valuable defense in depth but
  deliberately descoped by the operator to keep this spec S/M-sized; candidate
  follow-up intake.

## Consequences

- One `ls-remote` round-trip per build_review dispatch (network-cheap; skipped when
  offline).
- False scope FAILs stop consuming rework dispatches and stop exposing branches to
  history surgery; genuinely stalled/violating builds route exactly as today.
- The regrade counter is new `.pipeline/` state; it is run evidence (gitignored),
  reset per feature-session.
