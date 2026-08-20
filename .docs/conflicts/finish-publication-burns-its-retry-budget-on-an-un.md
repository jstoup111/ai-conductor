# Conflict Check: FINISH publication burns its retry budget on an unreachable transition

**Date:** 2026-08-13
**Feature:** ai-conductor#1487 — technical track, Tier M
**Stories scanned:** all 6 in `.docs/stories/finish-publication-burns-its-retry-budget-on-an-un.md`
**ADR corpus:** `change_set` (the default — `conflict_check.adr_corpus` is unset). Compared against
the two artifacts in this spec's change set —
`adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` and
`architecture-review-2026-08-13-finish-publication-burns-its-retry-budget-on-an-un` — plus the four
APPROVED ADRs those two cite as governing:
`adr-2026-08-01-engine-owned-resumable-finish-publication`,
`adr-2026-08-06-publication-progress-is-its-own-disposition`,
`adr-2026-08-06-bounded-progress-allowance-for-finish-publication`,
`adr-2026-08-09-one-pr-per-branch-halt-is-a-state`.
**Result:** 1 blocking conflict (resolved), 3 degrading conflicts (resolved). Zero blocking
conflicts remain.

All 15 story pairs were tested in both directions. The four conflicts below are the pairs where at
least one direction failed; the remaining pairs are recorded under "Pairs verified clean".

---

## Conflict 1: The halt short-circuit makes the Cycle A regression unreachable

**Stories involved:** Story 4 (a halt-state PR resolves human-required before any judgment is
dispatched) vs Story 2 (a non-advancing transition resolves human-required on its first occurrence)
**Files:** both in `.docs/stories/finish-publication-burns-its-retry-budget-on-an-un.md`
**Type:** oscillating
**Severity:** blocking

**Description:**

Both directions fail.

*If Story 4 is fully satisfied,* a PR carrying the `needs-remediation` title prefix, label, banner,
or body marker resolves `human_required` **before** the judgment branch is reached. Story 2's Cycle
A negative path opens "Given the Cycle A regression: a `needs-remediation` PR classified `halt` and
a judge returning `revision_required` with reason `placeholder`" — a scenario that can no longer be
reached through the production observer, because the judge is never asked. The regression test
would pass against an implementation that deleted the fixed-point guard entirely, since Story 4's
short-circuit alone produces the asserted halt.

*If Story 2's Cycle A path is fully satisfied end to end,* the halt short-circuit must not
pre-empt judgment for a `needs-remediation` PR — which is exactly what Story 4 requires, and
forfeits outcome-2's "without consuming retry attempts".

This is the costliest shape the skill describes: each story is individually implementable and reads
as reasonable, and the damage surfaces downstream as a `build_review` Tautology finding — a test
that exercises unchanged or unreachable behavior — rather than as a failed build. This repository
is currently cycling multiple features on that exact rubric, so the cost of missing it here is
concrete and measured.

**Resolution Options:**
1. Exercise Cycle A at the `advanceFinishPublication` seam with an injected snapshot whose
   `pr.prose` is a non-`accepted`, non-halt value, so judgment is genuinely reached and the guard
   is the thing that stops the run; Story 4 keeps its own acceptance test through the production
   classifier.
2. Order the halt short-circuit after judgment selection, preserving the literal end-to-end
   historical path.
3. Drop the Cycle A regression and rely on Story 4's short-circuit test alone.

**Recommendation:** Option 1.
**Operator selected:** Option 1 (2026-08-13).

Option 2 forfeits outcome-2 — the provider session is still paid for on every halt PR, which is
half the point of the feature. Option 3 leaves the fixed-point guard with no test against the exact
defect that motivated it, so a later change to halt classification could silently reopen the cycle
with nothing red. Option 1 keeps both behaviors under test and keeps each test pointed at the
mechanism it actually verifies: the guard is tested where the guard runs, the short-circuit where
the short-circuit runs.

**Applied:** Story 2's Cycle A negative path amended in place with an additive
`> **Amended 2026-08-13 by #1487:**` note; the original assertion is preserved.

---

## Conflict 2: Retrying on a recovered observation spends an attempt on real progress

