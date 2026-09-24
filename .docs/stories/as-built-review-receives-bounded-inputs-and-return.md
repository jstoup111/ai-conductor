**Status:** Accepted

# As-built review receives bounded inputs and returns typed verdicts (#2188)

## Context

Today `architecture_review_as_built` gathers its own evidence under a six-line policy block,
writes `.pipeline/architecture-review-as-built.md`, and has that Markdown re-parsed by regexes at
about eight engine sites. The regexes read the verdict line, the `Outcome delivered:` line, the
Blocking Findings table, the governing-clause grammar, and the Recorded Findings JSON block.

These stories move both sides of the step onto engine-owned contracts:
- the engine renders a bounded, versioned input projection;
- the step dispatches on the #2429 native structured-output seam;
- the engine validates, stamps, and persists the typed verdict as the sole authority and renders
  the report from it;
- every consumer reads the typed verdict, with verdict, routing, operator-authority, and delivery
  semantics unchanged;
- the as-built skill section carries judgement guidance only.

Governing decisions: adr-2026-09-07 D6.2/D7.1, adr-2026-08-25-as-built-remediable-findings-bounded-build-route
D1.1/D2.1/D6.1/D7.1, adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D2.1/D3.1/D7.1,
and adr-2026-09-02 D6.1. The operator decisions (OD-1 to OD-6) are recorded in
`.docs/decisions/architecture-review-2026-09-23-as-built-review-receives-bounded-inputs-and-return.md`.
Technical track, Large tier. The scope boundary is in
`.docs/track/as-built-review-receives-bounded-inputs-and-return.md`.

## Story 1: The as-built reviewer receives an engine-rendered, versioned input projection

As the as-built reviewer, I want the engine to hand me the evidence I grade against so that I
spend my context on judgement instead of on unbounded reads of the plan, the stories, the ADRs,
and the diff.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree whose plan, sealed stories, APPROVED ADRs, diagrams, and diff are all present, when the as-built step is dispatched, then the prompt carries one projection block stamped with its projection version that contains the changed-file stat, the per-file diff hunks at default context, every plan task id with its `Done when` bullets, the sealed story criteria, the resolved as-built check policy, and the approved diagram paths.
- Given a plan whose Architecture Obligation Coverage table cites two APPROVED ADRs and a feature diff that adds a third APPROVED ADR, when the projection is built, then its governing-ADR section carries exactly those three ADRs with each ADR's decision ids and decision text as `parseAdrDecisions` reports them.
- Given a kickback ledger holding two pending as-built remediation findings from the previous lap, when the projection is built, then both findings appear in the projection's prior-findings section with their class, governing reference, and summary.
- Given a changed file whose hunks exceed the per-file diff cap, when the projection is built, then that file's hunks are omitted, the projection lists the file under omitted files with its path and content digest, and the projection states that omitted files may be read on demand.
- Given a projection that fits every limit, when the step is dispatched twice against the same unchanged inputs, then both dispatches carry byte-identical projection blocks.

#### Negative Paths
- Given a plan that cites an ADR whose status is SUPERSEDED, when the projection is built, then that ADR is absent from the governing-ADR section and the projection is otherwise produced normally.
- Given a feature whose plan has no Architecture Obligation Coverage table and whose diff touches no ADR, in a repository that has APPROVED ADRs, when the projection is built, then the governing-ADR section is empty and states that no ADR is pre-selected, the projection is produced, and the resolved check policy still shows `adrCompliance` on as it does today.
- Given a project with no architecture diagrams, when the projection is built, then the diagram section is empty, the check policy shows `diagramDrift` off with its existing reason, and no fault is raised.
- Given a kickback ledger file that exists but cannot be parsed, when the projection is built, then the build fails with a mechanical fault naming the pending-findings dimension and the ledger path, and no projection with an empty prior-findings section is produced.
- Given a kickback ledger that does not exist, when the projection is built, then the prior-findings section is empty and the projection is produced.

### Done When
- [ ] A unit test over a fixture worktree asserts the projection block's version stamp and each section's contents for the fully populated case.
- [ ] A unit test asserts the governing-ADR set equals the plan-cited set joined with the diff-touched set, filtered to APPROVED, with decision ids matching `parseAdrDecisions`.
- [ ] A unit test asserts an over-cap file appears only as an omission entry carrying its path and content digest.
- [ ] A unit test asserts byte-identical projections for unchanged inputs.
- [ ] A unit test asserts an unreadable kickback ledger produces the named pending-findings fault and an absent ledger produces an empty section.

