# Conflict Report: Operator-configurable confidence floor for acting on build_review findings

**Date:** 2026-09-06
**Spec:** jstoup111/ai-conductor#2383
**Stories scanned:** `.docs/stories/operator-configurable-confidence-floor-for-acting-.md` (Stories 1-8)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:127`)
**Result:** PASSED CLEAN after resolution — 2 blocking conflicts found and resolved, 0 remaining,
0 degrading conflicts accepted.

## ADR corpus accounting

All 309 approved ADRs in `.docs/decisions/` were examined. None was excluded on supersession
grounds: `adr-2026-08-29-build-review-remediate-case-adjudication` is only *partially* superseded
(its successor states "All non-conflicting decisions, state/effect contracts, options, consequences,
and limitations in the predecessor remain adopted"), so it was retained for comparison as the scope
rule requires.

**Narrowed in — subject overlaps these stories (8):**

| ADR filename stem | Overlapping subject |
|---|---|
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication | case dispositions, effects, routing |
| adr-2026-08-29-build-review-remediate-case-adjudication | case schema, deferral effect, kickback rule |
| adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal | new config key obligations |
| adr-2026-08-12-cumulative-build-review-convergence-bound | kickback count and cumulative bound |
| adr-2026-07-26-event-sink-registry-exhaustiveness | new event members |
| adr-2026-07-07-audit-trail-event-sink | event completeness invariant |
| adr-2026-08-11-halt-events-ride-the-persisted-spine | additive event field pattern |
| adr-2026-07-04-kickback-event-emission-and-log-prominence | kickback event rendering |

**Narrowed out (301):** no subject overlap with confidence, adjudicator dispositions, kickback
accounting, config keys, or the event spine. `adr-2026-08-16-closed-build-review-finding-vocabularies`
is among these: it governs finding-*identity* vocabularies, and case-record confidence is not an
identity field and enters no identity hash.

## Conflict 1: A demoted-only lap both passes and leaves cumulative untouched

**Stories involved:** Story 4 (A demoted finding costs no budget) vs ADR: cumulative convergence bound
**Files:** [.docs/stories/operator-configurable-confidence-floor-for-acting-.md] vs [.docs/decisions/adr-2026-08-12-cumulative-build-review-convergence-bound.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-12-cumulative-build-review-convergence-bound
**Story ID:** 4
**ADR opposing sentence (verbatim):** "A `build_review` PASS is genuine convergence, so it resets `cumulative` to 0 (and leaves `count` alone)."
**Story opposing sentence (verbatim):** "Given a lap whose only `act` case is demoted, when the lap settles, then the ledger's `cumulative` value is unchanged."

**Description:** Story 6 requires a lap whose every action was demoted to reach a PASS verdict. On
that PASS the ADR's D2 resets `cumulative` to 0. Story 4 asserted `cumulative` is unchanged for
exactly that lap. Both cannot hold: an implementation honoring D2 fails Story 4's assertion, and an
implementation honoring Story 4 as written must suppress a reset the ADR requires. Story 4 overreached
— its intent is that the demotion charges nothing, not that a pass stops resetting the bound.

**Resolution Options:**
1. Narrow Story 4 to assert the demotion does not *increment* `cumulative`, and record that a pass
   may still reset it under the existing D2 rule.
2. Exempt demoted-only laps from the D2 reset, which requires a superseding ADR.
3. Drop Story 6's PASS requirement so the reset never fires.

**Recommendation:** Option 1 because it preserves the approved architectural decision and still
delivers the operator-visible outcome — a demoted finding costs no budget.

**Resolution applied:** Option 1, operator-selected. Story 4's criteria and its Done When now
attribute any observed reset to the pre-existing convergence rule rather than to the demotion.

## Conflict 2: Demotion asserted unconditionally while the floor is inert without a tracker

**Stories involved:** Story 2 (A sub-floor action is demoted to a deferral) vs Story 5 (The floor is inert where a deferral cannot be filed)
**Files:** [.docs/stories/operator-configurable-confidence-floor-for-acting-.md] (same file)
**Type:** contradiction
**Severity:** blocking
**Story ID:** 2
**Story 2 opposing sentence (verbatim):** "Given `act_min_confidence` is 70 and an adjudication returns an `act` case with confidence 40, when the lap is adjudicated, then that case is recorded as a `defer` case and no BUILD work order is published for it."
**Story 5 opposing sentence (verbatim):** "Given no tracker repository can be resolved and `act_min_confidence` is 70, when an adjudication returns an `act` case with confidence 40, then the case remains an `act` case and publishes its BUILD work order as though no floor were set."

**Description:** Story 2 stated the demotion with no tracker precondition, so its Given/When/Then is
satisfied by a fixture with no tracker configured — where Story 5 requires the opposite outcome for
identical inputs. Checked in both directions: fully satisfying Story 2 as written breaks Story 5, and
fully satisfying Story 5 breaks Story 2 as written. The root is story phrasing, not the design — the
implementation is unambiguous — so it resolves in stories rather than routing to architecture.

**Resolution Options:**
1. Add the "a tracker repository is resolvable" precondition to Story 2's demotion criteria, leaving
   Story 5 the sole authority for the no-tracker branch.
2. Merge Story 5 into Story 2 as a single story covering both branches.
3. Restate Story 5 as a degrading exception rather than an acceptance criterion.

**Recommendation:** Option 1 because it keeps each branch independently verifiable and preserves the
inert-floor behavior as its own acceptance criterion.

**Resolution applied:** Option 1, operator-selected. Story 2's demotion criteria and its Done When
now carry the tracker precondition and defer the no-tracker branch to Story 5.

## Pairs checked and found clean

All 28 story pairs were tested in both directions. Beyond the two conflicts above, the pairs sharing
a behavior, entity, field, or gate were:

| Pair | Shared surface | Both directions hold |
|---|---|---|
| 1 vs 8 | confidence value validation | Yes — Story 1 validates the artifact value, Story 8 validates the config floor; different inputs, no shared assertion |
| 2 vs 3 | the demoted case's effect | Yes — Story 2 fixes the disposition, Story 3 the filing; neither constrains the other's outcome |
| 3 vs 4 | effect id stability and budget | Yes — a stable effect id is what makes the no-charge idempotent; mutually reinforcing |
| 3 vs 6 | unfinalized deferral | Yes — Story 3 requires a failed filing to be recorded failed, Story 6 requires such a lap to halt rather than pass; consistent |
| 4 vs 6 | lap outcome for a demoted-only lap | Yes after Conflict 1's resolution |
| 5 vs 6 | no-tracker lap | Yes — Story 5 keeps the case actionable, so Story 6's fully-demoted precondition is simply not met |
| 6 vs 7 | evidence on a halting lap | Yes — Story 7 requires the demotion line to survive an unrelated halt, which Story 6 does not contradict |
| 2 vs 7 | ordering of demotion and emission | Yes — both place the demotion before reconciliation |

No sequencing conflict exists: no story assumes it runs first, and the single ordering constraint
(demotion precedes reconciliation) is asserted consistently by Stories 2 and 7.

No resource contention exists: the stories add one config key and one additive event field, neither
reusing an existing field for a second meaning.

No oscillating conflict remains. Conflicts 1 and 2 each failed the two-directional test before
resolution; both were rooted in story assertions rather than in the design, and neither required an
architecture kickback.

## Re-check

Re-ran the full scan after both resolutions. Zero blocking conflicts, zero degrading conflicts.
