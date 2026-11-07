# Conflict Check: Restack accepts resolutions that adapt the new parent's files (#3598)

**Date:** 2026-11-07
**New stories:** `.docs/stories/restack-refuses-child-resolution-that-adapts-tests.md` (Stories 1–4)
**Result:** passed. 1 overlap found and resolved by the operator; 0 blocking conflicts remain.

## Inventory

All of `.docs/stories/` was scanned. Pairs that share the restack acceptance rule, the conflict ref family, the restack halt shape, or gate invalidation were reasoned in both directions:

- `a-change-to-one-stacked-child-cannot-be-carried-in.md`: path ownership, `parentOverlapPaths`, resolver hand-off acceptance.
- `stacked-repair-restack-conflict-above-the-repaired.md`: operator `--tip` checks, consumption, conflict ref lifecycle.
- `flatten-refused-restack-halt-prescribes-a-recovery.md`: merge-bearing resolver results, `flattened-tip` lifecycle.
- `restack-resolver-asks-for-an-operator-decision-no-.md`: conflict record, recipes, ref teardown.
- `operator-restack-tip-resolution-always-refused-sta.md`: stale resolution retirement, record ref teardown.
- `halt-records-committed-on-stacked-child-branches-m.md`: clean-replay `replay-mismatch` with halt-record bookkeeping.
- `a-routed-fix-is-never-carried-up-the-stack-or-foll.md`: inherited rem-block normalization in ownership.
- `post-rebase-invalidation-re-runs-every-judged-gate.md`: rebase gate preservation for test-only own changes.

**ADRs examined:**
- `adr-2026-10-10-stacked-restack-journaled-replay` (decision 3 as amended by #3598).
- `adr-2026-10-25-operator-recorded-restack-conflict-resolution` (decisions 2, 3 and 5).
- `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`.
- `adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref`.
- `adr-2026-10-12-routed-whole-feature-repair` (decision 9).
- `adr-2026-07-20-post-rebase-delta-aware-invalidation`.

**ADRs narrowed out:** every other ADR in `.docs/decisions/`. None governs restack acceptance, the conflict refs, or replay gate invalidation.

## Conflict: Refused resolution on a merge-bearing child

**Stories involved:** #3598 Story 3 vs #3438 Story 1 (refused settled result) and Story 2 (`flattened-tip` recipe start)
**Files:** `.docs/stories/restack-refuses-child-resolution-that-adapts-tests.md` vs `.docs/stories/flatten-refused-restack-halt-prescribes-a-recovery.md`
**Type:** overlap
**Severity:** degrading

**Description:** #3438 said a refused settled result "halts `replay-mismatch`", and starts the merge-bearing `--tip` recipe from `flattened-tip`. #3598 Story 3 makes every ownership refusal a restack-conflict halt whose recipe starts from `refused-tip`. For a merge-bearing child whose settled result is refused, the two stories named different halt shapes and different recipe starts.

**Resolution options:**
1. `refused-tip` wins as the recipe start, because it is the resolver's linear work built from the flattened todo. `flattened-tip` stays pinned under its lifecycle. Narrow #3438's criterion to the restack-conflict halt with reason `replay-mismatch`.
2. `flattened-tip` wins for merge-bearing children, and `refused-tip` is only named in the detail.
3. Skip refused-tip preservation for merge-bearing children.

**Resolution (operator, 2026-11-07):** option 1.
- #3438's criterion now reads "refuses it with `restack_refused` reason `replay-mismatch` naming that path, takes the restack-conflict halt, and no branch or closure ref moves".
- #3598 Story 3 gains a merge-bearing criterion.

## Pairs checked clean

- **#3598 Story 2 vs post-rebase invalidation** (test-only own changes preserve `prd_audit` and `architecture_review_as_built`). Story 2 re-opens only `build_review` and `test_suite`. Counting adapted paths as the child's contribution routes the audits through `adr-2026-07-20-post-rebase-delta-aware-invalidation`'s changed-contribution regrade. Both hold.
- **#3598 Story 1 vs clean-replay `replay-mismatch` stories** (a-change-to-one, halt-records). A clean replay keeps the strict rule, so both hold.
- **#3598 Story 3 vs the conflict ref lifecycle stories** (stacked-repair, operator-decision, flatten-refused, operator-restack-tip). `refused-tip` joins the same persist, verify, delete and teardown sites as the parent pin. A later non-refusal halt removes it, which is compatible with `flattened-tip` being replaced by the latest halt.
- **#3598 Story 4 vs stacked-repair consumption refusal.** The same rule at record and consumption makes the consumption refusal reachable only on range or parent drift. Both hold.
