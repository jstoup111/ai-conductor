# Complexity: Halt records committed on stacked child branches make every restack conflict (#3451)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. The rule that picks the newest halt record reads the record's existing `Resolved at:` and `Halted at:` lines; the record format is unchanged. |
| External integrations | None. The provider resolver is still invoked, but only for conflicts that involve something other than the halt record. |
| Auth / permission surface | None |
| State machines | None new. The restack journal, closure refs and rewrite map keep their shapes. Each omitted halt-record-only commit maps to the rewrite of the nearest kept commit before it, or to the new parent; one after the last kept commit maps to the final tip. An unentered leaf at such a commit therefore still has a rewrite to move to. |
| Story count | 3: the resolver fallback never handles halt-record bookkeeping; the replayed tip carries the newest record on both replay paths; flat features and non-bookkeeping commits keep their current behavior. |
| Files touched | About 6 production files (one of them only exports an existing function): a new `engine/restack/halt-record-bookkeeping.ts` (halt-record-only predicate, newest-record choice, tip bookkeeping commit, omitted-commit rewrite mapping), `engine/restack/restack-replay.ts`, `engine/restack/restack-resolver.ts`, `engine/restack/restack-ownership.ts` (exports `ownedPaths` so the winner rule and acceptance share one definition), and the two callers that hand a conflict to the resolver, `engine/restack/restack-executor.ts` and `engine/restack/restack-recovery.ts`. |
| ADR work | No new ADR. An amendment to `adr-2026-10-10-stacked-restack-journaled-replay` decision 2 replaces "Inside a range: replayed; the upper child's record wins" with the bookkeeping rule, and an amendment to decision 6 removes halt-record-only commits from the resolver's todo and so from FR-9's subject list. |

## Rationale

Medium. The change spans two replay paths: the plumbing `replayChildRange` and the
`git rebase` fallback in `resolveRestackConflict`. Both must apply one shared rule, or they would
disagree about which record survives. The change also amends an APPROVED decision about replay
membership. A mistake either drops a real feature commit, because it was misclassified as halt
bookkeeping, or leaves an older halt record at the tip. A misread record then tells the operator
the wrong halt state, or makes recovery read a resolved halt as outstanding
(`restack-recovery.ts:371`). No new module boundary, persisted state shape or integration is
introduced, so the change is not Large.