**Stories involved:** Story 6 (an indeterminate dimension retries rather than halting) vs Story 5
(legitimate publication runs converge with no extra attempts)
**Files:** both in `.docs/stories/finish-publication-burns-its-retry-budget-on-an-un.md`
**Type:** contradiction
**Severity:** degrading

**Description:**

Story 6's second happy-path bullet required that a dimension observed as `indeterminate` before the
effect and determinate after it be "treated as undeterminable and the existing retry path taken
rather than a spurious `advanced`". Story 5 requires that "the FINISH retry budget is not consumed
by any transition that advanced".

An `author_pr_prose` pass that moves `pr.prose` from `indeterminate` to `accepted` has done exactly
the work the transition exists to do. Classifying that as undeterminable spends a FINISH attempt on
a transition that genuinely advanced. Only one direction fails — Story 5 holds vacuously under
Story 6's reading, since the transition is not *labelled* advanced — which is why this is a
contradiction rather than an oscillation, but the operational cost is real and the reading is
wrong.

The underlying error is evaluating the guard's three-way split across both observations. The split
belongs on the **post-effect** value alone: determinate-and-changed advances,
determinate-and-unchanged halts, indeterminate retries. A pre-effect `indeterminate` is simply a
value that changed.

**Resolution Options:**
1. Amend Story 6 so only a post-effect `indeterminate` routes to retry; a pre-effect
   `indeterminate` that becomes determinate reports `advanced`.
2. Amend Story 5 to exempt recovered-observation transitions from its no-extra-attempts guarantee.
3. Leave both and let BUILD choose.

**Recommendation:** Option 1 — it is the reading that makes the guard's contract statable in one
sentence about the post-effect observation, and it preserves Story 5 without carve-outs. Option 3
is precisely how an oscillation is manufactured.

**Applied:** Story 6 amended in place with an additive note; the original assertion is preserved.

---

## Conflict 3: Story 3 requires the halt to name a transition the disposition cannot carry

**Stories involved:** Story 3 (the halt names the stage that ran and the dimension that did not
move) vs the `human_required` disposition shape established by
`adr-2026-08-08-finish-human-required-halt-rendering`
**Type:** resource-contention (a shape carrying two different payloads)
**Severity:** degrading

**Description:**

`publication_retry` dispositions carry a `transition` field; `human_required` dispositions carry
only `reason` and an optional `detail` (`finish-publication.ts:1154-1157`, `:1173-1175`). Story 3
requires the rendered halt to name the transition that ran and the dimension that did not move, but
the disposition it is rendered from has nowhere to put either. Story 2 independently requires that
a non-advance emit **no** `PUBLICATION_RETRY_REASONS` entry, so the retry shape — which does carry
`transition` — is unavailable.

The two closed unions themselves do not conflict: `HumanRequiredReason` gains a member,
`PUBLICATION_RETRY_REASONS` does not, and nothing requires the same condition to appear in both.
The gap is only in the payload.

**Resolution Options:**
1. Carry the transition and dimension in the existing optional `detail` field, which
   `renderHumanRequiredHaltReason` already renders and which the decoder already trims and bounds.
2. Widen the `human_required` disposition shape with a `transition` field.
3. Encode the transition into the reason member itself (one member per transition).

**Recommendation:** Option 1 — `detail` exists for exactly this, is already rendered per
`adr-2026-08-08-finish-human-required-halt-rendering`, and needs no change to the disposition
union or to `isExactDisposition`'s shape validation. Option 2 widens a union used across routing
for one consumer's benefit; Option 3 multiplies the reason union sevenfold and duplicates the
guidance table.

**Applied:** Story 3 gained an explicit happy-path criterion for the `detail` carrier, with an
additive amendment note.

---

## Conflict 4: Widened halt detection reclassifies an authored PR carrying a residual halt signal

**Stories involved:** Story 4 (halt detection widens from two signals to four) vs Story 5 (healthy
paths converge unchanged)
**Type:** behavioral overlap
**Severity:** degrading

**Description:**

`prProse` today tests two signals — the `needs-remediation:` title prefix and the banner sentinel
in the body (`finish-publication-production.ts:125-128`). The `needs-remediation` **label** and the
`<!-- conductor:needs-remediation -->` body marker are new inputs. A PR whose prose was authored
normally but which still carries a residual label or marker observes `accepted` today and publishes;
under the four-signal test it halts.

