# Implementation Plan: Remediation dispositions honor the engine-owned input/output contract

**Date:** 2026-10-07
**Source:** jstoup111/ai-conductor#2522
**Design:** technical track — no PRD; `.docs/track/remediation-dispositions-honor-the-engine-owned-in.md`, `.docs/architecture/remediation-dispositions-honor-the-engine-owned-in.md`, `.docs/decisions/architecture-review-2026-10-06-remediation-dispositions-honor-the-engine-owned-in.md` (APPROVED WITH CONDITIONS, OD-1 to OD-5)
**Stories:** .docs/stories/remediation-dispositions-honor-the-engine-owned-in.md
**Conflict check:** Clean as of 2026-10-06 (`.docs/conflicts/remediation-dispositions-honor-the-engine-owned-in.md`, PASS after operator-approved reconciliation)

## Summary

Move the `remediate` gap-plan boundary onto one bounded, versioned engine projection, one static
native schema, one engine validator, and one attempt-stamped engine store, then thread every
`planRemediation` caller through a bounded retry and named-fault lane. As-built finding ids become
engine-stamped. The skill and planner agent keep judgment guidance only, guarded by a contract
audit. 35 tasks in five slices.

## Technical Approach

- **Reuse the shipped #2188/#2521 pattern, not a new platform.** Add three engine modules beside
  their as-built and PRD-audit siblings: `remediation-projection.ts` (bounded versioned input),
  `remediation-plan-contract.ts` (static schema, rendered shape, validator), and
  `remediation-plan-store.ts` (atomic attempt-stamped store and single discriminated reader).
  Local pattern: `as-built-projection.ts`/`prd-audit-projection.ts` resolve each authoritative
  source independently, return a typed preparation fault naming source and dimension, and carry
  explicit absence fields; `as-built-contract.ts`/`prd-audit-contract.ts` keep one module-constant
  JSON Schema from which the prompt shape is rendered, and return a discriminated
  accepted/rejected result with field-path diagnostics; `as-built-verdict-store.ts` and
  `prd-audit-verdict-store.ts` write atomically and read back `present`/`absent`/`invalid`
  (or `unreadable`). Allowed variation: remediation has references and dispositions instead of
  grades, and its store is keyed by a per-planning attempt identity rather than a run id. Search
  hints: `buildAsBuiltProjection`, `AS_BUILT_PROJECTION_LIMITS`, `validatePrdAuditJudgment`,
  `renderPrdAuditJudgmentShape`, `persistAsBuiltVerdict`, `readPrdAuditVerdict`, and the
  `test/engine/prd-audit-*.test.ts` and `test/as-built-*.test.ts` fixtures.
- **Schema.** Flat root object (Codex strict-mode precedent: every property required, optional
  values expressed as nullable). Each disposition carries `reference` (`kind` in
  `prd-criterion | as-built-finding | refusal | stall | test`, plus `id`), `disposition` (enum
  rendered from `REMEDIATION_TARGET_STEPS`, `publication`, `existing-task`, `halt`), `category`
  (nullable enum from `REMEDIATION_HALT_CATEGORIES`), `rationale`, `tasks` (`id`, `title`), and
  `boundTaskIds`. The unused task `status` field is dropped. The provider never submits attempt
  identity, stamps, admission results, or routes.
- **Validation.** Whole-plan acceptance or rejection. Typed references (`prd-criterion`,
  `as-built-finding`) are accounted for exactly once against the projection's required set;
  criterion ids compare under the lower-case normalization `validatePrdAuditJudgment` already
  uses. Untyped references (`stall:<slug>`, `test:<stem>`) are grammar-checked only. Refusal
  references (OD-5) are rejected when foreign, duplicate, or malformed, and a task-less `build` on
  them is rejected like any non-stall `build` (Story 4 negative 4); their completeness and
  non-`build` answers stay with `admitRefusalReworkPlan`, which keeps #3010's immediate refused
  HALT for those cases. `existing-task` bindings resolve through the shared plan-task reference resolver
  and must name the owning task (OD-3). `build` with no tasks is valid only for the build-stall
  source; `halt` requires a category. Unknown vocabulary yields per-entry rejections that keep
  feeding the existing `remediation_disposition_rejected` event.
- **Dispatch.** Gap planning becomes a second `remediationRequest` mode (`gap-plan`) on the existing
  `StepRunOptions` field; the step runner passes `nativeSchema`, renders the projection and shape
  into the one-shot prompt, validates the terminal structured result against the request's
  projection, and persists the accepted plan. A selected provider without
  `nativeSchemaCapabilityFor(provider)?.nativeOutputSchema` is a capability fault before
  invocation. No provider option, adapter, or step is added.
- **Fault lane (OD-1).** `planRemediation` owns a bounded retry using
  `resolveStepConfig('remediate', …).max_retries`, modelled on `coordinatePrdWidening`'s loop:
  each retry is a fresh one-shot; missing, rejected, timed-out, or thrown attempts count;
  provider auth, rate-limit, and model-availability results keep their existing classification.
  Capability and input faults go to `haltForValidatorFault` with no retry. Exhaustion returns the
  existing `{ kind: 'none' }` no-plan shape carrying the last named fault, so every caller keeps
  its current handling.
- **As-built identity (OD-2).** `AS_BUILT_VERDICT_CONTRACT_VERSION` becomes `v2`; the finding `id`
  leaves the provider schema; the engine stamps `<attemptId>.<ordinal>`-style ids (exact
  rendering chosen in Task 12) at validation/persist. Every `AsBuiltFinding.id` consumer —
  verdict store and report, projection prior findings, conductor pending map, kickback ledger,
  shipment association — carries the stamped id. A `v1` verdict reads as not authoritative and
  as-built reruns once through the existing stale/absent lifecycle.
- **Call sites.** Condition 3 of the review names seven call sites; current `main` has ten
  `planRemediation` calls over five sources: validation group (four sites), PRD audit (two),
  as-built (one, shared with finish), build stall (two: `build_stall`/`build_stall_zero_work`
  and `build-stall`), and finish verification. Tasks 23–26 own exhaustion behavior per source.
- **Test boundary.** Real projection, dispatch, validation, persistence, and `planRemediation`
  paths with fake provider runtimes (Claude and Codex ids) and injected filesystem faults. Task
  18's fixture helper replaces the many tests that stub the planner by writing
  `.pipeline/remediation.json`; it never writes that file. No default test calls a real model.
- **Removal.** `readRemediationPlanResult`, `renderRemediationPlanAbsence`, and the tolerant mtime
  fallback are deleted only after survivor coverage (Task 31), following `/code-removal`.
  `.pipeline/remediation.json` stays owned by the build_review case-v1/v2 mode.
- **Scope split.** Engine and test changes are consumer-facing shared engine; the
  `skills/remediate/SKILL.md` and `agents/remediation-planner.md` edits are shipped catalog
  content; the contract audit in `test/test_provider_skill_contracts.sh` is repository-local.

## Prerequisites

- None. #2188 (as-built typed verdict), #2521 (PRD-audit typed verdict), #2753 (pending-repair
  settlement), and #3010 (refusal rework) are on `main`.

## Scope and sequencing

