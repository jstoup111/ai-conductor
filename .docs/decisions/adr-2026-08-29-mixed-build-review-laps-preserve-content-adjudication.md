# ADR: mixed build_review laps preserve content adjudication

**Date:** 2026-08-29
**Status:** APPROVED
**Approved:** Operator-approved conflict resolution 2026-08-29
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#2033
**Supersedes:** `adr-2026-08-29-build-review-remediate-case-adjudication`
**Conforms to:** `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`,
`adr-2026-08-12-cumulative-build-review-convergence-bound`,
`adr-2026-08-13-stable-build-review-finding-dispositions`, and
`adr-2026-08-22-one-owner-per-review-question`

## Context

The predecessor ADR selected independent rubric fan-out followed by one existing `remediate`
judgement over current findings and prior cases. Its later mechanical-exhaustion amendment required
every infrastructure branch to heal or receive exact operator reduced coverage before valid content
siblings could enter that judgement.

Repo-wide conflict-check showed that this precedence contradicted the accepted mixed-lap contract.
The governing story says a lap with a mechanical fault and an unresolved real finding is a judged
failure and that the mechanical fault does not buy a free semantic lap. A later story also requires a
current-lap aggregate containing both the valid finding and infrastructure failure, with routing
evidence based on the finding. Requiring reduced coverage first would hide actionable sibling work
behind an operator-only infrastructure decision and violate the selected fan-out/fan-in outcome.

The mechanical lane and the semantic lane still require separate authority. Infrastructure inability
is not repairable content, and autonomous adjudication must never grant reduced coverage or fabricate
PASS.

## Decision

The independent-rubric, shared-case-contract, single-`remediate` design remains selected. All
non-conflicting decisions, state/effect contracts, options, consequences, and limitations in the
predecessor remain adopted. This ADR replaces its D1 mixed-lap rule, D3 entry condition, and D8
transition precedence as follows.

### D1 — Distinguish infrastructure-only laps from mixed laps

Every enabled rubric still settles from the same frozen snapshot before the engine chooses a route.
The raw join remains mechanical and source-preserving; it does not merge findings, assign priority,
perform effects, or spend a semantic allowance.

When a lap has infrastructure failures but no valid operator-unresolved content finding, it follows
the existing mechanical lane. Below the mechanical allowance it publishes no aggregate and consumes
no semantic charge. At exhaustion it exposes the infrastructure blocker for the existing exact
operator reduced-coverage decision.

When at least one sibling has a valid operator-unresolved content finding, the lap is mixed. The
engine publishes the current-lap aggregate with both the content and infrastructure outcomes, then
sends all and only the content findings into the post-join case judgement. The infrastructure outcome
remains raw blocking evidence and never enters `remediate` as a semantic case.

### D2 — One existing remediate dispatch still owns semantic fan-in

One fresh `remediate` dispatch receives every valid current unresolved content finding plus every
feature-local prior case after all branches settle. A mixed infrastructure outcome does not prevent
this dispatch and is not included as repairable content. The predecessor's source-complete schema,
bounded all-history input, engine validation, case reconciliation, and deterministic effect rules are
unchanged. No new step, skill, provider member, or second adjudicator is introduced.

### D3 — Content action and infrastructure blocking compose without erasure

After complete adjudication and required-effect settlement, transition precedence is:

1. A newly actionable content case publishes one durable prioritized BUILD work order and consumes
   the existing `build_review` kickback once, even on a mixed lap. Infrastructure remains
   independently blocking on the next effective evaluation.
2. If no actionable content route remains and infrastructure is uncovered, the gate follows the
   existing mechanical retry or exhaustion path. Finalized deferred/rejected/merged cases do not
   convert infrastructure to PASS or consume a semantic kickback.
3. PASS is possible only when every content source is operator-resolved or has a finalized permitted
   autonomous outcome, every required effect is applied, and every infrastructure result is healthy
   or covered by an exact current operator reduced-coverage decision.

Adjudication or effect failure remains fail-closed and blocks both PASS and partial routing. A
repeated attempted/regressed semantic case still halts without a second charge or a free route. Every
actual first-time BUILD route still increments the cumulative convergence bound.

### D4 — An operator confidence floor may narrow an act to a defer

> **Amended 2026-09-06 by #2383:** The predecessor's D4/D7 contract left a case's disposition a
> function of provider judgement alone. This amendment adds the decisions below. The original
> decisions above are preserved and unchanged; nothing here grants a provider new authority, and
> nothing here lets the engine manufacture an `act`.

