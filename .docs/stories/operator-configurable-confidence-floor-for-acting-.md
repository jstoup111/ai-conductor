**Status:** Accepted

# Stories: Operator-configurable confidence floor for acting on build_review findings

Source: jstoup111/ai-conductor#2383. Technical track — acceptance criteria derive from the
technical intent and the approved architecture
(`.docs/decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md`
decisions D4.1-D4.5) rather than from a PRD.

## Story 1: Confidence is a validated percentage

**Requirement:** ADR D4.1

As an operator, I want the adjudicator's per-case confidence expressed as a percentage so that I can
reason about how sure the judgement was in the same terms the rest of the harness uses.

### Acceptance Criteria

#### Happy Path
- Given an adjudication result whose case carries `"confidence": 72`, when the engine reads the remediation artifact, then the case is accepted and its confidence is retained as the integer 72.
- Given an adjudication result whose case carries `"confidence": 0`, when the engine reads the remediation artifact, then the case is accepted, because 0 is a valid confidence and not an absent value.
- Given an adjudication result whose case carries `"confidence": 100`, when the engine reads the remediation artifact, then the case is accepted.

#### Negative Paths
- Given a case carrying `"confidence": 101`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence` and no case is stamped.
- Given a case carrying `"confidence": -1`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence`.
- Given a case carrying `"confidence": 72.5`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence`, because confidence must be an integer.
- Given a case carrying `"confidence": "high"`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence`, because the enum form is no longer accepted.
- Given a case omitting `confidence` entirely, when the engine reads the remediation artifact, then the whole adjudication is rejected, because the key set is exact.
- Given a durable case store record whose persisted confidence is out of range, when the store is read, then the read fails closed as malformed state rather than admitting the record.

### Done When
- [ ] `readRemediationCaseJudgement` accepts integer confidence 0 through 100 inclusive and returns it unchanged on the parsed case.
- [ ] `readRemediationCaseJudgement` returns `{ ok: false, reason: 'invalid-case-confidence' }` for a non-integer, an out-of-range integer, or a string confidence.
- [ ] The durable case store applies the identical range check when parsing a persisted case, and rejects an out-of-range record as malformed state.
- [ ] No engine code path computes, defaults, or adjusts a confidence value; every accepted value came from the provider artifact.
- [ ] The adjudication context type carries confidence as an integer.

## Story 2: A sub-floor action is demoted to a deferral

**Requirement:** ADR D4.2

As an operator, I want to set a minimum confidence for acting so that a low-confidence hunch does not
cost a BUILD lap.

### Acceptance Criteria

#### Happy Path
- Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns an `act` case with confidence 40, when the lap is adjudicated, then that case is recorded as a `defer` case and no BUILD work order is published for it.
- Given `act_min_confidence` is 70 and an adjudication returns an `act` case with confidence 70, when the lap is adjudicated, then the case remains an `act` case, because the floor is a minimum and not an exclusive bound.
- Given `act_min_confidence` is 70 and an adjudication returns an `act` case with confidence 95, when the lap is adjudicated, then the case remains an `act` case and publishes its BUILD work order as today.
- Given `act_min_confidence` is left unset and an adjudication returns an `act` case with confidence 1, when the lap is adjudicated, then the case remains an `act` case, because the default floor of 0 never demotes.
- Given a tracker repository is resolvable and an adjudication returns both a sub-floor `act` case and an at-floor `act` case, when the lap is adjudicated, then only the sub-floor case is demoted and the other still publishes its work order.

