# Conflict Check: build_review halts when a judgement re-raises a source a resolved case owns

**Date:** 2026-10-19
**New stories:** `.docs/stories/build-review-halts-when-a-judgement-re-raises-a-so.md` (Stories 1–5)
**Result:** passed. There are 0 blocking conflicts. 5 degrading conflicts were resolved by
operator-approved in-place corrections.

## Scope

**Stories examined.** Each was tested in both directions:
- build-review-rubrics-need-a-post-join-adjudicator-
- a-rejected-case-transition-halts-as-corrupt-case-h
- refuted-build-review-finding-cycles-to-a-needs-hum
- kickback-cap-raise-replays-the-halted-lap-s-remedi
- projects-cannot-add-portable-non-competing-build-r
- a-routed-fix-cannot-be-built-charged-and-reviewed-
- operator-configurable-confidence-floor-for-acting-
- over-scope-refusal-should-route-to-build-rework-in
- plan-growth-allowance-is-spent-on-work-existing-ta
- preserve-self-build-provider-transcripts-on-failed
- build-repair-preserves-stale-wiring-pass-and-halts
- mergeable-autoresolve-tier-2-escalates-every-conte
- render-build-review-rubric-events-in-the-daemon-lo
- repeated-build-review-semantic-failures-can-churn-
- one-build-review-pass-clears-the-convergence-cap-s
- equivalent-re-worded-findings-escape-their-accepte
- gate-kickback-counter-resets-every-dispatch-so-no-

**ADRs examined:**
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication (governing)
- adr-2026-08-29-build-review-remediate-case-adjudication (superseded; its non-conflicting
  decisions are still adopted, so it was retained)
- adr-2026-09-10-portable-build-review-policy (D9, D11)
- adr-2026-09-07-durable-prd-widening-decision-reconciliation (D2)
- adr-2026-08-12-cumulative-build-review-convergence-bound
- adr-2026-08-13-stable-build-review-finding-dispositions
- adr-2026-07-13-kickback-build-no-op-escalation

**ADRs narrowed out**, because they don't touch build_review case ownership:
- adr-2026-10-12-routed-whole-feature-repair (stacked routing and receipts)
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework (prd_widening ids only)
- adr-2026-08-29-operator-authorized-kickback-budget-recovery (superseded)
- adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class
- adr-2026-08-31-kickback-ledger-read-fails-closed
- adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route
- adr-2026-08-11-halt-events-ride-the-persisted-spine (the additive fields are consistent)
- adr-2026-09-06-reopened-task-resolution

## Conflict 1: The regression halt's disposition scope

**Stories involved:** post-join adjudicator Story 7 vs new Story 4
**Type:** contradiction. **Severity:** degrading.
- **Existing:** "Given an action case not resolved by refutation was marked resolved and the judgement binds a reappearing finding to that case by `existingCaseId`, when reconciliation runs, then the gate halts as a regression of the prior case rather than resetting its history or consuming another kickback."
- **New:** "Given R holds no operator-accepted source and the judgement names R as `existingCaseId` on an escalation whose sources differ from R's, when the stop is persisted, then a new open stop with a fresh case id is written and R is byte-identical."
- **Resolution (option 1):** limit the regression halt to a rebind with disposition `act`. This
  matches the current coordinator, which skips non-`act` proposals before the regression check.
  Applied to the existing story, to governing D5.6, and to the predecessor's D7 note.

## Conflict 2: An unbound re-raise against the repeated-case stop

**Stories and ADRs involved:**
- portable-policy Story 15, predecessor D7 and mixed D3, against
- new Story 3

**Type:** behavioural overlap. **Severity:** degrading.
- **Existing:** "Given an attempted or regressed case is reported again with equivalent substance despite wording or code movement, when the aggregate identifies that unrefuted recurrence and again proposes action, then it follows the existing repeated-case stop rather than granting a fresh repair allowance."
- **New:** "Given N's new action effect and kickback budget remaining, when the effect stage applies it, then the kickback budget is charged exactly once for N's effect id and the lap routes BUILD with N."
- **Resolution (option 1):** "identifies" now means the judge binds the recurrence by
  `existingCaseId`. Governing D5.6 states that the no-second-charge repeat rule applies to a bound
  case, and that an unbound proposal is the judge's statement of non-equivalence. This follows the
  operator's "admit all, charged" decision, with the cumulative kickback cap as the bound.

## Conflict 3: The settled predicate in the confidence-floor story

**Type:** contradiction (only for multi-link fixtures). **Severity:** degrading.
- **Existing:** "A finding whose exact id links to a finalized deferred, rejected, or merged case is removed from the live source set before dispatch."
- **New:** "Given a resolved deferral whose applied link on S would settle it and a later open action case N linking S, when the settled-source predicate is computed, then S is not settled and stays a live source."
- **Resolution:** the existing criterion now reads "has its authoritative source link on" (D5.5).

## Conflict 4: The settled predicate in the refuted-cycles story

**Type:** contradiction (only for multi-link fixtures). **Severity:** degrading.
- **Existing:** "Given a case resolved by refutation with effect `none`, when a later lap re-raises the exact same source id, then that source is removed from the live source set, the judge is not dispatched for it, and the lap routes PASS when no other source is live"
- **New:** "Given two resolved cases linking S where the later-recorded link settles S and the earlier one does not, when the settled-source predicate is computed, then S is settled; with the settling link recorded earlier instead, S is not settled."
- **Resolution:** the existing criterion is qualified with "holds a source's authoritative link".

## Conflict 5: Portable-policy D9 durable stop against open-owner refusal

**ADR filename stem:** adr-2026-09-10-portable-build-review-policy
**Story ID:** Story 4
**Type:** contradiction. **Severity:** degrading. The gap already exists today.
- **ADR opposing sentence (verbatim):** "A `blocked` consistency result, any escalation, invalid output, or missing required admission evidence prevents all action effects for that adjudication and produces a durable decision stop."
- **Story opposing sentence (verbatim):** "Given an open decision stop D on S, when a later lap escalates S as an unbound case to a different owner, then the lap halts with a rejected transition naming `source-linked-by-multiple-cases`, D, the proposed stop id and S, and the store is byte-identical."
- **Resolution:** governing D5.7 now states three things:
  - a stop that would add a second open owner is refused and named;
  - that named halt is the escalation's durable stopping point;
  - open-owner supersession is #3005's decision.

  The portable ADR itself is unchanged.

## Notes carried to the plan

- The open-owner relaxation applies only to build_review cases. `prd_widening` keeps its own
  per-domain source uniqueness (adr-2026-09-07 D2).
- Kickback-cap tests must respect per-child ledgers in stacked features (per-child-build-region D10).
