**Status:** Accepted

# Remediation dispositions honor the engine-owned input/output contract

Source: jstoup111/ai-conductor#2522.

Technical track, Tier L. Scope and architecture were approved on 2026-10-06.
Architecture: `.docs/decisions/architecture-review-2026-10-06-remediation-dispositions-honor-the-engine-owned-in.md`.
These stories describe the approved target behavior of the `remediate` gap-planning boundary.
The routing, budget, operator-authority, concrete-work and idempotence rules applied after a
plan is validated are survivors of the migration, not new policy. The PRD-widening
reconciliation and build_review case adjudication modes of `remediate` are outside this feature.

## Story 1: Remediation receives complete, bounded, engine-owned input

As the remediation planner, I want the engine to supply every finding I must answer, with its
owning plan context and the accepted vocabulary, so that I judge the right obligations without
reading or guessing them myself.

### Acceptance Criteria

#### Happy Path
- Given a PRD-audit request with FIXABLE criteria, when gap planning is prepared, then the planner receives one versioned input naming every FIXABLE criterion by its engine criterion id with its owning task and judgment summary, the owning tasks' titles and completion conditions, and the accepted dispositions and halt categories.
- Given an as-built request with REMEDIABLE findings, when gap planning is prepared, then the input names every REMEDIABLE finding by its engine-stamped id with its governing reference and summary, plus pending as-built remediation findings and prior remediation laps already held in engine state.
- Given a validation-group request carrying both PRD-audit and as-built findings, when gap planning is prepared, then the input carries the union of both required reference sets, each labelled with its source.
- Given a build-stall or finish-verification request, when gap planning is prepared, then the input carries the stall question or failing-test evidence with its existing key grammar and no fabricated typed references.
- Given refusal decisions recorded for findings in this feature, when gap planning is prepared, then those decision bindings are part of the input.

#### Negative Paths
- Given a requesting gate whose typed verdict is missing, unreadable, or of an unsupported version, when gap planning is prepared, then preparation stops before any provider invocation and names the source verdict and the defect.
- Given a required structured dimension that exceeds its engine limit, when gap planning is prepared, then preparation stops before invocation naming the dimension, actual size, and limit, and no shortened reference set is dispatched.
- Given failing-test or stall evidence text larger than the evidence caps, when gap planning is prepared, then the omitted portions are identified with their content identity for read-only inspection while every required reference remains present.
- Given a present kickback ledger that is corrupt or unreadable, when prior laps are projected, then preparation stops naming the ledger rather than treating it as empty history.
- Given no pending findings, no prior laps, and no refusal decisions, when gap planning is prepared, then those absences are explicit in the input and preparation succeeds.

### Done When
- [ ] Fixtures for each requesting source produce a dispatched input carrying the projection version, the expected required reference set, owning-task context, and the accepted vocabulary.
- [ ] Each required-input fault records zero provider invocations and a diagnostic naming the dimension or source.
- [ ] Over-cap evidence fixtures retain omission identities; over-limit structured fixtures never reach the provider.

## Story 2: Both providers return the same native disposition contract

As the engine operator, I want the provider choice to leave the remediation contract unchanged.

### Acceptance Criteria

#### Happy Path
- Given Claude or Codex as the selected provider, when gap planning dispatches, then the invocation requests the engine-owned native structured-output schema, and the shape description it receives is rendered from that same schema.
- Given equal valid dispositions returned by the two provider fixtures, when the plans settle, then they produce equivalent validated plans and equivalent downstream routing, apart from engine-owned attempt metadata.
- Given each dispatch and each retry, when the provider is invoked, then it is a fresh one-shot invocation.

#### Negative Paths
- Given a selected provider without native structured-output capability, when gap planning is prepared, then that provider is not invoked and the feature halts naming the missing capability, without a retry.
- Given a provider that returns a well-formed plan only as chat text with no terminal structured result, when the dispatch settles, then the chat text is not used as a plan and the attempt is a missing-result fault.
- Given authentication failure, rate limiting, or model unavailability, when the adapter reports it, then the existing dedicated handling for that condition takes precedence over a missing-plan diagnosis.

