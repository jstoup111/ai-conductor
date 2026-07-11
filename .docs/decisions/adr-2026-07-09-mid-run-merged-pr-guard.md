# ADR: Mid-run merged-PR guard — synthetic verified-ship stop on out-of-band merge

**Date:** 2026-07-09
**Status:** APPROVED
**Relates to:** adr-2026-07-03-committed-shipped-record-dispatch-dedup (dispatch/rekick dedup),
issue jstoup111/ai-conductor#358

## Context

The daemon's kickback rewind (gate failure → `navigateBack(state, 'build', steps)`) re-runs the
whole step chain. During that window an operator can manually merge the feature's recorded PR
(observed in #358: finish failed try 1 on a stale title, the operator retitled and merged #350
by hand, and the daemon rebuilt/re-audited/rebased a branch whose content was already on main —
ending in an unresolvable rebase-conflict HALT). The existing dedup
(`makeIsProcessed`: ledger marker + committed shipped records) guards *dispatch* and *rekick*
only; it cannot see a PR merged mid-run.

## Decision

Add a shared **merged-PR guard**, active in daemon mode when the feature's `pr_url` is
recorded, invoked at exactly three kinds of points:

1. **Kickback re-entry** — at each gate-failure route that calls `navigateBack(state, 'build', …)`
   (`conductor.ts` sites at ~1786, 1856, 1917, 1975, 2046), before the rewind is committed.
2. **Rebase backstop** — at the top of `runRebaseStep` (`conductor.ts:2859`), before
   `performRebase`.
3. **Rekick play-forward** — in `resumeRebaseFirst` (`daemon-rekick.ts`), before its direct
   `performRebase` call. *(Amendment 2026-07-09, operator-approved during conflict-check: the
   rekick path rebases outside `runRebaseStep`, so a feature merged by hand while parked would
   otherwise re-halt on the same duplicate-branch conflict. On `MERGED` at this site the daemon
   writes the processed marker with the recorded `prUrl` and retires the feature without
   re-dispatch — same fail-open semantics on every other verdict.)*

The guard calls the existing `prMergeState(runGh, cwd, prUrl, log)` (`pr-labels.ts:277`;
production runner `makeProductionGh()`, already used in-engine at `artifacts.ts:1180`;
test runner injected).

**On `MERGED`:** stop the run as a **synthetic verified ship** — write the finish-choice marker
(`.pipeline/finish-choice` = `pr`, `artifacts.ts:317`) and the DONE marker (`.pipeline/DONE`),
leave `pr_url` in `conduct-state.json` untouched, log
`already shipped out-of-band; local branch retained at <sha>`, and terminate the run loop
without executing further steps. `readWorktreeOutcome` (`daemon-deps.ts:224-262`) then yields
`done=true, finishChoice='pr', prUrl≠null`, so `isVerifiedShip` (`daemon-runner.ts:144`) passes
and the daemon-runner's **existing** ship path performs `markProcessed` + cleanup + enroll.
No second ship pathway is introduced; side-effects stay owned by the daemon-runner.

**On `OPEN` / `CLOSED` / `NOTFOUND` / `UNKNOWN` or any gh failure:** the guard is advisory —
log at debug level and proceed with the normal retry/rebase unchanged. It is **fail-open** and
must never become a new HALT source. `CLOSED` (closed-not-merged) deliberately proceeds: a
closed PR is not shipped content.

The feature branch is **never deleted** by the guard.

## Consequences

- The #358 race exits cleanly at the earliest checkpoint instead of burning a rebuild + audit
  cycle and landing in a human-only rebase HALT.
- The synthetic verified-ship does not weaken the false-ship guard (#204/#205 Task 12): the
  `pr` finish-choice is only synthesized after a live `gh pr view` verdict of `MERGED` on the
  recorded PR — stronger evidence than the normal path requires.
- **Known limitation:** no committed `.docs/shipped/<slug>.md` reaches main for this feature
  (finish never completed; the branch is already merged, so a new commit on it goes nowhere).
  Local dedup rests on the `.daemon/processed/<slug>` ledger marker — the fast path of
  adr-2026-07-03-committed-shipped-record-dispatch-dedup. This matches the pre-existing state
  for any manual out-of-band merge and is accepted.
- If the operator's manual merge predates local rework commits made during the retry chain,
  that rework never ships automatically; the retained branch and the log line make it
  recoverable by a human. The operator who merges mid-run owns that trade-off.
- Guard cost: one `gh pr view` per kickback / rebase entry, bounded by
  `MAX_KICKBACKS_PER_GATE` — no polling, negligible API budget.

## Evidence

- Kickback sites + rewind mechanics: `conductor.ts:1786/1856/1917/1975/2046`, `navigateBack`
  at `conductor.ts:187` (verified by inspection 2026-07-09).
- Outcome derivation from markers: `daemon-deps.ts:224-262`; markers `artifacts.ts:317-318`,
  `DONE_MARKER` `conductor.ts:173` (daemon writes it at `conductor.ts:2409-2412`). Verified.
- `prMergeState` semantics incl. `MERGED`: `pr-labels.ts:277-306`; existing consumer
  `mergeable-sweep.ts:183-195`. Verified.
- Assumption (inferred, ~90%): a MERGED recorded PR ⇒ the feature is shipped and stopping is
  safe. Mitigated by branch retention + explicit log; approved by the operator with Approach C
  on 2026-07-09.
