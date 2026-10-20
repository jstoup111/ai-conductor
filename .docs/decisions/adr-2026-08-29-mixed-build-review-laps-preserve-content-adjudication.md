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

> **Amended 2026-09-10 by #1986:** custom-policy laps extend this same case flow with versioned consistency, plan-admission, and decision-escalation outcomes. The shared operation serves attended and daemon execution exactly once per lap. A blocked consistency decision, any decision escalation, or invalid admission evidence prevents action effects before a worker receives repairs. The inherited source-complete, mixed-lap infrastructure, suppression, settled-recurrence, durable-effect, and cumulative-bound contracts remain effective (adr-2026-09-10-portable-build-review-policy D8–D11).

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

> **Amended 2026-09-10 by #1986:** for custom-policy laps, a consistency or owning-decision stop precedes D3's actionable-content route; independently blocking infrastructure remains recorded. Only a complete consistent result with admitted repairs can publish the existing work order. Escalation itself neither charges BUILD nor appends a task (adr-2026-09-10-portable-build-review-policy D9).

> **Amended 2026-09-09 by #2409:** Decision 3 now distinguishes an *unrefuted* repeat from a
> *refuted* re-raise.
>
> - **D3.4** A repeated attempted case that the judge again proposes as `act` still halts without a
>   second charge or a free route. A re-raised attempted case that the judge binds with an admitted
>   `refute` row (adr-2026-08-29-build-review-remediate-case-adjudication D7.1–D7.3) is a finalized
>   permitted autonomous outcome for D3.3: it converts nothing about infrastructure, consumes no
>   semantic kickback, and joins the deferred/rejected/merged set of D3.2.

### D4 — Grader confidence and an operator floor suppress a finding before it fails the gate

> **Amended 2026-09-06 by #2383:** D1 admits every "valid operator-unresolved content finding" to
> the mixed-lap judgement. This amendment adds the decisions below, which narrow that set by one
> engine-applied rule before D1 classifies the lap. The original decisions above are preserved and
> unchanged; nothing here grants a provider operator authority, and nothing here lets the engine
> manufacture or adjust a confidence.

> **D4.1 — Confidence is a grader-supplied percentage the engine validates but never derives.**
> Each rubric finding may carry an integer `confidence` 0-100 stating how sure the grader is that
> the finding is a real defect. The engine range-validates it in the finding parser; an
> out-of-range or non-integer value makes the result malformed exactly as any other invalid field
> does. The engine never computes, defaults, or adjusts the number. Confidence is presentation
> evidence, not identity: it never enters the finding identity hash, so a re-graded finding at a
> different confidence keeps its id and every operator disposition bound to it.
>
> **D4.2 — Absent means blocking.** `confidence` is optional in the result contract. A finding
> that omits it is never suppressed. This keeps the change fail-safe — a grader that forgets the
> field can only cost a lap, never drop a finding — and keeps the contract at `v3`, so no stored
> operator disposition is invalidated. The skill-digest cache check already discards cached results
> when the skill text changes, so graders re-run with the new contract without a version bump.
>
> **D4.3 — The floor suppresses at the effective verdict, in its own bucket.** Per-rubric config
> `build_review.rubrics.<id>.min_confidence` (integer 0-100, default 0) is applied in
> `deriveEffectiveBuildReviewVerdict`: a finding whose confidence is below its rubric's floor is
> placed in a `suppressed` bucket beside `accepted` and `unresolved`, and the verdict formula is
> unchanged — only `unresolved` blocks. Suppression is engine bookkeeping on a grader judgement and
> is never recorded as, merged into, or promoted to an operator accepted-risk disposition; D2's
> separation of operator authority from autonomous outcomes is untouched. At the default 0 the
> comparison never fires and behavior is identical to today.
>
> **D4.4 — A suppressed finding never reaches remediate.** A lap whose every finding is suppressed
> or operator-resolved is an effective PASS and does not enter the post-join judgement at all. On a
> mixed lap the suppressed findings are excluded from the adjudication sources, so the one
> `remediate` dispatch of D2 sees only the surviving findings. No kickback is charged for a
> suppressed finding because none ever becomes an action case.
>
> **D4.5 — Every suppression is visible.** Each suppressed finding is recorded on the existing
> `build_review_outer_verdict` event as an additive optional list carrying its finding id, rubric,
> reported confidence, and the floor that suppressed it, following the additive-field pattern of
> `adr-2026-08-11-halt-events-ride-the-persisted-spine`, and it is rendered by the existing daemon
> log projection of that event. Suppression is not a `kickback` event and is never rendered as one.
>
> **D4.6 — Suppressed findings persist and remain visible to the judge.** A suppressed finding is
> not a blocking source, but it is not forgotten either. The coordinator records each suppression in
> the feature-scoped durable case store as a suppression entry keyed by the finding's exact id —
> rubric, summary, reported confidence, the floor applied, and the lap last seen — retained across
> laps and never pruned when the finding stops recurring or a related case resolves. The adjudication
> context carries these entries as a distinct non-blocking history section, separate from current
> sources, so the D4 source-complete validator does not demand an outcome for them while the judge
> can still weigh a suppressed finding when a later finding from another rubric conflicts with it.
> This is the predecessor's decision 5 store used as designed: the occurrence is emitted on the
> spine (D4.5), and the store carries it as durable control input for later judgement.

### D5 — Exact-id recurrence of a settled finding does not re-dispatch the judge

> **Amended 2026-09-06 by #2383:** The predecessor's decision 7 says a previously deferred or
> rejected case "reuses that outcome after the current adjudication confirms the binding". That
> confirmation costs one provider session per lap for a finding the harness has already settled,
> and it is the reason a deferred finding spins. This amendment adds the decision below.

> **D5.1 — Settled recurrence is a mechanical predicate, not a judgement.** Before the D2 dispatch,
> the coordinator reads the durable case store and removes from the live source set every finding
> whose exact content-anchored id already appears as a source link on a case that is finalized —
> disposition `defer` or `reject` with its effect `applied` or `none`, or a source outcome of
> `merged`. Exact-id match is the only admitted equivalence: a finding whose id has drifted is not
> settled and still dispatches the judge, because equivalence under drift is the judgement D2 exists
> for. If the live set is empty after this and after operator resolution, the lap finalizes from
> durable state without dispatching `remediate`; if any live source remains, the dispatch proceeds
> with the reduced set.
>
> **D5.2 — Unfinished and action cases are never settled.** A case with a `reserved` or `failed`
> effect, or any open action case, does not satisfy the predicate; the existing halt and BUILD
> routes for those states are unchanged. The predicate can only skip a dispatch that D7 would have
> resolved to the same finalized non-action outcome. The predicate reads the store and never
> writes, prunes, or resolves it: every case, including resolved ones, stays durable so a later
> judgement on a conflicting finding still sees the full history.
>
> **D5.3 — A skipped dispatch is recorded.** When the predicate empties the live set, the
> coordinator emits the existing `remediation_adjudication_completed` event for the lap with the
> settled case ids and no new effect ids, so the skipped session is visible on the spine and in the
> daemon log as a completed adjudication rather than as an absence.

> **Amended 2026-09-09 by #2409:** the settled predicate admits the refuted terminal.
>
> - **D5.3** A case with disposition `refute` whose effect is `none` or an `applied` deferral is
>   finalized for D5.1. Its source links are removed from the live source set on every later lap by
>   exact id, so a refuted claim is neither re-dispatched to the judge nor halted as a regression.
>   A `refute` case whose deferral effect is `reserved` or `failed` does not satisfy the predicate,
>   exactly as D5.2 prescribes for every other unfinished effect.

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