35 tasks, above the 20-task warning threshold. The approved architecture keeps the migration
together: shipping the writer without the reader, or one source without the others, leaves the
legacy prose contract as a competing authority. Slices organize implementation; they are not
independently publishable migrations.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Contract, projection and store | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 |
| 2 | Engine-stamped as-built identity | 12, 13, 14, 15 |
| 3 | Dispatch and fault lane | 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27 |
| 4 | Survivors, refusal rework and removal | 28, 29, 30, 31 |
| 5 | Skill boundary and guard | 32, 33, 34, 35 |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a PRD-audit request with FIXABLE criteria, when gap planning is prepared, then the planner receives one versioned input naming every FIXABLE criterion by its engine criterion id with its owning task and judgment summary, the owning tasks' titles and completion conditions, and the accepted dispositions and halt categories. | 8 | "A PRD-audit projection carries `REMEDIATION_PROJECTION_VERSION`, every FIXABLE criterion by engine criterion id with its owning task and judgment summary, those tasks' titles and Done-when blocks from the active plan, and the accepted dispositions and halt categories rendered from the code constants." | diff-local |
| Story 1 happy: Given an as-built request with REMEDIABLE findings, when gap planning is prepared, then the input names every REMEDIABLE finding by its engine-stamped id with its governing reference and summary, plus pending as-built remediation findings and prior remediation laps already held in engine state. | 8 | "An as-built projection names every REMEDIABLE finding by its stamped id with governing reference and summary, plus the pending as-built findings and the prior remediation laps read from the kickback ledger." | diff-local |
| Story 1 happy: Given a validation-group request carrying both PRD-audit and as-built findings, when gap planning is prepared, then the input carries the union of both required reference sets, each labelled with its source. | 8 | "A validation-group projection carries the union of both required reference sets, each reference labelled with its source gate." | diff-local |
| Story 1 happy: Given a build-stall or finish-verification request, when gap planning is prepared, then the input carries the stall question or failing-test evidence with its existing key grammar and no fabricated typed references. | 9 | "Build-stall and finish-verification projections carry the stall question or failing-test evidence with their `stall:<slug>`/`test:<stem>` key grammar and an empty required typed-reference set (no fabricated typed references)." | diff-local |
| Story 1 happy: Given refusal decisions recorded for findings in this feature, when gap planning is prepared, then those decision bindings are part of the input. | 8, 29 | "Supplied refusal evidence is projected as `refusal` references carrying decision id, revision and rationale." | diff-local |
| Story 1 negative: Given a requesting gate whose typed verdict is missing, unreadable, or of an unsupported version, when gap planning is prepared, then preparation stops before any provider invocation and names the source verdict and the defect. | 10, 21 | "A capability fault and each projection input fault reach `haltForValidatorFault`, writing a `mechanical` HALT, with zero provider invocations and zero retries." | diff-local |
| Story 1 negative: Given a required structured dimension that exceeds its engine limit, when gap planning is prepared, then preparation stops before invocation naming the dimension, actual size, and limit, and no shortened reference set is dispatched. | 10, 21 | "A required structured dimension over its `REMEDIATION_PROJECTION_LIMITS` constant returns a fault naming the dimension, actual size and limit, and no shortened projection is returned." | diff-local |
| Story 1 negative: Given failing-test or stall evidence text larger than the evidence caps, when gap planning is prepared, then the omitted portions are identified with their content identity for read-only inspection while every required reference remains present. | 9 | "Evidence over the per-file or total cap is excerpted with omission entries carrying each omitted path and content digest for read-only inspection, while every required reference in the projection remains present." | diff-local |
| Story 1 negative: Given a present kickback ledger that is corrupt or unreadable, when prior laps are projected, then preparation stops naming the ledger rather than treating it as empty history. | 10 | "A present but corrupt kickback ledger, and a present ledger whose injected read throws, each return a fault naming the ledger, not an empty-history projection." | diff-local |
| Story 1 negative: Given no pending findings, no prior laps, and no refusal decisions, when gap planning is prepared, then those absences are explicit in the input and preparation succeeds. | 8 | "With no pending findings, no prior laps and no refusals, the projection carries explicit empty pending, laps and refusals fields and `buildRemediationProjection` returns success." | diff-local |
| Story 2 happy: Given Claude or Codex as the selected provider, when gap planning dispatches, then the invocation requests the engine-owned native structured-output schema, and the shape description it receives is rendered from that same schema. | 1, 16 | "With Claude and with Codex fake runtimes, a `gap-plan` request invokes `executeProviderAwareSkillOneShot` with `nativeSchema` equal to `REMEDIATION_PLAN_SCHEMA` and a prompt containing the `renderRemediationPlanShape()` output and the rendered projection." | diff-local |
| Story 2 happy: Given equal valid dispositions returned by the two provider fixtures, when the plans settle, then they produce equivalent validated plans and equivalent downstream routing, apart from engine-owned attempt metadata. | 19 | "Equal disposition fixtures returned by the Claude and Codex runtimes yield persisted plans equal apart from attempt metadata, and the same route target, hint and appended task ids." | diff-local |
| Story 2 happy: Given each dispatch and each retry, when the provider is invoked, then it is a fresh one-shot invocation. | 16, 20 | "Each gap-plan dispatch is a fresh one-shot invocation with no resumed session id." | diff-local |
| Story 2 negative: Given a selected provider without native structured-output capability, when gap planning is prepared, then that provider is not invoked and the feature halts naming the missing capability, without a retry. | 16, 21 | "A selected provider whose `nativeSchemaCapabilityFor` lacks `nativeOutputSchema` records zero invocations and returns a capability fault naming the provider and the missing capability." | diff-local |
| Story 2 negative: Given a provider that returns a well-formed plan only as chat text with no terminal structured result, when the dispatch settles, then the chat text is not used as a plan and the attempt is a missing-result fault. | 16 | "A provider that returns a well-formed plan only as chat text with no `finalStructuredResult` yields a `structured-result-missing` fault, and no plan is persisted from the chat text." | diff-local |
| Story 2 negative: Given authentication failure, rate limiting, or model unavailability, when the adapter reports it, then the existing dedicated handling for that condition takes precedence over a missing-plan diagnosis. | 20 | "Authentication failure, rate limiting and model unavailability reported by the adapter take their existing dedicated handling, and no missing-plan diagnostic is emitted for them." | diff-local |
| Story 3 happy: Given a structured result that answers every required PRD-audit criterion and as-built finding exactly once by kind and id, when it is validated, then the plan is accepted and each disposition is linked to its source finding. | 2, 19 | "`validateRemediationPlan` accepts a PRD-audit fixture answering every required criterion exactly once and returns each disposition linked to its required reference with its target step from `remediationDispositionStep`, its category, rationale and tasks." | diff-local |
| Story 3 happy: Given a validation-group request, when a result answers PRD-audit and as-built references in any order, then accounting is checked against the union of both sets. | 2 | "A validation-group fixture answering PRD-audit and as-built references in shuffled order is accepted, with accounting checked against the union of both required sets (removing either set's reference from the fixture makes it fail)." | diff-local |
| Story 3 happy: Given a criterion reference that differs from the required criterion id only in letter case, when it is validated, then it matches that criterion under the shared case-normalization rules. | 2 | "A criterion reference differing from the required id only in letter case is accepted and linked to that criterion under the same lower-case normalization `validatePrdAuditJudgment` applies." | diff-local |
| Story 3 happy: Given an untyped source, when a result's references follow that source's key grammar (`stall:<slug>` or `test:<stem>`), then they are accepted without a completeness requirement. | 2 | "Build-stall `stall:<slug>` and finish `test:<stem>` fixtures are accepted with no completeness requirement, and a build-stall `build` disposition with zero tasks and its answer in `rationale` is accepted." | diff-local |
| Story 3 negative: Given a result that omits a required reference, when it is validated, then the whole plan is rejected with a diagnostic naming each missing reference. | 3 | "An omission fixture returns the `rejected` arm with diagnostics naming each missing required reference by kind and id." | diff-local |
| Story 3 negative: Given a result that answers the same reference twice, when it is validated, then the whole plan is rejected naming the duplicated reference; neither answer is chosen. | 3 | "A duplicate fixture is rejected naming the duplicated reference, and the result exposes neither answer." | diff-local |
| Story 3 negative: Given a result that cites a reference not in the required set, including an ADR stem or a finding from another lap or feature, when it is validated, then the whole plan is rejected naming the foreign reference. | 3 | "Foreign fixtures citing an ADR stem, an as-built id from another lap, and a criterion from another feature are each rejected naming the foreign reference." | diff-local |
| Story 3 negative: Given a reference with a missing kind, an empty id, or an untyped-source key outside its grammar, when it is validated, then the whole plan is rejected naming the malformed field. | 4 | "Fixtures with a missing reference kind, an empty id, a `stall:` key outside the `stall:<slug>` grammar, and a `test:` key outside the `test:<stem>` grammar are each rejected as a whole plan naming the malformed field path (for example `dispositions[2].reference.kind`)." | diff-local |
| Story 3 negative: Given any rejected result, when it settles, then it is neither a partial plan nor a substantive BLOCKED or halt judgment. | 3, 22 | "The `rejected` arm has no dispositions and no verdict, BLOCKED or halt field, as asserted by a runtime shape check on every rejection fixture in this file." | diff-local |
| Story 4 happy: Given dispositions drawn from the engine vocabulary, when they are validated, then each is accepted with its target step, category, rationale, and tasks. | 2 | "`validateRemediationPlan` accepts a PRD-audit fixture answering every required criterion exactly once and returns each disposition linked to its required reference with its target step from `remediationDispositionStep`, its category, rationale and tasks." | diff-local |
| Story 4 happy: Given an `existing-task` disposition for a finding whose owning task is in the active plan, when it binds that owner, then the binding is accepted and later restaged under the existing rules. | 6, 19 | "An `existing-task` disposition binding the finding's owning task resolves through the shared plan-task reference resolver and is accepted carrying the canonical bound task ids." | diff-local |
| Story 4 happy: Given a build-stall request answered with `build`, no new tasks, and the answer in its rationale, when it is validated, then it is accepted. | 2 | "Build-stall `stall:<slug>` and finish `test:<stem>` fixtures are accepted with no completeness requirement, and a build-stall `build` disposition with zero tasks and its answer in `rationale` is accepted." | diff-local |
| Story 4 happy: Given a `halt` disposition with a halt category, when it is validated, then it is accepted with its rationale. | 2 | "A `halt` disposition with a category is accepted carrying its category and rationale." | diff-local |
| Story 4 negative: Given an unknown disposition or halt category value, when it is validated, then the whole plan is rejected naming the value and the accepted set, and a `remediation_disposition_rejected` event is emitted for each rejected entry. | 5, 22 | "Unknown disposition and unknown halt-category fixtures are rejected as a whole plan, and the rejected arm lists one `RemediationDispositionRejection` per offending entry naming the value, the field (`disposition` or `category`) and the full accepted set." | diff-local |
| Story 4 negative: Given an `existing-task` disposition that binds a task other than the finding's owning task, when it is validated, then the whole plan is rejected naming both the bound task and the owner. | 6 | "Binding any active-plan task other than the owning task, alone or alongside the owner, makes `validateRemediationPlan` reject the whole plan (no disposition accepted, even beside a valid sibling disposition) with a diagnostic naming both the bound task and the owning task." | diff-local |
| Story 4 negative: Given an `existing-task` disposition binding a task id that is absent from the active plan, or that has no bound task, when it is validated, then the whole plan is rejected naming the field. | 6 | "A bound id absent from the active plan, and an empty `boundTaskIds` list, each make `validateRemediationPlan` reject the whole plan (no disposition accepted, even beside a valid sibling disposition) naming the `boundTaskIds` field." | diff-local |
| Story 4 negative: Given a `build` disposition with no new tasks for any source other than build stall, when it is validated, then the whole plan is rejected naming the empty task list. | 5 | "A `build` disposition with no new tasks is rejected naming the empty `tasks` field on PRD-audit, as-built, validation-group and finish sources, while the same entry on the build-stall source is accepted." | diff-local |
| Story 4 negative: Given a `halt` disposition without a category, when it is validated, then the whole plan is rejected naming the missing category. | 5 | "A `halt` disposition with a null category is rejected naming the missing `category` field." | diff-local |
| Story 5 happy: Given a first attempt that returns no structured result or a rejected plan, and a retry that returns a valid plan, when gap planning settles, then the valid plan is used and the rejected attempt's diagnostics are recorded. | 20 | "A first attempt with no structured result (and, separately, a rejected plan) followed by a valid plan settles with the second plan, and the first attempt's fault diagnostic is emitted on the existing event spine." | diff-local |
| Story 5 happy: Given a valid first attempt, when gap planning settles, then no retry occurs. | 20 | "A valid first attempt settles with exactly one provider invocation." | diff-local |
| Story 5 negative: Given every attempt within `remediate`'s configured retry allowance returns an unusable result, when the allowance is exhausted, then the requesting caller receives a no-plan result carrying the last named fault, and it applies its existing no-plan handling: as-built and validation-group requests halt needs-human, except that a validation group with manual-test FAIL rows still proceeds with its deterministic manual-test build kickback; PRD-audit requests use their deterministic gap classification and still write the refused-widening HALT when every blocking finding is refused; build-stall requests halt with the question verbatim or auto-park as they do today; and finish-verification requests halt as they do today. | 23, 24, 25, 26 | "When every attempt on an as-built round is unusable, the caller halts `needs-human` and the HALT text names the last mechanical fault." | diff-local |
| Story 5 negative: Given a capability or required-input fault, when gap planning is attempted, then it halts through the existing validator-fault halt without any retry. | 21 | "A capability fault and each projection input fault reach `haltForValidatorFault`, writing a `mechanical` HALT, with zero provider invocations and zero retries." | diff-local |
| Story 5 negative: Given a provider dispatch that times out or throws, when it settles, then that attempt counts against the retry allowance and is not accepted as a plan. | 20 | "A dispatch that times out or throws counts as one attempt against the configured `remediate` retry allowance, is never accepted as a plan, and the next attempt uses a fresh session id." | diff-local |
| Story 6 happy: Given a validated plan, when the attempt settles, then the engine writes it atomically as the typed remediation plan, stamped with the attempt identity, source kind, and required-reference digest, and admission reads it through the single typed reader. | 11, 17, 19 | "`persistRemediationPlan` writes `.pipeline/remediation-plan.json` through a temp-file rename carrying contract version, attempt identity, source kind and required-reference digest, and `readTypedRemediationPlan` for that attempt returns `present` with the same dispositions." | diff-local |
| Story 6 happy: Given a restart that re-enters remediation planning, when it runs, then it is a new attempt that dispatches again, and pending-repair receipts keep every earlier charge idempotent. | 27 | "A conductor restart that re-enters `planRemediation` generates a new attempt identity and dispatches again (invocation count increments)." | diff-local |
| Story 6 negative: Given a typed plan from a prior attempt, when the current attempt produces no usable result, then the prior plan is not accepted for the current attempt, regardless of its modification time. | 11, 27 | "A stored plan for another attempt id returns `absent` for the current attempt, including when its mtime is newer than the current attempt's start." | diff-local |
| Story 6 negative: Given only a legacy prose-authored `.pipeline/remediation.json`, when gap planning reads its result, then that file is never parsed as a plan. | 11 | "With only a legacy `.pipeline/remediation.json` or a case-v1 file present, `readTypedRemediationPlan` returns `absent` and an injected filesystem spy records no open of `.pipeline/remediation.json`; the case reader in `remediation-case-artifact.ts` never opens `remediation-plan.json`." | diff-local |
| Story 6 negative: Given a build_review case adjudication that writes `.pipeline/remediation.json`, when gap planning runs in the same worktree, then neither mode reads the other's output. | 11 | "With only a legacy `.pipeline/remediation.json` or a case-v1 file present, `readTypedRemediationPlan` returns `absent` and an injected filesystem spy records no open of `.pipeline/remediation.json`; the case reader in `remediation-case-artifact.ts` never opens `remediation-plan.json`." | diff-local |
| Story 6 negative: Given a persistence failure while writing the plan, when the attempt settles, then it is a named mechanical fault and no earlier file is accepted in its place. | 11, 17 | "A write failure from the injected filesystem returns a named `persistence-fault`, and the reader then returns no `present` plan for that attempt." | diff-local |
| Story 7 happy: Given a validated plan, when admission runs, then the sealed-artifact redirect, PRD and as-built admission sets, `existing-task` restage, plan-growth and lap budgets, operator authority on DECIDE re-entry, pending-repair recording and settlement, and the no-op guard behave as they did before the migration. | 28, 29 | "The sealed-artifact redirect, PRD and as-built admission sets, `existing-task` restage, validation-group primacy and single-appender assertions in these suites pass with plans supplied through the Task 18 helper." | diff-local |
| Story 7 happy: Given new tasks in a validated plan, when they are appended, then they receive engine `rem-` task ids through the single appender. | 19 | "New tasks in a validated `build` disposition are appended with engine `rem-` task ids through `appendRemediationTasks`, and an owner-bound `existing-task` disposition re-stages its bound task to `pending` in `.pipeline/task-status.json` before the rewind." | diff-local |
| Story 7 happy: Given a PRD-widening reconciliation request, when it dispatches `remediate`, then its existing contract and behavior are unchanged. | 30 | "The existing `prd-widening-coordinator` and step-runner reconciliation tests pass with no edits to their files." | diff-local |
| Story 7 negative: Given a validated plan whose admission exceeds the plan-growth or lap budget, when admission runs, then the existing budget halt occurs unchanged. | 28 | "A validated plan exceeding the plan-growth or lap budget still halts with the existing `kickback-cap` class." | diff-local |
| Story 7 negative: Given a validated plan routing to a DECIDE step whose artifact is already satisfied without an operator grant, when admission runs, then the existing operator-authority refusal occurs unchanged. | 28 | "A validated plan routing to an already-satisfied DECIDE step without an operator grant still gets the existing operator-authority refusal." | diff-local |
| Story 7 negative: Given a validated plan containing both a halt and fixes, when admission runs, then the halt wins as it does today. | 28 | "A validated plan with a halt and fixes still halts, and a validated plan whose admitted tasks are already complete still has its pending repair discarded by the no-op guard." | diff-local |
| Story 7 negative: Given a validated plan whose admitted tasks are already complete, when admission runs, then the existing no-op guard discards the pending repair unchanged. | 28 | "A validated plan with a halt and fixes still halts, and a validated plan whose admitted tasks are already complete still has its pending repair discarded by the no-op guard." | diff-local |
| Story 8 happy: Given an as-built verdict with findings, when the engine validates and persists it, then each finding receives an engine-stamped id unique across the feature's laps, and the rendered report, prior-findings projection, pending-finding records, and shipped record all show that id. | 12, 14 | "For one stamped finding, `renderAsBuiltReport`, the `renderAsBuiltProjection` prior-findings section, the kickback ledger's `pendingAsBuiltRemediationFindings` entry, and the shipped-record YAML from `recordedAsBuiltFindings` all show the same stamped id." | diff-local |
| Story 8 happy: Given two laps that each produce findings, when the second lap's findings are pending, then the first lap's pending records are still present. | 14 | "After a second lap's findings are recorded pending, every first-lap pending entry is still present in the ledger under its own distinct stamped id." | diff-local |
| Story 8 negative: Given a provider result that includes its own finding id field, when the as-built result is validated, then the result is rejected as a schema violation naming the unsupported field. | 12 | "`AS_BUILT_VERDICT_CONTRACT_VERSION` is `v2`, `AS_BUILT_VERDICT_SCHEMA` finding items declare no `id`, and `validateAsBuiltVerdict` rejects a result whose finding carries an `id` as a schema violation naming the unsupported `findings[n].id` field." | diff-local |
| Story 8 negative: Given a persisted as-built verdict of the prior contract version, when the gate is next evaluated, then that verdict is not authoritative and as-built reruns once through its lifecycle; it is never converted. | 13 | "With a persisted `v1` as-built verdict, the conductor's verdict handshake treats it as not authoritative and dispatches as-built exactly once (fake reviewer invocation count 1), and the `v1` file is never converted into a `v2` verdict." | diff-local |
| Story 8 negative: Given two findings in one verdict with identical summaries and references, when they are persisted, then each receives a distinct id and neither is collapsed. | 12 | "The step runner's as-built persist stamps each finding from attempt id and ordinal; two findings with identical summary and reference receive distinct ids and both are persisted." | diff-local |
| Story 8 negative: Given pending as-built remediation entries recorded before the upgrade with provider-minted ids, when the next as-built verdict is stamped, then those entries remain in the ledger and shipped record as historical records under their original ids, and they are never required, matched, or rejected by remediation accounting. | 15 | "A ledger holding pre-upgrade pending entries with provider-minted ids keeps those entries unchanged after the next `v2` verdict is stamped, and the shipped record lists them under their original ids." | diff-local |
| Story 9 happy: Given the remediate skill, when it is read for gap planning, then it explains the HALT categories, the implementation-only routing rule, the recorded-red exception obligation, the sealed artifact set including `.docs/decisions/`, the environmental-stall rule, plan-coverage judgment, and low-confidence HALT. | 32 | "The gap-plan sections of `skills/remediate/SKILL.md` contain the HALT categories, implementation-only routing rule, recorded-red exception obligation, sealed-artifact set prose including the decisions directory, environmental-stall rule, plan-coverage judgment, low-confidence HALT and refusal removal-only rule." | diff-local |
| Story 9 happy: Given the remediation planner agent definition, when it is read, then it carries the same judgment guidance, including rejecting contradictory dispositions and treating `plan` as terminal in daemon runs, and none of the machine contract. | 33 | "`agents/remediation-planner.md` carries the same judgment guidance as the skill's gap-plan sections (HALT categories, implementation-only routing rule, recorded-red exception obligation, sealed-artifact set, environmental-stall rule, plan-coverage judgment, low-confidence HALT) plus the prefer-autonomous, contradictory-disposition and `plan`-terminal-in-daemon rules." | diff-local |
| Story 9 happy: Given a human invoking the skill interactively outside a managed run, when they ask for a remediation plan, then they receive a human-readable plan, and it is not presented as a managed persisted result. | 32 | "A standalone-use paragraph states that interactive use produces a human-readable plan that is not a managed persisted result, and the plan-contract and prior-attempt pointer guidance with its fallback paths sits outside the audited gap-plan sections." | diff-local |
| Story 9 happy: Given the PRD-widening and case adjudication sections, when the skill is read, then those sections are unchanged. | 32 | "`git diff main -- skills/remediate/SKILL.md` shows no change inside the PRD-widening reconciliation and case-v1/v2 sections." | diff-local |
| Story 9 happy: Given supplied plan-contract and prior-attempt pointers, when the skill is read, then its guidance to read the referenced files before planning, and its fallback paths, remain as mode-neutral judgment outside the gap-plan sections the audit guards. | 32 | "A standalone-use paragraph states that interactive use produces a human-readable plan that is not a managed persisted result, and the plan-contract and prior-attempt pointer guidance with its fallback paths sits outside the audited gap-plan sections." | diff-local |
| Story 9 negative: Given a change that reintroduces gap-plan output format, field rules, disposition vocabulary tables, or input-reading recipes into the gap-planning sections of the skill or into the planner agent, when the provider skill contract audit runs, then it fails naming the file and the reintroduced content. | 34 | "Fixtures reintroducing an output-format block, a field rule, a vocabulary table, or an input-reading recipe into the skill's gap-plan sections or the planner agent each make the audit fail with a message naming the file and the reintroduced content." | diff-local |
| Story 9 negative: Given ordinary judgment prose that mentions a disposition by name, when the audit runs, then it passes. | 34 | "A fixture whose gap-plan judgment prose mentions `existing-task` by name passes the audit." | diff-local |