## Story 2: Missing or over-limit required inputs are explicit deterministic faults

As an operator, I want a projection that cannot carry its required inputs to stop with a message
naming what is missing or too large, so that the reviewer never grades against silently
truncated evidence and no retry is spent on a fault that cannot change.

### Acceptance Criteria

#### Happy Path
- Given the largest plan, stories file, and governing-ADR decision set present in the repository's `.docs/` corpus, when each is projected under the shipped limits, then none exceeds its limit.
- Given a feature whose total diff exceeds the total diff cap, when the projection is built, then the files beyond the cap are listed as omissions with path and digest, the step is dispatched, and no fault is raised.

#### Negative Paths
- Given a plan whose `Done when` blocks exceed the plan-task limit, when the as-built step is about to dispatch, then no provider is invoked and the step halts with a mechanical fault naming the plan-tasks dimension, the actual size, and the limit.
- Given a feature whose sealed stories file cannot be read, when the as-built step is about to dispatch, then no provider is invoked and the step halts with a fault naming the story-criteria dimension and the path.
- Given a governing ADR whose `## Decision` section `parseAdrDecisions` rejects as unparseable, when the as-built step is about to dispatch, then no provider is invoked and the step halts with a fault naming that ADR and the parser's diagnostic.
- Given any of these deterministic input faults, when the step settles, then the step-retry budget is not consumed, no second dispatch is attempted, and the halt uses an existing halt class and is emitted through the existing halt event.
- Given an over-limit required dimension, when the fault is raised, then the projection is not truncated to fit and no partial projection is dispatched.

### Done When
- [ ] A corpus test asserts every shipped as-built limit is at least the largest corresponding input in the repository's `.docs/` corpus.
- [ ] A test through the production step-runner dispatch path with a fake provider asserts zero provider invocations and a halt naming dimension, size, and limit for an over-limit plan-task set.
- [ ] The same test harness asserts the unreadable-stories and unparseable-ADR faults, and asserts the retry counter is unchanged.
- [ ] A test asserts total-diff overflow dispatches with omissions and raises no fault.

## Story 3: The as-built step requests native structured output on both providers

As the engine, I want the as-built dispatch to hand its output JSON Schema to the selected
provider's native structured-output option and to consume only the terminal structured result,
so that the verdict is never recovered from prose.

### Acceptance Criteria

#### Happy Path
- Given an as-built dispatch with a Claude candidate, when the step runs, then the recorded invocation options carry `nativeSchema` equal to the as-built output schema, `interactive` is false, and the Claude adapter fixture receives `--json-schema` with that schema serialized.
- Given an as-built dispatch with a Codex candidate, when the step runs, then the Codex adapter fixture receives `--output-schema` naming a file under the invocation's engine-owned scratch home whose bytes equal the serialized schema, and the scratch home is removed after the invocation settles.
- Given a conduct run in interactive mode, when the as-built step is dispatched, then it still runs one-shot with `interactive` false and the native schema attached.
- Given the as-built prompt, when it is rendered, then the output shape shown to the reviewer is derived from the same JSON Schema passed as `nativeSchema` and names exactly the fields and enum members that schema admits.
- Given identical fake Claude and Codex providers that return the same structured verdict, when the as-built step runs once with each, then both runs persist equal typed verdicts apart from run identity.

#### Negative Paths
- Given a selected provider candidate that does not declare the native output-schema capability, when the as-built step is about to dispatch, then no provider is invoked and the step halts without retry with a fault naming the provider and the missing capability.
- Given a provider result with `success: true`, a prose `output` containing a well-formed verdict, and no terminal structured result, when the step settles, then the prose is not parsed and the attempt is scored `absent` with the reason that the structured result is missing.
- Given a Codex invocation that requested the schema and ends with the adapter reporting a missing structured result as a failed invocation, when the step settles, then the attempt is scored `absent` with the same missing-structured-result reason as the Claude case and is not handled as a generic step failure.
- Given a provider result that the adapter classifies as an authentication failure, when the step settles, then it is handled by the existing authentication-failure path and is not reported as a missing or invalid structured result.
- Given a provider result that the adapter classifies as rate limited, when the step settles, then it enters the existing rate-limit handling and is not reported as a missing or invalid structured result.
- Given a skill command the provider cannot resolve (zero turns), when the step settles, then it is classified as an unresolved step command and not as an invalid structured result.

