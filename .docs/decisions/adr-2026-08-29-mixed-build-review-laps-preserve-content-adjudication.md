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
