**Status:** Accepted

# Stories: Operator-configurable confidence floor for acting on build_review findings

Source: jstoup111/ai-conductor#2383, as revised by the operator on 2026-09-06. Technical track —
acceptance criteria derive from the technical intent and the approved architecture
(`.docs/decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md`
decisions D4.1-D4.6 and D5.1-D5.3) rather than from a PRD.

## Story 1: A grader reports confidence and the engine validates it

**Requirement:** ADR D4.1, D4.2

As an operator, I want each rubric finding to carry the grader's confidence that it is a real defect
so that the engine has a number to compare against a floor.

### Acceptance Criteria

#### Happy Path
- Given a rubric result whose finding carries `"confidence": 72`, when the engine parses the result, then the finding is accepted and its confidence is retained as the integer 72.
- Given a rubric result whose finding carries `"confidence": 0`, when the engine parses the result, then the finding is accepted, because 0 is a valid confidence and not an absent value.
- Given a rubric result whose finding carries `"confidence": 100`, when the engine parses the result, then the finding is accepted.
- Given a rubric result whose finding omits `confidence`, when the engine parses the result, then the finding is accepted with no confidence recorded, because the field is optional.

#### Negative Paths
- Given a finding carrying `"confidence": 101`, when the engine parses the result, then the whole rubric result is malformed and is handled exactly as a result with any other invalid finding field.
- Given a finding carrying `"confidence": -1`, when the engine parses the result, then the whole rubric result is malformed.
- Given a finding carrying `"confidence": 72.5`, when the engine parses the result, then the whole rubric result is malformed, because confidence must be an integer.
- Given a finding carrying `"confidence": "high"`, when the engine parses the result, then the whole rubric result is malformed, because a string is not accepted.
- Given a cached rubric result produced before the contract stated confidence, when the skill text has since changed, then the cached result is discarded on skill-digest mismatch and the grader re-runs under the current contract.

### Done When
- [ ] The finding parser accepts an integer confidence 0 through 100 inclusive and returns it unchanged on the parsed finding.
- [ ] The finding parser accepts a finding with no confidence and records none.
- [ ] The finding parser treats a non-integer, out-of-range, or string confidence as a malformed result through the existing invalid-field path.
- [ ] No engine code path assigns, defaults, or adjusts a confidence value.
- [ ] The rubric result contract in the grader's skill text states the optional integer field and its meaning.

## Story 2: Confidence never changes a finding's identity

**Requirement:** ADR D4.1

As an operator, I want a finding's identity independent of its confidence so that my accepted-risk
dispositions keep binding when a grader re-scores the same finding.

### Acceptance Criteria

#### Happy Path
- Given two findings identical in rubric, contract version, concern kind and anchor but carrying confidence 30 and 90, when their identities are computed, then both produce the same finding id.
- Given a finding with confidence 30 and the same finding with no confidence, when their identities are computed, then both produce the same finding id.

#### Negative Paths
- Given an operator disposition accepting a finding graded at confidence 90, when the next lap re-grades the same finding at confidence 40, then the disposition still binds and the finding is recorded as accepted.
- Given the canonical identity payload for a finding, when it is inspected, then it contains no confidence field.
- Given a finding whose anchor differs by one character from an accepted finding, when its identity is computed, then it produces a different id regardless of confidence, because confidence neither adds to nor substitutes for the anchor.

### Done When
- [ ] Two findings differing only in confidence share one identity id.
- [ ] The canonical identity payload contains no confidence field.
- [ ] An operator disposition recorded against a finding continues to bind after the finding is re-graded at a different confidence.

## Story 3: A sub-floor finding is suppressed before build_review fails

**Requirement:** ADR D4.3, D4.4

As an operator, I want a finding below my floor to not fail build_review so that a low-confidence
hunch never costs a remediate session or a BUILD lap.

### Acceptance Criteria

#### Happy Path
- Given `build_review.rubrics.testQuality.min_confidence` is 70 and a lap's only finding carries confidence 40, when the effective verdict is derived, then the finding is placed in the suppressed set, the unresolved set is empty, and the effective verdict is PASS.
- Given the floor is 70 and a finding carries confidence 70, when the effective verdict is derived, then the finding is unresolved, because the floor is a minimum and not an exclusive bound.
- Given the floor is 70 and a finding carries confidence 95, when the effective verdict is derived, then the finding is unresolved and the effective verdict is FAIL, as today.
- Given the floor is unset and a finding carries confidence 1, when the effective verdict is derived, then the finding is unresolved, because the default floor of 0 never suppresses.
- Given the floor is 70 and a lap has findings at confidence 40 and 90, when the effective verdict is derived, then only the 40 is suppressed and the verdict is FAIL on the 90.