> **D4.1 — Confidence is a provider-supplied percentage the engine validates but never derives.**
> The `case-v1` per-case `confidence` is an integer 0-100, replacing the `high | medium | low`
> enum. The engine range-validates it exactly as decision 4 of the predecessor already requires
> for every bounded field ("any field exceeds its bound" fails the whole adjudication closed), and
> never computes, adjusts, or infers the number. The `rationale` field is unchanged; the number is
> what the floor reads. The enum has no released consumer, so this replaces it rather than
> migrating it.
>
> **D4.2 — The operator floor narrows, and only narrows.** Config key
> `build_review.adjudication.act_min_confidence` (integer 0-100, default 0) demotes an `act` case
> whose confidence is below it to a `defer` case, applied at judgement admission before case
> reconciliation. The engine may only turn an `act` into a `defer`; it may never promote a
> `defer` or `reject` into an `act`, never alter `reject` or `defer` cases, and never grant
> reduced coverage or operator accepted risk — D2's separation of operator authority from
> autonomous adjudication is untouched. At the default 0 the comparison never fires and behavior
> is identical to today.
>
> **D4.3 — A demoted case is filed, not dropped, and charges nothing.** The demoted case takes the
> existing deferral effect of decision 6 unchanged — exact hidden-marker lookup first, reusing a
> matching open or closed issue, otherwise filing through the existing intake adapter with the
> marker and sanitized Observed/Impact/Desired Outcomes/Hypotheses content — so it files exactly
> once across laps. The engine synthesizes that content from the case's `caseRef`, `rationale`,
> and confidence; it authors no new effect shape. The demotion consumes no kickback and publishes
> no BUILD work order, which is decision 7 applied unchanged ("Deferred, rejected, and
> merged-only adjudications consume no kickback") rather than a new budget rule. Per
> `adr-2026-08-12-cumulative-build-review-convergence-bound`, the demotion path must bypass the
> kickback gate outright rather than call it for a zero charge, so `count` and `cumulative` are
> never touched. Because the demotion happens before reconciliation, the case's effect id is
> stable across laps and the marker cannot mint duplicates.
>
> **D4.4 — The floor is inert wherever a deferral cannot finalize.** When the tracker
> dependencies are absent, a deferral effect stays `reserved` and the lap routes to `halt` on the
> existing unfinished-effect rule. The floor therefore does not apply at all in that state and the
> `act` proceeds unchanged. A confidence floor must never convert a passing or actionable lap into
> a halt.
>
> **D4.5 — Every demotion is visible, as an additive field on an existing event.** The demotion
> reason rides an existing remediation `ConductorEvent` member as an additive optional field
> following the house pattern of `adr-2026-08-11-halt-events-ride-the-persisted-spine`, rather
> than a new event member; decision 9 already registers those members with every sink. Should a
> new member prove necessary instead, `adr-2026-07-26-event-sink-registry-exhaustiveness` requires
> it to declare its sink and `adr-2026-07-07-audit-trail-event-sink` requires it in the audit
> mapping, or the completeness invariant silently breaks. The demotion is not a `kickback` event
> and must never be rendered as one (`adr-2026-07-04-kickback-event-emission-and-log-prominence`),
> since no kickback is charged. It is additionally rendered into the per-lap adjudication trace so
> it reaches HALT and route evidence and the daemon log. A lap whose every `act` was demoted
> retains no build-eligible action case and therefore reaches the existing PASS transition; it
> must not deadlock for want of something to fix.

## Consequences

- A mechanical failure cannot erase or postpone valid sibling content merely because reduced
  coverage requires an operator.
- Pure infrastructure retries remain token-free with respect to semantic judgement and kickback
  accounting.
- Mixed laps can spend one semantic route for genuine new work while retaining the infrastructure
  blocker for the next lap.
- Effective routing must encode precedence explicitly; it cannot reduce mixed content and
  infrastructure to a single undifferentiated FAIL branch.
- Tests must cover pure mechanical, mixed actionable, mixed non-action, exhausted mixed, healed, and
  exact reduced-coverage cases in both route directions.

## Rejected alternatives

- **Require reduced coverage before content judgement.** This recreates the resolved conflict and
  makes valid sibling repair depend on an unrelated operator-only decision.
- **Treat infrastructure as a remediation case.** This gives the model authority over provider or
  execution health and risks autonomous reduced coverage.
- **Ignore infrastructure once content routes.** This can fabricate PASS after BUILD and loses the
  reason coverage was incomplete.
