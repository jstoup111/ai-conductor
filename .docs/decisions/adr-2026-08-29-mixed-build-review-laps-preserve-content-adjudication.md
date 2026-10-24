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

> **Amended 2026-10-23 by #3291:** "Exactly once per lap" now means one authoritative judgement per lap. Inside the one shared operation, the coordinator may re-dispatch the same `remediate` judgement at most once, as an expansion round, under three conditions: the lap is case-v2, the round-1 judgement fails validation only because it admits plan tasks the context listed in its index without their bodies, and those tasks exist in the active plan. The expansion uses the same skill, provider member, mode and context contract, and adds only the requested task bodies under the same serialized ceiling. Round 1's judgement is discarded, never merged or reconciled. The expansion charges no kickback, and a second invalid judgement stops as today, naming any unsupplied task ids. No new step, skill, provider member or second adjudicator is introduced (adr-2026-09-10-portable-build-review-policy D8 amendment of the same date).

> **Amended 2026-10-24 by #3294:** Each prior case source in the remediate context may carry a bounded `finding` digest (rubric, concernKind, a summary of at most 1000 bytes, up to 8 evidence locations, lapId) read from the lap artifact that raised it. Only the latest 4 sources per case carry one, and all digests share one budget: the smaller of 64 KiB and the headroom left under `maxSerializedBytes` after every case, current source and the plan context. It is recomputed for an expansion round. The oldest digests are dropped first and counted as `priorDigestsOmitted`, never failing the context (adr-2026-10-24-lap-monotonic-build-review-scope D8).

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

> **Amended 2026-10-19 by #3298:** D4.2 kept the result contract at `v3` because `confidence` is
> optional. A required, reviewer-assigned `severity` (critical, major, minor, nit) now moves fresh
> built-in results to `v4`. Because contract version is part of built-in finding identity, every
> built-in finding id re-keys once at upgrade (custom ids are unchanged), and stored `v3` dispositions invalidate through the existing
> `build_review_disposition_version_invalidated` path; where remediate binds the re-keyed finding to
> the accepted case, #3271 still carries it. D4.3's buckets gain `advisory`, classified
> after `suppressed`: a finding whose severity is strictly below its rubric's declared `min_severity`
> never reaches remediate, is never charged, and is recorded on the same event, seam and store
> (adr-2026-10-19-build-review-finding-severity-advisory-threshold D2, D4, D5).

> **Amended 2026-10-24 by #3294:** Confidence suppression now has a second effect, before judgement. A finding below the floor is non-blocking, so it can let its hunk settle and leave a later lap's delta. D4.3's rule still holds, because the floor is applied after judgement to the findings a lap raises. The floor's value is not in the cache fingerprint, but a floor change can change a later lap's delta and thus its projection digest (adr-2026-10-24-lap-monotonic-build-review-scope D2).

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

> **Amended 2026-10-19 by #3298:** D5.1's finalized cases also include a remediate case with
> disposition `advisory` and effect `none`, read through the D5.5 authoritative link. That case
> settles only while every source rubric's current `min_severity` stays strictly above the case's
> adjudicated severity. Lowering or removing
> the threshold makes its sources live again. The predicate remains read-only
> (adr-2026-10-19-build-review-finding-severity-advisory-threshold D6, D7).

> **Amended 2026-10-19 by #3292:** Source ownership is scoped to open cases, and an unbound
> re-raise of resolved history is admitted. The predecessor's D5 store kept one case per source id
> across all history, and its D7 says a resolved case that reappears halts as a regression. In
> practice the judge proposes an unbound new case for a source that only a resolved case owns, and
> the store refused that transition as `source-linked-by-multiple-cases`. Two features halted
> needs-human on 2026-10-18. This amendment adds the decision below and narrows the predecessor
> sentence it contradicts.
>
> - **D5.4 — At most one open case per source.** The build_review case store refuses a proposed
>   state only when two cases with `resolution: open` link the same source id. A source that
>   resolved cases link may also be linked by one new case. Resolved rows are never rewritten by
>   that link, and the persisted schema and store version are unchanged. Duplicate case ids,
>   duplicate effect ids and a repeated source within one case stay refused.
> - **D5.5 — One link per source is authoritative.** Every build_review reader that maps a source
>   back to a case or an outcome reads it through one shared store-module selector. The selector
>   returns, per source id, the open case's link when one exists. Otherwise it returns the link
>   with the latest `recordedAt`, ties broken by store order. The reducer's coverage consistency
>   check and the D5.1 settled predicate read through it, and readers already restricted to open
>   cases are unchanged. A store with no shared sources therefore reads exactly as before.
> - **D5.6 — An unbound re-raise is a new, charged case.** When a judgement proposes a case
>   without `existingCaseId` for a source owned only by resolved cases, reconciliation admits it as
>   a new case of any disposition. A new `act` case reserves a fresh action effect, which the
>   existing kickback budget charges like any first action, so the cumulative cap is the bound. An
>   explicit `existingCaseId` rebind with disposition `act` of a resolved action case still
>   halts as a regression under predecessor D7. The predecessor D7 and D3 rule that an equivalent attempted
>   case consumes no second kickback and halts applies to a case the judge binds. An unbound
>   proposal is the judge's statement that the case is not that one. Equivalence across a re-raise
>   stays the judge's call, and nothing infers it from prose.
> - **D5.7 — Decision stops share the contract.** A decision or consistency stop over a source owned
>   only by resolved cases persists as a new open stop. A stop whose case id, owner, disposition and
>   source ids and outcomes match an open stop is that stop: it converges as already persisted
>   whatever the link timestamps. An unbound stop converges on the open stop with the same owner and
>   source set. Every rejected case-store transition, the decision-stop path included, reaches the
>   operator with its invariant, case ids and source ids on the existing
>   `remediation_adjudication_failed` event and the HALT text. An escalation or consistency stop
>   that would add a second open owner of a source is refused this way. The named halt is that
>   escalation's durable stopping point under portable-build-review-policy D9. Superseding an open
>   owner with a stop is #3005's decision and is not made here.

