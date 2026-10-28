**Status:** Accepted

# Stories: build_review remediate context scoped to the findings (#3291)

Technical track. Sources: `.docs/track/build-review-remediate-context-grows-with-the-whol.md`, `.docs/decisions/architecture-review-2026-10-23-build-review-remediate-context-grows-with-the-whol.md`, and the 2026-10-23 amendments to `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2 and `adr-2026-09-10-portable-build-review-policy` D8.

## Story 1: The remediate context carries bodies only for tasks the findings and open cases touch

**Requirement:** Track outcome 1 (context size tracks the findings under adjudication)

As the build_review adjudication coordinator, I want the remediate context to carry full plan-task bodies only for the tasks the current findings and open cases touch, plus an index of every task, so that context size grows with the findings rather than with the plan.

### Acceptance Criteria

#### Happy Path
- Given a 56-task plan where the lap's only current unresolved content source has an evidence location `src/a.ts`, task 3 declares `src/a.ts`, and no prior case is open, when the adjudication context is assembled, then the plan contract carries the full body of task 3 only, and its index lists all 56 task ids, each with its title and declared dependency ids.
- Given a plan where two tasks both declare the finding's evidence path `src/shared.ts`, when the adjudication context is assembled, then both tasks' full bodies are supplied, even though the finding pointer names neither task because its anchor matches more than one.
- Given an open prior case-v2 action case whose act task admitted plan task 12, and no current finding's evidence path is declared by task 12, when the adjudication context is assembled, then task 12's full body is supplied.
- Given a 140-task plan whose current findings and open cases touch 4 tasks, when the adjudication context is assembled, then assembly succeeds with 4 supplied bodies and 140 index entries rather than stopping with `field-overflow` on `admittedTaskContracts`.
- Given any lap with prior cases, when the adjudication context is assembled, then every feature-local prior case is present in the context exactly as before this change apart from its optional source finding digests, including cases that touch none of the supplied tasks.

#### Negative Paths
- Given a lap whose current findings carry no evidence path that any plan task declares and no prior case is open, when the adjudication context is assembled, then the plan contract supplies zero task bodies, lists every task in the index, and the lap still dispatches the remediate judgement.
- Given a current source that is operator-accepted, settled, suppressed, or threshold-advisory and so excluded from the dispatched source set, when the adjudication context is assembled, then that source's evidence paths select no task body.
- Given a prior case that is resolved, when the adjudication context is assembled, then that case's admitted task ids select no task body.
- Given the selected bodies, index, and prior cases together exceed the existing `maxSerializedBytes` ceiling, when the adjudication context is assembled, then assembly stops with `serialized-byte-overflow` naming the actual and limit bytes, and no judge is dispatched.
- Given no plan is bound to the feature, when the adjudication context is assembled, then the plan contract states `path: null` with no bodies and no index entries, exactly as before this change.

### Done When
- [ ] A coordinator test over a 56-task plan fixture asserts the supplied body ids equal the selected set and the index holds all 56 ids with titles and dependency ids.
- [ ] A test over a plan of more than 128 tasks asserts context assembly returns `ok` when four tasks are selected.
- [ ] A test asserts that the serialized prior-case list, excluding source finding digests, is byte-identical with and without the scoping change for the same case store.
- [ ] The existing build_review adjudication test suites pass, with only fixtures that asserted every plan body was supplied changed to assert the selected set.

## Story 2: Admission against an unsupplied task is rejected by name

**Requirement:** Track outcome 2 (the judge cites and admits only against contracts it saw)

As the build_review adjudication coordinator, I want a case-v2 judgement that admits work against a task whose body was not supplied to be rejected with the offending task ids, so that no repair is admitted against a contract the judge never read and the coordinator can tell which tasks were missing.

### Acceptance Criteria

#### Happy Path
- Given a case-v2 judgement whose every act task admits only supplied task ids, when the judgement is validated, then validation succeeds and reconciliation, effects, and the work order proceed unchanged.
- Given a case-v2 judgement whose act task admits supplied task 3 and index-only task 9, when the judgement is validated, then validation fails with `unknown-admission-task` and the rejection names task id 9.

#### Negative Paths
- Given a case-v2 judgement admitting task id `T-99` that is neither supplied nor present in the plan index, when the judgement is validated, then validation fails with `unknown-admission-task`, names `T-99`, and marks it as absent from the plan rather than index-only.
- Given a case-v2 judgement that admits index-only task 9 and also omits a dispatched source from its graph, when the judgement is validated, then validation fails on the graph defect and the result does not classify as an index-only admission.
- Given a case-v1 judgement, whose act tasks carry no admitted task ids, when the judgement is validated, then admission closure is not applied and validation behaves exactly as before this change.

### Done When
- [ ] A validator test asserts the rejection for an index-only admission carries the index-only ids and the code `unknown-admission-task`.
- [ ] A validator test asserts an id absent from the plan is reported as absent, not index-only.
- [ ] A validator test asserts a judgement with an index-only admission plus any other defect is not classified as index-only.

## Story 3: One bounded expansion round recovers an index-only admission

**Requirement:** Track outcome 2; mixed-laps D2 and portable-policy D8 amendments of 2026-10-23

As the build_review adjudication coordinator, I want one engine-run expansion round when the judge's only defect is admitting index-listed tasks, so that a selection miss is recovered inside the lap instead of halting needs-human after BUILD and `test_suite` were paid for.

### Acceptance Criteria

#### Happy Path
- Given a case-v2 lap whose round-1 judgement fails only because it admits index-only tasks 9 and 14, when the coordinator handles the rejection, then it discards the round-1 judgement and re-dispatches the same remediate judgement once with tasks 9 and 14's full bodies added to the round-1 supplied set and every prior case unchanged.
- Given that expansion round returns a valid judgement, when the lap completes, then only the round-2 judgement is reconciled and effected, the round-1 judgement leaves no case, effect, or work-order entry, and the lap's kickback charge is the same as a lap with one judgement.
- Given an expansion round is dispatched, when the coordinator emits `remediation_adjudication_started` for that round, then the event carries `expansionTaskIds` listing tasks 9 and 14, and the round-1 event carries no `expansionTaskIds` field.

#### Negative Paths
- Given the expansion round's judgement again admits an index-only task 21, when it is validated, then no third dispatch occurs and the lap halts needs-human with a reason naming `unknown-admission-task` and task id 21.
- Given the expansion round's judgement fails validation for any reason other than an inadmissible case binding, when it is validated, then the lap halts with the existing `invalid remediation judgement` reason and no further dispatch occurs; an inadmissible case binding instead gets the lap's one binding correction round.
- Given the round-1 judgement admits a task id absent from the plan, when the coordinator handles the rejection, then no expansion round is dispatched and the lap halts naming that id as absent from the plan.
- Given a case-v1 lap, when its judgement is invalid for any reason other than an inadmissible case binding, then no expansion round is dispatched and the lap halts exactly as before this change.
- Given adding the requested bodies pushes the expansion context past `maxSerializedBytes`, when the expansion context is assembled, then no round-2 dispatch occurs and the lap halts with `serialized-byte-overflow` naming the actual and limit bytes.
- Given an operator accepts every dispatched source while the expansion round is running, when its judgement returns, then the lap finalizes as operator-resolved with no reconciliation of either round's judgement, exactly as for a single-round lap.

### Done When
- [ ] A coordinator test with a fake judge asserts exactly two judge calls for an index-only round 1 and that the second context's supplied ids equal the first set plus the requested ids.
- [ ] A coordinator test asserts at most two judge calls per lap across every rejection shape.
- [ ] A test asserts the persisted case store and work order after a recovered lap contain only round-2 cases.
- [ ] An event test asserts `expansionTaskIds` appears only on the expansion round's `remediation_adjudication_started`.

## Story 4: A failed remediate dispatch halts with the provider's exit facts

**Requirement:** Track outcome 3 (an over-limit or failed dispatch fails with a named, operator-readable reason)

As an operator reading a needs-human halt, I want a failed remediate dispatch to name the provider and its bounded exit facts, so that a spawn failure such as `E2BIG` is diagnosable from the halt without digging through the daemon log.

### Acceptance Criteria

#### Happy Path
- Given the remediate provider subprocess exits without a classifiable result and reports `processErrorCode=E2BIG`, when the build_review lap halts, then the halt reason reads `remediate judgement failed` followed by the provider name and `processErrorCode=E2BIG`.
- Given the remediate provider exits with exit code 137 and signal `SIGKILL`, when the build_review lap halts, then the halt reason names the provider, `exitCode=137`, and `signal=SIGKILL`.

#### Negative Paths
- Given the remediate dispatch fails and the provider supplied no exit facts, when the build_review lap halts, then the halt reason reads `remediate judgement failed` and names the provider, with no fabricated fact fields.
- Given the remediate dispatch succeeds but its judgement file is missing or unparseable, when the build_review lap halts, then the halt reason names the judgement read failure rather than provider exit facts.
- Given a provider's raw stderr or output contains a filesystem path or credential-like text, when the halt reason is written, then it contains only the allowlisted `ProviderExitFacts` fields and none of that raw text.
- Given the expansion round's dispatch fails, when the lap halts, then the halt reason carries that round's exit facts and states that it was the expansion round.

### Done When
- [ ] A conductor-level test with a stub provider returning `processErrorCode: 'E2BIG'` asserts the HALT marker text contains the provider name and `processErrorCode=E2BIG`.
- [ ] A test asserts a dispatch failure without exit facts yields `remediate judgement failed` plus the provider name and no `=` fact fields.
- [ ] A test asserts the halt reason never contains a raw stderr sentinel string placed in the stub provider's output.
