# Conflict Check: Queued revalidation is admitted at child BUILD entry

**Date:** 2026-10-31
**Stories checked:** `.docs/stories/rebase-base-refresh-revalidation-halts-needs-human.md` (Stories 1–6) against every story file under `.docs/stories/`.
**Result:** PASSED after resolution. 1 blocking conflict was resolved and 0 degrading conflicts remain.

## Inventory

The new stories were compared pairwise against the 19 story files that mention revalidation, the
repair marker, or the re-validation queue. A grep confirmed that no other story file asserts
behavior on queue consumption, the repair marker, or region entry for a queued child. Story files
examined in depth:

- `a-routed-fix-is-never-carried-up-the-stack-or-foll` (#3212: queue production, consumption, acknowledgement, deferral)
- `routed-repair-opens-a-new-round-while-an-earlier-r` (#3445: admission fence, in-loop and resume parity)
- `routed-remediation-skips-re-run-steps-on-stale-chi` (#3455: queue parking HALT)
- `a-routed-fix-cannot-be-built-charged-and-reviewed-` (region entry writes, journal fencing)
- `stack-preflight-refusals-end-the-run-with-no-halt-` (preflight unavailable detail text)
- `admitted-whole-feature-fixes-in-a-stacked-feature-`, `a-change-to-one-stacked-child-cannot-be-carried-in`, `manual-reviewer-edits-cannot-be-landed-safely-in-t`, `operator-command-to-inspect-and-recover-wedged-rou`, `stacked-repair-restack-conflict-above-the-repaired`, `restack-resolver-asks-for-an-operator-decision-no-`, `post-rebase-invalidation-re-runs-every-judged-gate`, `whole-feature-audit-fixes-cannot-land-in-the-stack`

**ADRs examined:**
- `adr-2026-10-12-routed-whole-feature-repair`, including its #3445, #3455, #3459 and 2026-10-31 #3477 amendments
- `adr-2026-10-24-operator-route-round-for-closed-stacked-children`
- `adr-2026-10-10-stacked-restack-journaled-replay`
- `adr-2026-10-07-per-child-build-region`

All other ADRs were narrowed out because no story here touches their subject: routing rounds, the
re-validation queue, restacks, or region entry. No examined ADR is fully superseded.

## Conflict: Region entry refuses a queued child that has no revalidate round

**Stories involved:** Story 8 "Queued children are re-validated bottom-up and acknowledged safely" vs Story 1 "An in-loop restack's queued child is revalidated in the same run"
**Files:** [.docs/stories/a-routed-fix-is-never-carried-up-the-stack-or-foll.md] vs [.docs/stories/rebase-base-refresh-revalidation-halts-needs-human.md]
**Type:** contradiction
**Severity:** blocking

**Description:** Story 8 required region entry to refuse a queued child that had no `revalidate`
round. Story 1 requires region entry to admit that child into a `revalidate` round and enter it.
The two cannot both hold. The guarantee Story 8 protects is that no region step is dispatched
without the child's own round and marker. Story 1 keeps that guarantee.

**Resolution Options:**
1. Rewrite the Story 8 criterion in place. No region step is dispatched before queue admission has created the child's round and marker, and a refused admission halts.
2. Narrow the new stories so admission happens only after the `rebase` step and the routed exit (rejected Approach A).

**Recommendation:** Option 1. It preserves Story 8's safety guarantee and matches the approved
`adr-2026-10-12-routed-whole-feature-repair` decision 8 amendment of 2026-10-31.

**Resolution (operator, 2026-10-31):** Option 1. Story 8's criterion was replaced in place.

## Pairs checked with no conflict

- **Queue-parking HALT (#3455, `routed-remediation-skips-re-run-steps-on-stale-chi`).** That HALT
  fires only when no runnable gate exists. Story 1 acts at region entry once a region gate was
  selected. Both hold in either direction: the two stories have different preconditions.
- **In-loop and resume parity (#3445, `routed-repair-opens-a-new-round-while-an-earlier-r`
  Story 1).** It agrees with Stories 2 and 4. The fence refusals it specifies are the refusals
  Story 1's negative paths rely on.
- **Region-entry writes refused while a restack journal is `moved`
  (`a-routed-fix-cannot-be-built-charged-and-reviewed-`).** These compose with Story 3. A refused
  route-record write makes admission unavailable, and the run halts with nothing written.
- **Preflight unavailable detail text (`stack-preflight-refusals-end-the-run-with-no-halt-`).**
  Story 6 keeps `cannot consume revalidation queue` unchanged.
- **Routing off (`whole-feature-audit-fixes-cannot-land-in-the-stack` Story with
  `route_whole_feature_fixes: false`).** Story 3's ineligible path reads and writes no route record,
  marker or queue generation.
- **No oscillation found.** For each pair above, fully satisfying either story leaves the other
  satisfied.
