# ADR: Commit-movement liveness floor under the build stall breaker; attributed-task count demoted to advisory

**Date:** 2026-07-23
**Feature:** `builds-stall-when-work-lands-without-task-trailer-`
**Relationship to prior ADRs:** extends `adr-2026-07-23-trailer-union-build-step-routing.md`
(#859) and the #773 demote-task-stamping pair — does NOT supersede either. #859 §2's freeze
of the stall predicate's count-comparison shape is left intact; this ADR adds a conjunct
(the liveness floor), it does not alter the count semantics. #859 §1's routing-vs-authority
split is completed: the breaker stops being able to terminally kill a build that produced
real work, leaving `build_review` as the only thing that can reject it.

## Context

The stall breaker's only liveness signal is the attributed-task count
(`countResolvedTasks`: completed/skipped rows ∪ `Task:`-trailered commits). Attribution
coverage is structurally partial **by design**:

- #519 abstain-or-loud: every uncertainty path removes `.pipeline/current-task` and
  abstains — misattribution is treated as worse than no attribution. Correct, and kept.
- `post-dispatch` clears the stamp when a Task-tool dispatch returns; main-session commits
  after that point are unstamped by design.
- `Task: none` dispatches are legal and unattributed.

Live evidence (read 2026-07-23, worktree `engineer-unclaim-requeue-verb-stale-claimed-ledger`):
11 grammar-valid dispatches, 20 real commits since merge-base, trailers for only 3 task ids;
terminal HALT "resolved tasks stayed at 3 after 3 attempt(s)"; the feature shipped unchanged
after an operator unpark — the HALT was false. 31 completion/stall log lines occurred after
#859's union fix merged: #859 fixed the union logic; it cannot fix missing inputs.

Conclusion: any liveness signal derived from per-task attribution undercounts real progress,
under every leak cause, known or unknown. The breaker needs a signal that does not depend on
attribution.

## Decision

1. **Liveness floor.** The breaker classifies `no_task_progress` only when the attributed
   count is pinned **AND** HEAD did not move during the attempt
   (`attempt >= 2 && after <= before && headUnmovedThisAttempt`). Count pinned with HEAD
   moved is a new non-stall state, **unattributed progress**: the retry continues and an
   `unattributed_progress` telemetry event is emitted.
2. **Per-attempt SHA baseline.** The floor compares HEAD against a baseline re-captured
   every attempt (rolled at loop bottom like `resolvedTasksBefore`). The existing per-step
   `headShaBeforeBuild` const (`conductor.ts:3054`) is deliberately NOT reused — it would
   credit attempt N with attempt 1's commits and blind genuine-wedge detection
   (verified: it is captured outside the attempt loop).
3. **Budget exhaustion with real work routes to the authority.** When the fixed retry
   budget exhausts and at least one attempt moved HEAD, the step advances to `build_review`
   through the same seam the completion gate uses — it does not terminal-HALT.
   `build_review`'s fail-closed plan-vs-diff rubric (which needs no attribution) judges the
   work; FAIL kicks back, bounded by the existing `MAX_KICKBACKS_PER_GATE`.
4. **Attributed count demoted to advisory.** `countResolvedTasks` remains for retry hints
   (naming unresolved ids), re-kick eligibility (`daemon-cli.ts`), kickback-escalation
   baselines, and the #280 progress-bypass — all advisory/routing uses. It can no longer be
   the sole cause of a terminal HALT. Contract text states this once, consistently:
   `skills/pipeline/SKILL.md`, `docs/daemon-operations.md`, `src/conductor/README.md`.
5. **Genuine wedges preserved.** Count pinned AND HEAD pinned classifies exactly as today:
   `no_task_progress` → #569 `/remediate` routing → HALT. The `halt_marker` path and the
   #280 progress-bypass/attempt-ceiling machinery are untouched.

## Alternatives considered

- **Close the attribution gaps instead (100% stamping coverage).** Rejected as the primary
  fix: it fights #519's deliberate abstain-or-loud posture, is whack-a-mole against agent
  commit behavior, is structurally wrong under parallel dispatch (#531/#474 — one global
  current-task stamp), and even 95% coverage leaves a residue that still false-halts. May
  still be pursued later as telemetry polish; nothing here blocks it.
- **Diff-size / meaningful-change heuristics in the breaker** (guard against no-op commits
  gaming the floor). Rejected: wedge-class reasoning barred by #859 §4; the authority
  already FAILs an incomplete diff, so gaming the floor buys retries, never a false ship.
- **Reuse the per-step `headShaBeforeBuild` for the floor.** Rejected — verified wrong
  granularity (Decision 2).

## Verified claims

All read directly from source this session (~95% unless noted): breaker classification and
`lastBuildStallReason` (`conductor.ts:3768-3778`); per-step SHA capture outside the loop
(`:3054` vs loop at `:3149`); `detectZeroWorkProduct` pinned `false`
(`attribution-enforcement.ts:183-190`) — the floor does not depend on it; `stalled`
consumers confined to this site (`:3939-4189` — #569 remediation synthesis, auto-park,
retry accounting); pre-dispatch/post-dispatch/prepare-commit-msg stamping chain
(`session-hook-assets.ts`, `git-hook-assets.ts`); dispatch ledger vs commit trailers in the
live halted worktree. Inferred (~85%): no consumer outside `conductor.ts` re-derives
stall classification from the HALT text's exact wording beyond display (`daemon-cli.ts`
re-kick reads, does not parse semantics).

## Consequences

### Positive
- A build with real committed work can no longer terminally HALT as `no_task_progress`,
  regardless of stamping coverage — the daily false-HALT/unpark ritual ends.
- The routing-vs-authority split is finally total: deterministic machinery decides when to
  stop dispatching; only the fail-closed authority can reject work.
- Genuine wedges keep today's exact remediation → HALT behavior, with a regression fixture.

### Negative
- A pathological session that commits no-op changes each attempt burns the full retry
  budget plus a build_review pass before failing — bounded, accepted (gaming buys retries,
  not a ship).
- Builds that would previously HALT early with sparse-but-real work now consume more
  attempts and a review pass before resolution — the cost of never killing real work.

Status: APPROVED