## Architecture Obligation Coverage

All 26 citable decisions in the three ADRs amended by this spec are represented once; subdecision amendments (D1.2, D3.1, D6.4, D7.1, D7.3) attach to their parent decision.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-10-daemon-stall-remediation#D1 | existing | none | The build-stall branch reads the question with `readHaltMarkerContent` before `clearHaltMarker` and passes `.pipeline/build-stall-question.md` to `planRemediation` as stall evidence; this plan changes only the dispatch boundary. |
| adr-2026-07-10-daemon-stall-remediation#D2 | existing | none | Both build-stall call sites already call `planRemediation` with a build-stall source; Task 25 keeps both sites on the new fault lane. |
| adr-2026-07-10-daemon-stall-remediation#D3 | task | task-25 | A validated build-stall `build` disposition with no tasks resumes BUILD with the rationale as the retry hint without burning a build retry. |
| adr-2026-07-10-daemon-stall-remediation#D4 | task | task-25 | At both build-stall call sites, exhaustion writes the HALT whose first line is the stall question verbatim and whose detail names the mechanical fault, and the auto-park path still parks where it does on `main`. |
| adr-2026-07-10-daemon-stall-remediation#D5 | task | task-25 | At both build-stall call sites, exhaustion writes the HALT whose first line is the stall question verbatim and whose detail names the mechanical fault, and the auto-park path still parks where it does on `main`. |
| adr-2026-07-10-daemon-stall-remediation#D6 | existing | none | The build-stall branch checks `remediationRounds >= MAX_KICKBACKS_PER_GATE` before dispatch and writes the stall HALT; no new counter is added. |
| adr-2026-07-10-daemon-stall-remediation#D7 | task | task-2, task-5 | Build-stall `stall:<slug>` and finish `test:<stem>` fixtures are accepted with no completeness requirement, and a build-stall `build` disposition with zero tasks and its answer in `rationale` is accepted. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D1 | task | task-12 | `AS_BUILT_VERDICT_CONTRACT_VERSION` is `v2`, `AS_BUILT_VERDICT_SCHEMA` finding items declare no `id`, and `validateAsBuiltVerdict` rejects a result whose finding carries an `id` as a schema violation naming the unsupported `findings[n].id` field. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D2 | existing | none | `validateAsBuiltVerdict` and `readAsBuiltVerdict` already reject an invalid verdict as a whole and `planRemediation` halts on an unreadable or incomplete verdict; Task 12 only removes the provider id. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D3 | task | task-3, task-6 | Binding any active-plan task other than the owning task, alone or alongside the owner, makes `validateRemediationPlan` reject the whole plan (no disposition accepted, even beside a valid sibling disposition) with a diagnostic naming both the bound task and the owning task. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D4 | task | task-28 | A validated plan exceeding the plan-growth or lap budget still halts with the existing `kickback-cap` class. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D5 | task | task-19 | New tasks in a validated `build` disposition are appended with engine `rem-` task ids through `appendRemediationTasks`, and an owner-bound `existing-task` disposition re-stages its bound task to `pending` in `.pipeline/task-status.json` before the rewind. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | task | task-14 | For one stamped finding, `renderAsBuiltReport`, the `renderAsBuiltProjection` prior-findings section, the kickback ledger's `pendingAsBuiltRemediationFindings` entry, and the shipped-record YAML from `recordedAsBuiltFindings` all show the same stamped id. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D7 | task | task-14 | After a second lap's findings are recorded pending, every first-lap pending entry is still present in the ledger under its own distinct stamped id. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D8 | task | task-23 | On a validation-group round without manual-test FAIL rows, exhaustion halts `needs-human` naming the fault; with manual-test FAIL rows, the deterministic manual-test build kickback still runs. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D9 | task | task-19 | New tasks in a validated `build` disposition are appended with engine `rem-` task ids through `appendRemediationTasks`, and an owner-bound `existing-task` disposition re-stages its bound task to `pending` in `.pipeline/task-status.json` before the rewind. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | no-change | none | Accepted-widening and remediation-case authority records are read, never written, by this plan. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | no-change | none | `RemediationCaseStore` and its version-2 envelope are untouched; the build_review case mode keeps `.pipeline/remediation.json`, and the typed gap plan uses its own store. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | no-change | none | Decision offers and over-scope halt capture are outside the gap-plan boundary and unchanged. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | Legacy decision import is outside the gap-plan boundary and unchanged. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | task | task-30 | The existing `prd-widening-coordinator` and step-runner reconciliation tests pass with no edits to their files. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | task | task-16 | With Claude and with Codex fake runtimes, a `gap-plan` request invokes `executeProviderAwareSkillOneShot` with `nativeSchema` equal to `REMEDIATION_PLAN_SCHEMA` and a prompt containing the `renderRemediationPlanShape()` output and the rendered projection. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | task | task-10 | A required structured dimension over its `REMEDIATION_PROJECTION_LIMITS` constant returns a fault naming the dimension, actual size and limit, and no shortened projection is returned. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | task | task-29 | A plan that omits a refusal, or answers it with `halt` or `existing-task`, writes the refused over-scope HALT on that attempt with no retry. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | task | task-22 | For each rejected vocabulary entry, `planRemediation` emits one `remediation_disposition_rejected` event carrying the reference id as `gapId`, the rejected value, the accepted set and the field. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | The delivery boundary is respected: no NC confidence floor, cross-gate equivalence, rubric expansion or build_review case change is in this plan. |