### Done When
- [ ] Both adapter fixtures show the native schema request through the existing invocation seam.
- [ ] Equal fixture judgments yield equal validated plans and routes.
- [ ] Capability, prose-only, and provider-condition fixtures each retain their distinct classification.

## Story 3: Every required finding is accounted for exactly once by structural reference

As a gate consumer, I want each typed finding answered exactly once, by an engine-authored
reference, so that no finding is silently dropped and no foreign finding is invented.

### Acceptance Criteria

#### Happy Path
- Given a structured result that answers every required PRD-audit criterion and as-built finding exactly once by kind and id, when it is validated, then the plan is accepted and each disposition is linked to its source finding.
- Given a validation-group request, when a result answers PRD-audit and as-built references in any order, then accounting is checked against the union of both sets.
- Given a criterion reference that differs from the required criterion id only in letter case, when it is validated, then it matches that criterion under the shared case-normalization rules.
- Given an untyped source, when a result's references follow that source's key grammar (`stall:<slug>` or `test:<stem>`), then they are accepted without a completeness requirement.

#### Negative Paths
- Given a result that omits a required reference, when it is validated, then the whole plan is rejected with a diagnostic naming each missing reference.
- Given a result that answers the same reference twice, when it is validated, then the whole plan is rejected naming the duplicated reference; neither answer is chosen.
- Given a result that cites a reference not in the required set, including an ADR stem or a finding from another lap or feature, when it is validated, then the whole plan is rejected naming the foreign reference.
- Given a reference with a missing kind, an empty id, or an untyped-source key outside its grammar, when it is validated, then the whole plan is rejected naming the malformed field.
- Given any rejected result, when it settles, then it is neither a partial plan nor a substantive BLOCKED or halt judgment.

### Done When
- [ ] Validator fixtures for missing, duplicate, foreign, and malformed references each produce a whole-plan rejection with a field-specific diagnostic.
- [ ] Valid typed, mixed-source, and untyped fixtures are accepted with each disposition linked to its reference.
- [ ] No rejected fixture reaches admission or appends plan tasks.

## Story 4: Dispositions, categories, and task bindings honor the engine vocabulary

As a gate consumer, I want disposition values and task bindings checked against the engine's
vocabulary and the plan, so that only routable, correctly owned work reaches admission.

### Acceptance Criteria

#### Happy Path
- Given dispositions drawn from the engine vocabulary, when they are validated, then each is accepted with its target step, category, rationale, and tasks.
- Given an `existing-task` disposition for a finding whose owning task is in the active plan, when it binds that owner, then the binding is accepted and later restaged under the existing rules.
- Given a build-stall request answered with `build`, no new tasks, and the answer in its rationale, when it is validated, then it is accepted.
- Given a `halt` disposition with a halt category, when it is validated, then it is accepted with its rationale.

#### Negative Paths
- Given an unknown disposition or halt category value, when it is validated, then the whole plan is rejected naming the value and the accepted set, and a `remediation_disposition_rejected` event is emitted for each rejected entry.
- Given an `existing-task` disposition that binds a task other than the finding's owning task, when it is validated, then the whole plan is rejected naming both the bound task and the owner.
- Given an `existing-task` disposition binding a task id that is absent from the active plan, or that has no bound task, when it is validated, then the whole plan is rejected naming the field.
- Given a `build` disposition with no new tasks for any source other than build stall, when it is validated, then the whole plan is rejected naming the empty task list.
- Given a `halt` disposition without a category, when it is validated, then the whole plan is rejected naming the missing category.

### Done When
- [ ] Vocabulary, owner-binding, task-presence, and halt-category fixtures each produce the named rejection; the #2187 rejection event fires for each rejected entry.
- [ ] Accepted fixtures carry each disposition's target and bound tasks into admission unchanged.