This is not a regression: `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` makes
clearing the marker and the label atomic, so a residual signal means the halt state was never
cleared, and halting is the correct outcome. But the interaction is unstated, and an unstated
behavior change in a shared classifier is how a "healthy path" story and a "widen detection" story
end up disagreeing in BUILD.

The banner sentinel is **not** new, so no conflict exists for the "PR that legitimately quotes the
banner text" case — that PR is classified `halt` today and will be classified `halt` after.

**Resolution Options:**
1. Pin the behavior as an explicit story criterion so it is specified rather than discovered.
2. Restrict the widening to the body marker only, excluding the label.
3. Gate the widened classification behind the halt state also being uncleared by some second test.

**Recommendation:** Option 1. Option 2 drops the signal most likely to survive a partial clear.
Option 3 invents a second halt authority, which is the defect class this feature exists to remove.

**Applied:** Story 4 gained an explicit negative-path criterion with an additive amendment note.

---

## Pairs verified clean

| Pair | Both directions checked | Finding |
|---|---|---|
| Story 1 vs `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` | Does the dimension rule reduce to the rejected "each transition progresses at most once" bound? | **Clean, 95% confidence (verified).** They are not equivalent. In the #1342 revisit the ADR cites, `write_shipped_record` commits the record, which leaves the branch unpushed — so `branchPushed` returns to non-`valid` and the second `establish_pr` visit moves it back to `valid`. A visit-count bound halts on that second visit; the dimension rule advances, because the owned dimension genuinely moved. The rejected bound counts visits; this rule reads state. |
| Story 3 vs Story 2 (two closed unions) | Must the same condition appear in both `HumanRequiredReason` and `PUBLICATION_RETRY_REASONS`? | **Clean, 97% confidence (verified).** The unions are disjoint by construction: `isExactDisposition` validates `PUBLICATION_RETRY_REASONS[transition].includes(reason)` only for retry dispositions, and `human_required` is routed by `renderHumanRequiredHaltReason` against its own guidance table. Nothing forces a condition into both. The payload gap this pair does expose is Conflict 3. |
| Story 1 vs Story 5 | Does the guard halt any legitimately converging run? | **Clean.** Every healthy transition moves its owned dimension by construction; Story 5's per-transition legitimate-revisit coverage (review condition 2) is the enforcing test. |
| Story 2 vs Story 6 | Is there an input for which both claim a different outcome? | **Clean after Conflict 2's resolution.** With the split evaluated on the post-effect value only, the three cases partition the input space: changed, determinately unchanged, indeterminate. No input satisfies two branches. |
| Story 4 vs Story 6 | Does the halt short-circuit interact with degraded observation? | **Clean.** Story 4's negative path already requires that a failed `gh pr view` take the existing degraded-observation path and make no halt-state claim from absent data. |
| Story 5 vs Story 6 | Does bounded retry on indeterminate reintroduce an unbounded loop? | **Clean.** Story 6's negative path binds repeated indeterminate observations to the existing `stepMaxRetries` exhaustion. |

## Resource contention

`finish-publication.ts` and `finish-publication-production.ts` are touched by this spec.
`conduct-ts overlap-scan` over the candidate paths returned 39 overlapping branches, all
`origin/spec/*` for specs already merged or long dormant — no unmerged dependent work. Advisory
only, per the review; no sequencing constraint is imposed on the plan.

Documentation contention is real but low: `docs/explanation/gates.md` and
`docs/runbooks/stalled-or-stuck-feature.md` are high-traffic pages. The `gates.md:265` correction
(12 → 14) is a one-line factual fix and will conflict textually with any concurrent edit to the
same line, which git will surface at rebase rather than silently.

## Recurring patterns

No prior report exists in `.docs/conflicts/` for this feature area, so no recurring pattern is
established. Worth noting for future checks: Conflict 1's shape — *one half of a feature makes the
other half's regression scenario unreachable* — is a tautology generator, and it is invisible to a
one-directional check. It is the second such finding in this subsystem's history if
`adr-2026-08-06-bounded-progress-allowance`'s rejection of the naive visit-count bound is counted
as the first.