## Tasks

### Task 1: Static remediation plan schema and rendered shape

**Story:** Story 2 happy 1 (schema source); foundation for Stories 3 and 4
**Type:** infrastructure
**Dependencies:** none
**Files:** `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Write failing tests for the schema enums, property set, and schema-derived shape rendering.
2. Verify RED.
3. Implement `REMEDIATION_PLAN_CONTRACT_VERSION`, `REMEDIATION_PLAN_SCHEMA` and `renderRemediationPlanShape()` following the `as-built-contract.ts` pattern (module-constant schema, flat root, nullable rather than optional fields for Codex strict mode, shape rendered from the schema object). Build the disposition enum from the existing `REMEDIATION_TARGET_STEPS`, `REMEDIATION_PUBLICATION_DISPOSITION`, `REMEDIATION_EXISTING_TASK_DISPOSITION` and `halt`; build the category enum from `REMEDIATION_HALT_CATEGORIES` (export it).
4. Verify GREEN and commit.

**Done when:**
- [test] `REMEDIATION_PLAN_SCHEMA`'s disposition enum equals the code vocabulary built from `REMEDIATION_TARGET_STEPS`, `publication`, `existing-task` and `halt`, and its category enum equals `REMEDIATION_HALT_CATEGORIES`, as asserted by the schema-vocabulary test.
- [test] The schema root is a flat object whose disposition items require `reference` (`kind`, `id`), `disposition`, `category`, `rationale`, `tasks` (`id`, `title`) and `boundTaskIds`, and declare no `status`, attempt, stamp, admission or route property, as asserted by a property-set test.
- [test] `renderRemediationPlanShape()` is derived from `REMEDIATION_PLAN_SCHEMA`: a test rendering from a schema copy with one enum value removed omits that value, and the shipped rendering names every accepted disposition and halt category.

### Task 2: Validator accepts complete typed, mixed and untyped plans

**Story:** Story 3 happy 1–4; Story 4 happy 1, 3, 4
**Type:** happy-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Write failing validator fixtures for PRD-audit, validation-group (shuffled order), case-variant criterion, build-stall and finish plans.
2. Verify RED.
3. Implement `validateRemediationPlan(raw, projection)` returning a discriminated `{ kind: 'accepted', dispositions }` result in which each disposition is linked to its required reference and carries its target step from `remediationDispositionStep`. Compare criterion ids with the lower-case normalization `validatePrdAuditJudgment` uses; check untyped keys by grammar only.
4. Verify GREEN and commit.

**Done when:**
- [test] `validateRemediationPlan` accepts a PRD-audit fixture answering every required criterion exactly once and returns each disposition linked to its required reference with its target step from `remediationDispositionStep`, its category, rationale and tasks.
- [test] A validation-group fixture answering PRD-audit and as-built references in shuffled order is accepted, with accounting checked against the union of both required sets (removing either set's reference from the fixture makes it fail).
- [test] A criterion reference differing from the required id only in letter case is accepted and linked to that criterion under the same lower-case normalization `validatePrdAuditJudgment` applies.
- [test] Build-stall `stall:<slug>` and finish `test:<stem>` fixtures are accepted with no completeness requirement, and a build-stall `build` disposition with zero tasks and its answer in `rationale` is accepted.
- [test] A `halt` disposition with a category is accepted carrying its category and rationale.

### Task 3: Reject missing, duplicate and foreign references

**Story:** Story 3 negative 1–3, 5
**Type:** negative-path
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Write failing fixtures for an omitted reference, a duplicated reference, and foreign references (ADR stem, as-built id from another lap, criterion from another feature).
2. Verify RED.
3. Implement whole-plan rejection with one diagnostic per defect naming the field path and reference; the rejected arm carries no dispositions.
4. Verify GREEN and commit.

**Done when:**
- [test] An omission fixture returns the `rejected` arm with diagnostics naming each missing required reference by kind and id.
- [test] A duplicate fixture is rejected naming the duplicated reference, and the result exposes neither answer.
- [test] Foreign fixtures citing an ADR stem, an as-built id from another lap, and a criterion from another feature are each rejected naming the foreign reference.
- [test] The `rejected` arm has no dispositions and no verdict, BLOCKED or halt field, as asserted by a runtime shape check on every rejection fixture in this file.

### Task 4: Reject malformed references

**Story:** Story 3 negative 4
**Type:** negative-path
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Write failing fixtures for a missing kind, an empty id, and untyped keys outside `stall:<slug>` or `test:<stem>`.
2. Verify RED.
3. Implement the reference-shape and key-grammar checks, naming the field path.
4. Verify GREEN and commit.

**Done when:**
- [test] Fixtures with a missing reference kind, an empty id, a `stall:` key outside the `stall:<slug>` grammar, and a `test:` key outside the `test:<stem>` grammar are each rejected as a whole plan naming the malformed field path (for example `dispositions[2].reference.kind`).
- [test] An untyped-grammar reference submitted on a typed source (a `stall:` reference on a PRD-audit request) is rejected naming the reference field.

### Task 5: Reject unknown vocabulary, empty build and categoryless halt

**Story:** Story 4 negative 1 (validator), 4, 5
**Type:** negative-path
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Write failing fixtures for unknown disposition and category values, an empty-task `build` on each non-stall source, and a halt with a null category.
2. Verify RED.
3. Implement the vocabulary, build-task and halt-category checks; record each unknown-value entry as a `RemediationDispositionRejection` (reference id, value, accepted set, field) on the rejected arm.
4. Verify GREEN and commit.

**Done when:**
- [test] Unknown disposition and unknown halt-category fixtures are rejected as a whole plan, and the rejected arm lists one `RemediationDispositionRejection` per offending entry naming the value, the field (`disposition` or `category`) and the full accepted set.
- [test] A `build` disposition with no new tasks is rejected naming the empty `tasks` field on PRD-audit, as-built, validation-group and finish sources, while the same entry on the build-stall source is accepted.
- [test] A `halt` disposition with a null category is rejected naming the missing `category` field.

### Task 6: Enforce existing-task owner binding

**Story:** Story 4 happy 2 (validation); Story 4 negative 2, 3
**Type:** negative-path
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Write failing fixtures for an owner binding, a non-owner binding, an absent task id, and an empty binding.
2. Verify RED.
3. Resolve `boundTaskIds` through the shared plan-task reference resolver used by today's existing-task admission; for a typed reference with an owning task (PRD criterion owner or as-built plan-task governing reference), require the owner (OD-3).
4. Verify GREEN and commit.

**Done when:**
- [test] An `existing-task` disposition binding the finding's owning task resolves through the shared plan-task reference resolver and is accepted carrying the canonical bound task ids.
- [test] Binding any active-plan task other than the owning task, alone or alongside the owner, makes `validateRemediationPlan` reject the whole plan (no disposition accepted, even beside a valid sibling disposition) with a diagnostic naming both the bound task and the owning task.
- [test] A bound id absent from the active plan, and an empty `boundTaskIds` list, each make `validateRemediationPlan` reject the whole plan (no disposition accepted, even beside a valid sibling disposition) naming the `boundTaskIds` field.

### Task 7: Validate refusal references (OD-5)

**Story:** Story 3 negative 2–4 applied to refusal references; Story 7 happy 1 (refusal admission unchanged)
**Type:** negative-path
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/remediation-plan-contract.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Write failing fixtures for foreign, duplicate and empty refusal references, and an accepted plan that omits a projected refusal.
2. Verify RED.
3. Validate `refusal` references against the projection's refusal decision ids; do not add a completeness rule for them.
4. Verify GREEN and commit.

**Done when:**
- [test] A `refusal` reference whose decision id is not in the projected refusal set is rejected as foreign, a repeated refusal reference is rejected as duplicate, and an empty decision id is rejected as malformed, each naming the reference field.
- [test] A plan that omits a projected refusal reference is accepted by `validateRemediationPlan`, leaving refusal completeness to `admitRefusalReworkPlan`.

### Task 8: Project typed sources, refusals and explicit absence

**Story:** Story 1 happy 1, 2, 3, 5; Story 1 negative 5
**Type:** happy-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/remediation-projection.ts`, `src/conductor/test/engine/remediation-projection.test.ts`

**Steps:**
1. Write failing projection fixtures for PRD-audit, as-built, validation-group, refusal-bearing and empty-history requests.
2. Verify RED.
3. Implement `buildRemediationProjection` following `as-built-projection.ts`: resolve FIXABLE criteria through `readCurrentPrdAuditVerdict`, REMEDIABLE findings through `readAsBuiltVerdict`, owning tasks through the active plan, pending as-built findings through `readPendingAsBuiltRemediationFindings`, prior laps through `readKickbackLedgerResult`, and refusal evidence from the caller's `RefusalReworkEvidence`; render the vocabulary from the code constants; carry explicit empty fields for absent optional history.
4. Verify GREEN and commit.

