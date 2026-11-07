# Conflict Check: Restack resolver accepts an operator decision (#3478)

**Date:** 2026-10-31
**Result:** PASSED. No blocking conflicts. One degrading state conflict was found and resolved by the operator.

## Inventory

- **Stories scanned:** all 661 files in `.docs/stories/`. The 32 files that mention restack, the rebase resolver or `stack restack-resolve` were compared pairwise against `.docs/stories/restack-resolver-asks-for-an-operator-decision-no-.md` in both directions. Grep checks covered base-refresh conflict halts, `Restack-Conflict` and conflict refs, and resolver prompt or missing-decision assertions.
- **Closest pairs examined:**
  - `stacked-repair-restack-conflict-above-the-repaired` Stories 1, 2, 3 and 7. Its base-refresh parity criterion was replaced in place in this spec.
  - `rebase-full-replay-intent-validation`: the resolver's specific false reason is preserved in the HALT.
  - `daemon-build-start-base-refresh`: flat-feature `performRebase` base refresh, which the excluded plain rebase path handles.
  - `a-change-to-one-stacked-child-cannot-be-carried-in`, `halt-records-committed-on-stacked-child-branches-m`, `restack-cascade-cap-halts-l-tier-stacked-features-`, `admitted-whole-feature-fixes-in-a-stacked-feature-` and `manual-reviewer-edits-cannot-be-landed-safely-in-t`: base-refresh replay, cascade and deferral rules, which never reach the conflict hand-off.
- **ADRs examined:**
  - `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`.
  - `adr-2026-10-25-operator-recorded-restack-conflict-resolution`, as amended.
  - `adr-2026-10-10-stacked-restack-journaled-replay`, as amended.
  - `adr-2026-06-29-rebase-conflict-resolution-dispatch`.
  - `adr-2026-08-23-committed-halt-record`.
  - `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`.
  - `adr-2026-10-24-operator-route-round-for-closed-stacked-children`.
- **ADRs narrowed out:** the remaining restack-mentioning ADRs. They govern publication, evidence translation, seal rebaseline, verification selection and kickback budgets, none of which the stories touch.

## Conflict: A tip and a decision could both be recorded for one child

**Stories involved:** #3522 Story 2 (a recorded tip may stay recorded while its HALT stays live) vs #3478 Story 2 (`--decision` accepted on a live HALT) and #3478 Story 3 (tip precedence)
**Files:** `.docs/stories/stacked-repair-restack-conflict-above-the-repaired.md` vs `.docs/stories/restack-resolver-asks-for-an-operator-decision-no-.md`
**Type:** state-conflict
**Severity:** degrading

**Description:**
The sequence:
1. The operator records a tip, and the HALT clear fails, so the HALT stays live and the tip stays recorded.
2. The operator then records a decision on the same live HALT.

The next restack would consume the tip and silently ignore the newer decision. The decision ref would then stay behind until teardown.

**Resolution Options:**
1. The latest answer wins. Recording either kind deletes the other kind's ref for the same child in the same compare-and-swap transaction.
2. Refuse the second kind while the first kind's ref exists.
3. Accept tip precedence as a documented compromise.

**Resolution (operator, 2026-10-31):** Option 1.
- **ADR.** `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts` decisions 2 and 3 were revised in place; the ADR is not on main. The #3522 ADR's decision-3 amendment note says the same.
- **Stories.** #3478 Story 2 gains both replacement criteria. Story 3's tip-precedence criterion was replaced in place.

## Re-check

After the resolution, all pairs above were re-checked in both directions: no contradiction, overlap, state, resource, sequencing or oscillating conflict remains.