#### Negative Paths
- Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns a `defer` case with confidence 40, when the lap is adjudicated, then the case is unchanged, because the floor never alters a case that is already deferred.
- Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns a `reject` case with confidence 40, when the lap is adjudicated, then the case is unchanged, because the floor never alters a rejection.
- Given `act_min_confidence` is 90 and an adjudication returns a `defer` case with confidence 95, when the lap is adjudicated, then the case remains deferred, because the engine may narrow an action but may never promote a deferral into an action.
- Given a demoted case, when its stored record is read back, then its disposition is `defer` and its effect kind is `deferral`, with no residual action effect anywhere in the store.
- Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns an `act` case with confidence 40, when the demotion is applied, then it happens before case reconciliation, so no action effect is ever reserved and later contradicted.

### Done When
- [ ] The floor is read through the same resolved-config path that already serves `build_review.adjudication.enabled`.
- [ ] With a tracker repository resolvable, a sub-floor `act` case is persisted as a `defer` case with a `deferral` effect, and never as an `action` case. Story 5 governs the case where no tracker is resolvable.
- [ ] An `act` case at or above the floor is persisted unchanged.
- [ ] `defer` and `reject` cases are byte-identical with the floor set high and with it unset.
- [ ] The demotion is applied before `reconcileRemediationCases`, verifiable by the absence of any reserved action effect for a demoted case.
- [ ] No code path converts a `defer` or `reject` case into an `act` case.

## Story 3: A demoted finding is filed exactly once

**Requirement:** ADR D4.3

As an operator, I want a demoted finding filed as a deferral so that lowering the cost of a finding
never means losing it.

### Acceptance Criteria

#### Happy Path
- Given a sub-floor `act` case is demoted on a lap, when its deferral effect runs, then an intake issue is filed carrying the effect's hidden marker and a body with the existing Observed, Impact, Desired Outcomes and Hypotheses sections.
- Given a demoted case whose deferral body is synthesized by the engine, when the issue is filed, then the body states the case reference, the judgement's rationale, the reported confidence, and the floor that demoted it.
- Given a demoted case that was already filed on a previous lap, when the same case is demoted again on the next lap, then the existing issue is reused via its exact marker and no second issue is created.

#### Negative Paths
- Given a demoted case filed on lap one, when lap two demotes the same case and the prior issue has since been closed, then the closed issue is reused and no duplicate is filed.
- Given a demoted case, when the same feature runs three consecutive laps that each demote it, then exactly one issue exists for it across all three laps.
- Given a demoted case whose issue filing fails, when the lap settles, then the effect is recorded as failed and the lap does not report a clean pass around an unfiled finding.
- Given a demoted case, when its effect id is compared across two laps at the same floor and confidence, then the id is identical, because the demotion is deterministic and precedes reconciliation.
- Given two distinct sub-floor cases demoted on the same lap, when their deferrals are filed, then two separate issues exist with distinct markers and neither dedups against the other.

### Done When
- [ ] A demoted case files through the existing deferral effect and intake adapter, with no new filing path.
- [ ] The engine-synthesized deferral body contains the case reference, rationale, reported confidence, and the applied floor.
- [ ] Re-running a lap that demotes the same case reuses the existing issue by exact marker and creates no duplicate.
- [ ] A demoted case's effect id is stable across laps given the same confidence and floor.
- [ ] A failed deferral filing leaves the effect in a failed state rather than silently passing.

## Story 4: A demoted finding costs no budget

**Requirement:** ADR D4.3

As an operator, I want a demoted finding to consume no kickback so that raising the floor actually
reduces the cost of a build.

### Acceptance Criteria

#### Happy Path
- Given a lap whose only `act` case is demoted, when the lap settles, then the kickback ledger's `count` for `build_review` is unchanged from before the lap.
- Given a lap whose only `act` case is demoted, when the lap settles, then the demotion itself does not increment the ledger's `cumulative` value; a subsequent pass may still reset it to 0, which is the existing convergence rule and not an effect of the demotion.
- Given a lap with one demoted case and one surviving `act` case, when the lap settles, then exactly one kickback is charged, for the surviving action only.