**Done when:**
- [test] A PRD-audit projection carries `REMEDIATION_PROJECTION_VERSION`, every FIXABLE criterion by engine criterion id with its owning task and judgment summary, those tasks' titles and Done-when blocks from the active plan, and the accepted dispositions and halt categories rendered from the code constants.
- [test] An as-built projection names every REMEDIABLE finding by its stamped id with governing reference and summary, plus the pending as-built findings and the prior remediation laps read from the kickback ledger.
- [test] A validation-group projection carries the union of both required reference sets, each reference labelled with its source gate.
- [test] Supplied refusal evidence is projected as `refusal` references carrying decision id, revision and rationale.
- [test] With no pending findings, no prior laps and no refusals, the projection carries explicit empty pending, laps and refusals fields and `buildRemediationProjection` returns success.

### Task 9: Project untyped sources with bounded evidence

**Story:** Story 1 happy 4; Story 1 negative 3
**Type:** happy-path
**Dependencies:** Task 8
**Files:** `src/conductor/src/engine/remediation-projection.ts`, `src/conductor/test/engine/remediation-projection.test.ts`

**Steps:**
1. Write failing fixtures for build-stall and finish projections, and for evidence over the per-file and total caps.
2. Verify RED.
3. Project the stall question and `.pipeline/test-failures.md` evidence with the `stall:<slug>`/`test:<stem>` key grammar and no typed references; reuse the as-built excerpt/omission design with `AS_BUILT_PROJECTION_LIMITS`' per-file and total caps.
4. Verify GREEN and commit.

**Done when:**
- [test] Build-stall and finish-verification projections carry the stall question or failing-test evidence with their `stall:<slug>`/`test:<stem>` key grammar and an empty required typed-reference set (no fabricated typed references).
- [test] Evidence over the per-file or total cap is excerpted with omission entries carrying each omitted path and content digest for read-only inspection, while every required reference in the projection remains present.

### Task 10: Fault on missing, unreadable or over-limit required input

**Story:** Story 1 negative 1, 2, 4
**Type:** negative-path
**Dependencies:** Task 8
**Files:** `src/conductor/src/engine/remediation-projection.ts`, `src/conductor/test/engine/remediation-projection.test.ts`

**Steps:**
1. Write failing fixtures for missing, unreadable and unsupported-version verdicts, an over-limit structured dimension, and a corrupt ledger.
2. Verify RED.
3. Return a typed `preparation-fault` naming source, dimension and actual/limit; size `REMEDIATION_PROJECTION_LIMITS` from the corresponding corpus, round up, and record the measurement beside each constant. Never truncate required input.
4. Verify GREEN and commit.

**Done when:**
- [test] Missing, unreadable and unsupported-version PRD-audit or as-built verdict fixtures return a `preparation-fault` naming the source verdict and its defect, and no projection.
- [test] A required structured dimension over its `REMEDIATION_PROJECTION_LIMITS` constant returns a fault naming the dimension, actual size and limit, and no shortened projection is returned.
- [test] A present but corrupt kickback ledger, and a present ledger whose injected read throws, each return a fault naming the ledger, not an empty-history projection.
- Each `REMEDIATION_PROJECTION_LIMITS` constant carries a comment recording the corpus measurement it was sized from.

### Task 11: Attempt-stamped typed plan store

**Story:** Story 6 happy 1 (persistence); Story 6 negative 1–4 (store layer)
**Type:** infrastructure
**Dependencies:** Task 2
**Files:** `src/conductor/src/engine/remediation-plan-store.ts`, `src/conductor/test/engine/remediation-plan-store.test.ts`

**Steps:**
1. Write failing store fixtures for round trip, prior attempt, legacy file, case file, and write failure.
2. Verify RED.
3. Implement `persistRemediationPlan` (temp file plus rename, like `persistAsBuiltVerdict`) at `.pipeline/remediation-plan.json` with contract version, attempt identity, source kind and required-reference digest, and `readTypedRemediationPlan(projectRoot, { attemptId })` returning `present`/`absent`/`invalid`. The reader never opens `.pipeline/remediation.json` and ignores mtime.
4. Verify GREEN and commit.

**Done when:**
- [test] `persistRemediationPlan` writes `.pipeline/remediation-plan.json` through a temp-file rename carrying contract version, attempt identity, source kind and required-reference digest, and `readTypedRemediationPlan` for that attempt returns `present` with the same dispositions.
- [test] A stored plan for another attempt id returns `absent` for the current attempt, including when its mtime is newer than the current attempt's start.
- [test] With only a legacy `.pipeline/remediation.json` or a case-v1 file present, `readTypedRemediationPlan` returns `absent` and an injected filesystem spy records no open of `.pipeline/remediation.json`; the case reader in `remediation-case-artifact.ts` never opens `remediation-plan.json`.
- [test] A write failure from the injected filesystem returns a named `persistence-fault`, and the reader then returns no `present` plan for that attempt.

### Task 12: Engine-stamped as-built finding ids

**Story:** Story 8 happy 1 (stamping); Story 8 negative 1, 3
**Type:** happy-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/as-built-contract.ts`, `src/conductor/src/engine/as-built-verdict-store.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/as-built-contract.test.ts`, `src/conductor/test/engine/step-runners-as-built.test.ts`

**Steps:**
1. Write failing tests for the v2 schema without `id`, rejection of a provider `id`, distinct stamps for identical findings, and cross-attempt uniqueness.
2. Verify RED.
3. Bump `AS_BUILT_VERDICT_CONTRACT_VERSION` to `v2`, remove `id` from `AS_BUILT_VERDICT_SCHEMA` and the parser's `exactKeys`, and stamp ids from attempt id plus ordinal where the step runner persists the verdict. Record the chosen rendering in the contract module.
4. Verify GREEN and commit.

**Done when:**
- [test] `AS_BUILT_VERDICT_CONTRACT_VERSION` is `v2`, `AS_BUILT_VERDICT_SCHEMA` finding items declare no `id`, and `validateAsBuiltVerdict` rejects a result whose finding carries an `id` as a schema violation naming the unsupported `findings[n].id` field.
- [test] The step runner's as-built persist stamps each finding from attempt id and ordinal; two findings with identical summary and reference receive distinct ids and both are persisted.
- [test] Findings stamped in two attempts with equal ordinals receive different ids.

### Task 13: Prior-version as-built verdict reruns once

**Story:** Story 8 negative 2
**Type:** negative-path
**Dependencies:** Task 12
**Files:** `src/conductor/src/engine/as-built-verdict-store.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/as-built-review-required.test.ts`

**Steps:**
1. Write a failing conductor fixture with a persisted `v1` verdict.
2. Verify RED.
3. Ensure a `v1` verdict reads as not authoritative and reaches the existing stale/absent rerun path (`verdictDispatchHandshake`) without conversion.
4. Verify GREEN and commit.

**Done when:**
- [test] With a persisted `v1` as-built verdict, the conductor's verdict handshake treats it as not authoritative and dispatches as-built exactly once (fake reviewer invocation count 1), and the `v1` file is never converted into a `v2` verdict.
- [test] After that rerun persists a `v2` verdict, the next gate evaluation triggers no further as-built dispatch.

### Task 14: Stamped ids reach every as-built consumer; multi-lap pending survives

**Story:** Story 8 happy 1, 2
**Type:** happy-path
**Dependencies:** Task 12
**Files:** `src/conductor/src/engine/as-built-verdict-store.ts`, `src/conductor/src/engine/as-built-projection.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/kickback-ledger.ts`, `src/conductor/src/engine/shipment-association.ts`, `src/conductor/test/engine/as-built-recorded-findings-projection.test.ts`

**Steps:**
1. Write a failing round-trip fixture following one stamped finding through every consumer, and a two-lap pending fixture.
2. Verify RED.
3. Carry the stamped id through `renderAsBuiltReport`, `renderAsBuiltProjection` prior findings, the conductor's pending map, `pendingAsBuiltRemediationFindings`, and `recordedAsBuiltFindings`.
4. Verify GREEN and commit.

**Done when:**
- [test] For one stamped finding, `renderAsBuiltReport`, the `renderAsBuiltProjection` prior-findings section, the kickback ledger's `pendingAsBuiltRemediationFindings` entry, and the shipped-record YAML from `recordedAsBuiltFindings` all show the same stamped id.
- [test] After a second lap's findings are recorded pending, every first-lap pending entry is still present in the ledger under its own distinct stamped id.

### Task 15: Pre-upgrade pending entries stay historical

**Story:** Story 8 negative 4
**Type:** negative-path
**Dependencies:** Tasks 8, 14
**Files:** `src/conductor/src/engine/kickback-ledger.ts`, `src/conductor/src/engine/remediation-projection.ts`, `src/conductor/test/engine/kickback-ledger.test.ts`, `src/conductor/test/engine/remediation-projection.test.ts`

**Steps:**
1. Write failing fixtures with pending entries carrying provider-minted ids from before the upgrade.
2. Verify RED.
3. Keep those entries in the ledger and shipped record unchanged; exclude them from the projection's required reference set.
4. Verify GREEN and commit.

**Done when:**
- [test] A ledger holding pre-upgrade pending entries with provider-minted ids keeps those entries unchanged after the next `v2` verdict is stamped, and the shipped record lists them under their original ids.
- [test] The remediation projection excludes those entries from the required reference set, and `validateRemediationPlan` accepts a plan that does not answer them.
- [test] A plan whose disposition cites a pre-upgrade provider-minted id is never matched to that ledger entry: `validateRemediationPlan` returns no accepted disposition linked to it, and a re-read through `readPendingAsBuiltRemediationFindings` shows the entry's id and outcome unchanged.

### Task 16: Step runner gap-plan mode dispatches with the native schema

**Story:** Story 2 happy 1, 3; Story 2 negative 1 (pre-invocation), 2
**Type:** happy-path
**Dependencies:** Tasks 1, 8
**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/step-runners-remediate-gap-plan.test.ts`

**Steps:**
1. Write failing step-runner fixtures with Claude and Codex fake provider runtimes, an incapable provider, and a chat-text-only provider.
2. Verify RED.
3. Add a `gap-plan` member to the `remediationRequest` union in `StepRunOptions`. In the step runner's `remediate` branch, filter capable providers through `nativeSchemaCapabilityFor` (as the `prd_audit` branch does), pass `nativeSchema: REMEDIATION_PLAN_SCHEMA`, and render the projection and `renderRemediationPlanShape()` into the prompt. A missing capable provider returns a capability fault without invoking; a missing `finalStructuredResult` returns `structured-result-missing`. The PRD-widening reconciliation member is unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] With Claude and with Codex fake runtimes, a `gap-plan` request invokes `executeProviderAwareSkillOneShot` with `nativeSchema` equal to `REMEDIATION_PLAN_SCHEMA` and a prompt containing the `renderRemediationPlanShape()` output and the rendered projection.
- [test] Each gap-plan dispatch is a fresh one-shot invocation with no resumed session id.
- [test] A selected provider whose `nativeSchemaCapabilityFor` lacks `nativeOutputSchema` records zero invocations and returns a capability fault naming the provider and the missing capability.
- [test] A provider that returns a well-formed plan only as chat text with no `finalStructuredResult` yields a `structured-result-missing` fault, and no plan is persisted from the chat text.

### Task 17: Validate and persist the gap-plan result in the step runner