### Done When
- [ ] Adapter-fixture tests through the production step-runner path assert `--json-schema` for Claude and `--output-schema` with the scratch schema file for Codex, with `interactive` false in both auto and interactive modes.
- [ ] A test asserts the prompt's output shape is rendered from the same schema object passed as `nativeSchema`.
- [ ] A test asserts the unsupported-capability halt makes zero provider invocations and consumes no retry.
- [ ] Tests assert that the missing-structured-result (on both the Claude success-without-result shape and the Codex adapter-failure shape), authentication, rate-limit, and unresolved-command cases each route to their own classification.

## Story 4: The engine validates the typed verdict and names the defective field

As the engine, I want every structured result validated against the closed as-built contract,
with each reference resolved against real artifacts, before any consumer sees it, so that a
malformed answer is a mechanical fault with a precise diagnostic and never a verdict.

### Acceptance Criteria

#### Happy Path
- Given a structured result with verdict `APPROVED`, no findings, and production-reachability entries each naming a changed primitive and its caller chain, when it is validated, then it is accepted as an approved verdict carrying those entries.
- Given a structured result with verdict `APPROVED WITH DRIFT NOTES` whose drift notes include an `UNEXERCISED` primitive with its observation signature, when it is validated, then it is accepted and the drift note keeps the primitive and the signature.
- Given a structured result with verdict `PLAN_GAP`, `outcomeDelivered` true, and a recorded affected outcome, when it is validated, then it is accepted as a delivered plan gap.
- Given a structured result with verdict `BLOCKED` and one `REMEDIABLE` finding whose reference is `{kind: "adr-decision", stem, decision}` naming an APPROVED ADR and a decision id `parseAdrDecisions` reports for it, when it is validated, then it is accepted and the finding carries the resolved reference.
- Given an APPROVED ADR whose decision 5 carries a sub-decision written `D5.2`, when the projection lists that ADR's decisions and the reviewer cites it, then the reference's `decision` field is the whole number 5, the schema admits only whole numbers for that field, and the finding enters the bounded remediation route against decision 5.
- Given a `BLOCKED` result whose `REMEDIABLE` finding references `{kind: "plan-task", taskId}` naming a task present in the active plan, when it is validated, then the reference resolves through the shared plan-task resolver and the result is accepted.
- Given a `BLOCKED` result with one `DESIGN` finding carrying no reference, when it is validated, then it is accepted as a design-blocked verdict.

#### Negative Paths
- Given a `PLAN_GAP` result with no `outcomeDelivered` field, when it is validated, then it is rejected with a diagnostic naming `outcomeDelivered` and the form it requires.
- Given an `APPROVED` result that carries a findings array, when it is validated, then it is rejected with a diagnostic naming `findings` as not permitted for that verdict.
- Given a `BLOCKED` result whose `REMEDIABLE` finding has no reference, when it is validated, then it is rejected with a diagnostic naming `findings[0].reference`.
- Given a `BLOCKED` result whose ADR reference names a SUPERSEDED ADR, when it is validated, then it is rejected naming `findings[0].reference.stem` and the ADR's status.
- Given a `BLOCKED` result whose ADR reference names a decision id the ADR does not declare, when it is validated, then it is rejected naming `findings[0].reference.decision` and listing the ADR's decision ids.
- Given a `BLOCKED` result whose plan-task reference names a task absent from the active plan, when it is validated, then it is rejected naming `findings[0].reference.taskId`.
- Given a `BLOCKED` result whose ADR reference gives `decision` as the string `"5.2"`, when it is validated, then it is rejected naming `findings[0].reference.decision` and stating that a whole-number decision id is required.
- Given a result with an unknown verdict value, an unknown finding class, or a top-level key outside the contract, when it is validated, then it is rejected naming that field and the admitted values or keys.
- Given a result that the engine rejects, when the step settles, then the attempt is scored `absent`, the rejected field and its requirement are recorded in the retry reason, and the step reruns in a fresh session within its existing retry budget.
- Given every retry in the budget ends in a rejected result, when the budget is exhausted, then the step halts `needs-human` naming the as-built step and the last rejected field, and no consumer ever reads a rejected result as a verdict.

### Done When
- [ ] Contract unit tests assert acceptance of each valid verdict shape and a field-named rejection for each negative case above.
- [ ] A test asserts ADR references resolve only through `parseAdrDecisions` and APPROVED status, and plan-task references only through the shared plan-task resolver.
- [ ] A test through the production dispatch path with a fake provider asserts a rejected result scores `absent`, reruns, and halts `needs-human` naming the field on exhaustion.
- [ ] The verdict type is a discriminated union in which `outcomeDelivered` exists only on `PLAN_GAP` and findings only on `BLOCKED`, as asserted by a type-level test.