#### Negative Paths
- Given a lap whose only `act` case is demoted, when the lap settles, then the kickback gate is not invoked at all for the demoted case, rather than invoked for a zero charge.
- Given a feature one kickback below its cumulative cap, when a lap demotes its only `act` case, then the demotion does not advance it toward the cap and it does not halt on budget exhaustion.
- Given a lap whose only `act` case is demoted, when the lap settles, then no BUILD work order is published and BUILD is not re-dispatched.
- Given a demoted case, when the event stream for the lap is read, then it contains no `kickback` event attributable to that case.

### Done When
- [ ] A demotion increments neither `count` nor `cumulative` in the kickback ledger; any reset of `cumulative` observed on a passing lap is attributable to the existing pass-convergence rule, not to the demotion.
- [ ] The kickback gate is bypassed for demoted cases rather than called with a zero charge.
- [ ] A lap mixing demoted and surviving action cases charges exactly one kickback.
- [ ] No BUILD work order is published for a demoted case.

## Story 5: The floor is inert where a deferral cannot be filed

**Requirement:** ADR D4.4

As an operator, I want the floor to stand down when a deferral could not be filed so that a
cost-saving setting never strands a build.

### Acceptance Criteria

#### Happy Path
- Given no tracker repository can be resolved and `act_min_confidence` is 70, when an adjudication returns an `act` case with confidence 40, then the case remains an `act` case and publishes its BUILD work order as though no floor were set.
- Given a tracker repository is resolvable and `act_min_confidence` is 70, when an adjudication returns an `act` case with confidence 40, then the case is demoted, confirming the inert behavior is conditional and not permanent.

#### Negative Paths
- Given no tracker repository can be resolved, when a lap adjudicates a sub-floor `act` case, then the lap does not halt on an unfinished deferral effect.
- Given no tracker repository can be resolved, when a lap adjudicates a sub-floor `act` case, then no deferral effect is reserved for it, so nothing is left in a reserved state across laps.
- Given no tracker repository can be resolved, when a lap adjudicates a sub-floor `act` case, then the lap's route is identical to the route it would take with the floor unset.
- Given the tracker becomes resolvable on a later lap, when the same sub-floor case is adjudicated again, then it is demoted on that lap, because inertness is evaluated per lap and not cached.

### Done When
- [ ] With tracker dependencies absent, a sub-floor `act` case retains its `act` disposition and its work order.
- [ ] With tracker dependencies absent, no deferral effect is reserved for a sub-floor case.
- [ ] With tracker dependencies absent, the lap route for a given adjudication is the same with the floor set as with it unset.
- [ ] The inertness decision is re-evaluated on each lap rather than persisted.

## Story 6: A fully demoted lap passes rather than deadlocking

**Requirement:** ADR D4.5

As an operator, I want a lap whose every action was demoted to pass so that a high floor cannot wedge
a build with nothing left to fix.

### Acceptance Criteria

#### Happy Path
- Given a lap whose every `act` case is demoted and whose rubrics are otherwise healthy, when the lap settles, then build_review passes and the step is recorded done.
- Given a lap whose every `act` case is demoted, when the lap settles, then BUILD is not re-entered.
- Given a lap with three `act` cases all below the floor, when the lap settles, then all three are filed as deferrals and the lap still passes.

#### Negative Paths
- Given a lap whose every `act` case is demoted, when the lap settles, then it does not halt with a route of `halt`, and specifically not on an unfinished-effect reason.
- Given a lap whose every `act` case is demoted but one deferral effect has not finalized, when the lap settles, then the lap halts rather than passing, because an unfinished effect still blocks a pass.
- Given a lap whose every `act` case is demoted while an uncovered infrastructure failure remains, when the lap settles, then the lap follows the existing mechanical lane rather than passing, because content demotion does not clear an infrastructure blocker.
- Given a lap with one demoted case and one surviving `act` case, when the lap settles, then the lap routes to BUILD rather than passing.

