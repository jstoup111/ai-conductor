# Conflict Check: Routed repair opens a new round while an earlier round is still open

**Date:** 2026-10-26
**New stories:** `.docs/stories/routed-repair-opens-a-new-round-while-an-earlier-r.md` (Stories 1–5)
**Result:** PASSED after resolution. 2 blocking conflicts were found and resolved by the operator; 0 remain.

## Inventory

**Story files examined in full (they share the route record, the repair marker, admission, the
revalidation queue, the base-refresh deferral or the leaf return):**
- `admitted-whole-feature-fixes-in-a-stacked-feature-.md` (#3210: admission, base-refresh deferral)
- `a-routed-fix-is-never-carried-up-the-stack-or-foll.md` (#3212: routed exit, revalidation, leaf return)
- `a-routed-fix-cannot-be-built-charged-and-reviewed-.md` (#3211: region entry, settlement, reroute)
- `whole-feature-audit-fixes-cannot-land-in-the-stack.md` (#2944: cursor and operator surfaces)
- `manual-reviewer-edits-cannot-be-landed-safely-in-t.md` (#3203: operator rounds)
- `a-change-to-one-stacked-child-cannot-be-carried-in.md` (restack and base-refresh follow-on)
- `stacked-features-cannot-be-published-reviewed-and-.md` (publication freeze)
- In-flight `stack-preflight-refusals-end-the-run-with-no-halt-.md` on spec PR #3458 (#3446, the prerequisite)

**Narrowed out:** the remaining files in `.docs/stories/` that matched routing keywords only
incidentally (daemon lifecycle, park, halt-PR presentation, intake, evidence stamping, build_review
rubric and similar). None of them asserts route-record, marker or round-admission behavior.

**ADRs examined:** `adr-2026-10-12-routed-whole-feature-repair` (D4, D6, D7, D13, D14, and its #3445
amendments), `adr-2026-10-24-operator-route-round-for-closed-stacked-children` (D2, D5, D8–D10),
`adr-2026-10-10-stacked-restack-journaled-replay` (D7, the shared preflight).
**ADRs narrowed out:** every other ADR. None governs round admission, reconciliation or preflight stops.
None was excluded as superseded.

## Conflict C1: The stuck-rounds stop contradicts #3446's needs-human preflight halt

**Stories involved:** #3445 Stories 1, 2 and 4 vs #3446 Story 1 (and the stop-channel shape of #3446 Story 4)
**Files:** `.docs/stories/routed-repair-opens-a-new-round-while-an-earlier-r.md` vs `.docs/stories/stack-preflight-refusals-end-the-run-with-no-halt-.md` (spec PR #3458)
**Type:** contradiction
**Severity:** blocking

**Description:** #3458 Story 1's first criterion makes a reconciliation `unavailable` stop with
detail `round advance cas-failed` a HALT "with disposition needs-human". As first drafted, #3445
made the first stuck-rounds stops write no HALT at all, through a "retryable `restack_refused` channel".
#3458 no longer has that channel: its live-owner stop is a `mechanical` HALT, which the daemon's
episode-end sweep re-kicks (`resolveHaltRetention` does not retain `mechanical`). Both readings cannot
hold for the same routing stop.

**Resolution Options:**
1. Make the #3445 routing stops `mechanical` HALTs and escalate to needs-human on the 3rd consecutive
   identical stop. When #3458 merges, this spec amends #3458 Story 1's first criterion in place to use
   a non-routing example detail, and leaves routing-round stops to #3445.
2. Drop the cap, so every routing stop is needs-human as #3458 says.
3. Edit #3458's open spec branch now.

**Selected:** Option 1 (operator, 2026-10-26).

**Applied:**
- #3445 Stories 1, 2, 3, 4 and 5 now state `mechanical` HALTs for fence refusals, contested advances,
  unreadable records and stuck rounds, with Story 4's 3rd-stop needs-human escalation.
- The `adr-2026-10-12` D7 #3445 note, the architecture review, the diagram and the track scope were
  revised to match.

**Pending, required before land:**
- #3458 Story 1's first criterion is amended in place once #3458 is on main.
- If #3458 has not merged when this spec lands, the operator decides whether to hold land or land with
  the dependency edge and carry the amendment at reconcile time.

## Conflict C2: The D7 amendment downgraded every admission refusal

**Stories involved:** `adr-2026-10-12` D7 (#3445 amendment) vs `admitted-whole-feature-fixes-in-a-stacked-feature-` Story 5
**Files:** `.docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md` vs `.docs/stories/admitted-whole-feature-fixes-in-a-stacked-feature-.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-10-12-routed-whole-feature-repair
**Story ID:** Story 5 (`admitted-whole-feature-fixes-in-a-stacked-feature-`)
**ADR opposing sentence (verbatim):** "A refused admission is a retryable stop with its reason, never a needs-human HALT."
**Story opposing sentence (verbatim):** "Given the marker transaction, when another writer has already created a marker for round `r2`, then the transaction fails, the round stays `prepared`, and the feature halts needs-human naming both rounds."

**Description:** The draft amendment covered every admission refusal, including the lost marker race
and the round-limit halt, which existing accepted stories keep as needs-human.

**Resolution Options:**
1. Narrow the amendment to the new non-closed-round fence. The marker race and the round limit keep
   their needs-human halts.
2. Downgrade all admission refusals, and amend the existing accepted story in place.

**Selected:** Option 1 (operator, 2026-10-26).

**Applied:**
- The D7 note now scopes the `mechanical` stop to fence refusals, and names the marker race and round
  limit as unchanged needs-human halts.
- #3445 Story 2 gained a negative path asserting that the lost marker race still halts needs-human.

## Re-check

After the resolutions, every pair was re-tested in both directions ("if A is fully satisfied, does B
still hold?"):
- **Kind-aware fence vs #3212.** Revalidation admission ("no marker exists and no round has a pending
  child host"; the leaf host waits for the queue) is consistent with the fence.
- **Leaf return vs #3212.** "No other round is open and the queue is empty" is consistent with Story 1's
  third criterion and Story 3's continue-after-close walk.
- **Base-refresh deferral vs #3210 Story 6 and #3212 Story 10.** Deferral is unchanged; Story 5 only
  adds that the open round still advances.
- **Operator rounds vs #3203.** Operator admission already requires "no marker, no non-closed round",
  which is stricter than the fence.
- **Self-heal (Story 3) vs the #3212 crash-recovery stories.** A `prepared` record with no marker is
  still aborted first. Admission order changes only when two rounds are already non-closed.
- **Mechanical stops (Stories 1, 2, 4) vs #3458 Story 4.** Same HALT class, same retention behavior.
- **No oscillating pairs found.**

No blocking conflict remains, apart from the pending #3458 in-place amendment recorded under C1.
