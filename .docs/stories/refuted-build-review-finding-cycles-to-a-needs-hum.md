**Status:** Accepted

# Stories: Refuted build_review finding cycles to a needs-human halt instead of settling

Source: jstoup111/ai-conductor#2409. Technical track, Tier M. Design: the approved architecture
review and the four amended ADRs (adr-2026-08-29-build-review-remediate-case-adjudication D7.1–D7.6,
adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D3.4 and D5.3,
adr-2026-07-13-kickback-build-no-op-escalation D2.1, adr-2026-08-13-stable-build-review-finding-dispositions D4.1).

Throughout, "an attempted case" means an open build_review remediation case with disposition `act`
whose action effect is applied and whose id appears in the work order's attempted set.

## Story 1: A refuted re-raise settles the lap instead of halting

As the daemon operator, I want the adjudication judge to settle a re-raised finding whose claim it
finds refuted so that a refuted finding costs no remediation lap and no needs-human halt.

### Acceptance Criteria

#### Happy Path
- Given an attempted case and a new lap whose rubric re-raises the same source id, when the judge binds that case with a `refute` row carrying one `refuted` assertion, resolvable evidence references, `high` confidence, and an effect of `none`, then the lap routes PASS with the trace reporting a finalized non-action outcome for that source
- Given the same refutation, when the lap completes, then the kickback ledger's build_review count and cumulative count are unchanged from before the lap and no BUILD work order is published
- Given the same refutation, when the lap completes, then the case record is resolved with a `refuted` terminal and carries the refuted claim, every assertion verdict, and the judge rationale

#### Negative Paths
- Given an attempted case and a re-raise, when the judge binds it with a `refute` row whose every assertion is `upheld`, then the judgement is rejected fail-closed before any durable write and the lap does not route PASS
- Given an attempted case and a re-raise, when the judge binds it with a `refute` row whose confidence is `medium` or `low`, then the judgement is rejected fail-closed and the case remains open with disposition `act`
- Given an attempted case and a re-raise, when the judge binds it with a `refute` row whose effect is a BUILD action, then the judgement is rejected fail-closed and no work order is published

### Done When
- [ ] An end-to-end coordinator test drives an attempted case through a re-raise with a valid refutation and asserts route PASS, unchanged ledger counts, no work order, and a resolved case record carrying the refutation
- [ ] The three rejections above each leave the case store byte-identical to its pre-lap content

## Story 2: A refutation is admitted only under the mechanical bounds

As the harness owner, I want every refutation to pass engine-side admission checks so that the lane
cannot be used to wave findings through.

### Acceptance Criteria

#### Happy Path
- Given a `refute` row bound to an attempted case with no prior refutation, when every evidence reference names an existing path whose file contains the normalized excerpt, then the row is admitted and the case transitions from `act` to `refute`
- Given an admitted refutation, when the case store is read back, then the refutation is present on the case record and no operator disposition record was created or changed

#### Negative Paths
- Given a `refute` row with no existing-case binding, when the judgement is validated, then it is rejected with a reason naming the missing binding and nothing is persisted
- Given a `refute` row bound to an open `act` case that BUILD never attempted, when the judgement is reconciled, then it is rejected as an illegal disposition transition and the case remains open with disposition `act`
- Given a `refute` row bound to an attempted case whose action effect is still reserved or failed, when the judgement is reconciled, then it is rejected as an illegal disposition transition
- Given a `refute` row bound to a case with disposition `defer` or `reject`, when the judgement is reconciled, then it is rejected as an illegal disposition transition
- Given a `refute` row whose evidence reference names a path that does not exist at the current tree, when the judgement is validated, then the whole judgement is rejected fail-closed and no waiver path accepts it
- Given a `refute` row whose evidence reference names an existing path but an excerpt that does not occur in that file after whitespace normalization, when the judgement is validated, then the whole judgement is rejected fail-closed
- Given a `refute` row whose evidence reference carries a line number, hunk offset, or commit SHA field, when the judgement is parsed, then it is rejected as malformed
- Given a valid refutation, when the operator disposition store is inspected afterwards, then it contains no record for the refuted finding and the finding is not reported as operator-accepted

### Done When
- [ ] Parser, validator, and reconciler tests cover each rejection above with the named reason
- [ ] A test proves the `act` to `refute` transition is the only disposition change the reconciler admits and every other pairing still yields the existing illegal-transition rejection

## Story 3: A genuine repeat still halts, and a repeated refutation halts too

As the daemon operator, I want an unrefuted repeat to halt exactly as before and a second refutation
of one case to halt so that the lane is bounded once per case.

### Acceptance Criteria

#### Happy Path
- Given an attempted case and a re-raise, when the judge again proposes `act` on that case, then the lap halts needs-human with the existing semantic remediation case repeat reason naming the case id and the existing repeat-halt occurrence is emitted
- Given a case already resolved by refutation, when a later judgement binds a live source (one whose id is not the refuted source id) to that case with another `refute` row, then the lap halts needs-human with a reason naming the case id and the refutation repeat

#### Negative Paths
- Given the second-refutation halt, when the case store is read back, then the original refutation is unchanged and no second refutation was persisted
- Given the second-refutation halt, when the kickback ledger is read back, then no charge was recorded
- Given an attempted case and a re-raise where the judge proposes `act`, when the halt is written, then its class is needs-human and the halt survives daemon sweeps until an operator clears it