**Story:** Story 6 happy 1 (persist on dispatch); Story 3 negative 5 (dispatch layer)
**Type:** happy-path
**Dependencies:** Tasks 2, 11, 16
**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners-remediate-gap-plan.test.ts`

**Steps:**
1. Write failing fixtures for a valid and a rejected structured result.
2. Verify RED.
3. Validate the terminal structured result with `validateRemediationPlan` against the request's projection; persist an accepted plan with `persistRemediationPlan` stamped with the request's attempt id, source kind and reference digest; return a `structured-result-rejected` fault carrying diagnostics and rejections for a rejected one. A persistence failure returns a `persistence-fault`.
4. Verify GREEN and commit.

**Done when:**
- [test] A valid structured result is persisted through `persistRemediationPlan` stamped with the request's attempt id, source kind and required-reference digest.
- [test] A rejected result returns a `structured-result-rejected` fault carrying the validator's field-specific diagnostics and its `RemediationDispositionRejection` entries, and `.pipeline/remediation-plan.json` is not written.
- [test] A persistence failure during the step-runner write returns a named `persistence-fault` and no plan is reported as accepted.

### Task 18: Typed-plan fake-provider fixture helper

**Story:** Infrastructure for Stories 2, 5, 6, 7
**Type:** infrastructure
**Dependencies:** Task 16
**Files:** `src/conductor/test/engine/remediation-plan-fixtures.ts`, `src/conductor/test/engine/remediation-plan-fixtures.test.ts`

**Steps:**
1. Write a failing test for the helper.
2. Verify RED.
3. Implement a helper that installs a fake provider runtime (Claude or Codex id) returning a scripted sequence of per-invocation outcomes (`finalStructuredResult`, chat text only, throw, timeout, provider condition) and records invocation count, session ids and `nativeSchema` per call.
4. Verify GREEN and commit.

**Done when:**
- [test] The helper returns each scripted outcome in order and records invocation count, per-call session id and per-call `nativeSchema`, as asserted by its own test.
- [test] The helper never writes `.pipeline/remediation.json`, asserted by a filesystem check after a scripted run.

### Task 19: planRemediation consumes the typed plan end to end

**Story:** Story 6 happy 1 (single typed reader); Story 2 happy 2; Story 3 happy 1 (integration); Story 4 happy 2; Story 7 happy 2
**Type:** happy-path
**Dependencies:** Tasks 10, 17, 18
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`

**Steps:**
1. Write failing conductor fixtures through `planRemediation` using the Task 18 helper.
2. Verify RED.
3. In `planRemediation`, generate a per-planning attempt identity, build the projection, dispatch `remediate` with the `gap-plan` request, and read dispositions only through `readTypedRemediationPlan`; map them to the existing admission inputs. Keep the existing admission code unchanged below that seam.
4. Verify GREEN and commit.

**Done when:**
- [test] Through `Conductor.planRemediation` on a PRD-audit round, the engine builds the projection, dispatches the `gap-plan` request, and admission reads dispositions only through `readTypedRemediationPlan`: a stray `.pipeline/remediation.json` with conflicting content changes neither the route nor the appended tasks.
- [test] Equal disposition fixtures returned by the Claude and Codex runtimes yield persisted plans equal apart from attempt metadata, and the same route target, hint and appended task ids.
- [test] New tasks in a validated `build` disposition are appended with engine `rem-` task ids through `appendRemediationTasks`, and an owner-bound `existing-task` disposition re-stages its bound task to `pending` in `.pipeline/task-status.json` before the rewind.

### Task 20: Bounded retry around gap-plan dispatch

**Story:** Story 5 happy 1, 2; Story 5 negative 3; Story 2 negative 3
**Type:** happy-path
**Dependencies:** Task 19
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`

**Steps:**
1. Write failing fixtures for retry-then-success, valid-first-attempt, timeout and throw, and provider auth, rate-limit and model-unavailable outcomes.
2. Verify RED.
3. Wrap the gap-plan dispatch in a loop bounded by `resolveStepConfig('remediate', …).max_retries`, modelled on `coordinatePrdWidening`'s attempt loop; each attempt gets a fresh attempt identity and one-shot session; classify provider auth, rate-limit and model-availability results through their existing handlers before any missing-plan diagnosis.
4. Verify GREEN and commit.

**Done when:**
- [test] A first attempt with no structured result (and, separately, a rejected plan) followed by a valid plan settles with the second plan, and the first attempt's fault diagnostic is emitted on the existing event spine.
- [test] A valid first attempt settles with exactly one provider invocation.
- [test] A dispatch that times out or throws counts as one attempt against the configured `remediate` retry allowance, is never accepted as a plan, and the next attempt uses a fresh session id.
- [test] Authentication failure, rate limiting and model unavailability reported by the adapter take their existing dedicated handling, and no missing-plan diagnostic is emitted for them.

### Task 21: Capability and input faults halt without retry

**Story:** Story 5 negative 2; Story 2 negative 1 (halt); Story 1 negative 1, 2 (integration)
**Type:** negative-path
**Dependencies:** Task 20
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`

**Steps:**
1. Write failing conductor fixtures for an incapable provider and for projection input faults.
2. Verify RED.
3. Route capability faults and projection preparation faults to `haltForValidatorFault` without entering the retry loop.
4. Verify GREEN and commit.

**Done when:**
- [test] A capability fault and each projection input fault reach `haltForValidatorFault`, writing a `mechanical` HALT, with zero provider invocations and zero retries.
- [test] The HALT detail names the provider and missing capability, or the input source, dimension and actual/limit, and no `.pipeline/remediation-plan.json` is written.
- [test] On a build-stall request, that capability or input-fault HALT also carries the stall question verbatim, so no fault path drops it in daemon mode.

### Task 22: Rejection diagnostics stay on the event spine

**Story:** Story 4 negative 1 (event); Story 3 negative 5 (integration)
**Type:** negative-path
**Dependencies:** Task 20
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Steps:**
1. Rewrite the #2187 rejection tests to drive a rejected structured result through `planRemediation`.
2. Verify RED.
3. Emit one `remediation_disposition_rejected` event per `RemediationDispositionRejection` on each rejected attempt; never admit, route or append from a rejected attempt.
4. Verify GREEN and commit.

**Done when:**
- [test] For each rejected vocabulary entry, `planRemediation` emits one `remediation_disposition_rejected` event carrying the reference id as `gapId`, the rejected value, the accepted set and the field.
- [test] A rejected attempt appends no plan task, returns no route, and derives no BLOCKED or halt judgment from the plan's content.

### Task 23: Exhaustion on as-built and validation-group rounds

**Story:** Story 5 negative 1 (as-built, validation group)
**Type:** negative-path
**Dependencies:** Task 20
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`

**Steps:**
1. Write failing exhaustion fixtures for the as-built call site and the validation-group call sites, with and without manual-test FAIL rows.
2. Verify RED.
3. Return `{ kind: 'none' }` carrying the last named fault on exhaustion, and include that fault in the callers' existing halt text.
4. Verify GREEN and commit.

**Done when:**
- [test] When every attempt on an as-built round is unusable, the caller halts `needs-human` and the HALT text names the last mechanical fault.
- [test] On a validation-group round without manual-test FAIL rows, exhaustion halts `needs-human` naming the fault; with manual-test FAIL rows, the deterministic manual-test build kickback still runs.

### Task 24: Exhaustion on PRD-audit rounds

**Story:** Story 5 negative 1 (PRD audit)
**Type:** negative-path
**Dependencies:** Task 20
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-audit-kickback-typed.test.ts`

**Steps:**
1. Write failing exhaustion fixtures at both PRD-audit call sites.
2. Verify RED.
3. Keep the deterministic gap classification fallback and refused-widening HALT on the no-plan result, naming the fault.
4. Verify GREEN and commit.

**Done when:**
- [test] On PRD-audit exhaustion, the caller applies its deterministic gap classification fallback, and its message names the mechanical fault.
- [test] When every blocking finding is refused, PRD-audit exhaustion still writes the refused-widening HALT.

### Task 25: Exhaustion on build-stall rounds

**Story:** Story 5 negative 1 (build stall)
**Type:** negative-path
**Dependencies:** Task 20
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/daemon-mode-route-halt-user-input-required-through.acceptance.test.ts`

**Steps:**
1. Write failing exhaustion fixtures at both build-stall call sites (`build_stall`/`build_stall_zero_work` and `build-stall`).
2. Verify RED.
3. Keep the verbatim-question HALT and auto-park behavior on the no-plan result, naming the fault.
4. Verify GREEN and commit.

**Done when:**
- [test] At both build-stall call sites, exhaustion writes the HALT whose first line is the stall question verbatim and whose detail names the mechanical fault, and the auto-park path still parks where it does on `main`.
- [test] A validated build-stall `build` disposition with no tasks resumes BUILD with the rationale as the retry hint without burning a build retry.

### Task 26: Exhaustion on finish-verification rounds

**Story:** Story 5 negative 1 (finish verification)
**Type:** negative-path
**Dependencies:** Task 20
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-verdicts-and-daemon.test.ts`

**Steps:**
1. Write a failing exhaustion fixture for the finish-verification call site.
2. Verify RED.
3. Keep the existing finish halt on the no-plan result, naming the fault.
4. Verify GREEN and commit.

**Done when:**
- [test] On finish-verification exhaustion, the conductor writes the same halt class and lifecycle terminal it writes on `main` for a no-plan result, and the HALT text names the mechanical fault.
- [test] The finish-verification projection's `test:<stem>` evidence is what the dispatched prompt carries, as asserted on the fake runtime's recorded prompt.

### Task 27: Restart re-dispatches without double charging or stale plans

**Story:** Story 6 happy 2; Story 6 negative 1 (conductor)
**Type:** negative-path
**Dependencies:** Task 20
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`

**Steps:**
1. Write failing restart fixtures.
2. Verify RED.
3. Make re-entry a new attempt identity; rely on pending-repair receipts for idempotent charging; read only the current attempt's plan.
4. Verify GREEN and commit.

**Done when:**
- [test] A conductor restart that re-enters `planRemediation` generates a new attempt identity and dispatches again (invocation count increments).
- [test] Across that restart, pending-repair receipts keep the lap and plan-growth charges counted once.
- [test] When the restarted attempt produces no usable result, the earlier attempt's `.pipeline/remediation-plan.json` is not accepted and the caller's no-plan handling runs.

### Task 28: Survivor admission rules on typed plans

**Story:** Story 7 happy 1; Story 7 negative 1–4; Story 4 happy 2 (restage)
**Type:** refactor
**Dependencies:** Tasks 18, 19
**Files:** `src/conductor/test/engine/remediation-routing.test.ts`, `src/conductor/test/engine/conductor-remediation-authority-routing.test.ts`, `src/conductor/test/engine/conductor-remediation-noop-guard.test.ts`, `src/conductor/test/acceptance/plan-growth-existing-task-restage.acceptance.test.ts`, `src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts`

**Steps:**
1. Replace `.pipeline/remediation.json` planner stubs in these suites with the Task 18 helper, keeping every assertion.
2. Run them against the migrated `planRemediation`; any failure is a regression in Tasks 19–27, fixed there.
3. Commit.

**Done when:**
- [test] The sealed-artifact redirect, PRD and as-built admission sets, `existing-task` restage, validation-group primacy and single-appender assertions in these suites pass with plans supplied through the Task 18 helper.
- [test] A validated plan exceeding the plan-growth or lap budget still halts with the existing `kickback-cap` class.
- [test] A validated plan routing to an already-satisfied DECIDE step without an operator grant still gets the existing operator-authority refusal.
- [test] A validated plan with a halt and fixes still halts, and a validated plan whose admitted tasks are already complete still has its pending repair discarded by the no-op guard.
- [test] A validated plan supplied through the Task 18 helper records a pending repair at admission and settles it at the next BUILD dispatch, with the same pending-repair record and settlement outcome the existing suites assert on `main`.

### Task 29: Refusal-rework rounds through the typed plan (OD-5)

**Story:** Story 1 happy 5 (integration); Story 7 happy 1 (refusal admission)
**Type:** happy-path
**Dependencies:** Tasks 7, 19
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/prd-widening-refusal-rework.ts`, `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`