> **Amended 2026-10-23 by #3124:** An undeclared unbound re-raise is a recorded recurrence that
> shares its prior case's attempt limit. D5.6 read every unbound proposal as "the judge's statement
> that the case is not that one". That let a returning defect open fresh repair cycles until the
> feature-wide kickback cap stopped it, with nothing linking the new case to the attempts that
> already failed. The operator's goal is fewer halts, so the safe default is a bounded autonomous
> repair, not a halt. This amendment narrows D5.6 for `act` and adds the decisions below.
>
> - **D5.8 — Distinctness is declared, never inferred.** A remediate case row with disposition `act`
>   and no `existingCaseId` may carry `distinctFrom`: one or more `{ caseId, reason }` entries, each
>   with a non-empty bounded reason. An entry counts only when its `caseId` is the D5.5
>   authoritative owner of one of the row's sources, and that owner is a resolved `act` case. The
>   engine drops every other entry and halts on none. A row with a malformed `distinctFrom` shape is
>   rejected like any other malformed artifact. Nothing infers distinctness or sameness from prose,
>   summaries, or tree movement.
> - **D5.9 — An undeclared re-raise is a recurrence.** When reconciliation mints a new `act` case
>   whose sources' authoritative owners include resolved `act` cases that no counted entry names,
>   the new case is stamped `recurrenceOf` with those owners' ids. A case named by a counted entry
>   is recorded on the new case as `distinctFrom` with its reason, and the new case starts no
>   lineage with it. Both fields are optional, engine-stamped, and written only on the new case at
>   creation. Every resolved row stays byte-identical, and the store version is unchanged. The
>   frozen prior-case projection the judge reads exposes both fields, and `build-review findings`
>   shows them next to the case they reference.
> - **D5.10 — A lineage shares one attempt limit of three.** A case's lineage is that case plus
>   every case reachable through `recurrenceOf`. Its attempt count is the number of distinct
>   lineage `act` cases whose action effect is `applied`, read from the store, not from lap-local
>   work-order evidence. Before reconciliation reserves any effect, the coordinator checks every
>   undeclared recurrence proposal. A proposal whose lineage already counts three attempts does not
>   reconcile. Instead its live sources are linked to the authoritative resolved owner through the
>   existing halting-binding writer, and the lap halts through the existing operator-acceptance-aware
>   halt as `semantic remediation case recurrence limit <case id>`, naming every lineage case id and
>   the attempt count. Under the limit, the recurrence is admitted and charged exactly as D5.6
>   prescribes. The cumulative kickback cap still applies on top. The limit is a fixed engine
>   constant, not configuration.
> - **D5.11 — Recurrence is reported on the existing spine.** `remediation_case_reconciled` for a
>   newly opened case carries optional `recurrenceOf` and `distinctFrom` (case ids, with reasons
>   for distinct). `remediation_semantic_repeat_halt` gains the reason `recurrence-limit` and an
>   optional `lineageCaseIds`. No new event type, sink entry, or sidecar is added. Non-`act`
>   dispositions, decision and consistency stops (D5.7, #3005), explicit `existingCaseId` rebinds
>   (the predecessor D7 regression halt and carry), and resolved rows are unchanged.

> **Amended 2026-10-20 by #3271:** The settled predicate of D5.1 also admits a source by exact id when its D5.5 authoritative link is `carried`. A binding to a carry-eligible case is classified `carry` before D5.6's explicit-rebind regression halt and before D5.7's decision-stop persistence, so neither applies to it. D5.4's unchanged-resolved-row rule gains three engine writers that may change a resolved row: `finalize` acceptance origins, the carry lane, and reuse-halt source linking (adr-2026-10-20-operator-acceptance-is-durable-case-state D2, D3). D5.2's exclusion of `failed` and `reserved` action cases from settlement no longer applies to retirement: such a case retires under the shared retirement predicate when every source is covered by operator acceptance or carry, or is no longer raised on a mechanically healthy lap (adr-2026-10-20-operator-acceptance-is-durable-case-state D4, D5).

> **Amended 2026-10-24 by #3294:** D5.1's exact-id rule remains the only admitted equivalence. Out-of-delta classification is a scope rule, not an equivalence: in a delta lap, a finding whose mapped hunks are all settled is `outOfDelta` unless its `causeHunk` names a delta hunk (adr-2026-10-24-lap-monotonic-build-review-scope D5, D6). D5.8's recurrence owner gains a provenance source. An unbound `act` case with no exact-source owner, and with a source mapped to a delta hunk, is stamped `recurrenceOf` the applied act case that owns a source raised in the predecessor lap on the same path. Among several candidates, the one with the most applied lineage attempts wins, ties going to the lowest case id. D5.8's counting rule admits a `distinctFrom` entry that names a provenance candidate of the row, as well as a resolved `act` owner of a row source, and still drops every other entry. A provenance candidate may be an open or a resolved case with an applied action effect. D5.10's lineage limit of 3 applies unchanged (adr-2026-10-24-lap-monotonic-build-review-scope D7).

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