#### Negative Paths
- Given the floor is 70 and a finding omits confidence, when the effective verdict is derived, then the finding is unresolved, because an absent confidence is never suppressed.
- Given a lap whose every finding is suppressed, when the conductor evaluates the build_review gate, then it records the step done without dispatching remediate and without charging a kickback.
- Given a lap with one suppressed and one unresolved finding, when adjudication runs, then the judge's current sources contain only the unresolved finding.
- Given a suppressed finding, when the operator disposition store is read after the lap, then it is byte-identical to its state before the lap, because suppression never becomes operator authority.
- Given a rubric with an uncovered infrastructure failure alongside a suppressed finding, when the effective verdict is derived, then the verdict is still FAIL on the infrastructure failure, because suppression clears content only.

### Done When
- [ ] The effective verdict reducer produces a suppressed set distinct from the accepted and unresolved sets, and only the unresolved set blocks.
- [ ] A finding below its rubric's floor is suppressed; at or above it, or with no confidence, it is unresolved.
- [ ] A lap whose every finding is suppressed passes the build_review gate with no remediate dispatch and no kickback charged.
- [ ] On a mixed lap the adjudication sources exclude suppressed findings.
- [ ] The operator disposition store is unchanged by a suppressed lap.

## Story 4: Every suppression is visible

**Requirement:** ADR D4.5

As an operator, I want each suppressed finding recorded so that I can see what my floor hid and tune
it deliberately.

### Acceptance Criteria

#### Happy Path
- Given a finding is suppressed on a lap, when the lap's outer verdict event is read, then it carries a suppressed-findings list naming the finding id, its rubric, its reported confidence, and the floor applied.
- Given two findings are suppressed on a lap, when the outer verdict event is read, then both appear as separate entries.
- Given a finding is suppressed, when the daemon log for the lap is read, then a line names the suppressed finding and its confidence against the floor.

#### Negative Paths
- Given a lap that suppresses nothing, when the outer verdict event is read, then its suppressed-findings list is absent or empty.
- Given a finding is suppressed, when the event stream is read, then no kickback event is attributable to it.
- Given a suppressed finding, when its record is inspected, then it was stamped when the effective verdict was derived rather than reconstructed later from stored state.

### Done When
- [ ] The outer verdict event carries an additive suppressed-findings list with finding id, rubric, confidence, and floor for every suppressed finding.
- [ ] The daemon log projection of that event renders one line per suppressed finding.
- [ ] A suppression is never emitted or rendered as a kickback event.

## Story 5: Suppressed findings persist and stay visible to the judge

**Requirement:** ADR D4.6

As an operator, I want suppressed findings remembered across laps so that when rubrics later conflict,
remediate knows what was already seen and set aside.

### Acceptance Criteria

#### Happy Path
- Given a finding is suppressed on lap one, when the case store is read after the lap, then it holds a suppression entry keyed by the finding's id carrying its rubric, summary, confidence, floor, and the lap last seen.
- Given a suppression entry exists and a later lap dispatches the judge, when the adjudication context is assembled, then the entry appears in a non-blocking history section separate from current sources.
- Given a suppressed finding recurs on a later lap, when the case store is read, then its entry's last-seen lap is updated and no second entry is created.

#### Negative Paths
- Given a suppression entry exists, when the judge returns a case-v1 result that gives that entry no outcome, then the result is still valid, because suppression entries are not current sources and the source-complete validator does not demand an outcome for them.
- Given a suppressed finding stops recurring, when later laps run, then its entry remains in the store and is not pruned.
- Given a related case is resolved, when the store is read, then both the resolved case and every suppression entry remain present.
- Given a suppression entry, when the operator disposition store is read, then the entry does not appear there.

### Done When
- [ ] The case store persists one suppression entry per suppressed finding id, updated in place on recurrence and never pruned.
- [ ] The adjudication context carries suppression entries in a history section distinct from current sources.
- [ ] A judgement that assigns no outcome to a suppression entry still validates.
- [ ] Resolved cases and suppression entries remain in the store across laps.

## Story 6: A settled finding does not re-dispatch the judge

**Requirement:** ADR D5.1, D5.2

As an operator, I want a finding that remediate already deferred, rejected, or merged to stop costing
a remediate session every lap it recurs unchanged.

### Acceptance Criteria