**Steps:**
1. Write failing refusal-round fixtures through `planRemediation`.
2. Verify RED.
3. Pass the route's refusal evidence into the projection; feed validated `refusal` dispositions to `admitRefusalReworkPlan` keyed by `refusalReworkGapId(decisionId)`.
4. Verify GREEN and commit.

**Done when:**
- [test] A refusal-rework round whose dispatched projection carries every refused decision, and whose plan answers each with a `build` disposition with tasks, appends `rem-prd-audit-refusal-<decisionId>` tasks.
- [test] A plan that omits a refusal, or answers it with `halt` or `existing-task`, writes the refused over-scope HALT on that attempt with no retry.
- [test] A refusal answered with a task-less `build` is a whole-plan validator rejection that is retried within the `remediate` allowance, and the refused over-scope HALT is written only when the allowance is exhausted.

### Task 30: PRD-widening reconciliation is unchanged

**Story:** Story 7 happy 3
**Type:** refactor
**Dependencies:** Task 16
**Files:** none
**Verify-only:** yes

**Steps:**
1. Run the existing reconciliation coordinator and step-runner reconciliation suites against the migrated step runner.
2. Record an empty commit with `Evidence: skipped` if nothing changed.

**Done when:**
- The existing `prd-widening-coordinator` and step-runner reconciliation tests pass with no edits to their files.
- The reconciliation dispatch still passes `PRD_WIDENING_RECONCILIATION_SCHEMA` as `nativeSchema`, as those tests assert.

### Task 31: Remove the legacy tolerant plan reader

**Story:** Story 6 negative 2 (survivor); review Decision 5
**Type:** refactor
**Dependencies:** Tasks 22, 23, 24, 25, 26, 27, 28, 29
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/remediation-plan-absence.test.ts`, `src/conductor/test/engine/remediation-plan-store.test.ts`

**Steps:**
1. Follow `/code-removal`: delete `readRemediationPlanResult`, `renderRemediationPlanAbsence`, the mtime-gated fallback and the dead `RemediationPlan`/absence types; keep the vocabulary constants, `remediationDispositionStep` and `remediationDispositionAppendsToPlan`.
2. Remove "write .pipeline/remediation.json" from every gap-plan dispatch context in `conductor.ts`.
3. Move surviving absence assertions from `remediation-plan-absence.test.ts` to typed-reader `absent`/`invalid` fixtures and delete the old file's legacy cases.
4. Commit.

**Done when:**
- `src/conductor/src` contains no `readRemediationPlanResult` or `renderRemediationPlanAbsence` symbol, and no gap-plan dispatch context names `.pipeline/remediation.json`.
- [test] The typed-reader `absent` and `invalid` fixtures that replaced the legacy absence tests pass, and the case-v1 reader tests in `remediation-case-artifact.test.ts` pass unchanged.

### Task 32: Strip the machine contract from the remediate skill

**Story:** Story 9 happy 1, 3, 4, 5
**Type:** refactor
**Dependencies:** Task 19
**Files:** `skills/remediate/SKILL.md`

**Steps:**
1. Remove the gap-plan input-reading recipe, id rules (including ADR-stem keys and the `refusal-<decisionId>` required gap id), vocabulary table, output contract and stale plan-append section.
2. Keep the HALT categories, implementation-only routing rule, recorded-red exception obligation (adr-2026-08-09 D5), sealed-artifact set prose (including the decisions directory), environmental-stall rule, plan-coverage judgment, low-confidence HALT, verify-claims and the refusal removal-only rule.
3. Add a standalone-use paragraph; keep the plan-contract and prior-attempt pointer guidance outside the gap-plan sections; leave the PRD-widening and case-v1/v2 sections byte-identical.
4. Commit.

**Done when:**
- The gap-plan sections of `skills/remediate/SKILL.md` contain the HALT categories, implementation-only routing rule, recorded-red exception obligation, sealed-artifact set prose including the decisions directory, environmental-stall rule, plan-coverage judgment, low-confidence HALT and refusal removal-only rule.
- Those sections contain no input-reading recipe, id rules, disposition vocabulary table, output contract or plan-append section, as the Task 34 audit asserts on the shipped file.
- A standalone-use paragraph states that interactive use produces a human-readable plan that is not a managed persisted result, and the plan-contract and prior-attempt pointer guidance with its fallback paths sits outside the audited gap-plan sections.
- `git diff main -- skills/remediate/SKILL.md` shows no change inside the PRD-widening reconciliation and case-v1/v2 sections.

### Task 33: Strip the machine contract from the planner agent

**Story:** Story 9 happy 2
**Type:** refactor
**Dependencies:** Task 19
**Files:** `agents/remediation-planner.md`

**Steps:**
1. Remove the output contract, id and field rules, vocabulary table and input-reading recipe; carry the skill's gap-plan judgment guidance and keep prefer-autonomous remediation, rejecting contradictory dispositions, and `plan` as terminal in daemon runs.
2. Commit.

**Done when:**
- `agents/remediation-planner.md` carries the same judgment guidance as the skill's gap-plan sections (HALT categories, implementation-only routing rule, recorded-red exception obligation, sealed-artifact set, environmental-stall rule, plan-coverage judgment, low-confidence HALT) plus the prefer-autonomous, contradictory-disposition and `plan`-terminal-in-daemon rules.
- It contains no output contract, id or field rules, disposition vocabulary table or input-reading recipe, as the Task 34 audit asserts on the shipped file.

### Task 34: Remediate gap-plan contract audit

**Story:** Story 9 negative 1, 2
**Type:** negative-path
**Dependencies:** Tasks 32, 33
**Files:** `test/test_provider_skill_contracts.sh`

**Steps:**
1. Add `remediate_gap_plan_contract_audit` following `as_built_skill_prose_audit`: extract the skill's gap-plan sections and the planner agent, and reject output-format, field-rule, vocabulary-table and input-recipe patterns.
2. Add `expect_remediate_gap_plan_fixture_failure` mktemp fixtures that reintroduce each pattern class, plus a passing fixture with judgment prose naming `existing-task`.
3. Commit.

**Done when:**
- [test] `remediate_gap_plan_contract_audit` passes on the shipped `skills/remediate/SKILL.md` and `agents/remediation-planner.md`.
- [test] Fixtures reintroducing an output-format block, a field rule, a vocabulary table, or an input-reading recipe into the skill's gap-plan sections or the planner agent each make the audit fail with a message naming the file and the reintroduced content.
- [test] A fixture whose gap-plan judgment prose mentions `existing-task` by name passes the audit.

### Task 35: Move prose pins to engine validator tests

**Story:** Story 9 Done When 2; review Decision 9
**Type:** refactor
**Dependencies:** Tasks 5, 32, 33
**Files:** `src/conductor/test/acceptance/remediate-plan-coverage-check.acceptance.test.ts`, `src/conductor/test/remediate-skill-contract.test.ts`, `src/conductor/test/engine/remediation-plan-contract.test.ts`

**Steps:**
1. Replace the id-format, vocabulary and halt-category prose assertions with assertions against `validateRemediationPlan` and `REMEDIATION_PLAN_SCHEMA`; keep the case-v1 contract test in `test/engine/remediate-skill-contract.test.ts` unchanged.
2. Commit.

**Done when:**
- [test] `remediate-plan-coverage-check.acceptance.test.ts` and `remediate-skill-contract.test.ts` assert `stall:<slug>`/`test:<stem>` grammar, refusal references and halt categories through `validateRemediationPlan` and `REMEDIATION_PLAN_SCHEMA`, and no longer read those formats from skill or agent prose.
- [test] The judgment assertions retained in those files (routing rule, removal-only rule) pass against the stripped skill.

## Task Dependency Graph

```
1 ─┬─ 2 ─┬─ 3, 4, 5, 6, 7
   │     └─ 11
   └─ 8 ─┬─ 9, 10
         └─ 15 (also 14)
12 ─┬─ 13
    └─ 14 ─ 15
1, 8 ─ 16 ─┬─ 17 (also 2, 11) ─┐
           ├─ 18 ──────────────┤
           └─ 30               │
10, 17, 18 ─ 19 ─┬─ 20 ─┬─ 21, 22, 23, 24, 25, 26, 27
                 ├─ 28 (also 18)
                 ├─ 29 (also 7)
                 ├─ 32 ─┐
                 └─ 33 ─┴─ 34
