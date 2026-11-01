# Conflict Check: Stacked restacks recover merge-bearing conflicts automatically (#3438)

**Date:** 2026-11-01
**Result:** Clean. 0 blocking, 0 degrading.

## Scope

All 666 files in `.docs/stories/` were searched for the shared behavior: merge-bearing children, `flatten_refused`, merge commits, the resolver's todo, candidate subjects, and `restack/conflict/*`. Pairs sharing that behavior were read and checked in both directions.

**ADRs examined:** `adr-2026-10-10-stacked-restack-journaled-replay`, `adr-2026-10-25-operator-recorded-restack-conflict-resolution`, `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`, `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`, `adr-2026-06-29-rebase-conflict-resolution-dispatch`, `adr-2026-07-12-rebase-evidence-stamp-translation`.

**ADRs narrowed out:** the other 368 approved ADRs. None names `flatten_refused` or merge-bearing history.

**Open spec PRs checked:** #3566, #3495, #3403 and #3216 touch no restack file and do not name this behavior.

## Pairs reasoned through

- **Resolved during stories.** Five on-main criteria said a merge-bearing restack conflict halts `flatten_refused`. They were replaced in place in `stacked-repair-restack-conflict-above-the-repaired`, `restack-resolver-asks-for-an-operator-decision-no-`, `a-change-to-one-stacked-child-cannot-be-carried-in`, `halt-records-committed-on-stacked-child-branches-m` and `automatic-rebase-preserves-merges-carrying-unique-`.
- **`--tip` refuses a merge, against a merge-bearing recovery** (`stacked-repair-…` Story 3). Compatible both ways: the printed recipe starts from a linear flattened tip, so its result has no merge, and a tip that still holds a merge remains refused.
- **FR-9 subject presence, against dropping emptied flattened merges.** Compatible both ways: a dropped entry leaves the candidate subjects too, so the guard never requires it, and a merge with a real change stays required.
- **Halt-record-only commits stay out of the todo and FR-9 list** (`halt-records-…` Story 2), against the flattened chain. Compatible: such commits keep the chain's trees continuous but are never todo entries or candidates.
- **Path ownership, against flattened merges.** Compatible: a not-carried merge's side paths are owned by the range, and a Q-carried merge contributes only hand-resolved paths, which ownership already counts.
- **First-parent evidence translation** (`rebase-reopens-completed-repair-tasks-against-stal`), against rewrites for flattened merges. Compatible: rewrites map the first-parent merge to its rebuilt commit, and side-lineage commits are never mapped.
- **N=1 `flatten_refused` stories** (`automatic-rebase-…` Story 4). Compatible: they cover features without children, which this change leaves untouched, and the one stacked criterion was replaced above.
- **No-merge parity** (`adr-2026-10-25-…` decision 9 as amended, and this spec's Story 3). Compatible: the flattened path runs only when the range contains a merge.
- **#3557.** No story conflict. Its open defect affects `--tip` consumption for every restack conflict, and this spec's test uses an unchanged parent tree.

No oscillating pair was found.
