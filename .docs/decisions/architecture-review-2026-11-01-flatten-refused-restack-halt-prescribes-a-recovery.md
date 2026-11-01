# Architecture Review: Stacked restacks recover merge-bearing conflicts automatically

**Date:** 2026-11-01
**Inputs reviewed:** explore output and track scope for #3438; `.docs/architecture/flatten-refused-restack-halt-prescribes-a-recovery.md`; the restack executor, recovery, resolver, replay and conflict-record modules; the three amended ADRs.
**Verdict:** APPROVED

## Feasibility

- **Stack and data.** No new dependency, schema, or migration. One new engine-owned ref, `restack/conflict/flattened-tip`.
- **Why it can work (verified in scratch repositories, 2026-11-01).** A linear chain with `Flattened-merge:` commits, picked through `git rebase -i --onto <newParent> <oldParent>`, kept the hand edits of a not-carried merge and a Q-carried merge, and left no merge commit. The chain's tree equalled the child's tip. A plain `git rebase --onto` from the chain tip also kept them, and a plain rebase of the merge-bearing tip lost them.
- **Emptied merges (verified).** A flattened merge whose change the new parent already contains stops `rebase -i` as an empty pick, and its missing subject would then fail FR-9. The design therefore drops such entries before the hand-off, from both the todo and the candidate subjects, testing `merge-tree --merge-base <entry parent> <newParent> <entry>` against the new parent's tree.
- **Not yet proved.** None of this has run through `resolveRestackConflict` with a provider resolver. The plan carries real-git tests through the engine path.

## Alignment

- **Governing decisions are reused, so no new ADR.** `adr-2026-10-10-stacked-restack-journaled-replay` decision 6 owns the hand-off, and decision 3 owns merge classification. `adr-2026-10-25-operator-recorded-restack-conflict-resolution` and `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts` own the halt, record and recipes. Each statement this change falsifies carries an amendment note.
- **`adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history` is not amended.** Its refusal governs N=1, which is unchanged. Its stated reason is that a resolver must not be dispatched against a worktree with no rebase state. The stacked resolver has its own temporary worktree, so that reason does not extend to restacks.
- **Pattern basis.**
  - Role: `replayChildRange` in `restack-replay.ts` is the precedent for classification.
  - Traits to preserve: the `classifyReplayMerge` `stacked` mode, the `Flattened-merge:` trailer, and `rebase_merge_audit` reporting.
  - Why it applies: the hand-off must apply exactly the commits the plumbing replay would, as decision 6 already requires.
  - Allowed variation: the hand-off needs commits it can `pick`, so it builds a chain where the replay builds only trees.
- **Retired machinery.** With no restack writer left, the `flatten_refused` value leaves `RestackRefusalReason`, and `mergeInRange` and recovery's `flatten-refused` result are deleted. `RebaseOutcome`'s `flatten_refused` kind belongs to N=1 and stays.
- **State and security.** The chain is unreachable objects until pinned, and only the pin is durable. No new input crosses a boundary: the operator commands and their refusals are unchanged.
- **Worktree isolation.** Refs are per-feature, and the resolver keeps its temporary worktree.
- **Production DI defaults.** No stateful store or registered default changes.

## Wiring Surface

- **Flattened chain builder:** called by `resolveRestackConflict`, which `runRestack` and `resumePlanned` already call.
- **Rewrite translation and merge audit:** returned through `RestackConflictResolution`, and read by the existing `updateRestackChildStatus` and `rebase_merge_audit` emission sites in the executor and recovery.
- **`restack/conflict/flattened-tip`:** written by `writeConflictRecord` through `haltRecordedRestackConflict`. Printed by `haltRestackConflict`. Deleted by `conflictDeleteLines`, and named in `featureConductorRefNames`.

Early overlap scan over these restack modules: `No overlap detected; no open blockers.`

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The resolver drops a merge's hand edit inside a file the child owns; no guard detects content loss inside owned paths | Technical | Low | Medium | Same limit as ordinary conflicts, stated in decision 3; moved closed children re-validate under the shipped path |
| A `--tip` recorded for this halt goes stale, as for every restack conflict, until #3557 ships | Integration | High until #3557 | Medium | `--decision` needs no parent-tree match and remains available; #3557 owns the fix |
| In a `--tip` rebase, the chain's automatic entry for a Q-carried merge conflicts when main later edited those lines | Technical | Low | Low | A human resolves it; path ownership refuses a result that changes unowned paths |
| A resolution empties a flattened entry only partway through the rebase, so the rebase stops as it does for an ordinary commit today | Technical | Low | Low | Ends in the ordinary conflict halt under the existing budget |

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong |
|---|---|---|---|---|---|
| A1 | `resolveRestackConflict` and its guards accept a flattened todo unchanged apart from the candidate list, as N=1's engine-written flattened todo does | inferred | 80% | yes | The resolver path needs more change; the plan proves it with real-git tests |
| A2 | No reader validates old `restack_refused` lines against the reason union, so removing the value is safe for persisted events | inferred | 85% | no | Keep the value in the union with no writer |

A1 is approved by operator 2026-11-01.

## ADRs Created

None. Three on-main ADRs are amended.

## Conditions

None.