### Done When
- [ ] A coordinator test asserts the unchanged repeat halt reason, class, and occurrence for an `act` re-proposal
- [ ] A coordinator test asserts the refutation-repeat halt reason and class and the unchanged store and ledger

## Story 4: A refuted case stays settled on later laps

As the daemon operator, I want a refuted source to be excluded from later adjudication so that the
same refuted claim is neither re-judged nor halted as a regression.

### Acceptance Criteria

#### Happy Path
- Given a case resolved by refutation with effect `none`, when a later lap re-raises the exact same source id, then that source is removed from the live source set, the judge is not dispatched for it, and the lap routes PASS when no other source is live
- Given a case resolved by refutation whose residual deferral is applied, when a later lap re-raises the same source id, then the source is settled the same way

#### Negative Paths
- Given a case resolved by refutation whose residual deferral effect is reserved or failed, when a later lap re-raises the same source id, then the source is not settled, the lap does not route PASS, and the unfinished effect is reported as the blocker
- Given a case resolved by refutation, when a later lap raises a finding whose id has drifted from the refuted source id, then the drifted finding is a live source and is adjudicated normally
- Given a case resolved by refutation, when a later lap re-raises the same source id, then no regression halt is written for that case

### Done When
- [ ] A two-lap coordinator test proves the refuted source is excluded by exact id and that a drifted id is not
- [ ] A test proves an unfinished residual effect blocks settlement exactly as any other reserved or failed effect

## Story 5: The narrow true remainder files an intake issue

As the harness owner, I want the part of a refuted finding that is genuinely true to be recorded as
a deferral so that it reaches the tracker without re-entering a remediation lap.

### Acceptance Criteria

#### Happy Path
- Given a `refute` row whose effect is a complete deferral with a title, body, and exclusion rationale, when the refutation is admitted, then one intake issue is filed through the existing tracker seam with the sanitized body and the deferral effect is recorded as applied with the issue reference
- Given the same lap, when it completes, then no BUILD action task exists for the remainder and no plan task was appended

#### Negative Paths
- Given a `refute` row whose deferral omits the exclusion rationale, when the judgement is validated, then it is rejected with the existing invalid-deferral reason
- Given a `refute` row with a deferral, when the tracker is unavailable at filing time, then the deferral effect is recorded as failed, the lap does not route PASS, and the failure occurrence is emitted
- Given a `refute` row with a deferral whose marker already matches an existing issue, when the effect is applied, then the existing issue is reused and no duplicate is filed
- Given a `refute` row with a deferral whose body contains tracker-directed text, when the issue is filed, then the body passed to the tracker is the sanitized form

### Done When
- [ ] An effect-executor test files the residual through a fake tracker client and asserts sanitize, marker dedup, and the applied issue reference
- [ ] A test asserts a tracker failure leaves the effect failed and the route blocked

## Story 6: The operator can see a refutation in build-review findings

As the daemon operator, I want `build-review findings` to show each case and its refutation so that I
can audit an autonomous settlement without opening the store by hand.

### Acceptance Criteria

#### Happy Path
- Given a feature whose case store holds a refuted case, when the operator runs `build-review findings` for that feature, then the output lists the case id, disposition, resolution, source ids, effect state, the refuted claim, each assertion verdict, and the judge rationale, labeled as an autonomous outcome
- Given a feature with both an operator disposition and a refuted case, when findings is rendered, then the two are printed in distinct sections and neither is described as the other

#### Negative Paths
- Given a feature whose case store file is malformed, when findings runs, then the command reports the unreadable store and exits non-zero rather than omitting the cases
- Given a feature whose case store carries an unknown store version, when findings runs, then the command reports the unknown version and exits non-zero
- Given a feature with no case store file, when findings runs, then the listing succeeds and reports no autonomous cases
- Given the JSON output mode, when a refuted case is present, then the JSON carries the same case fields as the human rendering

### Done When
- [ ] A CLI test renders a refuted case in both human and JSON modes and asserts the autonomous label and distinct sections
- [ ] CLI tests cover malformed store, unknown version, and absent store outcomes

## Story 7: The refutation lane is visible on the event spine and pinned in the skill contract

As the harness owner, I want every admitted refutation to emit one occurrence and the judge contract
to name the new vocabulary so that no consumer or provider learns about it by accident.

### Acceptance Criteria

#### Happy Path
- Given an admitted refutation, when the lap completes, then exactly one refutation occurrence for that case id is persisted to the events file with the lap id and, when a residual was filed, the residual effect id
- Given the remediate skill text, when the contract test runs, then the case-v1 section enumerates `refute` and `refuted`, the refutation record fields, and the binding, confidence, and evidence rules

#### Negative Paths
- Given a rejected refutation, when the lap completes, then no refutation occurrence is emitted and the existing adjudication-failed occurrence carries the rejection reason
- Given the event sink registry, when the refutation member is missing a sink declaration, then the registry's exhaustiveness check fails to compile
- Given the remediate skill text with the refutation rules removed, when the contract test runs, then it fails naming the missing rule

### Done When
- [ ] The event union and sink registry carry the refutation member with explicit render, persist, audit, and otel flags and a daemon renderer case
- [ ] The remediate skill contract test is extended for the refutation vocabulary and rules
