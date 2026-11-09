# Complexity: stack teardown keeps merged child branches whose GitHub head moved

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models or entities | None. The proof reads refs that already exist: `pushed/<branch>`, the merged PR head, and the local branch. |
| Integrations | None new. It uses one more read of an existing kind, a `git fetch origin <sha>` of the merged head when that object is missing locally. `shipment-audit.ts` has the same shape. |
| Auth or identity | Untouched. |
| State machines | None. `deleteStackChildren` keeps its three results: `deleted`, `kept` and `failed`. |
| Story count | 3: a moved head is deleted when every commit is accounted for; an unaccounted commit keeps the branch; a proof that cannot be read retries and deletes nothing. |
| Files touched | `src/conductor/src/engine/stack-teardown.ts` and its test, `src/conductor/test/engine/stack-teardown.test.ts`. Both callers, `mergeable-sweep.ts` and `daemon-park-cli.ts`, are unchanged. |
| Blast radius | Child-branch deletion after the leaf merges. The leaf, the ship gate, FINISH and the tip guard are untouched. |

This is a single-function change to the deletion proof, so it is Small.

It amends publication ADR `adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 12, step 4, in place. The proof changes from "local tip equals `headRefOid`" to an accounted-for proof. No new ADR is needed. Following the Small tier rules, conflict-check, architecture-diagram and architecture-review are skipped.

## Evidence

All 3 stacks published to date kept every child branch and its refs:
- #3483 under #3414;
- #3464 and #3465 under #3426;
- #3480 and #3481 under #3453.

Each child's merged head was 11 to 15 commits past the recorded pushed tip, because `main` had been merged in and CI fixes pushed. Four local tips equal their pushed tip. The fifth, `feat/c2/manual-reviewer-edits-cannot-be-landed-safely-in-t`, carries 2 more commits that touch only `.docs/halted/<slug>.md`. The halt-record push was skipped as `stack-tip-mismatch`, so they never reached the PR.

## Non-trivial details carried into the plan

1. **Accounted-for proof.** Let L be the local tip, P the recorded `pushed/<branch>` tip if one exists, and H the merged PR's `headRefOid`. Every commit in `rev-list L --not P H` must satisfy `isHaltRecordOnlyCommit` (`restack/halt-record-bookkeeping.ts`). Any other commit keeps the branch.
2. **The delete is a CAS on L**, the tip the proof read, not on H. A branch that moves between the proof and the delete fails the CAS, giving `failed`, and the sweep retries.
3. **A missing H is fetched by SHA.** When the fetch or any git probe fails, the result is `failed`, so the sweep retries. An unreadable proof is never converted into `kept` or `deleted`.
4. **Ref cleanup is unchanged.** Once every child is deleted, the existing path deletes the pushed, intent, positions and publication refs.
5. **Fix forward only.** Branches already kept behind `tornDown` records are not revisited. The operator removes them by hand.