### Done When
- [ ] A lap whose every action case was demoted and whose deferrals all finalized reaches a pass verdict.
- [ ] That lap re-enters neither BUILD nor a halt.
- [ ] A lap with an unfinalized deferral still halts.
- [ ] A lap with a remaining uncovered infrastructure failure still follows the mechanical lane.
- [ ] A lap retaining at least one action case still routes to BUILD.

## Story 7: Every demotion is visible to the operator

**Requirement:** ADR D4.5

As an operator, I want each demotion recorded so that I can see what my floor suppressed and raise or
lower it deliberately.

### Acceptance Criteria

#### Happy Path
- Given a case is demoted, when the lap's event stream is read, then it contains a remediation event carrying the demotion reason, including the reported confidence and the applied floor.
- Given a case is demoted, when the lap's adjudication trace is rendered, then it contains a line naming the case, its confidence, and the floor that demoted it.
- Given a lap demotes two cases, when the trace is rendered, then both appear as separate lines.

#### Negative Paths
- Given a case is demoted, when the event stream is read, then the demotion is not emitted as a `kickback` event, because no kickback was charged.
- Given a lap that demotes nothing, when its event stream is read, then no demotion reason appears on any event.
- Given a case is demoted, when the demotion record is inspected, then it is stamped at the time of demotion rather than reconstructed later from stored case state.
- Given a demoted case, when the lap subsequently halts for an unrelated reason, then the demotion line still appears in the halt evidence.
- Given the demotion record rides an existing event member, when a new event member is introduced instead, then that member declares its sink and appears in the audit-trail mapping, so event completeness is preserved.

### Done When
- [ ] Each demotion emits its reason on the persisted event spine, carrying the reported confidence and the applied floor.
- [ ] Each demotion contributes a distinct line to the rendered adjudication trace.
- [ ] The demotion is never emitted or rendered as a `kickback` event.
- [ ] The demotion record is produced at demotion time, not derived afterwards from stored state.
- [ ] Any new event member introduced for this purpose declares its sink and its audit-trail mapping.

## Story 8: The floor is configured like every other harness knob

**Requirement:** ADR D4.2, adr-2026-08-26 decision 4

As an operator, I want the floor validated and declared like other config keys so that a typo fails
loudly at load instead of silently disabling the floor.

### Acceptance Criteria

#### Happy Path
- Given a project config setting `build_review.adjudication.act_min_confidence` to 70, when config loads, then it is accepted and the resolved value is 70.
- Given a project config that omits the key, when config loads, then the resolved value is 0 and no warning is produced.
- Given a project config setting the key to 0, when config loads, then it is accepted and the floor never demotes.
- Given a project config setting the key to 100, when config loads, then it is accepted.

#### Negative Paths
- Given a config setting the key to 101, when config loads, then loading fails with a validation error naming the exact `build_review.adjudication.act_min_confidence` path and its permitted range.
- Given a config setting the key to -5, when config loads, then loading fails with a validation error naming the exact path.
- Given a config setting the key to 70.5, when config loads, then loading fails with a validation error, because the value must be an integer.
- Given a config setting the key to the string "70", when config loads, then loading fails with a validation error, because the value must be an integer and is not coerced.
- Given a config setting a misspelled `act_min_confidance`, when config loads, then loading fails with the existing unknown-key error naming the `build_review.adjudication` block.
- Given the config-key consumer registry, when its totality test runs, then `build_review.adjudication.act_min_confidence` declares a resolvable production consumer and the test passes.

### Done When
- [ ] `build_review.adjudication.act_min_confidence` is accepted in the `build_review.adjudication` key set and validated as an integer 0 through 100 inclusive.
- [ ] An out-of-range, non-integer, or string value fails config load with an error naming the exact key path and permitted range.
- [ ] An unknown sibling key still fails with the existing unknown-key error.
- [ ] The resolved default is 0 when the key is absent.
- [ ] The key declares a production consumer in the config-key consumer registry and the registry totality test passes.
