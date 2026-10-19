**Status:** Accepted

# Stories: Operator acceptance of a build_review finding survives a re-raise

**Feature:** jstoup111/ai-conductor#3271, technical track, Tier M
**Authoritative design:** `adr-2026-08-29-build-review-remediate-case-adjudication` D2.1–D2.5 and the
#3271 amendment to Decisions 2 and 6 of `adr-2026-08-13-stable-build-review-finding-dispositions`.
**Binding conditions:** `.docs/decisions/architecture-review-2026-10-19-operator-acceptance-of-a-build-review-finding-does.md`
(APPROVED WITH CONDITIONS, conditions 1–5).

Technical track: there is no PRD. `**Requirement:**` cites the numbered desired outcomes of #3271:

1. A re-raise the adjudicator binds to an accepted case does not block.
2. The carried acceptance is visible in `build-review findings`, in the PR body, and on the event spine.
3. The adjudicator can see which prior cases an operator accepted.
4. An unbound finding still blocks; acceptance never spreads by automatic matching.
5. An acceptance covers only the feature it was made on.

Terms: an *accepted case* is a remediation case holding at least one source that has an exact
operator disposition for the feature. A *carried* finding is a current finding the adjudicator binds
to an accepted case, in a lap after the origin acceptance.

---

## Story 1: A re-raised finding bound to an accepted case settles instead of halting

**Requirement:** #3271 desired outcome 1

As an operator who accepted a build_review finding, I want a later lap that re-raises the same substance under a new finding id, and that the adjudicator binds to the accepted case, to settle on its own, so that I do not have to accept it again or clear a needs-human halt.

### Acceptance Criteria

#### Happy Path
- Given an `act` case whose source finding the operator accepted on lap L1 and whose action effect is `applied`, when lap L2 raises the same substance under a new finding id and the adjudicator binds it to that case with disposition `act`, then the finding is operator-resolved as carried, no `semantic remediation case regression` or `semantic remediation case repeat` halt occurs, no BUILD work order is published, and no kickback is charged.
- Given an accepted case whose action effect was retired as `failed` by the operator acceptance, when a later lap's re-raised finding is bound to it, then the binding is kept and the finding settles as carried rather than opening a fresh `act` case.
- Given a carried finding is the only unresolved content finding of a lap, when the effective verdict is derived, then the effective verdict is PASS with no further operator action.
- Given a finding carried on lap L2 and the same substance re-raised again under a third finding id on lap L3 and bound to the same case, when lap L3 settles, then it is carried from the original L1 acceptance as well.
- Given a lap whose re-raised finding the adjudicator binds to a resolved `act` case with an `applied` effect halts as a `semantic remediation case regression` and the operator then accepts that finding, when a later lap re-raises the same substance under another new id and the adjudicator binds it to the same case, then that later finding settles as carried with no halt.

#### Negative Paths
- Given the #3211 sequence (accepted eventSpine finding on one lap, re-raised under a new id next lap and bound to the accepted case), when it is replayed as a regression test, then the lap settles without any halt and without a second `build-review accept`.
- Given a re-raised finding bound to an accepted case and a second, unbound content finding in the same lap, when the lap settles, then only the bound finding is carried and the unbound finding routes exactly as it does today.
- Given a re-raised finding bound to an accepted case, when the case store is updated, then the case's existing sources, disposition, resolution and effect are unchanged apart from the appended source link.
- Given the adjudication is replayed after a crash between binding and settlement, when the lap resumes, then the finding is carried exactly once and no effect is reserved or charged.

### Done When
- [ ] The act-path regression case and the retired-effect case are each pinned by a test that fails on today's engine with `halt-regression` or a fresh act case.
- [ ] A lap whose only content finding is carried derives effective PASS in a test, with zero kickback ledger increments.
- [ ] A three-lap chain test proves carry follows the case, not the previous lap's finding id.
- [ ] A halt-accept-re-raise test proves the regression-halt flow carries after one acceptance.

---

## Story 2: An escalation bound to an accepted case does not open a decision stop

**Requirement:** #3271 desired outcome 1

As an operator, I want an escalation that the adjudicator binds to an accepted case to settle as carried, so that a re-raise never halts with `decision stop conflicting-case-id` or opens a new blocking decision case.

### Acceptance Criteria

