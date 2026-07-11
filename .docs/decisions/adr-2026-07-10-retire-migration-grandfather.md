# ADR: Retire the H8 migration-grandfather path — evidence stamps are the only completion currency

**Date:** 2026-07-10
**Status:** APPROVED
**Deciders:** James Stoup (operator-directed fix for #463; approval via spec PR merge)
**Supersedes:** the H8 migration-grandfather decision of `adr-2026-07-05-engine-owned-task-status`
(that ADR's H1–H7 and H9 remain authoritative; never-demote for *evidence-stamped* rows is
untouched — only grandfather-backed, evidence-less rows lose standing)

## Context

The engine-owned task-status cutover (merged 2026-07-07, `5c73c293`) introduced an H8 migration
aid: on the FIRST seed of the `.pipeline/task-evidence.json` sidecar, `seedTaskStatus`
(`task-seed.ts:151-166`) stamps every existing terminal (`completed`/`skipped`) row whose id the
plan defines into `migrationGrandfather`, and the build gate (`artifacts.ts:741-755`) accepts a
grandfathered id as resolved whenever its row is currently terminal — with **no commit evidence**.

This was meant to protect pre-cutover in-flight worktrees whose real completions predate evidence
stamping. But it is also a standing forgery hole: whenever the sidecar file is absent (fresh
`.pipeline` after a worktree recreate, a rekick that reconstructs state, or an agent deleting the
sidecar), an agent that flips rows to `completed` gets those flips grandfathered at the next seed
and the build gate passes with zero commits. The post-rebase pre-verify then re-derives from
commits and demotes the same rows — the exact un-convergeable halt/rekick loop of #463 (observed
2026-07-10, `setup-before-dispatch-wedge`: build ✓ 10:08Z with no commits since 05:48Z → finish
rebase → 9/17 reset → halt → rekick).

Verified: `conduct task done` never writes `task-status.json` (it only clears the
`.pipeline/current-task` stamp), so there is no CLI chokepoint to guard — rows are written by
`applyDerivedCompletion` or directly by agents. The gate's own H6/H7 hardening already demotes
unstamped rows; grandfather is the one remaining way a row can count without a commit.

## Options Considered

### Option A: Corroborate grandfather candidates at seed time
Only grandfather a terminal row if commit-derived evidence confirms it (run derivation during seed).
- **Pros:** Preserves the migration aid for any straggler pre-cutover worktree.
- **Cons:** A row derivation CAN confirm doesn't need grandfathering — derivation stamps it
  anyway. The set "legitimate but underivable" is exactly the set indistinguishable from forgery;
  no deterministic test separates them. Complexity with zero discriminating power.

### Option B: Retire grandfathering entirely (write side and read side)
Remove the first-seed stamping in `task-seed.ts` and the `migrationGrandfather` acceptance in the
gate resolution; keep the sidecar field parse-tolerated (old files still load) but inert.
- **Pros:** Closes the forgery hole completely and deterministically. One evidence currency:
  git-derived stamps. The migration window has passed — the cutover shipped 2026-07-07 and every
  active worktree has since re-seeded; post-#418/#433 commits carry engine-stamped trailers, so
  genuine completions re-derive from commits with the corrected anchor
  (adr-2026-07-10-evidence-range-anchor-resolution).
- **Cons:** A hypothetical still-in-flight worktree with genuinely-completed, underivable
  pre-cutover tasks would see those tasks reset to pending and rebuilt — bounded re-work, fail-closed.

### Option C: Guard the write point (`task done` refuses evidence-less flips)
- **Pros:** Fails at the moment of the mistake.
- **Cons:** The write point doesn't exist as a chokepoint — `task done` never writes status rows
  and agents edit the JSON directly. Unenforceable; subsumed by read-side derivation.

## Decision

**Option B — retire H8.** The gate resolves a task **only** by a real `evidenceStamps` entry
(re-derived from git on every evaluation). `seedTaskStatus` stops stamping `migrationGrandfather`;
gate resolution stops reading it; loading old sidecar files with the field remains harmless.
With adr-2026-07-10-evidence-range-anchor-resolution this makes the build gate, auto-heal, and
post-rebase pre-verify provably agree: same predicate, same anchor, same single evidence currency
— an evidence-less status flip can never pass any of them, so the #463 loop cannot form.

## Consequences

### Positive
- Forged/evidence-less terminal rows can never satisfy the build gate, regardless of sidecar
  presence, worktree recreation, or rekick timing.
- Gate and pre-verify verdicts are structurally identical — the halt/rekick divergence class dies.
- Simpler mental model and code: one way for a task to count.

### Negative
- Any residual pre-cutover in-flight feature with underivable completions resets those tasks and
  rebuilds them (fail-closed re-work; none known to exist as of 2026-07-10).

### Follow-up Actions
- [ ] Remove first-seed grandfather stamping from `task-seed.ts` (keep sidecar field tolerated on load).
- [ ] Remove `migrationGrandfather` acceptance from the gate resolution in `artifacts.ts`.
- [ ] Adversarial tests: forged terminal rows + absent sidecar + zero commits must fail the build
      gate AND the post-rebase pre-verify with the same verdict; sidecar deletion mid-build must
      not resurrect completions.
