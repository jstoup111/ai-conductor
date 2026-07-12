# Conflict-check: satisfied-by-forged-citation-validation

**Source:** jstoup111/ai-conductor#533 · **Track:** technical · **Tier:** M
**Verdict:** CLEAR (no blocking conflicts) — one coordination note with #581.

## Stories reviewed

Stories 1-8 (`.docs/stories/satisfied-by-forged-citation-validation.md`). All exercise a
single code branch: the `Evidence: satisfied-by <sha>` handler in
`deriveCompletionInternal` (`src/conductor/src/engine/autoheal.ts:619-643`).

## Internal consistency (story-vs-story)

| Pair | Assessment |
|---|---|
| S1/S2/S3 (stamp) vs S4-S8 (refuse) | No contradiction — disjoint by construction. Stamp requires ancestor ∧ non-empty ∧ (no-Files ∨ overlap). Refuse fires when any conjunct fails. The predicate is total and deterministic. |
| S3 (no-Files stamps) vs S7 (Files + no overlap refuses) | Consistent: the overlap check is **gated on the task declaring Files**, exactly like the sibling `Task:`-trailer rule (`autoheal.ts:695-707`). No-Files tasks never reach the overlap branch. |
| S5 (off-branch, touches the right file) vs S7 (on-branch, wrong file) | Consistent: **ancestry is checked before overlap**. S5 fails at ancestry regardless of files; S7 passes ancestry+non-empty but fails overlap. Ordering is explicit in the plan. |
| S6 (empty ancestor) vs S1 (non-empty ancestor) | Consistent: the non-empty check (`git diff-tree --quiet`) discriminates them. |

No state conflicts, no resource contention, no ordering contradictions.

## Cross-feature / concurrent-work conflicts (same files)

The active attribution cluster touches neighboring code. Assessed:

1. **#581 judged-attribution-verdict-persistence** — edits the **same function**
   `deriveCompletionInternal` (`autoheal.ts`), but at **different lines**: #581 touches
   the sidecar-stamp precedence branch (`~668`) and the path-corroboration miss (`~709`)
   plus `conductor.ts` gate ordering. This spec touches only the `satisfied-by` branch
   (`619-643`). **No logical conflict** (the two hardened predicates are independent),
   but a **textual merge conflict is possible** if both land close in time. *Coordination
   note:* land order-independent; whichever lands second rebases the other's `autoheal.ts`
   hunk. Both preserve the "empty commit is not evidence" invariant, so they reinforce
   rather than contradict.

2. **#520 semantic-attribution-verification-lane** — owns `validateCitations`
   (`attribution-validate.ts`), which this spec **reuses the pattern of** but does not
   edit. This feature may **import** `validateCitations` (or a shared helper) rather than
   re-implement the ancestry/non-empty/overlap checks — no conflict, a dependency to note
   in the plan (see plan Task 3 design note). If import proves awkward across the
   sidecar/no-sidecar boundary, the fix inlines the three git checks using the in-file
   helpers `filesForCommit` (`autoheal.ts:896`) and `filesOverlappingTaskPaths`
   (`autoheal.ts:43`) — still no edit to #520's file.

3. **#570 isZeroWork / #576 trailers / #530-#529 finish** — operate on the gate-miss and
   finish paths, not the `satisfied-by` derivation branch. No overlap.

## Resolution

No blocking conflicts. Proceed to `/plan`. The plan MUST:
- pin the ancestry-before-overlap ordering (resolves the S5/S7 tension deterministically);
- reuse existing helpers / the #520 validation pattern rather than fork a new checker;
- keep the change confined to the `satisfied-by` branch so the #581 merge surface stays
  minimal.
