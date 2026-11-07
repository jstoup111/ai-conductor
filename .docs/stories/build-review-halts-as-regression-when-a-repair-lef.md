**Status:** Accepted

# Stories: a bound build_review re-raise of a resolved action case routes a judged residual gap to BUILD under the lineage limit (#3362)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/build-review-halts-as-regression-when-a-repair-lef.md`;
- the 2026-10-28 amendment of `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5 (D5.12–D5.15);
- `architecture-review-2026-10-28-build-review-halts-as-regression-when-a-repair-lef` (APPROVED);
- the desired outcomes of #3362.

Terms used below:
- **Lap:** a build_review lap of feature `demo` whose only current finding is the testQuality source `testQuality:F2`, adjudicated by `coordinateBuildReviewAdjudication` with a scripted judge, the real case store and the real reconciler.
- **Resolved action case `case-R`:** a prior build_review case with disposition `act`, resolution `resolved`, an `action` effect with status `applied`, no operator acceptance origin, no operator resolution, and no `recurrenceOf`; it is not carry-eligible.
- **Failed resolved case `case-X`:** the same as `case-R` except that its action effect status is `failed`.
- **Open attempted case `case-A`:** a prior case with disposition `act`, resolution `open`, an `applied` action effect, and an id in the lap's attempted case ids.
- **Bound act row:** a judgement case row with disposition `act`, `existingCaseId` naming a prior case, a valid action effect with in-scope tasks, and `testQuality:F2` as its only `acted` source.
- **Residual declaration:** `reRaise` `{ kind: 'residual-gap', reason: 'the repair left a narrower gap' }`. **Repeat declaration:** `reRaise` `{ kind: 'repeat', reason: 'the same defect is back' }`.
- **Lineage of `case-R`:** `case-R` plus every case reachable through `recurrenceOf`; its applied attempts are the lineage `act` cases whose action effect is `applied`.

## Story 1: The judge can declare whether a bound re-raise of a resolved action case is a residual gap or a repeat

**Requirement:** #3362 outcome 3 (the operator can see whether a rebind was judged residual progress or a repeat); mixed-laps D5.12 amendment of 2026-10-28

As the remediate judge, I want to state whether a finding I bind to a resolved action case is a narrower residual gap or the same defect again, so that the engine routes it on my judgement instead of halting every rebind.

### Acceptance Criteria

#### Happy Path
- Given a judgement artifact whose bound act row on `case-R` carries the residual declaration, when `readRemediationCaseJudgement` parses it and the case-graph validator checks it against the lap's prior cases, then the validated row keeps `reRaise` exactly `{ kind: 'residual-gap', reason: 'the repair left a narrower gap' }`.
- Given a judgement artifact whose bound act row on `case-R` carries the repeat declaration, when it is parsed and validated, then the validated row keeps `reRaise` exactly `{ kind: 'repeat', reason: 'the same defect is back' }`.
- Given the remediate skill's build_review case contract, when the judge reads it, then it states that a row with disposition `act` binding a resolved `act` case with an applied action effect may carry `reRaise` with kind `residual-gap` or `repeat` and a non-empty reason, that `residual-gap` routes the repair to BUILD under the lineage limit of three applied attempts, that `repeat` halts the lap, and that an absent `reRaise` is treated as a residual gap.

#### Negative Paths
- Given a bound act row on `case-R` whose `reRaise` has kind `maybe`, an empty reason, a reason longer than 8,000 characters, or an extra key, when the artifact is parsed, then it is rejected as `invalid-case-keys`, exactly as a malformed `distinctFrom` is, and no case store, work-order store or kickback ledger byte changes.
- Given a judgement whose row carrying the residual declaration is unbound, binds `case-A`, binds `case-X`, or binds `case-R` with disposition `defer`, when it is validated, then the validated row has no `reRaise` key, the validator returns no rejection, and the lap proceeds exactly as it does for the same row without `reRaise`.
- Given a store holding `case-R`, when a lap whose judgement carries a residual declaration is reconciled, then no persisted case record, including the newly minted one, contains a `reRaise` key, and the store version is unchanged.

### Done When
- [ ] Artifact-parser tests accept both declaration kinds on a bound act row and reject each malformed shape above as `invalid-case-keys`.
- [ ] A validator test asserts that `reRaise` is dropped, with no rejection, on the unbound, open-case, failed-effect and `defer` rows above.
- [ ] A skill-contract test finds the `reRaise` rule, both kinds, the lineage limit and the absent-means-residual rule in the remediate skill's build_review case contract.

## Story 2: A residual or undeclared rebind of a resolved action case routes to BUILD under the lineage limit

**Requirement:** #3362 outcomes 1 (a narrower residual gap routes to BUILD) and 2 (cycling stays bounded and names its attempts); mixed-laps D5.13 and D5.15 amendments of 2026-10-28

As an operator, I want a repair that left a narrower gap to go back to BUILD with the judge's planned tasks, so that I do not hand-apply work the adjudicator already planned, while a finding that keeps coming back still stops after a bounded number of attempts.

### Acceptance Criteria

#### Happy Path
- Given a lap with prior case `case-R` whose lineage has one applied attempt and a judgement whose bound act row on `case-R` carries the residual declaration, when the coordinator adjudicates, then it returns an ok result with route `build`, a new open `act` case N is persisted with a freshly reserved action effect, `recurrenceOf` exactly `['case-R']` and source `testQuality:F2`, no `remediation_semantic_repeat_halt` or `remediation_adjudication_failed` event is emitted, and the bytes of the `case-R` record are identical to their state before the lap.
- Given the same lap, when N is reconciled, then exactly one `remediation_case_reconciled` event for N carries `recurrenceOf` `['case-R']`, `reRaiseKind` `residual-gap` and `boundCaseId` `case-R`, and the kickback ledger records exactly one charge, for N's effect id.
- Given the same lap except that the bound act row carries no `reRaise`, when the coordinator adjudicates, then it routes `build` with a new case N stamped `recurrenceOf` `['case-R']`, and N's `remediation_case_reconciled` event carries `reRaiseKind` `undeclared` and `boundCaseId` `case-R`.
- Given the #3348 shape replayed from fixtures (resolved `26a04ec0` with applied effect `74d67e04`, and a bound act re-raise on a new testQuality source with Task-16-scoped tasks and no `reRaise`), when the lap runs through the conductor's build_review step, then no `.pipeline/HALT` is written and BUILD receives a work order whose tasks are the judgement's tasks.
- Given N was minted from `case-R`, its repair was applied and N was resolved, and a later lap binds a new finding to N as a residual rebind, when the coordinator adjudicates, then a new case M is persisted with `recurrenceOf` exactly N's id, and the lineage it is checked against is `case-R` and N with two applied attempts.

#### Negative Paths
- Given a lap whose `case-R` lineage already counts three applied attempts and a bound act row on `case-R` carrying the residual declaration, when the coordinator adjudicates, then no new case or action effect is persisted, `testQuality:F2` is linked to `case-R` with outcome `acted`, one `remediation_semantic_repeat_halt` event carries reason `recurrence-limit`, `caseId` `case-R`, `reRaiseKind` `residual-gap` and every lineage case id, and the coordinator fails with a detail beginning `semantic remediation case recurrence limit case-R` and containing `3 applied attempts (limit 3)`.
- Given the residual rebind of the first happy path and an exhausted cumulative kickback cap, when the effect stage runs, then the lap halts with the existing kickback-cap halt naming N's effect id and no `semantic remediation case regression` text appears in the halt or in any event.
- Given N is persisted for the residual rebind, when the same judgement is reconciled again, then it converges on N with no second case, no second effect, no change to N's `recurrenceOf`, and no second kickback charge.
- Given a lap whose lineage limit would halt and whose `testQuality:F2` is operator-accepted before the halt decision, when the coordinator re-reads authority, then the lap takes the existing acceptance-terminal exit and writes no halt, exactly as the existing recurrence-limit halt behaves under acceptance.
- Given `case-R` is carry-eligible, when a bound act row on it carries the residual declaration, then the binding is classified `carry` exactly as today: no new case, no effect, no charge and no halt.

### Done When
- [ ] Coordinator tests with the real store and reconciler assert the route, N's `recurrenceOf`, the byte-identical `case-R`, the single charge and the `remediation_case_reconciled` fields for the residual and undeclared rebinds.
- [ ] A conductor-level test replays the #3348 shape and asserts no HALT and a BUILD work order carrying the judgement's tasks.
- [ ] Coordinator tests assert the lineage-limit halt, the kickback-cap halt, replay convergence, the acceptance exit and carry for the negative paths above.

## Story 3: A declared repeat still halts, names its spent attempts, and every other binding behaves as today

**Requirement:** #3362 outcomes 2 (a real cycle halts and names the re-acts spent) and 3; mixed-laps D5.14 and D5.15 amendments of 2026-10-28; mixed-laps D3 (unchanged)

As an operator, I want a re-raise the judge calls the same defect to stop at once with the attempts it has already spent, so that I can decide on a real cycle without wasted BUILD laps, while the halts that protect open, failed and carried cases do not change.

### Acceptance Criteria

#### Happy Path
- Given a lap with prior case `case-R` whose lineage has one applied attempt and a judgement whose bound act row on `case-R` carries the repeat declaration, when the coordinator adjudicates, then no new case or action effect is persisted, `testQuality:F2` is linked to `case-R` with outcome `acted`, and the coordinator fails with a detail beginning `semantic remediation case regression case-R` and containing `declared repeat` and `lineage case-R has 1 applied attempts`.
- Given the same lap, when it halts, then one `remediation_semantic_repeat_halt` event carries reason `regressed`, `caseId` `case-R`, `reRaiseKind` `repeat`, `lineageCaseIds` `['case-R']` and `appliedAttempts` 1.
- Given the same lap halted `semantic remediation case regression case-R`, when the operator follows the recovery the halt detail names, then the detail still names the `ai-conductor build-review accept` command for `testQuality:F2` (or, on a stacked child, the fix-the-finding recovery) exactly as before this change.

#### Negative Paths
- Given a lap with prior case `case-X` and a bound act row on `case-X`, with or without a `reRaise`, when the coordinator adjudicates, then it fails with a detail beginning `semantic remediation case regression case-X`, the `remediation_semantic_repeat_halt` event carries reason `regressed` and no `reRaiseKind`, and no new case is persisted.
- Given a lap with prior case `case-A` and a bound act row on `case-A`, with or without a `reRaise`, when the coordinator adjudicates, then it fails with a detail beginning `semantic remediation case repeat case-A` and an event with reason `already-attempted`, as today.
- Given a lap with prior case `case-R` and an unbound act row on `testQuality:F2` whose authoritative owner is `case-R`, with or without a `reRaise`, when the coordinator adjudicates, then N is stamped `recurrenceOf` `['case-R']` through the existing unbound recurrence lane, and N's `remediation_case_reconciled` event carries no `reRaiseKind` and no `boundCaseId`.
- Given a lap with the repeat declaration whose `testQuality:F2` is operator-accepted before the halt decision, when the coordinator re-reads authority, then the lap takes the existing acceptance-terminal exit and writes no halt.

### Done When
- [ ] Coordinator tests assert the declared-repeat halt detail, its event fields and the unchanged recovery text.
- [ ] Coordinator tests assert that the failed-effect regression, the open-case repeat and the unbound recurrence lane behave as before, with no `reRaiseKind` on their events.
- [ ] An event-type test asserts that `reRaiseKind`, `boundCaseId` and `appliedAttempts` are optional fields of the existing `remediation_case_reconciled` and `remediation_semantic_repeat_halt` variants and that no new event type is registered.