## Story 5: The engine persists the stamped typed verdict and renders the report from it

As an operator, I want the validated verdict stored as the single authority, stamped with the
dispatch that produced it, and rendered into a human-readable report that cannot disagree with
it, so that freshness and content both come from engine-owned state.

### Acceptance Criteria

#### Happy Path
- Given an accepted structured result, when the step settles, then the engine persists the typed verdict under `.pipeline/` stamped with this dispatch's `attempt.id` and the reviewed HEAD's code stamp.
- Given a persisted `BLOCKED` typed verdict with two findings, when the report is rendered, then `.pipeline/architecture-review-as-built.md` shows the verdict, each finding's id, class, governing reference, and summary, and the prose violation and resolution text, all equal to the typed fields.
- Given a persisted `APPROVED` typed verdict with production-reachability entries and drift notes, when the report is rendered, then the report shows each reachability entry's primitive and caller chain, each drift note, and the applied check policy with each off check's reason, all equal to the typed fields and the projection.
- Given a persisted `PLAN_GAP` typed verdict, when the report is rendered, then the report shows the verdict and whether the outcome was delivered, equal to the typed fields.
- Given an accepted result, when the post-dispatch handshake runs, then it records that this dispatch's structured result was validated and persisted, on the existing freshness event with the run-identity floor source.

#### Negative Paths
- Given a worktree holding only a reviewer-written `.pipeline/architecture-review-as-built.md` with a clean APPROVED verdict line and no typed verdict, when the completion check runs, then the gate is scored `absent` and the step reruns rather than passing.
- Given a typed verdict stamped with a previous attempt's identity whose code stamp cannot vouch for it because the gate's surface changed since that stamp, and whose file mtime is newer than the current dispatch start, when the completion check runs, then it is scored `absent` with a reason naming both identities.
- Given the gate-code-validity kill switch is turned off, when the as-built completion check runs against an engine-written typed verdict from a previous attempt, then run-identity checking still applies to the as-built step, the verdict is scored `absent`, and no mtime comparison decides freshness.
- Given a rendered report that has been edited by hand to say `APPROVED` while the typed verdict says `BLOCKED`, when any consumer evaluates the gate, then the consumer acts on `BLOCKED`.
- Given a dispatch whose structured result is rejected, when the step settles, then no typed verdict is persisted for that attempt, no report is rendered for it, and the handshake records the rejection outcome.
- Given the typed verdict file exists but cannot be parsed, when any consumer reads it, then the read reports it as unreadable and the gate is not satisfied, rather than treating the verdict as approved or empty.

### Done When
- [ ] A test asserts the persisted typed verdict carries `attempt.id` and the code stamp for an accepted result.
- [ ] A renderer test asserts the report's verdict, outcome, reachability entries, drift notes, applied check policy, and every finding field equal the typed verdict for `APPROVED`, `PLAN_GAP`, and `BLOCKED` cases.
- [ ] A completion-predicate test asserts a Markdown-only verdict, and a prior-identity typed verdict with a fresh mtime whose code stamp cannot vouch for it, both score `absent`.
- [ ] A test asserts a hand-edited report never changes a consumer's outcome.
- [ ] A test asserts that with the gate-code-validity kill switch off, a prior-attempt as-built typed verdict still scores `absent`.
- [ ] A test asserts an unparseable typed verdict leaves the gate unsatisfied with an unreadable reason.

## Story 6: Gate and routing consumers act on the typed verdict with unchanged semantics

As an operator, I want the SHIP tail to pass, halt, and remediate exactly as it does today, with
the decision taken from the typed verdict rather than from scraped Markdown.

### Acceptance Criteria