22–29 ─ 31
5, 32, 33 ─ 35
```

## Integration Points

- After Task 17: one gap-plan dispatch validates and persists a typed plan through the step runner.
- After Task 19: `planRemediation` is fed only by the typed reader for every source.
- After Task 27: every caller's exhaustion and restart behavior is proven on the new fault lane.
- After Task 31: no legacy reader remains.

## Integration proof owners

| Boundary (Wiring Surface) | Owning task | Entry point |
| --- | --- | --- |
| Remediation projection builder/renderer | 19 (input faults: 21) | `Conductor.planRemediation` |
| Plan schema and validator | 17 | Step runner `remediate` `gap-plan` dispatch |
| Typed plan store and reader | 19 | `Conductor.planRemediation` admission |
| Bounded retry and fault mapping | 20 (per caller: 23–26) | `Conductor.planRemediation` and its callers |
| As-built id stamping | 14 (rerun: 13) | Step runner as-built persist and conductor gate handshake |
| Rejection diagnostics | 22 | `remediation_disposition_rejected` on the event spine |
| Skill and planner-agent guidance and guard | 34 | `test/test_provider_skill_contracts.sh` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-prd-audit-s1-1-1: src/conductor/src/engine/remediation-projection.ts:138-171 — replace REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES (Task 8 fixture measurements) with measurements from the repository .docs/ corpus at BUILD: tasks = largest serialized set of projected tasks (id+title+Done-when) for any single .docs/plans/*.md (the whole plan, as any task can own a FIXABLE criterion), requiredReferences = largest serialized FIXABLE-criterion + REMEDIABLE-finding + refusal reference set from recorded verdicts/shipped records (or the plan/story criterion text bound when none exists), pendingAsBuiltFindings/priorLaps/refusals likewise from the corpus; apply the D7.2 named-bound floor (≥256 KiB for plan-task and criterion dimensions) and round up; size totalBytes as the sum of the component limits plus envelope overhead (vocabulary, version, source). Record each measurement and its source path in the comment beside each constant (Task 10 Done-when). Keep the 'never truncate' fault path; update remediation-projection.test.ts and conductor-remediation-typed-plan.test.ts overflow cases to pass explicit small limitOverrides so the Task 10 / S1.7 overflow-fault coverage survives unchanged.
**Gate:** prd-audit
**Rationale:** remediation-projection.ts:139-171 sizes REMEDIATION_PROJECTION_LIMITS from unit-test fixtures (tasks 512 B, required references 1,024 B, total 2,048 B), but ADR D7.3 (amended #2522) and plan Task 10 step 3 require sizing from the corresponding .docs/ corpus at BUILD (the D7.1/D7.2 sibling definition); this feature's own plan has a 1,976 B Task 8 section, so one real owning task overflows. Owning plan Task 10 admits the fix, so this is conforming implementation drift and routes build. The task keeps Task 10's existing overflow-fault coverage (S1.7 test 'halts mechanically for a bounded remediation projection input fault') by passing explicit small limitOverrides instead of relying on the production constants. Sibling sites S1.2/S1.3 (same constants) are covered by the S1.2/S1.3 tasks; AB-1's total-vs-untyped-evidence accounting is a separate task under AB-1.
**Criterion:** S1.1
**Parent task:** 10
**Done when:**
- [test] S1.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-s1-1-1 is complete.

### Task rem-prd-audit-rem-prd-audit-s1-1-2: src/conductor/test/engine/remediation-projection.test.ts — add a PRD-audit projection fixture whose owning task is a realistic plan section (copy this feature's Task 8 title + Done-when, ~2 KB) and several FIXABLE criteria owned by distinct tasks; assert buildRemediationProjection returns ok:true with every criterion and task present under the default REMEDIATION_PROJECTION_LIMITS; add the same realistic plan to one conductor-remediation-typed-plan.test.ts routing case so a non-toy typed plan routes successfully.
**Gate:** prd-audit
**Rationale:** remediation-projection.ts:139-171 sizes REMEDIATION_PROJECTION_LIMITS from unit-test fixtures (tasks 512 B, required references 1,024 B, total 2,048 B), but ADR D7.3 (amended #2522) and plan Task 10 step 3 require sizing from the corresponding .docs/ corpus at BUILD (the D7.1/D7.2 sibling definition); this feature's own plan has a 1,976 B Task 8 section, so one real owning task overflows. Owning plan Task 10 admits the fix, so this is conforming implementation drift and routes build. The task keeps Task 10's existing overflow-fault coverage (S1.7 test 'halts mechanically for a bounded remediation projection input fault') by passing explicit small limitOverrides instead of relying on the production constants. Sibling sites S1.2/S1.3 (same constants) are covered by the S1.2/S1.3 tasks; AB-1's total-vs-untyped-evidence accounting is a separate task under AB-1.
**Criterion:** S1.1
**Parent task:** 10
**Done when:**
- [test] S1.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-s1-1-2 is complete.

### Task rem-prd-audit-rem-prd-audit-s1-2-1: src/conductor/test/engine/remediation-projection.test.ts — add an as-built projection fixture with multiple REMEDIABLE findings carrying realistic (~500 B) stamped-id summaries like this feature's AB-1/AB-2, a plan-task reference to a realistic owning task section, several pending stamped as-built findings across two laps, and populated prior laps; assert ok:true under default REMEDIATION_PROJECTION_LIMITS with every finding, pending entry and lap present (depends on rem-prd-audit-s1-1-1's resize of pendingAsBuiltFindingsBytes/tasksBytes/priorLapsBytes/totalBytes).
**Gate:** prd-audit
**Rationale:** remediation-projection.ts:375-388 and 420-427 project REMEDIABLE findings, owner tasks, pending findings and prior laps correctly, but under the same fixture-sized limits (lines 155-167: tasks 512 B, pending as-built 512 B, total 2,048 B); the constant resize is in rem-prd-audit-s1-1-1 (owning plan Task 10), and this task adds the as-built-specific corpus-scale coverage so the dimension cannot regress, keeping Task 8's existing as-built projection assertions.
**Criterion:** S1.2
**Parent task:** 10
**Done when:**
- [test] S1.2 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-s1-2-1 is complete.

### Task rem-prd-audit-rem-prd-audit-s1-3-1: src/conductor/test/engine/remediation-projection.test.ts — add a validation-group fixture combining this feature's real-size prd-audit FIXABLE evidence (S1.1-S1.3 / S7.1 summaries, ~600-900 B each) with two REMEDIABLE as-built findings (AB-1/AB-2-size summaries); assert ok:true under default limits, the union contains every reference labelled with its sourceGate (prd_audit / architecture_review_as_built), and requiredReferences serialized size is below REMEDIATION_PROJECTION_LIMITS.requiredReferencesBytes.
**Gate:** prd-audit
**Rationale:** remediation-projection.ts:196-202 and 344-389 correctly build the sourceGate-labelled union for validation-group, but it is bounded by requiredReferencesBytes=1024 / totalBytes=2048 (lines 139-167) sized from fixtures; the resize is rem-prd-audit-s1-1-1 (plan Task 10), and this task pins the union at corpus scale, keeping Task 8's union/sourceGate assertions.
**Criterion:** S1.3
**Parent task:** 10
**Done when:**
- [test] S1.3 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-s1-3-1 is complete.

### Task rem-prd-audit-rem-prd-audit-s7-1-1: src/conductor/src/engine/conductor.ts:5121-5130 + remediation-projection.ts:112-125/196-202 — derive the projection's included gates from hintSource.evidence (the caller's narrowed list) instead of from the source label alone: add an optional includedGates (or evidence gate list) to RemediationProjectionRequest, have includesPrdAudit/includesAsBuilt honor it, and pass hintSource.evidence.map(e => e.gate) from planRemediation so a validation-group round whose as-built evidence was withheld (conductor.ts:9913-9933, DESIGN/invalid) projects only the PRD-audit references; add a remediation-projection.test.ts case for validation-group with only prd_audit included asserting no as-built references and no as-built verdict read fault.
**Gate:** prd-audit
**Rationale:** conductor.ts:5121-5130 builds the projection from remediationProjectionSource(hintSource.source) alone, and remediation-projection.ts:196-202/369-389 always reads the as-built verdict for 'validation-group', ignoring that conductor.ts:9913-9933 deliberately withholds terminal (DESIGN/invalid) as-built evidence so PRD-owned work still proceeds (AB-R11 / APPROVED decision 3); the fix is determinable and owned by plan Task 28 (validation-group primacy / admission sets survive unchanged) and Task 19 (keep admission unchanged below the seam), so build. The task restores the two survivor assertions that were rewritten (every-as-built-blocked-verdict-halts-needs-human-i.acceptance.test.ts:403-408 and plan-growth-existing-task-restage.acceptance.test.ts:547-558) rather than weakening them, preserving Task 28's coverage. Sibling site: every other planRemediation call that narrows hintSource.evidence (as-built-only, prd-audit-only) is derived from the same evidence list by the same change so the source and evidence cannot drift.
**Criterion:** S7.1
**Parent task:** 28
**Done when:**
- [test] S7.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-s7-1-1 is complete.

### Task rem-prd-audit-rem-prd-audit-s7-1-2: src/conductor/test/acceptance/every-as-built-blocked-verdict-halts-needs-human-i.acceptance.test.ts:403-408 and src/conductor/test/acceptance/plan-growth-existing-task-restage.acceptance.test.ts:547-558 — restore the pre-branch admission assertions (main's expect(plan).toContain('rem-prd-audit-') for the DESIGN-withheld round, and the 'ONE remediate, ONE build' merged manual-test + as-built work order for prd_audit 'skipped') with typed plans supplied through the Task 18 helper, and make them pass against rem-prd-audit-s7-1-1 rather than keeping the rewritten not.toContain / zero-dispatch expectations.
**Gate:** prd-audit
**Rationale:** conductor.ts:5121-5130 builds the projection from remediationProjectionSource(hintSource.source) alone, and remediation-projection.ts:196-202/369-389 always reads the as-built verdict for 'validation-group', ignoring that conductor.ts:9913-9933 deliberately withholds terminal (DESIGN/invalid) as-built evidence so PRD-owned work still proceeds (AB-R11 / APPROVED decision 3); the fix is determinable and owned by plan Task 28 (validation-group primacy / admission sets survive unchanged) and Task 19 (keep admission unchanged below the seam), so build. The task restores the two survivor assertions that were rewritten (every-as-built-blocked-verdict-halts-needs-human-i.acceptance.test.ts:403-408 and plan-growth-existing-task-restage.acceptance.test.ts:547-558) rather than weakening them, preserving Task 28's coverage. Sibling site: every other planRemediation call that narrows hintSource.evidence (as-built-only, prd-audit-only) is derived from the same evidence list by the same change so the source and evidence cannot drift.
**Criterion:** S7.1
**Parent task:** 28
**Done when:**
- [test] S7.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-s7-1-2 is complete.

### Task rem-as-built-rem-as-built-ab1-1: src/conductor/src/engine/remediation-projection.ts:218-235 — compute the 'total' structured dimension over the projection with evidence excluded (structured-input accounting only), leaving untyped evidence governed solely by projectUntypedEvidence's perFileHunksBytes/totalDiffBytes caps and omission entries (:290-310); add remediation-projection.test.ts cases for a 3 KiB .pipeline/build-stall-question.md and a 3 KiB .pipeline/test-failures.md asserting ok:true with the content excerpted, and keep the existing over-cap omission (S1.8) and structured-overflow fault (S1.7) tests passing.
**Gate:** as-built
**Rationale:** remediation-projection.ts:167 sets totalBytes=2,048 and projectionLimitFault (:231) serializes the whole projection including evidence.excerpts, while projectUntypedEvidence (:300-310) retains excerpts up to the as-built per-file/total caps (256/512 KiB), so a 3 KiB stall question or test-failures.md mechanically faults instead of following D7.3's evidence-cap-and-omission contract; approved architecture (ADR adr-2026-09-07 D7.3, plan Tasks 9/10) is authoritative and the fix is conforming implementation, so build. Task 9's omission coverage (S1.8) and Task 10's structured-overflow coverage (S1.7) are preserved; both untyped sources (build-stall and finish-verification) are covered by the one change.
**Governing clause:** adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 7
**Done when:**
- adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 7 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-as-built-ab1-1 is complete.

### Task rem-as-built-rem-as-built-ab2-1: src/conductor/src/engine/remediation-projection.ts:281-310/423-428 — make projectUntypedEvidence return a typed result ({ ok: false, detail }) for non-ENOENT read errors instead of rethrowing, and have buildRemediationProjection return preparationFault('build-stall question' | 'finish test failures', `untyped evidence is unreadable: <path>: <error>`) naming the source path; add remediation-projection.test.ts cases (EISDIR/EACCES via a directory at each path) asserting a preparation-fault for both .pipeline/build-stall-question.md and .pipeline/test-failures.md, and one conductor-remediation-typed-plan.test.ts case asserting the halt goes through haltForRemediationValidatorFault with remediate invocationCount 0; keep the ENOENT-is-absent behavior.
**Gate:** as-built
**Rationale:** remediation-projection.ts:294-297 rethrows non-ENOENT read errors from projectUntypedEvidence, and neither buildRemediationProjection (:423-428) nor conductor.ts:5121 converts them, so an unreadable build-stall-question.md or test-failures.md escapes haltForRemediationValidatorFault, contrary to D7.3's named required-input fault contract; the fix mirrors the existing safelyReadLedger pattern (:248-266) and is owned by plan Task 10, so build. ENOENT stays honest absence (Task 9 coverage preserved).
**Governing clause:** adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 7
**Done when:**
- adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 7 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-as-built-ab2-1 is complete.