#### Happy Path
- Given lap one deferred finding B and its deferral effect is applied, when lap two reports B with the identical content-anchored id, then the live source set is empty after operator resolution and settlement, and no remediate dispatch occurs.
- Given lap one rejected finding C, when lap two reports C with the identical id, then no remediate dispatch occurs.
- Given a finding was recorded with a merged source outcome on a finalized case, when it recurs with the identical id, then no remediate dispatch occurs.
- Given lap two reports settled finding B and new finding D, when adjudication runs, then the judge is dispatched with D as its only current source.

#### Negative Paths
- Given lap one deferred finding B, when lap two reports B with an anchor that differs by one character, then B is a live source and the judge is dispatched, because only an exact id is settled.
- Given lap one deferred finding B but its deferral effect is still reserved, when lap two reports B, then B is not settled and the lap follows the existing unfinished-effect route.
- Given lap one produced an open action case for finding A that BUILD has not attempted, when lap two reports A, then A is not settled and the existing action route applies.
- Given the settlement predicate runs, when the case store is read afterwards, then no case was written, resolved, or pruned by the predicate.
- Given the case store is unreadable, when the settlement predicate would run, then the lap fails closed exactly as it does today for an unreadable store.

### Done When
- [ ] A finding whose exact id links to a finalized deferred, rejected, or merged case is removed from the live source set before dispatch.
- [ ] A lap whose live set is empty after settlement finalizes from durable state without dispatching the judge.
- [ ] A drifted id, a reserved or failed effect, and an open action case each leave the finding live.
- [ ] The predicate performs no write to the case store.

## Story 7: A skipped dispatch is recorded

**Requirement:** ADR D5.3

As an operator, I want a skipped remediate dispatch visible so that a quiet lap reads as a settled lap
and not as a missing one.

### Acceptance Criteria

#### Happy Path
- Given the settlement predicate empties the live set, when the lap finalizes, then a remediation adjudication completed event is emitted for the lap carrying the settled case ids and no new effect ids.
- Given a skipped dispatch, when the daemon log is read, then the lap shows a completed adjudication line rather than no adjudication line.

#### Negative Paths
- Given the settlement predicate empties the live set, when the event stream is read, then no adjudication started event was emitted for a dispatch that did not happen.
- Given the settlement predicate empties the live set, when the kickback ledger is read, then it is unchanged.
- Given a skipped dispatch, when the trace for the lap is rendered, then each settled case appears with its finalized outcome.

### Done When
- [ ] A skipped dispatch emits the completed-adjudication event with settled case ids and an empty effect list.
- [ ] No started event is emitted for a skipped dispatch.
- [ ] The kickback ledger is unchanged by a skipped dispatch.

## Story 8: The floor is configured per rubric like every other rubric policy

**Requirement:** ADR D4.3, adr-2026-08-26 decision 4

As an operator, I want the floor validated and declared like the other rubric policy keys so that a
typo fails loudly at load instead of silently disabling it.

### Acceptance Criteria

#### Happy Path
- Given a project config setting `build_review.rubrics.testQuality.min_confidence` to 70, when config loads, then it is accepted and the resolved rubric policy carries 70.
- Given a project config that omits the key, when config loads, then the resolved floor is 0 and no warning is produced.
- Given a project config setting the key to 0, when config loads, then it is accepted and nothing is ever suppressed.
- Given a project config setting the key to 100, when config loads, then it is accepted.

#### Negative Paths
- Given a config setting the key to 101, when config loads, then loading fails with a validation error naming the exact `build_review.rubrics.testQuality.min_confidence` path and its permitted range.
- Given a config setting the key to -5, when config loads, then loading fails with a validation error naming the exact path.
- Given a config setting the key to 70.5, when config loads, then loading fails with a validation error, because the value must be an integer.
- Given a config setting the key to the string "70", when config loads, then loading fails with a validation error, because the value is not coerced.
- Given a config setting a misspelled `min_confidance`, when config loads, then loading fails with the existing unknown-key error naming the rubric policy block.
- Given the config-key consumer registry, when its totality test runs, then `build_review.rubrics.min_confidence` declares a resolvable production consumer and the test passes.

### Done When
- [ ] `min_confidence` is accepted in the rubric policy key set and validated as an integer 0 through 100 inclusive.
- [ ] An out-of-range, non-integer, or string value fails config load with an error naming the exact key path and range.
- [ ] An unknown sibling key still fails with the existing unknown-key error.
- [ ] The resolved default is 0 when the key is absent.
- [ ] The key declares a production consumer in the config-key consumer registry and the totality test passes.