#### Happy Path
- Given a typed `APPROVED` or `APPROVED WITH DRIFT NOTES` verdict, when the completion predicate runs, then the gate is satisfied and the as-built code stamp is written.
- Given a typed `PLAN_GAP` verdict with `outcomeDelivered` true, when the completion predicate runs, then the gate is satisfied.
- Given a typed `BLOCKED` verdict whose findings are all `REMEDIABLE` and no `manual_test` FAIL in the same validation round, when the gate settles, then `planRemediation` receives each finding with its typed governing reference, admits it under gate key `architecture_review_as_built`, and navigates back to BUILD within the gate's remediation lap cap.
- Given a typed `BLOCKED` verdict with a `REMEDIABLE` finding whose remedy the planner dispositions as `existing-task`, when the kickback runs, then the bound task ids are re-staged to pending and no plan-growth allowance is charged.
- Given a validation round with a typed `BLOCKED` remediable as-built verdict and a `manual_test` FAIL, when the join settles, then the as-built findings ride the single consolidated work order and the as-built-only route does not run.
- Given a clean typed verdict in a non-auto run, when the step completes, then no review-required marker is written for the as-built step and the step completes as it does today.

#### Negative Paths
- Given a typed `PLAN_GAP` verdict with `outcomeDelivered` false, when the gate settles, then the loop halts with class `plan-gap` naming the affected outcome.
- Given a typed `BLOCKED` verdict containing a `DESIGN` finding, when the gate settles, then the loop halts `needs-human` and the halt body lists every finding with its class and governing reference.
- Given a typed `BLOCKED` remediable verdict on a feature that has already used its as-built remediation lap, when the gate settles, then the loop halts with class `kickback-cap` listing every finding.
- Given the as-built remediation kill switch is disabled in config, when a typed `BLOCKED` remediable verdict settles, then the loop halts `needs-human` exactly as it does today with the switch off.
- Given a validation round in which the as-built branch ends in a mechanical fault, when the join settles, then the group treats it as a no-verdict branch, no synthetic remediation gap is created for it, and the existing step-failure handling applies.
- Given the planner returns remediation findings that do not match the typed `REMEDIABLE` findings exactly, when admission runs, then the loop halts `needs-human` naming the mismatch, as it does today.

### Done When
- [ ] Tests through the production serial path and the production validation-group path with fake providers assert each happy and negative outcome above from a typed verdict fixture.
- [ ] The existing as-built remediation acceptance tests pass unchanged in their asserted outcomes, re-pointed from Markdown fixtures to typed verdict fixtures.
- [ ] A test asserts no review-required marker is written for the as-built step on a non-clean verdict in non-auto mode.

## Story 7: Durable and replay consumers read the typed verdict

As an operator, I want the shipped record, the recorded-findings projection, rebase
preservation, restart, rewind, and the pre-finish fence to all read the same typed verdict, so
that the record of what shipped and why is identical wherever it is read.

### Acceptance Criteria

#### Happy Path
- Given a typed `PLAN_GAP` verdict with `outcomeDelivered` true, when the shipped record is assembled at finish, then the record includes the delivered plan-gap finding.
- Given a typed verdict with pending remediation findings that the rebuilt gate has now passed, when the recorded-findings projection runs, then the findings with their remediation outcomes are written into the typed verdict, the report is re-rendered showing them, and the kickback ledger's pending entries are cleared in the same step.
- Given the recorded findings in the typed verdict, when the shipped record is assembled, then each finding appears with its class, governing reference, and outcome.
- Given an approved typed verdict whose code stamp remains reachable after a rebase that did not touch the gate's surface, when the SHIP tail resumes, then the verdict is preserved and the as-built step is not re-dispatched.
- Given a daemon restart after an approved typed verdict was persisted in the current run, when the feature resumes, then the as-built gate is satisfied from the typed verdict without re-dispatch.
- Given a finish attempt, when the pre-finish fence recomputes the as-built gate at current HEAD, then it reads the typed verdict through the same reader as the completion predicate.

#### Negative Paths
- Given an operator rewind that demotes the as-built step, when the rewind completes, then both the typed verdict and the rendered report are removed and the next dispatch starts without a prior verdict.
- Given an operator rewind that demotes the as-built step and fails after removing the typed verdict, when the rewind rolls back, then the typed verdict and the rendered report are restored with their original contents.
- Given a rebase that changes a file in the as-built gate's surface, when the SHIP tail resumes, then the typed verdict is invalidated and the step re-dispatches.
- Given a stale-artifact sweep for the as-built step, when the sweep removes the verdict, then it removes the typed verdict and the rendered report together and never leaves one without the other.
- Given a typed verdict whose code stamp has been orphaned by an amend or reset, when the SHIP tail resumes, then the verdict is scored `absent` and the step re-dispatches.
- Given a finish run in which no typed as-built verdict is present, when the shipped record is assembled, then the record carries no as-built findings and publication proceeds exactly as it does today when the as-built report is absent.
- Given a typed verdict that records both remediated findings and a delivered plan gap from the same lap, when the shipped record is assembled, then the record carries both kinds and neither displaces the other.