#### Happy Path
- Given an open escalate case whose sources are all operator-accepted, when a later lap's re-raised finding is bound to it as `escalate`, then the finding settles as carried and the lap does not halt with `decision stop conflicting-case-id`.
- Given a resolved case holding an operator-accepted source, when a later lap's re-raised finding is bound to it as `escalate` with source ids that differ from the case's, then no new open escalate case is created and the finding settles as carried.

#### Negative Paths
- Given an escalate case with no operator-accepted source, when a later lap binds a finding to it as `escalate`, then the decision stop is created or refused exactly as it is today, including `conflicting-case-id`.
- Given an escalation bound to an accepted case, when the lap settles, then no external effect is performed, no intake issue is filed, and no kickback is charged.
- Given a lap in which one escalation is bound to an accepted case and another escalation is unbound, when it settles, then the unbound escalation still produces its decision stop.

### Done When
- [ ] The 2026-10-17 `decision stop conflicting-case-id` halt is pinned as a regression test that settles as carried.
- [ ] A test asserts the case store holds no new open escalate case after a carried escalation bound to a resolved accepted case.
- [ ] The unaccepted-escalation `conflicting-case-id` path is asserted unchanged.

---

## Story 3: Carry never widens past the adjudicator's binding

**Requirement:** #3271 desired outcome 4

As an operator, I want an acceptance to reach only findings the adjudicator binds to the case I accepted, in a later lap, so that a defect I saw and did not accept, or a genuinely new defect, still blocks.

### Acceptance Criteria

#### Happy Path
- Given an accepted case, when a later lap raises a finding the adjudicator does not bind to any case, then the finding is unresolved and routes exactly as it does today.
- Given a case that holds no operator-accepted source, when a later lap binds a finding to it, then the finding is not carried and today's reuse, repeat and regression rules apply.
- Given an infrastructure failure on a lap that also carries a finding, when the lap settles, then the infrastructure result still blocks until it heals or has an exact reduced-coverage decision.

#### Negative Paths
- Given a lap where the operator accepts one finding of a case and leaves a second finding of the same case unaccepted, when that lap settles, then the second finding is not carried and still blocks.
- Given an acceptance recorded while the same lap's adjudication is still running, when that lap binds another finding to the accepted case, then that finding is not carried.
- Given a source linked to an accepted case before the origin acceptance time, when any later read resolves accepted risk, then that source is not reported as carried.
- Given a current finding whose exact id matches no disposition and which the adjudicator does not bind, when it resembles an accepted finding by rubric, path or summary, then it is not suppressed.

### Done When
- [ ] Same-lap, mid-adjudication and pre-acceptance sources are each pinned as not carried.
- [ ] Unbound and unaccepted-case bindings are asserted to produce today's routes for the `act`, `escalate` and `reject` dispositions.
- [ ] A mixed lap test shows infrastructure still blocking beside a carried content finding.

---

## Story 4: Acceptance stays scoped to the feature it was made on

**Requirement:** #3271 desired outcome 5

As an operator, I want an acceptance to carry only within the feature I accepted it on, so that an acceptance on one feature can never settle a finding on another.

### Acceptance Criteria

#### Happy Path
- Given an accepted case on feature A, when feature B's lap raises a finding with the same substance, then feature B's finding is not carried.
- Given a stacked child feature, when its lap binds a finding to one of its own accepted cases, then the finding is carried using the child's case store and the feature's disposition store, as the coordinator already pairs them.

#### Negative Paths
- Given a disposition record whose feature identity differs from the current feature, when accepted risk is resolved, then it neither accepts nor carries any finding.
- Given a stacked child whose sibling child holds an accepted case, when the child binds a finding by a case id that exists only in the sibling, then the binding is not resolved against the sibling's case and nothing is carried.

### Done When
- [ ] A two-feature test asserts no carry crosses features.
- [ ] A stacked-child test asserts carry reads only that child's case store.

---

## Story 5: The adjudicator sees which prior cases an operator accepted

**Requirement:** #3271 desired outcome 3

As the `remediate` adjudicator, I want every prior case that holds an operator-accepted source to be marked as operator-accepted in my context, so that I can bind a re-raise of the same substance to it.

### Acceptance Criteria

#### Happy Path
- Given a prior case holding an operator-accepted source, when the adjudication context is assembled, then that case carries an operator-accepted marker naming the origin finding ids and lap.
- Given the `remediate` skill contract, when it describes prior cases, then it states that a binding to an operator-accepted case is judged by substance and that the adjudicator never asserts or creates acceptance.