## Story 5: Unusable remediation output is retried, then reaches the caller's existing handling

As the operator, I want a bad planner response retried a bounded number of times and then
reported as a named mechanical fault, so that a transient defect does not halt the feature and a
persistent one is diagnosable.

### Acceptance Criteria

#### Happy Path
- Given a first attempt that returns no structured result or a rejected plan, and a retry that returns a valid plan, when gap planning settles, then the valid plan is used and the rejected attempt's diagnostics are recorded.
- Given a valid first attempt, when gap planning settles, then no retry occurs.

#### Negative Paths
- Given every attempt within `remediate`'s configured retry allowance returns an unusable result, when the allowance is exhausted, then the requesting caller receives a no-plan result carrying the last named fault, and it applies its existing no-plan handling: as-built and validation-group requests halt needs-human, except that a validation group with manual-test FAIL rows still proceeds with its deterministic manual-test build kickback; PRD-audit requests use their deterministic gap classification and still write the refused-widening HALT when every blocking finding is refused; build-stall requests halt with the question verbatim or auto-park as they do today; and finish-verification requests halt as they do today.
- Given a capability or required-input fault, when gap planning is attempted, then it halts through the existing validator-fault halt without any retry.
- Given a provider dispatch that times out or throws, when it settles, then that attempt counts against the retry allowance and is not accepted as a plan.

### Done When
- [ ] A retry-then-success fixture uses the second plan and records the first attempt's diagnostic.
- [ ] Exhaustion fixtures for each caller show its pre-migration no-plan behavior, with the halt or fallback message naming the mechanical fault.
- [ ] Deterministic-fault fixtures record exactly zero retries.

## Story 6: The validated plan is engine-persisted and tied to its attempt

As a gate consumer, I want the plan that admission reads to be the engine's validated record
for this attempt, so that stale or hand-written files cannot drive routing.

### Acceptance Criteria

#### Happy Path
- Given a validated plan, when the attempt settles, then the engine writes it atomically as the typed remediation plan, stamped with the attempt identity, source kind, and required-reference digest, and admission reads it through the single typed reader.
- Given a restart that re-enters remediation planning, when it runs, then it is a new attempt that dispatches again, and pending-repair receipts keep every earlier charge idempotent.

#### Negative Paths
- Given a typed plan from a prior attempt, when the current attempt produces no usable result, then the prior plan is not accepted for the current attempt, regardless of its modification time.
- Given only a legacy prose-authored `.pipeline/remediation.json`, when gap planning reads its result, then that file is never parsed as a plan.
- Given a build_review case adjudication that writes `.pipeline/remediation.json`, when gap planning runs in the same worktree, then neither mode reads the other's output.
- Given a persistence failure while writing the plan, when the attempt settles, then it is a named mechanical fault and no earlier file is accepted in its place.

### Done When
- [ ] The persisted plan carries attempt identity, source kind, and reference digest, and admission reads only through the typed reader.
- [ ] Prior-attempt, legacy-file, case-file, and write-failure fixtures each yield no accepted plan for the current attempt.
- [ ] A restart fixture re-dispatches without double-charging pending repairs.

## Story 7: Valid dispositions keep today's routing, budgets, authority, and idempotence

As the operator, I want the migration to change only how dispositions arrive, so that every
existing remediation rule behaves as before.

### Acceptance Criteria

#### Happy Path
- Given a validated plan, when admission runs, then the sealed-artifact redirect, PRD and as-built admission sets, `existing-task` restage, plan-growth and lap budgets, operator authority on DECIDE re-entry, pending-repair recording and settlement, and the no-op guard behave as they did before the migration.
- Given new tasks in a validated plan, when they are appended, then they receive engine `rem-` task ids through the single appender.
- Given a PRD-widening reconciliation request, when it dispatches `remediate`, then its existing contract and behavior are unchanged.

