**Status:** Accepted

# Stories: one corrected re-judgement for an inadmissible build_review case binding (#3461)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/build-review-halts-needs-human-when-the-judge-reje.md`;
- the 2026-10-28 amendments of `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2 and `adr-2026-09-10-portable-build-review-policy` D9;
- `architecture-review-2026-10-28-build-review-halts-needs-human-when-the-judge-reje` (APPROVED);
- the desired outcomes of #3461.

Terms used below:
- **Lap:** a case-v1 build_review lap of feature `demo` whose only current finding is the testQuality source `testQuality:F2`, adjudicated by `coordinateBuildReviewAdjudication` with a scripted judge.
- **Acted case `case-A`:** a prior build_review case with disposition `act`, resolution `open`, an `action` effect with status `applied`, and an id in the lap's attempted case ids.
- **Unattempted acted case `case-U`:** the same as `case-A` except that its id is not in the attempted case ids.
- **Reserved case `case-R`:** a prior case with disposition `act`, resolution `open`, an `action` effect with status `reserved`, not attempted.
- **Rejected case `case-J`:** a prior case with disposition `reject`, resolution `resolved`, effect `none`.
- **Refuted case `case-F`:** a prior case with disposition `refute`, resolution `resolved`, effect `none` and a stored refutation.
- **Carried case `case-C`:** a resolved prior case whose operator-acceptance origins are all accepted source ids from an earlier lap, so it is carry-eligible.
- **Evidence-backed refutation:** a `refute` row with confidence `high` and one `refuted` assertion whose path and excerpt occur in the current tree.

## Story 1: The remediate context names the dispositions each prior case can be bound with

**Requirement:** #3461 outcome 2 (impossible to emit); mixed-laps D2 and portable-policy D9 amendments of 2026-10-28

As the remediate judge, I want every prior case to list the dispositions a binding to it can take, so that I do not propose a disposition change the engine will refuse.

### Acceptance Criteria

#### Happy Path
- Given a lap whose prior cases are `case-A`, `case-J` and `case-C`, when the adjudication context is assembled, then the `priorCases` entry of `case-A` carries `bindableDispositions` exactly `act`, `defer`, `refute`, the entry of `case-J` carries exactly `reject`, and the entry of `case-C` carries exactly `act`, `advisory`, `defer`, `refute`, `reject`.
- Given the remediate skill's build_review case contract, when the judge reads it, then it states that a non-escalation row binding an `existingCaseId` must use a disposition listed in that prior case's `bindableDispositions`, that a refused binding is named in `bindingCorrections` for one corrected judgement, and that a finding judged no longer present on an attempted applied action is answered with an evidence-backed `refute`, not a bound `reject`.

#### Negative Paths
- Given a lap whose prior cases are `case-R`, `case-U` and `case-F`, when the context is assembled, then `case-R` carries `bindableDispositions` exactly `act`, `case-U` carries exactly `act`, `defer`, and `case-F` carries exactly `refute`, so neither an unattempted case nor a reserved action is offered `refute` and none of the three is offered `reject`.
- Given a lap whose first judgement is admissible, when the context is assembled for its only dispatch, then the context has no `bindingCorrections` key and its serialized size stays within the existing `maxSerializedBytes` ceiling.

### Done When
- [ ] A context test asserts the six `bindableDispositions` lists above for `case-A`, `case-J`, `case-C`, `case-R`, `case-U` and `case-F`.
- [ ] A skill-contract test finds the binding rule, the `bindingCorrections` round and the refute-not-reject instruction in the remediate skill's build_review case contract.

## Story 2: An inadmissible binding gets one corrected re-judgement before any halt

**Requirement:** #3461 outcomes 1, 2 (bounded retry) and 3; mixed-laps D2 and portable-policy D9 amendments of 2026-10-28

As an operator, I want a judgement that binds a prior case with a disposition it cannot take to be re-judged once with the problem named, so that a semantically valid verdict does not halt my feature needs-human, while a binding that really is illegal still fails closed.

### Acceptance Criteria

#### Happy Path
- Given a lap with prior case `case-A` and a judge whose first judgement binds `testQuality:F2` to `case-A` as `reject` and whose second judgement binds it to `case-A` as an evidence-backed refutation, when the coordinator adjudicates, then the judge is dispatched exactly twice, `case-A` is resolved with disposition `refute`, the coordinator returns an ok result with route `pass`, and no `remediation_adjudication_failed` event is emitted.
- Given the same lap, when the correction round runs, then the second dispatch's context carries `bindingCorrections` with one entry naming the first judgement's `caseRef`, `existingCaseId` `case-A`, proposed disposition `reject` and bindable dispositions `act`, `defer`, `refute`, and a `remediation_adjudication_started` event with `bindingCorrectionCaseIds` exactly `case-A` is emitted before that dispatch.
- Given the same lap, when the first judgement is refused, then at the start of the second dispatch the case store, the work-order store and the kickback ledger are byte-identical to their state at the start of the first dispatch, and after the lap the kickback ledger is byte-identical to its state before the lap, so neither round consumes a kickback.

#### Negative Paths
- Given a lap with prior case `case-R` and a judge that binds `testQuality:F2` to `case-R` as `reject` in both judgements, when the coordinator adjudicates, then the judge is dispatched exactly twice, the coordinator fails with a detail containing `inadmissible-case-binding`, `case case-R bound as reject` and `bindable: act`, one `remediation_adjudication_failed` event carries that detail, and the case store is byte-identical to its state at the start of the first dispatch.
- Given a lap whose first judgement both binds `case-A` as `reject` and omits `testQuality:F2` from its source outcomes, when the coordinator adjudicates, then the judge is dispatched exactly once and the coordinator fails with `invalid remediation judgement missing-source`, because a correction round runs only when the inadmissible binding is the judgement's sole defect.
- Given a case-v2 lap whose first judgement needs the expansion round and whose next two judgements both bind `testQuality:F2` to `case-A` as `reject`, when the coordinator adjudicates, then the judge is dispatched exactly three times, the third dispatch's context carries `bindingCorrections`, and the coordinator fails with a detail containing `inadmissible-case-binding` and `case case-A bound as reject`, so no lap makes a fourth dispatch.

### Done When
- [ ] Coordinator tests assert the dispatch counts, the corrected context, the started event and the unchanged stores for each scenario above.
- [ ] The halt detail of the exhausted scenario names the case, the proposed disposition and the bindable set.

## Story 3: Admissible bindings and the existing halts behave exactly as today

**Requirement:** #3461 outcome 3; predecessor ADR D7.2–D7.4 and mixed-laps D3 (unchanged)

As an operator, I want judgements whose bindings were already legal, and the halts that protect repeated or refuted cases, to behave exactly as before, so that the correction round cannot hide a real semantic stop.

### Acceptance Criteria

#### Happy Path
- Given a lap with prior case `case-A` and a judge whose first judgement binds `testQuality:F2` to `case-A` as an evidence-backed refutation, when the coordinator adjudicates, then the judge is dispatched exactly once, its context has no `bindingCorrections` key, and `case-A` is resolved with disposition `refute`.
- Given any of the cases `case-A`, `case-U`, `case-R`, `case-J`, `case-F` and `case-C` and any of the dispositions `act`, `defer`, `reject`, `refute` and `advisory`, when a single-row judgement binding that case with that disposition passes the case-graph validator given the lap's bindable sets, then reconciling it with the same attempted case ids and carry input never returns `illegal-disposition-transition`.
- Given a case-v2 judgement whose only bound row is an `escalate` row on `case-A`, when the case-graph validator checks it, then it does not return `inadmissible-case-binding`.

#### Negative Paths
- Given a lap with prior case `case-A` and a judge whose first judgement binds `testQuality:F2` to `case-A` as `act`, when the coordinator adjudicates, then the judge is dispatched exactly once and the coordinator fails with a detail beginning `semantic remediation case repeat case-A`, as today.
- Given a lap with prior case `case-F` and a judge whose first judgement binds `testQuality:F2` to `case-F` as an evidence-backed refutation, when the coordinator adjudicates, then the judge is dispatched exactly once and the coordinator fails with `refutation repeat case-F`, as today.
- Given a case graph that binds `testQuality:F2` to `case-R` as `reject` handed directly to `reconcileRemediationCases` without validation, when it reconciles, then it returns `illegal-disposition-transition` and the case store is byte-identical to its state before the call.

### Done When
- [ ] Coordinator tests assert the single dispatch and the unchanged halt details for the admissible refutation, the repeated act and the repeated refutation.
- [ ] A validator-and-reconciler test covers every case and disposition pair and finds no validated binding that reconciliation refuses.
- [ ] A reconciler test asserts the backstop refusal and the unchanged store.