#### Negative Paths
- Given a prior case with no operator-accepted source, when the context is assembled, then it carries no operator-accepted marker.
- Given an operator-accepted case, when the context is assembled, then the operator's rationale and username are absent from the context.
- Given an accepted case marker, when the context is assembled near its byte ceiling, then the existing overflow rule applies unchanged and no case is truncated.

### Done When
- [ ] A context test asserts the marker on an accepted case and its absence on an unaccepted one.
- [ ] The skill contract text is asserted to forbid asserting or creating acceptance while permitting a substance binding to an accepted case.

---

## Story 6: A carried acceptance is visible to the operator and in the PR

**Requirement:** #3271 desired outcome 2

As an operator, I want every carried finding listed locally with its origin and listed in the PR's accepted-risk section, so that I can audit what my acceptance now covers.

### Acceptance Criteria

#### Happy Path
- Given a carried finding, when `conduct build-review findings --feature <slug>` runs, then the finding is listed as carried, with its origin finding id, origin lap, operator and rationale.
- Given a carried finding, when `conduct build-review findings --feature <slug> --json` runs, then the record carries the same origin fields in machine-readable form.
- Given a feature with carried findings, when finish publication or the shipped record renders the accepted-risk section, then each carried finding is listed with its id, rubric, and carried-from origin finding id and lap.

#### Negative Paths
- Given a carried finding, when the PR accepted-risk section is rendered, then the operator username and rationale do not appear in it.
- Given a case store that cannot be read when the PR section is rendered, when publication runs, then directly accepted findings are still rendered, no carried row is fabricated, and the unreadable state is reported rather than silently dropped.
- Given a source linked to an accepted case before the origin acceptance, when the findings output or PR section is rendered, then that source is not listed as carried.

### Done When
- [ ] Findings output tests (text and `--json`) assert the carried row and its origin fields.
- [ ] The accepted-risk renderer test asserts carried rows with carried-from fields and no operator or rationale.

---

## Story 7: Every carry is an occurrence on the event spine

**Requirement:** #3271 desired outcome 2

As an operator or downstream reader of `.pipeline/events.jsonl`, I want each carry recorded as an event, so that the carry is observable on the one telemetry spine.

### Acceptance Criteria

#### Happy Path
- Given a finding carried on a lap, when the lap settles, then exactly one `build_review_disposition_carried` event is persisted naming the feature, lap, finding, case, origin finding and origin lap.
- Given the event union, when sink registration is checked, then `build_review_disposition_carried` is declared in every event sink.

#### Negative Paths
- Given a lap with no carried finding, when it settles, then no `build_review_disposition_carried` event is emitted.
- Given a lap resumed after a crash that already emitted a carry event, when it settles again, then no duplicate carry event is emitted for the same lap, finding and case.

### Done When
- [ ] The event variant exists in the `ConductorEvent` union and its sink declaration is asserted.
- [ ] A coordinator test asserts one event per carried finding and none on an uncarried lap.

---

## Story 8: Every consumer resolves accepted risk the same way, and fails closed

**Requirement:** #3271 desired outcome 4

As the engine, I want every reader of accepted risk to use one shared resolution, so that no consumer keeps exact-only matching and an unreadable store never invents acceptance.

### Acceptance Criteria

#### Happy Path
- Given a carried finding, when the effective verdict, the coordinator's accepted set, the reuse classification, the decision-stop path, the adjudication context, the findings output and the accepted-risk renderer each evaluate it, then all seven report the same carried state and the same origin.
- Given the origin disposition record is removed from the feature's disposition store, when the next lap resolves accepted risk, then no finding is carried from it.

#### Negative Paths
- Given a case store that is unreadable or malformed, when accepted risk is resolved, then no finding is carried, directly accepted findings still resolve, and the gate takes today's path for every other finding.
- Given a disposition store that is unreadable or malformed, when accepted risk is resolved, then the existing fail-closed behavior is unchanged and nothing is carried.
- Given a production consumer that matches dispositions directly instead of through the shared resolution, when the test suite runs, then a test fails naming that consumer.

### Done When
- [ ] One consumer-parity test exercises all seven consumers against one fixture.
- [ ] Unreadable case-store and disposition-store fixtures are asserted to carry nothing.
- [ ] A guard test fails on a direct disposition match outside the shared resolution.
