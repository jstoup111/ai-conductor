# ADR: Parked-feature deletion rests on a set of equal-strength proofs, and every refusal names its cause

Status: APPROVED
Date: 2026-08-01
Refs: jstoup111/ai-conductor#1114
Amends: adr-2026-07-27-ancestry-proven-park-reconciliation
Related: adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main, adr-2026-07-25-fail-closed-durable-shipment-evidence

## Context

`adr-2026-07-27-ancestry-proven-park-reconciliation` §3 states: *"Git ancestry is the ONLY deletion
authority."* That sentence is no longer true of the shipped system, and has not been since #1185.

#1185 added a second deletion proof — **merged-PR head identity** (`isSquashMergedAtTip`): a MERGED
pull request for the branch reports the branch's *current* tip as the commit it merged. That proof
exists precisely because under squash-merge `git merge-base --is-ancestor <branch> origin/main`
returns 1 **by construction**, forever, so ancestry alone can never authorize cleanup of a
squash-merged branch. `docs/guides/running-the-daemon.md` and `docs/reference/cli.md` were both
updated to describe two proofs. The ADR was not. The governing decision record now contradicts the
code it governs.

Issue #1114 was filed on the belief that the cleanup arm was still structurally unreachable.
Measured against this repository on 2026-08-01, it is not: of 225 local `feat/*` branches, 186 are
not ancestors of `origin/main`, and the head-identity proof clears 144 of those 186. The branch the
issue cites (`feat/daemon-wiring-check-retries-on-evidence-it-invalidated-it`, PR #924) is already
reconciled and unparked — its `headRefOid` matches its tip exactly. The functional half of #1114
shipped in #1185.

What did **not** ship is the half that makes the arm's health legible, and it is the half the issue
argued was the dangerous part:

- All 42 branches that neither proof clears refuse with the single reason `not-ancestor`, whatever
  the actual cause. That string is now actively misleading: for a squash-merged repository, "not an
  ancestor" is the normal condition of every healthy branch, not a diagnosis.
- Refusals never reach the sweep summary. A merged slug that is refused does not increment
  `reconciled`; it falls through to `parked++`. So `reconciled=0 … parked=15 skipped=54` is exactly
  what a totally unreachable cleanup arm prints, and exactly what a correctly-idle one prints.

The measured cases behind the taxonomy below are real branches in this repository:
`feat/9.3-retro-proposals` carries a `WIP backup` commit past its merged head (must refuse, and can
name that commit); `feat/188-retry-as-escalation` is merely *behind* its merged head and would drop
nothing, yet is indistinguishable today.

**Operator decision (2026-08-01):** scope this to the observability and governance half. Do not add
further deletion proofs. A patch-equivalence proof (synthetic `git commit-tree` of the branch tree
onto the merge base, then `git cherry` against `origin/main`) was prototyped and verified working —
it correctly clears the cited branch, correctly refuses fabricated unmerged content, and costs ~48ms
across 329 commits — but measured against the real backlog it clears only **3** branches the shipped
head-identity proof misses. A third deletion authority over a destructive path is not worth 3
branches. Rejected on cost/benefit, not on correctness.

## Decision

1. **Amend `adr-2026-07-27` §3.** Deletion authority is a *set* of machine-checkable proofs, not one
   proof. Today that set is exactly two, and both are equal-strength:
   - **Ancestry** — `git merge-base --is-ancestor <branch> origin/main` succeeds.
   - **Merged-PR head identity** — a MERGED PR for the branch reports the branch's current tip as
     its `headRefOid`.

   Everything else §3 asserts stands unchanged and is restated here in force: all deletion flows
   through one guarded helper; it accepts exactly ONE explicit slug; it rejects globs, lists, and
   paths; it re-derives evidence itself immediately before any destructive step and never trusts the
   caller's or the sweep's cached classification; issue state, artifact content hashes, and slug text
   never authorize deletion; no force flag exists anywhere. A shipped record on main remains a
   deletion *precondition*, never an authority.

2. **Adding a proof to the set is an ADR-level change.** Any future proof must be recorded here
   before it ships. #1185 shipping a second authority without amending the ADR is the failure this
   clause prevents from recurring.

3. **Every refusal names its cause.** The single overloaded `not-ancestor` reason is replaced by a
   taxonomy that distinguishes what an operator must actually do next:
   - `no-merge-proof` — no merged PR attests this branch, and it is not an ancestor. Nothing shows
     the work shipped.
   - `unmerged-commits` — a merged PR exists, but the branch has advanced past it. The refusal MUST
     name the commits that `branch -D` would drop.
   - `branch-behind-merged-head` — a merged PR exists and the branch is behind it. Deleting drops
     nothing, but no proof currently held authorizes it, so it still refuses.
   - `ancestry-check-failed` — git could not answer. Unchanged fail-closed meaning; never folded
     into the three above.

   `branch-missing`, `record-missing`, `worktree-remove-failed`, `branch-delete-failed`, and
   `unpark-failed` keep their present meanings.

4. **Refusals are counted in the sweep summary.** `ParkedSweepResult.counts` gains `refused`, with a
   per-reason breakdown. The summary line reports it. The log de-duplication signature
   (`sweepSummarySignatures`) MUST incorporate the refusal counts, or a change in refusal mix is
   suppressed and the feature defeats itself.

5. **Deletion strength is unchanged by this ADR.** Every branch deleted before this change is still
   deleted; every branch refused is still refused. This is a naming, counting, and record-keeping
   change only. No branch becomes newly deletable.

> **Amended 2026-09-14 by jstoup111/ai-conductor#1510 (spec `reclaim-merged-feature-worktrees-without-depending`):** the candidate set, the branch the
> proofs key on, and the scope of the record precondition change; the proof set and its strength
> do not.
>
> 6. **The guarded helper's candidate set is the worktree listing, not only the park markers.**
>    `reconcileParkedFeatures` enumerates every git-registered worktree directly under
>    `.worktrees/` from `git worktree list --porcelain` and unions it with the operator-parked
>    slugs. Enumeration produces candidates only: each candidate still enters
>    `reconcileMergedPark` as exactly one explicit slug, and the helper still re-derives every
>    proof immediately before the destructive step. A flat directory read is not an enumeration
>    source — it cannot supply the branch and it misreads nested paths as slugs.
>
> 7. **The helper keys its proofs on the worktree's listed branch.** Evidence is gathered for the
>    branch the listing reports for that worktree, not for a branch whose final path segment
>    happens to equal the slug. The two deletion proofs — ancestry and merged-PR head identity —
>    and their equal strength are unchanged.
>
> 8. **The shipped-record precondition is scoped by branch kind.** A candidate on a
>    `feat/daemon-*` branch keeps the record-on-main precondition, because the daemon backlog
>    dedups dispatch on that record. A candidate on any other branch is reclaimable on the proof
>    set alone; no record is required or consulted for it, because no dispatch depends on one.
>    This adds no proof to the set: nothing becomes deletable that both proofs would refuse.

> **Amended 2026-09-21 by jstoup111/ai-conductor#2636 (spec `daemon-reclaim-sweep-deletes-a-worktree-that-holds`):**
> the reclaim sweep removed an operator worktree holding uncommitted edits, on a freshly created
> branch whose tip still equalled `origin/main`. The reason logged was `ancestry`. A branch with no
> commits beyond its base and a fully merged branch are identical under
> `git merge-base --is-ancestor`, because that test is true exactly when the branch tip is the merge
> base. This amendment narrows what the set can delete; it adds no proof.
>
> 9. **Ancestry alone never authorizes deletion.** An ancestry-proven branch is reclaimable only when
>    a MERGED pull request's `headRefOid` equals its current tip, or a shipped record for the slug is
>    on `origin/main`. Without either, the helper refuses with `no-merge-proof` and the candidate is
>    retained. Merged-PR head identity stays sufficient on its own. The strength of Decision 1 is
>    narrowed, never widened.
>
> 10. **A dirty worktree is never removed.** Immediately before the destructive step, and after every
>     merge proof has passed, the helper runs `git status --porcelain` in the candidate worktree. Any
>     modified, staged, or untracked path refuses with the new reason `dirty-worktree`, and neither
>     the worktree nor the branch is deleted. A failed status probe refuses the same way (fail
>     closed). A candidate with no worktree on disk skips the check.
>
> 11. **Every new refusal is observable on the existing spine.** `dirty-worktree` joins
>     `RefusalReason` and is reported through the existing `worktree_reclaim_failed` event and the
>     sweep log line, as every other refusal is under Decision 3. No new event type or channel is
>     added.

## Consequences

- The governing record matches the code again, and the "one authority" sentence stops being a trap
  for the next reader deciding whether a new proof is legitimate.
- An unreachable cleanup arm is now visible: a nonzero `refused` with a reason breakdown cannot be
  mistaken for a healthy idle sweep.
- `branch-behind-merged-head` is deliberately a refusal rather than a delete. It is safe in
  principle, but authorizing it needs a proof this ADR does not grant. Naming it separately makes
  the case countable, so a future ADR can decide it on evidence rather than on assumption.
- Existing tests that assert the literal `not-ancestor` string must be updated. That is a
  contract-visible change and is why this work is Medium tier rather than Small.

## Alternatives rejected

- **Patch-equivalence as a third deletion authority** — prototyped and verified, but clears only 3
  branches beyond the shipped head-identity proof. Rejected on cost/benefit; a third destructive
  authority must earn more than that. The measurement is recorded above so a later reviewer need not
  redo it.
- **Trusting the shipped record alone to authorize deletion** — this is the failure the 07-27 ADR
  exists to prevent. A record proves the work shipped; it says nothing about commits that landed on
  the branch afterwards, including work racing the sweep. Explicitly still forbidden.
- **Superseding `adr-2026-07-27` outright** — its Context, kill-switch, single-slug scope, and
  re-verification contract are all still correct and in force. Amending the one false clause is
  narrower and keeps the original rationale readable.
- **Leaving the ADR stale and fixing only the code** — the contradiction is precisely what let a
  second authority ship unrecorded.