### Done When
- [ ] Tests assert the shipped record carries a delivered plan-gap finding and recorded remediation findings read from the typed verdict, both together when a lap produced both, and no as-built findings when no typed verdict is present.
- [ ] A test asserts the recorded-findings projection updates the typed verdict, re-renders the report, and clears the ledger's pending entries in one step.
- [ ] Tests assert preservation across a surface-miss rebase, invalidation on a surface hit, and `absent` on an orphaned stamp.
- [ ] Tests assert rewind and the stale sweep remove both files together, a failed rewind restores both, and that the pre-finish fence and restart read through the single reader.

## Story 8: No engine path treats the reviewer's Markdown as authority

As a maintainer, I want the rule "the as-built report is a rendered view" enforced by a check,
so that a future change cannot reintroduce a Markdown judge parser with gate or routing
authority.

### Acceptance Criteria

#### Happy Path
- Given the engine source after this change, when the repository integrity check runs, then no engine module reads `.pipeline/architecture-review-as-built.md` other than the report renderer's writer and the paired cleanup paths, and the check passes.
- Given a reviewer-written Markdown file containing a well-formed `## Blocking Findings` table and no typed verdict, when the SHIP tail evaluates the as-built gate, then neither the gate, the remediation planner, nor the shipped record acts on the table.

#### Negative Paths
- Given an engine module that is changed to read the as-built report file to decide a verdict or route, when the repository integrity check runs, then the check fails naming the module.
- Given an engine module that is changed to match an as-built verdict line or governing-clause text with a regular expression, when the repository integrity check runs, then the check fails naming the module.

### Done When
- [ ] A repository check wired into the harness integrity suite fails on a fixture engine module that reads the as-built report file for a verdict, and passes on the shipped engine source.
- [ ] A test asserts a reviewer-written table with no typed verdict drives no gate, remediation, or shipped-record outcome.

## Story 9: The as-built skill section carries judgement guidance only, guarded by an audit

As a skill maintainer, I want the as-built section of `skills/architecture-review/SKILL.md` to
describe how to judge, not what to read or what shape to answer in, and an audit that fails if
that prose returns, so that the engine's contract is the only statement of inputs and output.

### Acceptance Criteria

#### Happy Path
- Given the as-built section of the skill, when it is read, then it contains the reachability semantics (including the same-file root-to-caller-to-export exception, current-source authority, and UNEXERCISED observation signatures), the plan-gap semantics with sealed-story outcome authority, the meanings of each verdict, the meanings of `REMEDIABLE` and `DESIGN`, and the citation of the ADRs that define its relationship to BUILD-time judgement.
- Given the as-built section, when it is read, then it contains no bounded-read command recipe, no report template, no table header or column list, no cell-formatting or governing-clause grammar rule, no instruction to overwrite a report file, and no instruction to write a review-required marker.
- Given the provider skill-contract audit, when it runs on the shipped skill, then it passes, and the existing pins on the as-built judgement prose also pass.
- Given the pre-stories review mode's output template elsewhere in the same skill file, when the audit runs, then the template does not trip the as-built format rule.
- Given an operator using `/architecture-review --as-built` outside the engine, when they read the section, then it tells them to state a verdict from the closed set with its findings, classes, and governing references, so the skill stays usable interactively.

#### Negative Paths
- Given a copy of the skill with a Blocking Findings table header row (columns `Finding`, `Class`, `Governing clause`, `Summary`) reintroduced into the as-built section, when the audit runs on it, then it fails naming the skill and the forbidden pattern.
- Given a copy of the skill with a bounded `git diff` or `git log` read recipe reintroduced into the as-built section, when the audit runs on it, then it fails naming the forbidden pattern.
- Given a copy of the skill with a `Verdict:` line template reintroduced into the as-built section, when the audit runs on it, then it fails naming the forbidden pattern.
- Given a copy of the skill whose as-built section drops the same-file root-to-caller-to-export judgement prose, when the existing provider contract pins run, then they fail.

### Done When
- [ ] The as-built section of `skills/architecture-review/SKILL.md` passes the new §12-scoped audit and the existing judgement-prose pins.
- [ ] Audit fixture tests fail for the reintroduced table header, read recipe, and verdict-line template, and pass for the other modes' output template.
- [ ] The prior test that required the verdict-line and `Outcome delivered:` prose in the skill is replaced by the audit.