#### Negative Paths
- Given a validated plan whose admission exceeds the plan-growth or lap budget, when admission runs, then the existing budget halt occurs unchanged.
- Given a validated plan routing to a DECIDE step whose artifact is already satisfied without an operator grant, when admission runs, then the existing operator-authority refusal occurs unchanged.
- Given a validated plan containing both a halt and fixes, when admission runs, then the halt wins as it does today.
- Given a validated plan whose admitted tasks are already complete, when admission runs, then the existing no-op guard discards the pending repair unchanged.

### Done When
- [ ] Existing remediation acceptance tests for routing, caps, the single appender, validation-group primacy, and `existing-task` restage pass against typed plans.
- [ ] PRD-widening reconciliation fixtures are unchanged.

## Story 8: As-built findings carry engine-stamped identity

As a gate consumer, I want as-built finding ids authored by the engine and unique across laps,
so that remediation references and pending records cannot collide.

### Acceptance Criteria

#### Happy Path
- Given an as-built verdict with findings, when the engine validates and persists it, then each finding receives an engine-stamped id unique across the feature's laps, and the rendered report, prior-findings projection, pending-finding records, and shipped record all show that id.
- Given two laps that each produce findings, when the second lap's findings are pending, then the first lap's pending records are still present.

#### Negative Paths
- Given a provider result that includes its own finding id field, when the as-built result is validated, then the result is rejected as a schema violation naming the unsupported field.
- Given a persisted as-built verdict of the prior contract version, when the gate is next evaluated, then that verdict is not authoritative and as-built reruns once through its lifecycle; it is never converted.
- Given two findings in one verdict with identical summaries and references, when they are persisted, then each receives a distinct id and neither is collapsed.
- Given pending as-built remediation entries recorded before the upgrade with provider-minted ids, when the next as-built verdict is stamped, then those entries remain in the ledger and shipped record as historical records under their original ids, and they are never required, matched, or rejected by remediation accounting.

### Done When
- [ ] Stamped ids appear unchanged in the report, the projection, the kickback ledger, and the shipped record fixtures.
- [ ] Multi-lap fixtures keep every pending record.
- [ ] Prior-version verdict fixtures trigger exactly one as-built rerun.

## Story 9: The remediate skill and planner agent keep judgment guidance and cannot regain the machine contract

As a skill maintainer, I want the remediate skill and its planner agent to describe judgment only, so that the engine
remains the single owner of the wire format and vocabulary.

### Acceptance Criteria

#### Happy Path
- Given the remediate skill, when it is read for gap planning, then it explains the HALT categories, the implementation-only routing rule, the recorded-red exception obligation, the sealed artifact set including `.docs/decisions/`, the environmental-stall rule, plan-coverage judgment, and low-confidence HALT.
- Given the remediation planner agent definition, when it is read, then it carries the same judgment guidance, including rejecting contradictory dispositions and treating `plan` as terminal in daemon runs, and none of the machine contract.
- Given a human invoking the skill interactively outside a managed run, when they ask for a remediation plan, then they receive a human-readable plan, and it is not presented as a managed persisted result.
- Given the PRD-widening and case adjudication sections, when the skill is read, then those sections are unchanged.
- Given supplied plan-contract and prior-attempt pointers, when the skill is read, then its guidance to read the referenced files before planning, and its fallback paths, remain as mode-neutral judgment outside the gap-plan sections the audit guards.

#### Negative Paths
- Given a change that reintroduces gap-plan output format, field rules, disposition vocabulary tables, or input-reading recipes into the gap-planning sections of the skill or into the planner agent, when the provider skill contract audit runs, then it fails naming the file and the reintroduced content.
- Given ordinary judgment prose that mentions a disposition by name, when the audit runs, then it passes.

### Done When
- [ ] The provider skill contract audit has a remediate gap-plan check covering the skill and the planner agent that fails on a reintroduction fixture and passes on the shipped files.
- [ ] Tests that pinned the legacy output prose now assert engine validator behavior instead.
