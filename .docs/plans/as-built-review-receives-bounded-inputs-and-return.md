# Implementation Plan: As-built review receives bounded inputs and returns typed verdicts (#2188)

**Date:** 2026-09-23
**Stories:** .docs/stories/as-built-review-receives-bounded-inputs-and-return.md
**Stories status:** Accepted; Stories 1-9
**Conflict check:** Clean as of 2026-09-23 (`.docs/conflicts/as-built-review-receives-bounded-inputs-and-return.md`)
**Architecture review:** `.docs/decisions/architecture-review-2026-09-23-as-built-review-receives-bounded-inputs-and-return.md` (APPROVED WITH CONDITIONS)
**Track:** technical; **Tier:** L

## Summary

This plan moves `architecture_review_as_built` onto engine-owned contracts:

- an engine-rendered, bounded, versioned input projection;
- dispatch on the #2429 native-schema one-shot path;
- an engine-validated typed verdict, persisted with its run identity as the sole authority;
- a report rendered from that verdict;
- every consumer rewired to one reader, and the Markdown judge parsers retired;
- a skill section carrying judgement guidance only, guarded by a scoped audit.

There are 27 tasks. That is above the 20-task band; the operator chose a single spec covering all seven issue outcomes at explore.

## Technical Approach

- **Three new engine modules.**
  - `as-built-contract.ts` holds the closed schema, the exact-key validator with field-named rejections, the typed-reference resolution, and the schema-derived prompt shape. Local precedent: `prd-widening-contract.ts` pairs a frozen schema object with a hand-written validator and uses no schema library. The advertised shape comes from the same schema, following `renderRubricContractShape`.
  - `as-built-projection.ts` builds the versioned, bounded projection and renders it deterministically.
  - `as-built-verdict-store.ts` persists the stamped typed verdict atomically, renders the report, and exposes `readAsBuiltVerdict`, the single reader.
- **Dispatch** reuses the one-shot skill path `remediate` uses for reconciliation (`executeProviderAwareSkillOneShot` with `nativeSchema`). It forces `interactive: false` and adds no option, adapter flag, or scratch lifecycle (adr-2026-09-07 D6.2).
- **Faults split by determinism** (operator decision OD-1):
  - **Deterministic:** an unsupported capability, or a missing, unreadable, or over-limit required input, halts before any provider call and consumes no retry.
  - **Nondeterministic:** a missing or invalid structured result, or an unresolvable reference, scores `absent` and reruns within the existing budget. It halts `needs-human` on exhaustion.
  - Auth, rate-limit, and unresolved-command classification run first.
- **Consumers are rewired in dependency order** before anything is deleted:
  1. the completion predicate;
  2. retry classification;
  3. remediation admission;
  4. serial halts;
  5. the group join;
  6. recorded findings;
  7. the shipped record;
  8. rebase, restart, and the fence;
  9. rewind and the sweep.

  Task 23 then retires the Markdown parsers under `code-removal`, so any missed reader fails to compile. Task 24 adds a repository check against reintroduction.
- **Semantics preserved:** the verdict set, the class meanings, the bounded route and its caps, the single appender, validation-group primacy, `existing-task` restage, the kill switch, and code-stamp-first preservation are unchanged. Only their input source changes (adr-2026-08-25 remediable decisions 3-5, 8, 9).
- **Freshness** for this step is the engine-stamped `attempt.id` of a validated result. There is no mtime fallback, including for a legacy Markdown-only report or with the kill switch off (run-identity D2.1, D3.1, D7.1).
- **Event spine:** reuse `verdict_freshness` (`floorSource: 'run-identity'`), `loop_halt`, `kickback`, and `gate_blocked`. No new event member and no sidecar.

## Prerequisites

- #2429 native-schema seam (shipped) and #2384 typed rubric dispatch (shipped, PR #2660): no new provider work.
- Companion story PR on branch `docs/2188-supersede-as-built-markdown-stories` merges with this spec (conflict report).

## Tasks

### Task 1: As-built verdict contract: closed schema and accepted verdict shapes
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in the new contract test file: a schema-shape test over `AS_BUILT_VERDICT_SCHEMA`, acceptance tests for an `APPROVED` result carrying production-reachability entries, an `APPROVED WITH DRIFT NOTES` result whose drift note is `UNEXERCISED` with an observation signature, a delivered `PLAN_GAP`, and a `BLOCKED` result whose only finding is `DESIGN` with no reference, plus an `expectTypeOf` test over the exported `AsBuiltVerdict` union.
2. Verify the tests fail (RED): the module does not exist.
3. Implement `src/conductor/src/engine/as-built-contract.ts`: `AS_BUILT_VERDICT_CONTRACT_VERSION` (`v1`), a frozen `AS_BUILT_VERDICT_SCHEMA` (`additionalProperties: false` at every object level; `verdict` enum; `outcomeDelivered` and `affectedOutcome` for `PLAN_GAP`; `findings[]` with `id`, `class`, optional `reference` as a `oneOf` of `{kind: "adr-decision", stem, decision: integer}` and `{kind: "plan-task", taskId}`, `summary`; `violations` and `resolution` prose; `reachability[]` entries `{primitive, callerChain}`; `driftNotes[]` entries `{note, unexercised?: {primitive, signature}}`), the discriminated `AsBuiltVerdict` union, and `validateAsBuiltVerdict(value)` returning `{ok: true, verdict}` or `{ok: false, field, requirement}`. Follow the local precedent in `prd-widening-contract.ts`: a hand-written exact-key validator beside a frozen schema object, with no schema library. The schema is the as-built verdict's own versioned contract (adr-2026-09-02 D6.1); do not import or extend the build_review finding-reference kinds.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): closed typed verdict contract"

**Done when:**
- `AS_BUILT_VERDICT_SCHEMA` in as-built-contract.ts is a frozen JSON Schema with `additionalProperties: false` whose `verdict` enum is exactly `APPROVED`, `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, `BLOCKED`, whose finding `class` enum is exactly `REMEDIABLE`, `DESIGN`, and whose finding `reference` admits exactly the two kinds `adr-decision` (with an integer `decision`) and `plan-task`, as asserted by the schema-shape test
- `validateAsBuiltVerdict` accepts an `APPROVED` result with no findings and returns it as an approved verdict carrying every production-reachability entry's primitive and caller chain, as asserted by the approved-with-reachability test
- `validateAsBuiltVerdict` accepts an `APPROVED WITH DRIFT NOTES` result and the returned drift note keeps the `UNEXERCISED` primitive and its observation signature, as asserted by the drift-notes test
- `validateAsBuiltVerdict` accepts a `PLAN_GAP` result with `outcomeDelivered: true` and an affected outcome as a delivered plan gap, and accepts a `BLOCKED` result whose only finding is `DESIGN` with no reference as a design-blocked verdict, as asserted by the plan-gap and design-only tests
- The exported `AsBuiltVerdict` type is a discriminated union on `verdict` in which `outcomeDelivered` exists only on the `PLAN_GAP` arm and `findings` only on the `BLOCKED` arm, as asserted by the `expectTypeOf` type-level test

**Files likely touched:**
- src/conductor/src/engine/as-built-contract.ts
- src/conductor/test/as-built-contract.test.ts

**Dependencies:** none

### Task 2: As-built verdict contract: field-named rejections
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in the contract test file for each rejection: `PLAN_GAP` without `outcomeDelivered`; `APPROVED` carrying `findings`; a `REMEDIABLE` finding with no `reference`; an ADR reference whose `decision` is the string `"5.2"`; an unknown `verdict`, an unknown finding `class`, and an unknown top-level key.
2. Verify the tests fail (RED).
3. Implement the rejection branches in `validateAsBuiltVerdict`, so each returns `{ok: false, field, requirement}` with the JSON path of the first offending field and the form it requires (admitted values or keys for a closed set). Rejection diagnostics name the field and never an untested cause (adr-2026-08-19-engine-stamped-rubric-judged-result-envelope D6 precedent).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): field-named contract rejections"

**Done when:**
- `validateAsBuiltVerdict` rejects a `PLAN_GAP` result lacking `outcomeDelivered` with a diagnostic whose `field` is `outcomeDelivered` and whose `requirement` names a boolean, as asserted by the missing-outcome test
- `validateAsBuiltVerdict` rejects an `APPROVED` result carrying `findings` with a diagnostic whose `field` is `findings` and whose `requirement` states findings are not permitted for that verdict, and rejects a `REMEDIABLE` finding with no reference with `field` `findings[0].reference`, as asserted by the verdict-arm tests
- `validateAsBuiltVerdict` rejects an ADR reference whose `decision` is the string `"5.2"` with `field` `findings[0].reference.decision` and a `requirement` stating a whole-number decision id is required, as asserted by the dotted-decision test
- `validateAsBuiltVerdict` rejects an unknown `verdict` value, an unknown finding `class`, and an unknown top-level key, each with a diagnostic naming that field and listing the admitted values or keys, as asserted by the closed-vocabulary tests

**Files likely touched:**
- src/conductor/src/engine/as-built-contract.ts
- src/conductor/test/as-built-contract.test.ts

**Dependencies:** Task 1

### Task 3: Resolve typed governing references against APPROVED ADRs and the active plan
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in the contract test file over a fixture worktree containing an APPROVED ADR (decisions 1-5, where decision 5 carries a `D5.2` sub-decision), a SUPERSEDED ADR, and a plan with tasks 1-3: an ADR reference to decision 4 resolves; a plan-task reference to task 2 resolves; references to the SUPERSEDED ADR, to decision 9, and to task 7 are rejected.
2. Verify the tests fail (RED).
3. Implement `resolveAsBuiltReferences(verdict, worktree)` in `as-built-contract.ts`. ADR references resolve only through `parseAdrDecisions` and `adrApprovalStatus` (adr-2026-09-02 items 1 and 3), and plan-task references only through the shared plan-task resolver (adr-2026-08-30-shared-plan-task-reference-resolver D1), with no second grammar. A failure returns the same `{ok: false, field, requirement}` shape as validation. Retain the ADR and plan lookup half of `resolveAsBuiltGoverningClause` as the implementation; its text-grammar half is retired in Task 23.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): resolve typed governing references"

**Done when:**
- `resolveAsBuiltReferences` resolves an `adr-decision` reference only through `parseAdrDecisions` and `adrApprovalStatus` and accepts a `BLOCKED` result whose `REMEDIABLE` finding names an APPROVED ADR and a decision id `parseAdrDecisions` reports, returning the finding with its resolved reference, as asserted by the adr-reference test
- `resolveAsBuiltReferences` resolves a `plan-task` reference only through the shared plan-task resolver, accepting the result when the task is present in the active plan and rejecting it with `field` `findings[0].reference.taskId` when the task is absent, as asserted by the plan-task tests
- `resolveAsBuiltReferences` rejects a reference to a SUPERSEDED ADR with `field` `findings[0].reference.stem` and a `requirement` naming the status `SUPERSEDED`, as asserted by the superseded-adr test
- `resolveAsBuiltReferences` rejects a reference to a decision id the ADR does not declare with `field` `findings[0].reference.decision` and a `requirement` listing the ADR's declared decision ids, as asserted by the undeclared-decision test

**Files likely touched:**
- src/conductor/src/engine/as-built-contract.ts
- src/conductor/test/as-built-contract.test.ts

**Dependencies:** Task 1

### Task 4: Render the reviewer-facing output shape from the verdict schema
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: the rendered shape names every property and enum member of `AS_BUILT_VERDICT_SCHEMA`; a copy of the schema with one added property yields text naming it; the text names no field the schema lacks.
2. Verify the tests fail (RED).
3. Implement `renderAsBuiltVerdictShape(schema)` in `as-built-contract.ts` by walking the schema object. This follows the precedent of `renderRubricContractShape` in `build-review-contract.ts`, whose trait is that the advertised shape is derived from the one validated schema (adr-2026-08-13 D1.2). Hand-written shape prose is not allowed.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): derive the prompt shape from the schema"

**Done when:**
- `renderAsBuiltVerdictShape(AS_BUILT_VERDICT_SCHEMA)` returns text naming every property and every enum member the schema admits, as asserted by the shape-completeness test
- `renderAsBuiltVerdictShape` names no field absent from the schema it is given, and a schema copy with one added property yields text naming that property, as asserted by the shape-derivation test

**Files likely touched:**
- src/conductor/src/engine/as-built-contract.ts
- src/conductor/test/as-built-contract.test.ts

**Dependencies:** Task 1

### Task 5: Read-only pending-findings accessor on the remediation seam
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `kickback-ledger.test.ts`: an absent ledger yields an empty list; a ledger holding two `pendingAsBuiltRemediationFindings` entries yields both; an unparseable ledger yields a typed unreadable result naming the ledger path; the ledger bytes are unchanged after the read.
2. Verify the tests fail (RED).
3. Implement `readPendingAsBuiltRemediationFindings(projectRoot)` in `kickback-ledger.ts` on top of `readKickbackLedgerResult`, the fail-closed read of adr-2026-08-31-kickback-ledger-read-fails-closed item 1. Never use the tolerant `readKickbackLedger`. The accessor is read-only; the remediation seam remains the only writer (adr-2026-08-25 remediable D7.1).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): read-only pending-findings accessor"

**Done when:**
- `readPendingAsBuiltRemediationFindings` in kickback-ledger.ts reads through `readKickbackLedgerResult` and returns an empty list when the ledger file does not exist and both entries when the ledger holds two pending findings, as asserted by the absent-and-present ledger tests
- `readPendingAsBuiltRemediationFindings` returns a typed unreadable result naming the ledger path, never an empty list, when the ledger file exists but cannot be parsed, as asserted by the unreadable-ledger test
- The ledger file's bytes are identical before and after `readPendingAsBuiltRemediationFindings` runs, as asserted by the read-only test

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts
- src/conductor/test/kickback-ledger.test.ts

**Dependencies:** none

### Task 6: Build the versioned as-built input projection
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in the new projection test file over a fully populated fixture worktree: the projection sections and version stamp; the governing-ADR set (two plan-cited APPROVED ADRs plus one ADR added in the diff); the prior-findings section from a two-entry ledger; the empty section for an absent ledger; the fault for an unparseable ledger; byte-identical text across two renders.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/as-built-projection.ts`:
   - `AS_BUILT_PROJECTION_VERSION`, `buildAsBuiltProjection(worktree, limits)` returning `{ok: true, projection}` or `{ok: false, fault: {dimension, detail, actual?, limit?}}`, and a deterministic `renderAsBuiltProjection(projection)`.
   - Reuse `parsePlanTaskBodies` and `parsePlanTaskDoneWhen` for tasks, `extractAuthoritativeStoryCriteria` for sealed criteria, `parseAdrDecisions` and `adrApprovalStatus` for ADRs, `parsePlanCoverage`/obligation-table parsing for plan-cited ADR stems, `resolveAsBuiltPolicy` for the check policy, `findArtifactFiles(..., 'architecture_diagram')` for diagram paths, and `readPendingAsBuiltRemediationFindings` (Task 5) for prior findings.
   - Take the diff at default context against the same base `rebase.ts#resolveBase` uses (adr-2026-07-23-build-review-fresh-base-disposition D1).
   - The rendered text orders every section and entry deterministically.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): engine-rendered input projection"

**Done when:**
- `buildAsBuiltProjection` over a fully populated fixture worktree returns a projection stamped with `AS_BUILT_PROJECTION_VERSION` whose sections carry the changed-file stat, the per-file hunks at default context, every plan task id with its `Done when` bullets from `parsePlanTaskDoneWhen`, the sealed story criteria, the resolved as-built check policy, and the approved diagram paths, as asserted by the populated-projection test
- The governing-ADR section equals the ADRs cited by the plan's Architecture Obligation Coverage table joined with the ADRs added in the feature diff, filtered to APPROVED, each with the decision ids and decision text `parseAdrDecisions` reports, so the fixture yields exactly three ADRs, as asserted by the governing-set test
- The prior-findings section lists both pending findings from a two-entry fixture ledger with their class, governing reference, and summary, and is empty with the projection still produced when the ledger file does not exist, as asserted by the prior-findings tests
- `buildAsBuiltProjection` over a fixture whose ledger file cannot be parsed returns `ok: false` with a mechanical fault whose `dimension` is `pending-findings` and whose detail names the ledger path, and returns no projection, as asserted by the unreadable-ledger projection test
- Two `renderAsBuiltProjection` calls over unchanged fixture inputs return byte-identical text, as asserted by the determinism test

**Files likely touched:**
- src/conductor/src/engine/as-built-projection.ts
- src/conductor/test/as-built-projection.test.ts

**Dependencies:** Task 5

### Task 7: Projection edge sets: superseded ADRs, empty governing set, no diagrams
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in the projection test file: a plan citing a SUPERSEDED ADR; a plan with no obligation table whose diff touches no ADR, in a repository that has APPROVED ADRs; a project with no architecture diagrams.
2. Verify the tests fail (RED).
3. Implement the edge handling in `buildAsBuiltProjection`: filter the governing set to APPROVED; when the set is empty, render a governing-ADR section stating that no ADR is pre-selected and that APPROVED ADRs may be read on demand. Leave `resolveAsBuiltPolicy` untouched, so `adrCompliance` keeps its repository-wide enablement and `diagramDrift` keeps its existing `no diagrams` reason (adr-2026-09-07 D7.1).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): projection edge sets"

**Done when:**
- For a plan citing a SUPERSEDED ADR, `buildAsBuiltProjection` returns `ok: true` and the governing-ADR section omits that ADR while every other section is produced as in the populated fixture, as asserted by the superseded-exclusion test
- For a plan with no Architecture Obligation Coverage table and a diff touching no ADR in a repository with APPROVED ADRs, `buildAsBuiltProjection` returns `ok: true`, the governing-ADR section is empty and its rendered text states that no ADR is pre-selected, and the projected check policy shows `adrCompliance` enabled with reason `approved ADRs present`, as asserted by the empty-governing-set test
- For a project with no architecture diagrams, `buildAsBuiltProjection` returns `ok: true` with an empty diagram section and the projected check policy shows `diagramDrift` disabled with reason `no diagrams`, as asserted by the no-diagrams test

**Files likely touched:**
- src/conductor/src/engine/as-built-projection.ts
- src/conductor/test/as-built-projection.test.ts

**Dependencies:** Task 6

### Task 8: Explicit projection limits with diff omissions and no truncation
**Story:** 1
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in the projection test file:
   - a corpus test that projects the largest plan, stories file, and governing-ADR decision set found under the repository's `.docs/` against `AS_BUILT_PROJECTION_LIMITS`;
   - a per-file hunk overflow case;
   - a total-diff overflow case;
   - an over-limit plan-task case.
2. Verify the tests fail (RED).
3. Implement `AS_BUILT_PROJECTION_LIMITS` as explicit byte constants: per-file hunks, total diff, plan tasks, story criteria, and governing-ADR decisions. Set each to at least the corpus maximum measured by the test. Diff overflow moves a file to `omittedFiles` with its path and a sha256 content digest, and the rendered text states that omitted files may be read on demand. A structured dimension over its limit returns the fault `{dimension, actual, limit}` without building partial text (adr-2026-09-07 D7.1; byte bound, never a token bound).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): explicit projection limits"

**Done when:**
- `AS_BUILT_PROJECTION_LIMITS` declares explicit byte limits for per-file hunks, total diff, plan tasks, story criteria, and governing-ADR decisions, and the corpus test projects the largest plan, stories file, and governing-ADR decision set present in the repository's `.docs/` corpus and asserts none exceeds its limit
- A changed file whose hunks exceed the per-file cap is absent from the hunks section and listed under `omittedFiles` with its path and content digest, and the rendered projection states that omitted files may be read on demand, as asserted by the per-file overflow test
- A diff over the total cap yields `ok: true` with the files beyond the cap listed under `omittedFiles` with path and digest and no fault, as asserted by the total-diff overflow test
- A plan whose `Done when` blocks exceed the plan-task limit yields `ok: false` with a fault naming the `plan-tasks` dimension, the actual size, and the limit, and no projection text is produced or truncated to fit, as asserted by the over-limit test

**Files likely touched:**
- src/conductor/src/engine/as-built-projection.ts
- src/conductor/test/as-built-projection.test.ts

**Dependencies:** Task 6

### Task 9: Deterministic input faults halt before any provider call
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests through the production conductor path with a fake provider:
   - an over-limit plan-task fixture;
   - an unreadable stories file;
   - an unparseable governing ADR;
   - a total-diff overflow fixture.
   Assert the provider call count, the halt reason and class, the retry counter, and the `loop_halt` event.
2. Verify the tests fail (RED).
3. Route a projection fault from the as-built dispatch branch to a deterministic halt in `conductor.ts`. It uses the unretryable-by-kind facet (adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D1/D3), an existing halt class, and `writeHaltMarker` with the `loop_halt` emit path. No retry is consumed and the projection is never truncated.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): deterministic input-fault halts"

**Done when:**
- An over-limit plan-task fixture run through the production conductor path for `architecture_review_as_built` makes zero fake-provider invocations and halts with a mechanical fault naming the `plan-tasks` dimension, the actual size, and the limit, as asserted by the over-limit dispatch test
- An unreadable stories file makes zero fake-provider invocations and halts naming the `story-criteria` dimension and the path, and an unparseable governing ADR makes zero invocations and halts naming that ADR and the `parseAdrDecisions` diagnostic, as asserted by the unreadable-input tests
- For each of these input faults the step-retry counter is unchanged, no second dispatch is attempted, the halt class is an existing halt class, and exactly one `loop_halt` event is emitted, as asserted by the no-retry assertions in the same tests
- A total-diff-overflow fixture invokes the fake provider exactly once with a projection listing the overflow files as omissions with path and digest, and no fault or halt is raised, as asserted by the overflow-dispatch test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/as-built-dispatch.test.ts

**Dependencies:** Task 8, Task 10

### Task 10: Dispatch the as-built step on the native-schema one-shot path
**Story:** 3
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing step-runner tests with Claude and Codex adapter fixtures:
   - an auto-mode as-built dispatch on each provider;
   - an interactive-mode dispatch;
   - assertions on the recorded `InvokeOptions`, the adapter argv, the Codex scratch schema file, and the prompt text.
2. Verify the tests fail (RED).
3. Admit `architecture_review_as_built` to the one-shot step union in `step-runners.ts`. Its branch builds the projection (Task 6); on a projection fault it returns the fault without invoking. Otherwise it calls `executeProviderAwareSkillOneShot` with `nativeSchema: AS_BUILT_VERDICT_SCHEMA` and `interactive: false` in every run mode. The prompt is the skill command plus the rendered projection block plus `renderAsBuiltVerdictShape` of the same schema object. Follow the local precedent of the `remediate` reconciliation branch (`remediationRequest` with `nativeSchema`): same executor, same scratch lifecycle, and no second option or adapter flag (adr-2026-09-07 D6.2).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): dispatch on the native-schema seam"

**Done when:**
- With a Claude candidate, the recorded `InvokeOptions` for an `architecture_review_as_built` dispatch carry `nativeSchema` identical to `AS_BUILT_VERDICT_SCHEMA` and `interactive: false`, and the Claude adapter fixture receives `--json-schema` with that schema serialized, as asserted by the claude-dispatch test
- With a Codex candidate, the Codex adapter fixture receives `--output-schema` naming a file under the invocation's engine-owned scratch home whose bytes equal the serialized schema, and that scratch home no longer exists after the invocation settles, as asserted by the codex-dispatch test
- In an interactive-mode conduct run the as-built dispatch still goes through `executeProviderAwareSkillOneShot` with `interactive: false` and `nativeSchema` attached, as asserted by the interactive-mode test
- The dispatched prompt carries exactly one projection block stamped with `AS_BUILT_PROJECTION_VERSION` and embeds the text `renderAsBuiltVerdictShape` returns for the same schema object passed as `nativeSchema`, as asserted by the prompt-contract test

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners-as-built.test.ts

**Dependencies:** Task 4, Task 6

### Task 11: Classify missing output, unsupported capability, and provider failures
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing step-runner tests with adapter fixtures:
   - a candidate lacking `nativeOutputSchema`;
   - a Claude `success: true` result with a prose verdict and no `finalStructuredResult`;
   - a Codex result reporting `structuredResultFailure: 'missing'` as a failed invocation;
   - an authentication failure;
   - a rate-limited result;
   - a zero-turn unresolved skill command.
2. Verify the tests fail (RED).
3. Implement the classification order in the as-built branch:
   1. The unsupported-capability pre-dispatch check, using the executor's `unsupportedNativeSchemaProviderResult`.
   2. The existing auth, rate-limit, and unresolved-command classification (adr-2026-07-04 D2, adr-2026-07-05-daemon-rate-limit D4, adr-2026-08-04-unresolved-step-command-fails-by-name).
   3. Missing structured result on either adapter shape scores `absent` with reason `structured-result-missing`.
   Never read the `output` prose.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): classify structured-output faults"

**Done when:**
- A candidate that does not declare the native output-schema capability makes zero provider invocations and the step halts without retry with a fault naming the provider and the missing capability, as asserted by the unsupported-capability test
- A Claude result with `success: true`, a prose `output` containing a well-formed verdict, and no `finalStructuredResult` is scored `absent` with reason `structured-result-missing` and the prose is never passed to `validateAsBuiltVerdict`, and a Codex result reporting `structuredResultFailure: 'missing'` as a failed invocation is scored `absent` with the same reason rather than a generic step failure, as asserted by the missing-result tests
- An adapter-classified authentication failure takes the existing authentication-failure path and an adapter-classified rate limit enters the existing rate-limit handling, and neither is reported as a missing or invalid structured result, as asserted by the auth and rate-limit tests
- A zero-turn result carrying the unresolved-command signal is classified as an unresolved step command and not as an invalid structured result, as asserted by the unresolved-command test

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/step-runners-as-built.test.ts

**Dependencies:** Task 10

### Task 12: Persist the stamped typed verdict and observe it in the handshake
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - an accepted structured result persists `.pipeline/architecture-review-as-built.json` with the verdict, `attempt.id`, and code stamp;
   - the post-dispatch handshake records a validated-and-persisted observation and emits `verdict_freshness` with `floorSource: 'run-identity'`;
   - a rejected result persists nothing, renders nothing, and the handshake records the rejection.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/as-built-verdict-store.ts`:
   - `AS_BUILT_VERDICT_PATH`, and `persistAsBuiltVerdict(worktree, verdict, {attemptId, codeStamp})` using an atomic temp-file plus `rename` (adr-2026-08-05-build-settle-outcome-stamp D2 precedent).
   - Wire it at the settle boundary in `step-runners.ts`/`conductor.ts`, after `validateAsBuiltVerdict` and `resolveAsBuiltReferences` accept the result.
   - Classify the JSON path as `run` evidence in `STEP_ARTIFACT_GLOBS` and the gate-code-validity sidecar contract.
   - For as-built, redefine `verdictDispatchHandshake` to observe the persisted verdict's `attemptId` rather than a provider-written file's mtime (run-identity D2.1/D3.1).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): persist the stamped typed verdict"

**Done when:**
- An accepted structured result makes `persistAsBuiltVerdict` write `.pipeline/architecture-review-as-built.json` carrying the validated verdict, this dispatch's `attempt.id`, and the reviewed HEAD's code stamp, as asserted by the persistence test
- After an accepted result the post-dispatch handshake for `architecture_review_as_built` records that this dispatch's structured result was validated and persisted, and emits a `verdict_freshness` event with `floorSource: 'run-identity'`, as asserted by the handshake test
- After a rejected result no `.pipeline/architecture-review-as-built.json` is written for that attempt, no report is rendered for it, and the handshake records the rejection outcome, as asserted by the rejected-attempt test

**Files likely touched:**
- src/conductor/src/engine/as-built-verdict-store.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/src/engine/gate-code-validity.ts
- src/conductor/test/as-built-verdict-store.test.ts

**Dependencies:** Task 3, Task 10

### Task 13: Render the human-readable report from the typed verdict
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing renderer tests for a `BLOCKED` verdict with two findings, an `APPROVED` verdict with reachability entries and drift notes, and a `PLAN_GAP` verdict. Each compares the rendered report against the typed fields and the projection's applied check policy.
2. Verify the tests fail (RED).
3. Implement `renderAsBuiltReport(verdict, policy)` in `as-built-verdict-store.ts`. Call it from `persistAsBuiltVerdict` so it writes `.pipeline/architecture-review-as-built.md` with the verdict, the outcome, findings (id, class, rendered reference, summary), violations and resolution prose, reachability entries, drift notes, and the applied check policy with each off check's reason. The report is a derived view and is never read back.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): render the report from the typed verdict"

**Done when:**
- For a persisted `BLOCKED` typed verdict with two findings, `renderAsBuiltReport` writes `.pipeline/architecture-review-as-built.md` showing the verdict, each finding's id, class, governing reference, and summary, and the violation and resolution prose, all equal to the typed fields, as asserted by the blocked-render test
- For a persisted `APPROVED` typed verdict with reachability entries and drift notes, the rendered report shows each entry's primitive and caller chain, each drift note, and the applied check policy with each off check's reason, all equal to the typed fields and the projection, as asserted by the approved-render test
- For a persisted `PLAN_GAP` typed verdict, the rendered report shows the verdict and whether the outcome was delivered, equal to the typed fields, as asserted by the plan-gap-render test

**Files likely touched:**
- src/conductor/src/engine/as-built-verdict-store.ts
- src/conductor/test/as-built-verdict-store.test.ts

**Dependencies:** Task 12

### Task 14: Completion predicate reads the typed verdict through one reader
**Story:** 5
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing completion-predicate tests:
   - typed `APPROVED`, `APPROVED WITH DRIFT NOTES`, and delivered `PLAN_GAP`;
   - a Markdown-only worktree;
   - a prior-attempt verdict whose code stamp cannot vouch for it, with a fresh mtime;
   - the gate-code-validity kill switch off;
   - a hand-edited report that disagrees with the typed verdict;
   - an unparseable JSON file.
2. Verify the tests fail (RED).
3. Implement `readAsBuiltVerdict(worktree)` in `as-built-verdict-store.ts`, returning `absent`, `unreadable` (with reason), or `present` with the verdict, `attemptId`, and `codeStamp`. Rewire the as-built completion predicate in `artifacts.ts` to it:
   - keep code-stamp-first preservation (the run-identity amendment of 2026-09-06);
   - use identity-only freshness with no mtime fallback for this step, even with the kill switch off (run-identity D7.1);
   - map the typed verdict to the existing `AsBuiltReviewOutcome` kinds through an exhaustive switch with no default arm;
   - write the code stamp via `writeArchitectureReviewAsBuiltCodeStamp` on approval.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): completion reads the typed verdict"

**Done when:**
- A typed `APPROVED` or `APPROVED WITH DRIFT NOTES` verdict satisfies the as-built completion predicate and `writeArchitectureReviewAsBuiltCodeStamp` writes the code stamp, and a typed `PLAN_GAP` verdict with `outcomeDelivered: true` satisfies it, as asserted by the satisfied-verdict tests
- A worktree holding only a reviewer-written `.pipeline/architecture-review-as-built.md` with a clean APPROVED verdict line and no JSON scores `routeClass: 'absent'` so the step reruns, and a prior-attempt typed verdict whose code stamp cannot vouch for it because the gate's surface changed, with an mtime newer than the dispatch start, scores `absent` with a reason naming both identities, as asserted by the stale-verdict tests
- With the gate-code-validity kill switch off, a prior-attempt as-built typed verdict still scores `absent` by run identity and no mtime comparison decides its freshness, as asserted by the kill-switch test
- A report edited by hand to say `APPROVED` while the typed verdict says `BLOCKED` leaves the predicate and every consumer reading `BLOCKED`, as asserted by the hand-edit test
- `readAsBuiltVerdict` returns `unreadable` for a JSON file that cannot be parsed and the predicate leaves the gate unsatisfied with an unreadable reason rather than treating the verdict as approved or empty, as asserted by the unreadable-verdict test

**Files likely touched:**
- src/conductor/src/engine/as-built-verdict-store.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/src/engine/gate-code-validity.ts
- src/conductor/test/engine/gate-predicates.test.ts

**Dependencies:** Task 12

### Task 15: Rejected results rerun, then halt needs-human on exhaustion
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests through the production conductor path with a fake provider that returns a schema-invalid result on every attempt, plus a `classifyRetryDecision` unit test for as-built.
2. Verify the tests fail (RED).
3. Score a rejected as-built result `absent`, recording the rejected field and requirement in the retry reason. Keep the existing step retry budget with a fresh session per attempt (adr-2026-07-24 D4). On exhaustion, halt `needs-human` through the existing halt seam naming the step and the last rejected field. Extend `classifyRetryDecision` so a rejected, missing, or stale-identity as-built result is `absent`, and a fresh typed non-APPROVED verdict is `named-route`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): rerun rejected results within the retry budget"

**Done when:**
- A fake provider returning a rejected result makes the attempt score `absent` with the rejected field and its requirement in the retry reason, and the next attempt starts a fresh provider session within the existing retry budget, as asserted by the rejected-rerun test
- When every attempt in the budget is rejected the loop halts `needs-human` naming `architecture_review_as_built` and the last rejected field, no typed verdict is persisted, and `planRemediation` is never invoked, as asserted by the exhausted-rejection test
- `classifyRetryDecision` scores a rejected, missing, or stale-identity as-built result `absent` and a fresh typed non-APPROVED verdict `named-route`, as asserted by the retry-classification test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/as-built-dispatch.test.ts

**Dependencies:** Task 12, Task 14

### Task 16: Remediation admission consumes typed findings
**Story:** 6
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests through the production serial path with typed verdict fixtures:
   - an all-`REMEDIABLE` `BLOCKED` verdict;
   - a finding citing ADR decision 5 of an ADR declaring `D5.2`;
   - an `existing-task` disposition;
   - an exhausted remediation lap;
   - a planner mismatch.
2. Verify the tests fail (RED).
3. Feed `planRemediation` the typed findings from `readAsBuiltVerdict` in place of the table parse. Carry each finding's typed reference into the gap's governing clause. Render the reference to the same clause text appended tasks already carry, so the appender and the `Done when` emission are unchanged. Keep the lap cap, the `existing-task` restage, the growth accounting, the kickback-cap halt, and the exact-match halt verbatim (adr-2026-08-25 remediable decisions 3-5 and 9).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): remediation admission reads typed findings"

**Done when:**
- A typed `BLOCKED` verdict whose findings are all `REMEDIABLE`, with no `manual_test` FAIL, makes `planRemediation` receive each finding with its typed governing reference, admit it under gate key `architecture_review_as_built`, and navigate back to BUILD within the gate's remediation lap cap, as asserted by the remediable-route test
- A `REMEDIABLE` finding whose reference has `decision: 5` for an ADR declaring a `D5.2` sub-decision is admitted as a remediation gap citing decision 5, as asserted by the sub-decision route test
- An `existing-task` disposition re-stages the bound task ids to `pending` in `.pipeline/task-status.json` and leaves `growth.added` unchanged, as asserted by the existing-task test
- A remediable typed verdict on a feature that has used its as-built remediation lap halts with class `kickback-cap` listing every finding, as asserted by the lap-cap test
- Planner findings that do not exactly match the typed `REMEDIABLE` findings halt `needs-human` naming the mismatch, as asserted by the mismatch test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/as-built-remediation.test.ts

**Dependencies:** Task 3, Task 14

### Task 17: Serial halts read the typed verdict
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests through the production serial path with typed verdict fixtures: an undelivered `PLAN_GAP`, a `BLOCKED` verdict with a `DESIGN` finding, and a remediable verdict with `architecture_review_as_built.remediation.enabled: false`.
2. Verify the tests fail (RED).
3. Rewire the serial halt branch in `conductor.ts` to classify from `readAsBuiltVerdict`, and build the halt body from the typed findings (id, class, rendered reference, summary). Keep today's halt classes and the switch-off behavior.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): serial halts read the typed verdict"

**Done when:**
- A typed `PLAN_GAP` verdict with `outcomeDelivered: false` halts the loop with class `plan-gap` naming the affected outcome, as asserted by the undelivered-plan-gap test
- A typed `BLOCKED` verdict containing a `DESIGN` finding halts `needs-human` with a halt body listing every finding with its class and governing reference, as asserted by the design-halt test
- With `architecture_review_as_built.remediation.enabled: false`, a typed remediable `BLOCKED` verdict halts `needs-human` with the same halt class and body shape the switch-off path produces today, as asserted by the kill-switch-halt test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/as-built-remediation.test.ts

**Dependencies:** Task 14

### Task 18: Validation-group join reads the typed verdict
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests through the production validation-group path:
   - a round with a remediable typed as-built verdict plus a `manual_test` FAIL;
   - a round whose as-built branch ends in a mechanical fault;
   - a clean typed verdict in a non-auto run.
2. Verify the tests fail (RED).
3. Rewire the group join in `conductor.ts` and `group-core.ts` to `readAsBuiltVerdict`, and point the consolidated remediation hint at the typed verdict. A mechanical fault stays a no-verdict branch with no synthetic gap (adr-2026-07-10-validation-group-join D2). Write no `review-required` marker for this step (operator decision OD-4).
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): group join reads the typed verdict"

**Done when:**
- A validation round with a typed remediable `BLOCKED` as-built verdict and a `manual_test` FAIL puts the as-built findings in the single consolidated work order and the as-built-only remediation route does not run, as asserted by the consolidated-join test
- A round whose as-built branch ends in a mechanical fault is treated as a no-verdict branch, no synthetic remediation gap is created for it, the existing step-failure handling applies, and the member is recorded `failed`, as asserted by the faulted-branch test
- A clean typed verdict in a non-auto run completes the step with no `review-required` marker written for `architecture_review_as_built`, as asserted by the no-marker test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/as-built-group.test.ts

**Dependencies:** Task 14, Task 16

### Task 19: Recorded findings are written into the typed verdict
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write a failing test: after a remediation lap whose rebuilt gate passes, run the recorded-findings projection over a typed verdict and a ledger holding pending findings.
2. Verify the test fails (RED).
3. Rewrite `projectPendingAsBuiltRemediationFindings` and `persistRecordedFindings` for as-built so they write the findings with their remediation outcomes into the typed verdict through `persistAsBuiltVerdict`, which re-renders the report. Clear the ledger's pending entries in the same step (adr-2026-08-25 remediable D6.1/D7).
4. Verify the test passes (GREEN).
5. Commit: "feat(as-built): record findings in the typed verdict"

**Done when:**
- After the rebuilt gate passes, `projectPendingAsBuiltRemediationFindings` writes each pending finding with its remediation outcome into `.pipeline/architecture-review-as-built.json`, as asserted by the recorded-findings test
- The same step re-renders `.pipeline/architecture-review-as-built.md` showing those findings and clears the kickback ledger's `pendingAsBuiltRemediationFindings`, as asserted by the recorded-findings test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/as-built-verdict-store.ts
- src/conductor/test/engine/as-built-remediation.test.ts

**Dependencies:** Task 13, Task 16

### Task 20: Shipped record reads the typed verdict
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests over `recordedShipmentFindings` and the finish publication path:
   - a delivered `PLAN_GAP`;
   - recorded remediation findings;
   - a lap with both kinds;
   - no typed verdict.
2. Verify the tests fail (RED).
3. Replace the Markdown and fenced-JSON reads in `shipment-association.ts` with `readAsBuiltVerdict`, and read it in `finish-publication-production.ts`. Keep the additive both-kinds rule (AB-R9). An absent verdict yields no as-built findings, exactly as an absent report does today.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): shipped record reads the typed verdict"

**Done when:**
- A typed `PLAN_GAP` verdict with `outcomeDelivered: true` makes the assembled shipped record include the delivered plan-gap finding, as asserted by the delivered-plan-gap record test
- Each recorded finding in the typed verdict appears in the shipped record with its class, governing reference, and outcome, and a lap that recorded both remediated findings and a delivered plan gap yields both kinds with neither displacing the other, as asserted by the recorded-findings record tests
- With no typed as-built verdict present the shipped record carries no as-built findings and finish publication proceeds exactly as it does today when the as-built report is absent, as asserted by the absent-verdict record test

**Files likely touched:**
- src/conductor/src/engine/shipment-association.ts
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/shipped-record.test.ts

**Dependencies:** Task 19

### Task 21: Rebase preservation, restart, and the pre-finish fence read the typed verdict
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - a surface-miss rebase;
   - a surface-hit rebase;
   - an orphaned code stamp;
   - a daemon restart with an approved typed verdict;
   - the pre-finish fence recomputation.
2. Verify the tests fail (RED).
3. Point `currentPreservedJudgeIdentity` in `gate-code-validity.ts`, the rebase reopen path in `rebase.ts`, the rekick path in `daemon-rekick.ts`, and `computeAndWriteVerdict` in `gate-verdicts.ts` at `readAsBuiltVerdict`. The digest covers the typed JSON, not the report.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): rebase, restart, and fence read the typed verdict"

**Done when:**
- After a rebase that leaves the as-built surface untouched with the code stamp reachable, the approved typed verdict is preserved and `architecture_review_as_built` is not re-dispatched, as asserted by the surface-miss test
- After a rebase that changes a file in the as-built surface, the typed verdict is invalidated and the step re-dispatches, as asserted by the surface-hit test
- A typed verdict whose code stamp was orphaned by an amend or reset scores `absent` and the step re-dispatches, as asserted by the orphaned-stamp test
- After a daemon restart with an approved typed verdict persisted in the current run, the feature resumes with the as-built gate satisfied and no as-built dispatch, as asserted by the restart test
- The pre-finish fence's `computeAndWriteVerdict` recomputes the as-built gate at current HEAD through `readAsBuiltVerdict`, the same reader the completion predicate uses, as asserted by the fence test

**Files likely touched:**
- src/conductor/src/engine/gate-code-validity.ts
- src/conductor/src/engine/rebase.ts
- src/conductor/src/engine/daemon-rekick.ts
- src/conductor/src/engine/gate-verdicts.ts
- src/conductor/test/engine/as-built-preservation.test.ts

**Dependencies:** Task 14

### Task 22: Rewind, rollback, and the stale sweep handle both files together
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests: an operator rewind demoting `architecture_review_as_built`; a rewind that fails after removing the typed verdict; a stale-artifact sweep for the as-built step.
2. Verify the tests fail (RED).
3. Add the typed verdict and the rendered report as one pair to the rewind's cleared set in `rewind.ts`, inside its rollback snapshot. Add the pair to `sweepStaleReviewArtifacts` in `artifacts.ts`, so neither file is removed without the other.
4. Verify the tests pass (GREEN).
5. Commit: "feat(as-built): rewind and sweep clear the verdict pair"

**Done when:**
- An operator rewind that demotes `architecture_review_as_built` removes both `.pipeline/architecture-review-as-built.json` and `.pipeline/architecture-review-as-built.md`, and the next dispatch starts with `readAsBuiltVerdict` returning `absent`, as asserted by the rewind test
- A rewind that fails after removing the typed verdict rolls back with both files restored byte-identical to their original contents, as asserted by the rewind-rollback test
- `sweepStaleReviewArtifacts` for the as-built step removes the typed verdict and the rendered report together and never leaves one without the other, as asserted by the paired-sweep test

**Files likely touched:**
- src/conductor/src/engine/rewind.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/as-built-preservation.test.ts

**Dependencies:** Task 12

### Task 23: Retire the as-built Markdown judge parsers
**Story:** 8
**Type:** refactor

**Steps:**
1. Write a failing test through the production SHIP path. The worktree holds a reviewer-written `.pipeline/architecture-review-as-built.md` with a well-formed `## Blocking Findings` table and no typed verdict. Assert that the gate scores `absent`, that `planRemediation` is not invoked, and that the shipped record carries no as-built findings.
2. Verify the test fails (RED).
3. Apply the `code-removal` skill and delete, with no deprecation shims:
   - `as-built-verdict-line.ts` and its re-export;
   - `parseAsBuiltVerdict`, and the Markdown branch of `classifyAsBuiltReviewOutcome`;
   - `parseAsBuiltBlockedFindings` and `asBuiltBlockedFindingsMechanicalFault`;
   - the governing-clause text grammar in `conductor.ts` (`stripClauseEmphasis` and the clause regex);
   - the Markdown and fenced-JSON scrapes in `shipment-association.ts`;
   - the `## Recorded Findings` write-back into the report.
   Keep `tableCells` and `isTableSeparator`, which the PRD-audit parser shares. Surviving behavior: every consumer reads `readAsBuiltVerdict`, so the test above passes.
4. Verify the test passes and the engine compiles (GREEN).
5. Commit: "refactor(as-built): retire Markdown judge parsers"

**Done when:**
- With a reviewer-written report containing a well-formed `## Blocking Findings` table and no typed verdict, the as-built gate scores `absent`, `planRemediation` is not invoked, and the shipped record carries no as-built findings, as asserted by the markdown-ignored test
- The diff deletes `src/conductor/src/engine/as-built-verdict-line.ts`, `parseAsBuiltBlockedFindings`, and the governing-clause regex in `conductor.ts`, and the engine compiles with `tsc --noEmit` against the rewired consumers

**Files likely touched:**
- src/conductor/src/engine/as-built-verdict-line.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/shipment-association.ts
- src/conductor/test/as-built-verdict.test.ts

**Dependencies:** Task 15, Task 16, Task 17, Task 18, Task 19, Task 20, Task 21, Task 22

### Task 24: Repository check forbids Markdown authority for the as-built verdict
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing fixture tests for the new check:
   - it passes on the shipped engine source;
   - it fails on a fixture engine module that reads `.pipeline/architecture-review-as-built.md` to decide a verdict;
   - it fails on a fixture module containing a regular expression that matches an as-built `Verdict:` line or a governing-clause cell.
2. Verify the tests fail (RED).
3. Implement `test/check_as_built_markdown_authority.sh`. It scans `src/conductor/src` for the report path literal outside an allowlist containing only the report writer (`as-built-verdict-store.ts`) and the paired cleanup modules (`rewind.ts`, `artifacts.ts` sweep). It also scans for regular-expression literals containing `Verdict:` or `Governing clause`. It exits non-zero naming each offending module. Wire it into `test/test_harness_integrity.sh`.
4. Verify the tests pass (GREEN).
5. Commit: "test(as-built): forbid Markdown verdict authority"

**Done when:**
- `test/check_as_built_markdown_authority.sh` exits zero on the shipped engine source, where the only modules referencing `.pipeline/architecture-review-as-built.md` are the report writer and the paired cleanup modules on its allowlist, as asserted by the shipped-source fixture test
- The check exits non-zero naming the module for a fixture engine module that reads the as-built report file to decide a verdict or route, as asserted by the report-reader fixture test
- The check exits non-zero naming the module for a fixture engine module containing a regular expression that matches an as-built `Verdict:` line or governing-clause text, as asserted by the verdict-regex fixture test
- `test/test_harness_integrity.sh` runs `test/check_as_built_markdown_authority.sh` and fails when it fails, as asserted by the integrity wiring test

**Files likely touched:**
- test/check_as_built_markdown_authority.sh
- test/test_harness_integrity.sh
- test/fixtures/as-built-markdown-authority/report-reader.ts
- test/fixtures/as-built-markdown-authority/verdict-regex.ts

**Dependencies:** Task 23

### Task 25: The as-built skill section carries judgement guidance only
**Story:** 9
**Type:** refactor

**Steps:**
1. Write failing assertions in `test/test_provider_skill_contracts.sh`, run against a fixture copy of the as-built section:
   - the required judgement content: reachability semantics with the same-file root-to-caller-to-export exception, current-source authority, and `UNEXERCISED` signatures; plan-gap semantics with sealed-story authority; verdict meanings; `REMEDIABLE` and `DESIGN` meanings; the BUILD-time-judgement ADR citations; and the interactive instruction to state a closed-set verdict with findings, classes, and governing references;
   - a fixture that drops the same-file prose fails the existing pins.
2. Verify the new required-content assertions fail against the current section (RED).
3. Rewrite §12 of `skills/architecture-review/SKILL.md`. Remove:
   - the context-budget read recipe;
   - the report template;
   - the table, column, cell, and clause grammar;
   - the mandatory-overwrite block;
   - the review-required marker instruction;
   - the format checklist items.
   Keep the judgement guidance, the delegated-evidence and validator-discipline guidance, and the ADR citations. Add one sentence for interactive use naming the closed verdict set, the finding classes, and whole-decision governing references. Do not touch §1–§11.
4. Verify the assertions pass (GREEN).
5. Commit: "docs(skill): as-built section carries judgement guidance only"

**Done when:**
- The as-built section of `skills/architecture-review/SKILL.md` contains the reachability semantics including the same-file root-to-caller-to-export exception, current-source authority, and `UNEXERCISED` observation signatures, the plan-gap semantics with sealed-story outcome authority, the meaning of each verdict, the meanings of `REMEDIABLE` and `DESIGN`, and the ADR citations for its relationship to BUILD-time judgement, as asserted by the required-content checks in `test/test_provider_skill_contracts.sh`
- The as-built section contains no bounded-read command recipe, no report template, no table header or column list, no cell-formatting or governing-clause grammar rule, no instruction to overwrite a report file, and no instruction to write a review-required marker, as asserted by the forbidden-content checks in `test/test_provider_skill_contracts.sh`
- The as-built section tells an interactive operator to state a verdict from the closed set with its findings, classes, and governing references, as asserted by the interactive-guidance check
- The existing as-built judgement-prose pins in `test/test_provider_skill_contracts.sh` pass on the rewritten skill and fail on a fixture copy whose as-built section drops the same-file root-to-caller-to-export prose, as asserted by the pin fixture test

**Files likely touched:**
- skills/architecture-review/SKILL.md
- test/test_provider_skill_contracts.sh
- test/fixtures/as-built-skill-prose/missing-same-file.md

**Dependencies:** Task 10

### Task 26: Scope the output-format audit to the as-built section
**Story:** 9
**Type:** infrastructure

**Steps:**
1. Write failing fixture tests for the new §12-scoped audit:
   - the shipped skill passes;
   - the pre-stories §8 output template does not trip it;
   - three fixtures fail, each naming the skill and the pattern: a reintroduced Blocking Findings table header row (columns `Finding`, `Class`, `Governing clause`, `Summary`), a reintroduced bounded `git diff`/`git log` read recipe, and a reintroduced `Verdict:` line template.
2. Verify the tests fail (RED).
3. Extend `test/test_provider_skill_contracts.sh` with `require_absent_pattern` checks restricted to the `### 12.` section, extracted by heading. This follows the local precedent of the build-review prose loop and its `build_review_skill_prose_audit` fixture self-test. Replace the verdict-line and `Outcome delivered:` pins in `src/conductor/test/skill-contracts.test.ts` with an assertion that the audit script contains the §12 rule.
4. Verify the tests pass (GREEN).
5. Commit: "test(skill): §12-scoped output-format audit"

**Done when:**
- The §12-scoped audit in `test/test_provider_skill_contracts.sh` passes on the shipped `skills/architecture-review/SKILL.md` and the existing as-built judgement pins also pass, as asserted by the audit run in the integrity suite
- The pre-stories review mode's `## Output` template elsewhere in the skill file does not trip the as-built format rule, as asserted by the section-scoping fixture test
- Fixture copies with a reintroduced Blocking Findings table header row (columns `Finding`, `Class`, `Governing clause`, `Summary`), a reintroduced bounded `git diff` or `git log` read recipe, and a reintroduced `Verdict:` line template in the as-built section each make the audit fail naming the skill and the forbidden pattern, as asserted by the three prose fixture tests
- `src/conductor/test/skill-contracts.test.ts` no longer requires the verdict-line or `Outcome delivered:` prose and instead asserts that the audit script carries the §12 rule, as asserted by the updated skill-contracts test

**Files likely touched:**
- test/test_provider_skill_contracts.sh
- test/fixtures/as-built-skill-prose/table-header.md
- test/fixtures/as-built-skill-prose/read-recipe.md
- test/fixtures/as-built-skill-prose/verdict-line.md
- src/conductor/test/skill-contracts.test.ts

**Dependencies:** Task 25

### Task 27: Claude and Codex produce the same typed verdict
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test that runs the as-built step once with a fake Claude adapter and once with a fake Codex adapter, both returning the same structured verdict.
2. Verify the test fails (RED).
3. No new production code is expected beyond Tasks 10-13. If the test exposes a provider-specific difference in result extraction or persistence, fix it at the adapter boundary.
4. Verify the test passes (GREEN).
5. Commit: "test(as-built): provider parity for the typed verdict"

**Done when:**
- Fake Claude and Codex adapters returning the same structured verdict make both runs persist `.pipeline/architecture-review-as-built.json` with equal verdict content, differing only in `attemptId`, as asserted by the provider-parity test
- Both runs' recorded `InvokeOptions` carry the same `nativeSchema` object and `interactive: false`, as asserted by the provider-parity test

**Files likely touched:**
- src/conductor/test/engine/step-runners-as-built.test.ts

**Dependencies:** Task 12, Task 13

## Task Dependency Graph

```text
Task  1 <- (none)
Task  2 <- 1
Task  3 <- 1
Task  4 <- 1
Task  5 <- (none)
Task  6 <- 5
Task  7 <- 6
Task  8 <- 6
Task  9 <- 8, 10
Task 10 <- 4, 6
Task 11 <- 10
Task 12 <- 3, 10
Task 13 <- 12
Task 14 <- 12
Task 15 <- 12, 14
Task 16 <- 3, 14
Task 17 <- 14
Task 18 <- 14, 16
Task 19 <- 13, 16
Task 20 <- 19
Task 21 <- 14
Task 22 <- 12
Task 23 <- 15, 16, 17, 18, 19, 20, 21, 22
Task 24 <- 23
Task 25 <- 10
Task 26 <- 25
Task 27 <- 12, 13
```

## Integration Points

- After Task 10: an as-built dispatch reaches both provider adapters with the native schema and the projection.
- After Task 14: the SHIP tail's completion predicate is satisfied from a typed verdict end to end.
- After Task 18: serial and validation-group routing run from typed verdicts.
- After Task 23: no Markdown reader remains; every consumer is on `readAsBuiltVerdict`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature worktree whose plan, sealed stories, APPROVED ADRs, diagrams, and diff are all present, when the as-built step is dispatched, then the prompt carries one projection block stamped with its projection version that contains the changed-file stat, the per-file diff hunks at default context, every plan task id with its `Done when` bullets, the sealed story criteria, the resolved as-built check policy, and the approved diagram paths. | 6, 10 | "`buildAsBuiltProjection` over a fully populated fixture worktree returns a projection stamped with `AS_BUILT_PROJECTION_VERSION` whose sections carry the changed-file stat, the per-file hunks at default context, every plan task id with its `Done when` bullets from `parsePlanTaskDoneWhen`, the sealed story criteria, the resolved as-built check policy, and the approved diagram paths, as asserted by the populated-projection test" | diff-local |
| Story 1 happy: Given a plan whose Architecture Obligation Coverage table cites two APPROVED ADRs and a feature diff that adds a third APPROVED ADR, when the projection is built, then its governing-ADR section carries exactly those three ADRs with each ADR's decision ids and decision text as `parseAdrDecisions` reports them. | 6 | "The governing-ADR section equals the ADRs cited by the plan's Architecture Obligation Coverage table joined with the ADRs added in the feature diff, filtered to APPROVED, each with the decision ids and decision text `parseAdrDecisions` reports, so the fixture yields exactly three ADRs, as asserted by the governing-set test" | diff-local |
| Story 1 happy: Given a kickback ledger holding two pending as-built remediation findings from the previous lap, when the projection is built, then both findings appear in the projection's prior-findings section with their class, governing reference, and summary. | 6 | "The prior-findings section lists both pending findings from a two-entry fixture ledger with their class, governing reference, and summary, and is empty with the projection still produced when the ledger file does not exist, as asserted by the prior-findings tests" | diff-local |
| Story 1 happy: Given a changed file whose hunks exceed the per-file diff cap, when the projection is built, then that file's hunks are omitted, the projection lists the file under omitted files with its path and content digest, and the projection states that omitted files may be read on demand. | 8 | "A changed file whose hunks exceed the per-file cap is absent from the hunks section and listed under `omittedFiles` with its path and content digest, and the rendered projection states that omitted files may be read on demand, as asserted by the per-file overflow test" | diff-local |
| Story 1 happy: Given a projection that fits every limit, when the step is dispatched twice against the same unchanged inputs, then both dispatches carry byte-identical projection blocks. | 6 | "Two `renderAsBuiltProjection` calls over unchanged fixture inputs return byte-identical text, as asserted by the determinism test" | diff-local |
| Story 1 negative: Given a plan that cites an ADR whose status is SUPERSEDED, when the projection is built, then that ADR is absent from the governing-ADR section and the projection is otherwise produced normally. | 7 | "For a plan citing a SUPERSEDED ADR, `buildAsBuiltProjection` returns `ok: true` and the governing-ADR section omits that ADR while every other section is produced as in the populated fixture, as asserted by the superseded-exclusion test" | diff-local |
| Story 1 negative: Given a feature whose plan has no Architecture Obligation Coverage table and whose diff touches no ADR, in a repository that has APPROVED ADRs, when the projection is built, then the governing-ADR section is empty and states that no ADR is pre-selected, the projection is produced, and the resolved check policy still shows `adrCompliance` on as it does today. | 7 | "For a plan with no Architecture Obligation Coverage table and a diff touching no ADR in a repository with APPROVED ADRs, `buildAsBuiltProjection` returns `ok: true`, the governing-ADR section is empty and its rendered text states that no ADR is pre-selected, and the projected check policy shows `adrCompliance` enabled with reason `approved ADRs present`, as asserted by the empty-governing-set test" | diff-local |
| Story 1 negative: Given a project with no architecture diagrams, when the projection is built, then the diagram section is empty, the check policy shows `diagramDrift` off with its existing reason, and no fault is raised. | 7 | "For a project with no architecture diagrams, `buildAsBuiltProjection` returns `ok: true` with an empty diagram section and the projected check policy shows `diagramDrift` disabled with reason `no diagrams`, as asserted by the no-diagrams test" | diff-local |
| Story 1 negative: Given a kickback ledger file that exists but cannot be parsed, when the projection is built, then the build fails with a mechanical fault naming the pending-findings dimension and the ledger path, and no projection with an empty prior-findings section is produced. | 6 | "`buildAsBuiltProjection` over a fixture whose ledger file cannot be parsed returns `ok: false` with a mechanical fault whose `dimension` is `pending-findings` and whose detail names the ledger path, and returns no projection, as asserted by the unreadable-ledger projection test" | diff-local |
| Story 1 negative: Given a kickback ledger that does not exist, when the projection is built, then the prior-findings section is empty and the projection is produced. | 6 | "The prior-findings section lists both pending findings from a two-entry fixture ledger with their class, governing reference, and summary, and is empty with the projection still produced when the ledger file does not exist, as asserted by the prior-findings tests" | diff-local |
| Story 2 happy: Given the largest plan, stories file, and governing-ADR decision set present in the repository's `.docs/` corpus, when each is projected under the shipped limits, then none exceeds its limit. | 8 | "`AS_BUILT_PROJECTION_LIMITS` declares explicit byte limits for per-file hunks, total diff, plan tasks, story criteria, and governing-ADR decisions, and the corpus test projects the largest plan, stories file, and governing-ADR decision set present in the repository's `.docs/` corpus and asserts none exceeds its limit" | diff-local |
| Story 2 happy: Given a feature whose total diff exceeds the total diff cap, when the projection is built, then the files beyond the cap are listed as omissions with path and digest, the step is dispatched, and no fault is raised. | 9 | "A total-diff-overflow fixture invokes the fake provider exactly once with a projection listing the overflow files as omissions with path and digest, and no fault or halt is raised, as asserted by the overflow-dispatch test" | diff-local |
| Story 2 negative: Given a plan whose `Done when` blocks exceed the plan-task limit, when the as-built step is about to dispatch, then no provider is invoked and the step halts with a mechanical fault naming the plan-tasks dimension, the actual size, and the limit. | 9 | "An over-limit plan-task fixture run through the production conductor path for `architecture_review_as_built` makes zero fake-provider invocations and halts with a mechanical fault naming the `plan-tasks` dimension, the actual size, and the limit, as asserted by the over-limit dispatch test" | diff-local |
| Story 2 negative: Given a feature whose sealed stories file cannot be read, when the as-built step is about to dispatch, then no provider is invoked and the step halts with a fault naming the story-criteria dimension and the path. | 9 | "An unreadable stories file makes zero fake-provider invocations and halts naming the `story-criteria` dimension and the path, and an unparseable governing ADR makes zero invocations and halts naming that ADR and the `parseAdrDecisions` diagnostic, as asserted by the unreadable-input tests" | diff-local |
| Story 2 negative: Given a governing ADR whose `## Decision` section `parseAdrDecisions` rejects as unparseable, when the as-built step is about to dispatch, then no provider is invoked and the step halts with a fault naming that ADR and the parser's diagnostic. | 9 | "An unreadable stories file makes zero fake-provider invocations and halts naming the `story-criteria` dimension and the path, and an unparseable governing ADR makes zero invocations and halts naming that ADR and the `parseAdrDecisions` diagnostic, as asserted by the unreadable-input tests" | diff-local |
| Story 2 negative: Given any of these deterministic input faults, when the step settles, then the step-retry budget is not consumed, no second dispatch is attempted, and the halt uses an existing halt class and is emitted through the existing halt event. | 9 | "For each of these input faults the step-retry counter is unchanged, no second dispatch is attempted, the halt class is an existing halt class, and exactly one `loop_halt` event is emitted, as asserted by the no-retry assertions in the same tests" | diff-local |
| Story 2 negative: Given an over-limit required dimension, when the fault is raised, then the projection is not truncated to fit and no partial projection is dispatched. | 8, 9 | "A plan whose `Done when` blocks exceed the plan-task limit yields `ok: false` with a fault naming the `plan-tasks` dimension, the actual size, and the limit, and no projection text is produced or truncated to fit, as asserted by the over-limit test" | diff-local |
| Story 3 happy: Given an as-built dispatch with a Claude candidate, when the step runs, then the recorded invocation options carry `nativeSchema` equal to the as-built output schema, `interactive` is false, and the Claude adapter fixture receives `--json-schema` with that schema serialized. | 10 | "With a Claude candidate, the recorded `InvokeOptions` for an `architecture_review_as_built` dispatch carry `nativeSchema` identical to `AS_BUILT_VERDICT_SCHEMA` and `interactive: false`, and the Claude adapter fixture receives `--json-schema` with that schema serialized, as asserted by the claude-dispatch test" | diff-local |
| Story 3 happy: Given an as-built dispatch with a Codex candidate, when the step runs, then the Codex adapter fixture receives `--output-schema` naming a file under the invocation's engine-owned scratch home whose bytes equal the serialized schema, and the scratch home is removed after the invocation settles. | 10 | "With a Codex candidate, the Codex adapter fixture receives `--output-schema` naming a file under the invocation's engine-owned scratch home whose bytes equal the serialized schema, and that scratch home no longer exists after the invocation settles, as asserted by the codex-dispatch test" | diff-local |
| Story 3 happy: Given a conduct run in interactive mode, when the as-built step is dispatched, then it still runs one-shot with `interactive` false and the native schema attached. | 10 | "In an interactive-mode conduct run the as-built dispatch still goes through `executeProviderAwareSkillOneShot` with `interactive: false` and `nativeSchema` attached, as asserted by the interactive-mode test" | diff-local |
| Story 3 happy: Given the as-built prompt, when it is rendered, then the output shape shown to the reviewer is derived from the same JSON Schema passed as `nativeSchema` and names exactly the fields and enum members that schema admits. | 10 | "The dispatched prompt carries exactly one projection block stamped with `AS_BUILT_PROJECTION_VERSION` and embeds the text `renderAsBuiltVerdictShape` returns for the same schema object passed as `nativeSchema`, as asserted by the prompt-contract test" | diff-local |
| Story 3 happy: Given identical fake Claude and Codex providers that return the same structured verdict, when the as-built step runs once with each, then both runs persist equal typed verdicts apart from run identity. | 27 | "Fake Claude and Codex adapters returning the same structured verdict make both runs persist `.pipeline/architecture-review-as-built.json` with equal verdict content, differing only in `attemptId`, as asserted by the provider-parity test" | diff-local |
| Story 3 negative: Given a selected provider candidate that does not declare the native output-schema capability, when the as-built step is about to dispatch, then no provider is invoked and the step halts without retry with a fault naming the provider and the missing capability. | 11 | "A candidate that does not declare the native output-schema capability makes zero provider invocations and the step halts without retry with a fault naming the provider and the missing capability, as asserted by the unsupported-capability test" | diff-local |
| Story 3 negative: Given a provider result with `success: true`, a prose `output` containing a well-formed verdict, and no terminal structured result, when the step settles, then the prose is not parsed and the attempt is scored `absent` with the reason that the structured result is missing. | 11 | "A Claude result with `success: true`, a prose `output` containing a well-formed verdict, and no `finalStructuredResult` is scored `absent` with reason `structured-result-missing` and the prose is never passed to `validateAsBuiltVerdict`, and a Codex result reporting `structuredResultFailure: 'missing'` as a failed invocation is scored `absent` with the same reason rather than a generic step failure, as asserted by the missing-result tests" | diff-local |
| Story 3 negative: Given a Codex invocation that requested the schema and ends with the adapter reporting a missing structured result as a failed invocation, when the step settles, then the attempt is scored `absent` with the same missing-structured-result reason as the Claude case and is not handled as a generic step failure. | 11 | "A Claude result with `success: true`, a prose `output` containing a well-formed verdict, and no `finalStructuredResult` is scored `absent` with reason `structured-result-missing` and the prose is never passed to `validateAsBuiltVerdict`, and a Codex result reporting `structuredResultFailure: 'missing'` as a failed invocation is scored `absent` with the same reason rather than a generic step failure, as asserted by the missing-result tests" | diff-local |
| Story 3 negative: Given a provider result that the adapter classifies as an authentication failure, when the step settles, then it is handled by the existing authentication-failure path and is not reported as a missing or invalid structured result. | 11 | "An adapter-classified authentication failure takes the existing authentication-failure path and an adapter-classified rate limit enters the existing rate-limit handling, and neither is reported as a missing or invalid structured result, as asserted by the auth and rate-limit tests" | diff-local |
| Story 3 negative: Given a provider result that the adapter classifies as rate limited, when the step settles, then it enters the existing rate-limit handling and is not reported as a missing or invalid structured result. | 11 | "An adapter-classified authentication failure takes the existing authentication-failure path and an adapter-classified rate limit enters the existing rate-limit handling, and neither is reported as a missing or invalid structured result, as asserted by the auth and rate-limit tests" | diff-local |
| Story 3 negative: Given a skill command the provider cannot resolve (zero turns), when the step settles, then it is classified as an unresolved step command and not as an invalid structured result. | 11 | "A zero-turn result carrying the unresolved-command signal is classified as an unresolved step command and not as an invalid structured result, as asserted by the unresolved-command test" | diff-local |
| Story 4 happy: Given a structured result with verdict `APPROVED`, no findings, and production-reachability entries each naming a changed primitive and its caller chain, when it is validated, then it is accepted as an approved verdict carrying those entries. | 1 | "`validateAsBuiltVerdict` accepts an `APPROVED` result with no findings and returns it as an approved verdict carrying every production-reachability entry's primitive and caller chain, as asserted by the approved-with-reachability test" | diff-local |
| Story 4 happy: Given a structured result with verdict `APPROVED WITH DRIFT NOTES` whose drift notes include an `UNEXERCISED` primitive with its observation signature, when it is validated, then it is accepted and the drift note keeps the primitive and the signature. | 1 | "`validateAsBuiltVerdict` accepts an `APPROVED WITH DRIFT NOTES` result and the returned drift note keeps the `UNEXERCISED` primitive and its observation signature, as asserted by the drift-notes test" | diff-local |
| Story 4 happy: Given a structured result with verdict `PLAN_GAP`, `outcomeDelivered` true, and a recorded affected outcome, when it is validated, then it is accepted as a delivered plan gap. | 1 | "`validateAsBuiltVerdict` accepts a `PLAN_GAP` result with `outcomeDelivered: true` and an affected outcome as a delivered plan gap, and accepts a `BLOCKED` result whose only finding is `DESIGN` with no reference as a design-blocked verdict, as asserted by the plan-gap and design-only tests" | diff-local |
| Story 4 happy: Given a structured result with verdict `BLOCKED` and one `REMEDIABLE` finding whose reference is `{kind: "adr-decision", stem, decision}` naming an APPROVED ADR and a decision id `parseAdrDecisions` reports for it, when it is validated, then it is accepted and the finding carries the resolved reference. | 3 | "`resolveAsBuiltReferences` resolves an `adr-decision` reference only through `parseAdrDecisions` and `adrApprovalStatus` and accepts a `BLOCKED` result whose `REMEDIABLE` finding names an APPROVED ADR and a decision id `parseAdrDecisions` reports, returning the finding with its resolved reference, as asserted by the adr-reference test" | diff-local |
| Story 4 happy: Given an APPROVED ADR whose decision 5 carries a sub-decision written `D5.2`, when the projection lists that ADR's decisions and the reviewer cites it, then the reference's `decision` field is the whole number 5, the schema admits only whole numbers for that field, and the finding enters the bounded remediation route against decision 5. | 16, 1, 6 | "A `REMEDIABLE` finding whose reference has `decision: 5` for an ADR declaring a `D5.2` sub-decision is admitted as a remediation gap citing decision 5, as asserted by the sub-decision route test" | diff-local |
| Story 4 happy: Given a `BLOCKED` result whose `REMEDIABLE` finding references `{kind: "plan-task", taskId}` naming a task present in the active plan, when it is validated, then the reference resolves through the shared plan-task resolver and the result is accepted. | 3 | "`resolveAsBuiltReferences` resolves a `plan-task` reference only through the shared plan-task resolver, accepting the result when the task is present in the active plan and rejecting it with `field` `findings[0].reference.taskId` when the task is absent, as asserted by the plan-task tests" | diff-local |
| Story 4 happy: Given a `BLOCKED` result with one `DESIGN` finding carrying no reference, when it is validated, then it is accepted as a design-blocked verdict. | 1 | "`validateAsBuiltVerdict` accepts a `PLAN_GAP` result with `outcomeDelivered: true` and an affected outcome as a delivered plan gap, and accepts a `BLOCKED` result whose only finding is `DESIGN` with no reference as a design-blocked verdict, as asserted by the plan-gap and design-only tests" | diff-local |
| Story 4 negative: Given a `PLAN_GAP` result with no `outcomeDelivered` field, when it is validated, then it is rejected with a diagnostic naming `outcomeDelivered` and the form it requires. | 2 | "`validateAsBuiltVerdict` rejects a `PLAN_GAP` result lacking `outcomeDelivered` with a diagnostic whose `field` is `outcomeDelivered` and whose `requirement` names a boolean, as asserted by the missing-outcome test" | diff-local |
| Story 4 negative: Given an `APPROVED` result that carries a findings array, when it is validated, then it is rejected with a diagnostic naming `findings` as not permitted for that verdict. | 2 | "`validateAsBuiltVerdict` rejects an `APPROVED` result carrying `findings` with a diagnostic whose `field` is `findings` and whose `requirement` states findings are not permitted for that verdict, and rejects a `REMEDIABLE` finding with no reference with `field` `findings[0].reference`, as asserted by the verdict-arm tests" | diff-local |
| Story 4 negative: Given a `BLOCKED` result whose `REMEDIABLE` finding has no reference, when it is validated, then it is rejected with a diagnostic naming `findings[0].reference`. | 2 | "`validateAsBuiltVerdict` rejects an `APPROVED` result carrying `findings` with a diagnostic whose `field` is `findings` and whose `requirement` states findings are not permitted for that verdict, and rejects a `REMEDIABLE` finding with no reference with `field` `findings[0].reference`, as asserted by the verdict-arm tests" | diff-local |
| Story 4 negative: Given a `BLOCKED` result whose ADR reference names a SUPERSEDED ADR, when it is validated, then it is rejected naming `findings[0].reference.stem` and the ADR's status. | 3 | "`resolveAsBuiltReferences` rejects a reference to a SUPERSEDED ADR with `field` `findings[0].reference.stem` and a `requirement` naming the status `SUPERSEDED`, as asserted by the superseded-adr test" | diff-local |
| Story 4 negative: Given a `BLOCKED` result whose ADR reference names a decision id the ADR does not declare, when it is validated, then it is rejected naming `findings[0].reference.decision` and listing the ADR's decision ids. | 3 | "`resolveAsBuiltReferences` rejects a reference to a decision id the ADR does not declare with `field` `findings[0].reference.decision` and a `requirement` listing the ADR's declared decision ids, as asserted by the undeclared-decision test" | diff-local |
| Story 4 negative: Given a `BLOCKED` result whose plan-task reference names a task absent from the active plan, when it is validated, then it is rejected naming `findings[0].reference.taskId`. | 3 | "`resolveAsBuiltReferences` resolves a `plan-task` reference only through the shared plan-task resolver, accepting the result when the task is present in the active plan and rejecting it with `field` `findings[0].reference.taskId` when the task is absent, as asserted by the plan-task tests" | diff-local |
| Story 4 negative: Given a `BLOCKED` result whose ADR reference gives `decision` as the string `"5.2"`, when it is validated, then it is rejected naming `findings[0].reference.decision` and stating that a whole-number decision id is required. | 2 | "`validateAsBuiltVerdict` rejects an ADR reference whose `decision` is the string `"5.2"` with `field` `findings[0].reference.decision` and a `requirement` stating a whole-number decision id is required, as asserted by the dotted-decision test" | diff-local |
| Story 4 negative: Given a result with an unknown verdict value, an unknown finding class, or a top-level key outside the contract, when it is validated, then it is rejected naming that field and the admitted values or keys. | 2 | "`validateAsBuiltVerdict` rejects an unknown `verdict` value, an unknown finding `class`, and an unknown top-level key, each with a diagnostic naming that field and listing the admitted values or keys, as asserted by the closed-vocabulary tests" | diff-local |
| Story 4 negative: Given a result that the engine rejects, when the step settles, then the attempt is scored `absent`, the rejected field and its requirement are recorded in the retry reason, and the step reruns in a fresh session within its existing retry budget. | 15 | "A fake provider returning a rejected result makes the attempt score `absent` with the rejected field and its requirement in the retry reason, and the next attempt starts a fresh provider session within the existing retry budget, as asserted by the rejected-rerun test" | diff-local |
| Story 4 negative: Given every retry in the budget ends in a rejected result, when the budget is exhausted, then the step halts `needs-human` naming the as-built step and the last rejected field, and no consumer ever reads a rejected result as a verdict. | 15 | "When every attempt in the budget is rejected the loop halts `needs-human` naming `architecture_review_as_built` and the last rejected field, no typed verdict is persisted, and `planRemediation` is never invoked, as asserted by the exhausted-rejection test" | diff-local |
| Story 5 happy: Given an accepted structured result, when the step settles, then the engine persists the typed verdict under `.pipeline/` stamped with this dispatch's `attempt.id` and the reviewed HEAD's code stamp. | 12 | "An accepted structured result makes `persistAsBuiltVerdict` write `.pipeline/architecture-review-as-built.json` carrying the validated verdict, this dispatch's `attempt.id`, and the reviewed HEAD's code stamp, as asserted by the persistence test" | diff-local |
| Story 5 happy: Given a persisted `BLOCKED` typed verdict with two findings, when the report is rendered, then `.pipeline/architecture-review-as-built.md` shows the verdict, each finding's id, class, governing reference, and summary, and the prose violation and resolution text, all equal to the typed fields. | 13 | "For a persisted `BLOCKED` typed verdict with two findings, `renderAsBuiltReport` writes `.pipeline/architecture-review-as-built.md` showing the verdict, each finding's id, class, governing reference, and summary, and the violation and resolution prose, all equal to the typed fields, as asserted by the blocked-render test" | diff-local |
| Story 5 happy: Given a persisted `APPROVED` typed verdict with production-reachability entries and drift notes, when the report is rendered, then the report shows each reachability entry's primitive and caller chain, each drift note, and the applied check policy with each off check's reason, all equal to the typed fields and the projection. | 13 | "For a persisted `APPROVED` typed verdict with reachability entries and drift notes, the rendered report shows each entry's primitive and caller chain, each drift note, and the applied check policy with each off check's reason, all equal to the typed fields and the projection, as asserted by the approved-render test" | diff-local |
| Story 5 happy: Given a persisted `PLAN_GAP` typed verdict, when the report is rendered, then the report shows the verdict and whether the outcome was delivered, equal to the typed fields. | 13 | "For a persisted `PLAN_GAP` typed verdict, the rendered report shows the verdict and whether the outcome was delivered, equal to the typed fields, as asserted by the plan-gap-render test" | diff-local |
| Story 5 happy: Given an accepted result, when the post-dispatch handshake runs, then it records that this dispatch's structured result was validated and persisted, on the existing freshness event with the run-identity floor source. | 12 | "After an accepted result the post-dispatch handshake for `architecture_review_as_built` records that this dispatch's structured result was validated and persisted, and emits a `verdict_freshness` event with `floorSource: 'run-identity'`, as asserted by the handshake test" | diff-local |
| Story 5 negative: Given a worktree holding only a reviewer-written `.pipeline/architecture-review-as-built.md` with a clean APPROVED verdict line and no typed verdict, when the completion check runs, then the gate is scored `absent` and the step reruns rather than passing. | 14 | "A worktree holding only a reviewer-written `.pipeline/architecture-review-as-built.md` with a clean APPROVED verdict line and no JSON scores `routeClass: 'absent'` so the step reruns, and a prior-attempt typed verdict whose code stamp cannot vouch for it because the gate's surface changed, with an mtime newer than the dispatch start, scores `absent` with a reason naming both identities, as asserted by the stale-verdict tests" | diff-local |
| Story 5 negative: Given a typed verdict stamped with a previous attempt's identity whose code stamp cannot vouch for it because the gate's surface changed since that stamp, and whose file mtime is newer than the current dispatch start, when the completion check runs, then it is scored `absent` with a reason naming both identities. | 14 | "A worktree holding only a reviewer-written `.pipeline/architecture-review-as-built.md` with a clean APPROVED verdict line and no JSON scores `routeClass: 'absent'` so the step reruns, and a prior-attempt typed verdict whose code stamp cannot vouch for it because the gate's surface changed, with an mtime newer than the dispatch start, scores `absent` with a reason naming both identities, as asserted by the stale-verdict tests" | diff-local |
| Story 5 negative: Given the gate-code-validity kill switch is turned off, when the as-built completion check runs against an engine-written typed verdict from a previous attempt, then run-identity checking still applies to the as-built step, the verdict is scored `absent`, and no mtime comparison decides freshness. | 14 | "With the gate-code-validity kill switch off, a prior-attempt as-built typed verdict still scores `absent` by run identity and no mtime comparison decides its freshness, as asserted by the kill-switch test" | diff-local |
| Story 5 negative: Given a rendered report that has been edited by hand to say `APPROVED` while the typed verdict says `BLOCKED`, when any consumer evaluates the gate, then the consumer acts on `BLOCKED`. | 14 | "A report edited by hand to say `APPROVED` while the typed verdict says `BLOCKED` leaves the predicate and every consumer reading `BLOCKED`, as asserted by the hand-edit test" | diff-local |
| Story 5 negative: Given a dispatch whose structured result is rejected, when the step settles, then no typed verdict is persisted for that attempt, no report is rendered for it, and the handshake records the rejection outcome. | 12 | "After a rejected result no `.pipeline/architecture-review-as-built.json` is written for that attempt, no report is rendered for it, and the handshake records the rejection outcome, as asserted by the rejected-attempt test" | diff-local |
| Story 5 negative: Given the typed verdict file exists but cannot be parsed, when any consumer reads it, then the read reports it as unreadable and the gate is not satisfied, rather than treating the verdict as approved or empty. | 14 | "`readAsBuiltVerdict` returns `unreadable` for a JSON file that cannot be parsed and the predicate leaves the gate unsatisfied with an unreadable reason rather than treating the verdict as approved or empty, as asserted by the unreadable-verdict test" | diff-local |
| Story 6 happy: Given a typed `APPROVED` or `APPROVED WITH DRIFT NOTES` verdict, when the completion predicate runs, then the gate is satisfied and the as-built code stamp is written. | 14 | "A typed `APPROVED` or `APPROVED WITH DRIFT NOTES` verdict satisfies the as-built completion predicate and `writeArchitectureReviewAsBuiltCodeStamp` writes the code stamp, and a typed `PLAN_GAP` verdict with `outcomeDelivered: true` satisfies it, as asserted by the satisfied-verdict tests" | diff-local |
| Story 6 happy: Given a typed `PLAN_GAP` verdict with `outcomeDelivered` true, when the completion predicate runs, then the gate is satisfied. | 14 | "A typed `APPROVED` or `APPROVED WITH DRIFT NOTES` verdict satisfies the as-built completion predicate and `writeArchitectureReviewAsBuiltCodeStamp` writes the code stamp, and a typed `PLAN_GAP` verdict with `outcomeDelivered: true` satisfies it, as asserted by the satisfied-verdict tests" | diff-local |
| Story 6 happy: Given a typed `BLOCKED` verdict whose findings are all `REMEDIABLE` and no `manual_test` FAIL in the same validation round, when the gate settles, then `planRemediation` receives each finding with its typed governing reference, admits it under gate key `architecture_review_as_built`, and navigates back to BUILD within the gate's remediation lap cap. | 16 | "A typed `BLOCKED` verdict whose findings are all `REMEDIABLE`, with no `manual_test` FAIL, makes `planRemediation` receive each finding with its typed governing reference, admit it under gate key `architecture_review_as_built`, and navigate back to BUILD within the gate's remediation lap cap, as asserted by the remediable-route test" | diff-local |
| Story 6 happy: Given a typed `BLOCKED` verdict with a `REMEDIABLE` finding whose remedy the planner dispositions as `existing-task`, when the kickback runs, then the bound task ids are re-staged to pending and no plan-growth allowance is charged. | 16 | "An `existing-task` disposition re-stages the bound task ids to `pending` in `.pipeline/task-status.json` and leaves `growth.added` unchanged, as asserted by the existing-task test" | diff-local |
| Story 6 happy: Given a validation round with a typed `BLOCKED` remediable as-built verdict and a `manual_test` FAIL, when the join settles, then the as-built findings ride the single consolidated work order and the as-built-only route does not run. | 18 | "A validation round with a typed remediable `BLOCKED` as-built verdict and a `manual_test` FAIL puts the as-built findings in the single consolidated work order and the as-built-only remediation route does not run, as asserted by the consolidated-join test" | diff-local |
| Story 6 happy: Given a clean typed verdict in a non-auto run, when the step completes, then no review-required marker is written for the as-built step and the step completes as it does today. | 18 | "A clean typed verdict in a non-auto run completes the step with no `review-required` marker written for `architecture_review_as_built`, as asserted by the no-marker test" | diff-local |
| Story 6 negative: Given a typed `PLAN_GAP` verdict with `outcomeDelivered` false, when the gate settles, then the loop halts with class `plan-gap` naming the affected outcome. | 17 | "A typed `PLAN_GAP` verdict with `outcomeDelivered: false` halts the loop with class `plan-gap` naming the affected outcome, as asserted by the undelivered-plan-gap test" | diff-local |
| Story 6 negative: Given a typed `BLOCKED` verdict containing a `DESIGN` finding, when the gate settles, then the loop halts `needs-human` and the halt body lists every finding with its class and governing reference. | 17 | "A typed `BLOCKED` verdict containing a `DESIGN` finding halts `needs-human` with a halt body listing every finding with its class and governing reference, as asserted by the design-halt test" | diff-local |
| Story 6 negative: Given a typed `BLOCKED` remediable verdict on a feature that has already used its as-built remediation lap, when the gate settles, then the loop halts with class `kickback-cap` listing every finding. | 16 | "A remediable typed verdict on a feature that has used its as-built remediation lap halts with class `kickback-cap` listing every finding, as asserted by the lap-cap test" | diff-local |
| Story 6 negative: Given the as-built remediation kill switch is disabled in config, when a typed `BLOCKED` remediable verdict settles, then the loop halts `needs-human` exactly as it does today with the switch off. | 17 | "With `architecture_review_as_built.remediation.enabled: false`, a typed remediable `BLOCKED` verdict halts `needs-human` with the same halt class and body shape the switch-off path produces today, as asserted by the kill-switch-halt test" | diff-local |
| Story 6 negative: Given a validation round in which the as-built branch ends in a mechanical fault, when the join settles, then the group treats it as a no-verdict branch, no synthetic remediation gap is created for it, and the existing step-failure handling applies. | 18 | "A round whose as-built branch ends in a mechanical fault is treated as a no-verdict branch, no synthetic remediation gap is created for it, the existing step-failure handling applies, and the member is recorded `failed`, as asserted by the faulted-branch test" | diff-local |
| Story 6 negative: Given the planner returns remediation findings that do not match the typed `REMEDIABLE` findings exactly, when admission runs, then the loop halts `needs-human` naming the mismatch, as it does today. | 16 | "Planner findings that do not exactly match the typed `REMEDIABLE` findings halt `needs-human` naming the mismatch, as asserted by the mismatch test" | diff-local |
| Story 7 happy: Given a typed `PLAN_GAP` verdict with `outcomeDelivered` true, when the shipped record is assembled at finish, then the record includes the delivered plan-gap finding. | 20 | "A typed `PLAN_GAP` verdict with `outcomeDelivered: true` makes the assembled shipped record include the delivered plan-gap finding, as asserted by the delivered-plan-gap record test" | diff-local |
| Story 7 happy: Given a typed verdict with pending remediation findings that the rebuilt gate has now passed, when the recorded-findings projection runs, then the findings with their remediation outcomes are written into the typed verdict, the report is re-rendered showing them, and the kickback ledger's pending entries are cleared in the same step. | 19 | "After the rebuilt gate passes, `projectPendingAsBuiltRemediationFindings` writes each pending finding with its remediation outcome into `.pipeline/architecture-review-as-built.json`, as asserted by the recorded-findings test" | diff-local |
| Story 7 happy: Given the recorded findings in the typed verdict, when the shipped record is assembled, then each finding appears with its class, governing reference, and outcome. | 20 | "Each recorded finding in the typed verdict appears in the shipped record with its class, governing reference, and outcome, and a lap that recorded both remediated findings and a delivered plan gap yields both kinds with neither displacing the other, as asserted by the recorded-findings record tests" | diff-local |
| Story 7 happy: Given an approved typed verdict whose code stamp remains reachable after a rebase that did not touch the gate's surface, when the SHIP tail resumes, then the verdict is preserved and the as-built step is not re-dispatched. | 21 | "After a rebase that leaves the as-built surface untouched with the code stamp reachable, the approved typed verdict is preserved and `architecture_review_as_built` is not re-dispatched, as asserted by the surface-miss test" | diff-local |
| Story 7 happy: Given a daemon restart after an approved typed verdict was persisted in the current run, when the feature resumes, then the as-built gate is satisfied from the typed verdict without re-dispatch. | 21 | "After a daemon restart with an approved typed verdict persisted in the current run, the feature resumes with the as-built gate satisfied and no as-built dispatch, as asserted by the restart test" | diff-local |
| Story 7 happy: Given a finish attempt, when the pre-finish fence recomputes the as-built gate at current HEAD, then it reads the typed verdict through the same reader as the completion predicate. | 21 | "The pre-finish fence's `computeAndWriteVerdict` recomputes the as-built gate at current HEAD through `readAsBuiltVerdict`, the same reader the completion predicate uses, as asserted by the fence test" | diff-local |
| Story 7 negative: Given an operator rewind that demotes the as-built step, when the rewind completes, then both the typed verdict and the rendered report are removed and the next dispatch starts without a prior verdict. | 22 | "An operator rewind that demotes `architecture_review_as_built` removes both `.pipeline/architecture-review-as-built.json` and `.pipeline/architecture-review-as-built.md`, and the next dispatch starts with `readAsBuiltVerdict` returning `absent`, as asserted by the rewind test" | diff-local |
| Story 7 negative: Given an operator rewind that demotes the as-built step and fails after removing the typed verdict, when the rewind rolls back, then the typed verdict and the rendered report are restored with their original contents. | 22 | "A rewind that fails after removing the typed verdict rolls back with both files restored byte-identical to their original contents, as asserted by the rewind-rollback test" | diff-local |
| Story 7 negative: Given a rebase that changes a file in the as-built gate's surface, when the SHIP tail resumes, then the typed verdict is invalidated and the step re-dispatches. | 21 | "After a rebase that changes a file in the as-built surface, the typed verdict is invalidated and the step re-dispatches, as asserted by the surface-hit test" | diff-local |
| Story 7 negative: Given a stale-artifact sweep for the as-built step, when the sweep removes the verdict, then it removes the typed verdict and the rendered report together and never leaves one without the other. | 22 | "`sweepStaleReviewArtifacts` for the as-built step removes the typed verdict and the rendered report together and never leaves one without the other, as asserted by the paired-sweep test" | diff-local |
| Story 7 negative: Given a typed verdict whose code stamp has been orphaned by an amend or reset, when the SHIP tail resumes, then the verdict is scored `absent` and the step re-dispatches. | 21 | "A typed verdict whose code stamp was orphaned by an amend or reset scores `absent` and the step re-dispatches, as asserted by the orphaned-stamp test" | diff-local |
| Story 7 negative: Given a finish run in which no typed as-built verdict is present, when the shipped record is assembled, then the record carries no as-built findings and publication proceeds exactly as it does today when the as-built report is absent. | 20 | "With no typed as-built verdict present the shipped record carries no as-built findings and finish publication proceeds exactly as it does today when the as-built report is absent, as asserted by the absent-verdict record test" | diff-local |
| Story 7 negative: Given a typed verdict that records both remediated findings and a delivered plan gap from the same lap, when the shipped record is assembled, then the record carries both kinds and neither displaces the other. | 20 | "Each recorded finding in the typed verdict appears in the shipped record with its class, governing reference, and outcome, and a lap that recorded both remediated findings and a delivered plan gap yields both kinds with neither displacing the other, as asserted by the recorded-findings record tests" | diff-local |
| Story 8 happy: Given the engine source after this change, when the repository integrity check runs, then no engine module reads `.pipeline/architecture-review-as-built.md` other than the report renderer's writer and the paired cleanup paths, and the check passes. | 24 | "`test/check_as_built_markdown_authority.sh` exits zero on the shipped engine source, where the only modules referencing `.pipeline/architecture-review-as-built.md` are the report writer and the paired cleanup modules on its allowlist, as asserted by the shipped-source fixture test" | diff-local |
| Story 8 happy: Given a reviewer-written Markdown file containing a well-formed `## Blocking Findings` table and no typed verdict, when the SHIP tail evaluates the as-built gate, then neither the gate, the remediation planner, nor the shipped record acts on the table. | 23 | "With a reviewer-written report containing a well-formed `## Blocking Findings` table and no typed verdict, the as-built gate scores `absent`, `planRemediation` is not invoked, and the shipped record carries no as-built findings, as asserted by the markdown-ignored test" | diff-local |
| Story 8 negative: Given an engine module that is changed to read the as-built report file to decide a verdict or route, when the repository integrity check runs, then the check fails naming the module. | 24 | "The check exits non-zero naming the module for a fixture engine module that reads the as-built report file to decide a verdict or route, as asserted by the report-reader fixture test" | diff-local |
| Story 8 negative: Given an engine module that is changed to match an as-built verdict line or governing-clause text with a regular expression, when the repository integrity check runs, then the check fails naming the module. | 24 | "The check exits non-zero naming the module for a fixture engine module containing a regular expression that matches an as-built `Verdict:` line or governing-clause text, as asserted by the verdict-regex fixture test" | diff-local |
| Story 9 happy: Given the as-built section of the skill, when it is read, then it contains the reachability semantics (including the same-file root-to-caller-to-export exception, current-source authority, and UNEXERCISED observation signatures), the plan-gap semantics with sealed-story outcome authority, the meanings of each verdict, the meanings of `REMEDIABLE` and `DESIGN`, and the citation of the ADRs that define its relationship to BUILD-time judgement. | 25 | "The as-built section of `skills/architecture-review/SKILL.md` contains the reachability semantics including the same-file root-to-caller-to-export exception, current-source authority, and `UNEXERCISED` observation signatures, the plan-gap semantics with sealed-story outcome authority, the meaning of each verdict, the meanings of `REMEDIABLE` and `DESIGN`, and the ADR citations for its relationship to BUILD-time judgement, as asserted by the required-content checks in `test/test_provider_skill_contracts.sh`" | diff-local |
| Story 9 happy: Given the as-built section, when it is read, then it contains no bounded-read command recipe, no report template, no table header or column list, no cell-formatting or governing-clause grammar rule, no instruction to overwrite a report file, and no instruction to write a review-required marker. | 25 | "The as-built section contains no bounded-read command recipe, no report template, no table header or column list, no cell-formatting or governing-clause grammar rule, no instruction to overwrite a report file, and no instruction to write a review-required marker, as asserted by the forbidden-content checks in `test/test_provider_skill_contracts.sh`" | diff-local |
| Story 9 happy: Given the provider skill-contract audit, when it runs on the shipped skill, then it passes, and the existing pins on the as-built judgement prose also pass. | 26 | "The §12-scoped audit in `test/test_provider_skill_contracts.sh` passes on the shipped `skills/architecture-review/SKILL.md` and the existing as-built judgement pins also pass, as asserted by the audit run in the integrity suite" | diff-local |
| Story 9 happy: Given the pre-stories review mode's output template elsewhere in the same skill file, when the audit runs, then the template does not trip the as-built format rule. | 26 | "The pre-stories review mode's `## Output` template elsewhere in the skill file does not trip the as-built format rule, as asserted by the section-scoping fixture test" | diff-local |
| Story 9 happy: Given an operator using `/architecture-review --as-built` outside the engine, when they read the section, then it tells them to state a verdict from the closed set with its findings, classes, and governing references, so the skill stays usable interactively. | 25 | "The as-built section tells an interactive operator to state a verdict from the closed set with its findings, classes, and governing references, as asserted by the interactive-guidance check" | diff-local |
| Story 9 negative: Given a copy of the skill with a Blocking Findings table header row (columns `Finding`, `Class`, `Governing clause`, `Summary`) reintroduced into the as-built section, when the audit runs on it, then it fails naming the skill and the forbidden pattern. | 26 | "Fixture copies with a reintroduced Blocking Findings table header row (columns `Finding`, `Class`, `Governing clause`, `Summary`), a reintroduced bounded `git diff` or `git log` read recipe, and a reintroduced `Verdict:` line template in the as-built section each make the audit fail naming the skill and the forbidden pattern, as asserted by the three prose fixture tests" | diff-local |
| Story 9 negative: Given a copy of the skill with a bounded `git diff` or `git log` read recipe reintroduced into the as-built section, when the audit runs on it, then it fails naming the forbidden pattern. | 26 | "Fixture copies with a reintroduced Blocking Findings table header row (columns `Finding`, `Class`, `Governing clause`, `Summary`), a reintroduced bounded `git diff` or `git log` read recipe, and a reintroduced `Verdict:` line template in the as-built section each make the audit fail naming the skill and the forbidden pattern, as asserted by the three prose fixture tests" | diff-local |
| Story 9 negative: Given a copy of the skill with a `Verdict:` line template reintroduced into the as-built section, when the audit runs on it, then it fails naming the forbidden pattern. | 26 | "Fixture copies with a reintroduced Blocking Findings table header row (columns `Finding`, `Class`, `Governing clause`, `Summary`), a reintroduced bounded `git diff` or `git log` read recipe, and a reintroduced `Verdict:` line template in the as-built section each make the audit fail naming the skill and the forbidden pattern, as asserted by the three prose fixture tests" | diff-local |
| Story 9 negative: Given a copy of the skill whose as-built section drops the same-file root-to-caller-to-export judgement prose, when the existing provider contract pins run, then they fail. | 25 | "The existing as-built judgement-prose pins in `test/test_provider_skill_contracts.sh` pass on the rewritten skill and fail on a fixture copy whose as-built section drops the same-file root-to-caller-to-export prose, as asserted by the pin fixture test" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D1 | task | task-1 | `AS_BUILT_VERDICT_SCHEMA` in as-built-contract.ts is a frozen JSON Schema with `additionalProperties: false` whose `verdict` enum is exactly `APPROVED`, `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, `BLOCKED`, whose finding `class` enum is exactly `REMEDIABLE`, `DESIGN`, and whose finding `reference` admits exactly the two kinds `adr-decision` (with an integer `decision`) and `plan-task`, as asserted by the schema-shape test |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D2 | task | task-15 | A fake provider returning a rejected result makes the attempt score `absent` with the rejected field and its requirement in the retry reason, and the next attempt starts a fresh provider session within the existing retry budget, as asserted by the rejected-rerun test |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D3 | task | task-16 | A typed `BLOCKED` verdict whose findings are all `REMEDIABLE`, with no `manual_test` FAIL, makes `planRemediation` receive each finding with its typed governing reference, admit it under gate key `architecture_review_as_built`, and navigate back to BUILD within the gate's remediation lap cap, as asserted by the remediable-route test |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D4 | task | task-16 | A remediable typed verdict on a feature that has used its as-built remediation lap halts with class `kickback-cap` listing every finding, as asserted by the lap-cap test |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D5 | existing | none | `planRemediation` through `appendRemediationTasks` remains the only plan appender; this feature changes only the source of the findings it receives (Task 16), not the appender |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | task | task-19 | After the rebuilt gate passes, `projectPendingAsBuiltRemediationFindings` writes each pending finding with its remediation outcome into `.pipeline/architecture-review-as-built.json`, as asserted by the recorded-findings test |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D7 | task | task-5 | `readPendingAsBuiltRemediationFindings` returns a typed unreadable result naming the ledger path, never an empty list, when the ledger file exists but cannot be parsed, as asserted by the unreadable-ledger test |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D8 | task | task-18 | A validation round with a typed remediable `BLOCKED` as-built verdict and a `manual_test` FAIL puts the as-built findings in the single consolidated work order and the as-built-only remediation route does not run, as asserted by the consolidated-join test |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D9 | task | task-16 | An `existing-task` disposition re-stages the bound task ids to `pending` in `.pipeline/task-status.json` and leaves `growth.added` unchanged, as asserted by the existing-task test |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D1 | existing | none | the provider-lifecycle `attempt.id` minted per dispatch is reused unchanged as the as-built run identity |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D2 | task | task-12 | An accepted structured result makes `persistAsBuiltVerdict` write `.pipeline/architecture-review-as-built.json` carrying the validated verdict, this dispatch's `attempt.id`, and the reviewed HEAD's code stamp, as asserted by the persistence test |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D3 | task | task-12 | After an accepted result the post-dispatch handshake for `architecture_review_as_built` records that this dispatch's structured result was validated and persisted, and emits a `verdict_freshness` event with `floorSource: 'run-identity'`, as asserted by the handshake test |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D4 | task | task-21 | The pre-finish fence's `computeAndWriteVerdict` recomputes the as-built gate at current HEAD through `readAsBuiltVerdict`, the same reader the completion predicate uses, as asserted by the fence test |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D5 | task | task-14 | A worktree holding only a reviewer-written `.pipeline/architecture-review-as-built.md` with a clean APPROVED verdict line and no JSON scores `routeClass: 'absent'` so the step reruns, and a prior-attempt typed verdict whose code stamp cannot vouch for it because the gate's surface changed, with an mtime newer than the dispatch start, scores `absent` with a reason naming both identities, as asserted by the stale-verdict tests |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D6 | no-change | none | clear-and-rerun recovery is unchanged; a prior-identity typed verdict is absent input exactly as a prior-identity report was |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D7 | task | task-14 | With the gate-code-validity kill switch off, a prior-attempt as-built typed verdict still scores `absent` by run identity and no mtime comparison decides its freshness, as asserted by the kill-switch test |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D8 | no-change | none | manual_test append-only attempts and the HEAD-movement whitewash guard are untouched by this feature |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D9 | task | task-12 | After an accepted result the post-dispatch handshake for `architecture_review_as_built` records that this dispatch's structured result was validated and persisted, and emits a `verdict_freshness` event with `floorSource: 'run-identity'`, as asserted by the handshake test |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | no-change | none | PRD-widening authority records are untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | no-change | none | the remediation-case store and its envelope are untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | no-change | none | over-scope decision capture is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | legacy widening authority is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | no-change | none | the unmatched-NC reconciliation judgment is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | task | task-10 | With a Claude candidate, the recorded `InvokeOptions` for an `architecture_review_as_built` dispatch carry `nativeSchema` identical to `AS_BUILT_VERDICT_SCHEMA` and `interactive: false`, and the Claude adapter fixture receives `--json-schema` with that schema serialized, as asserted by the claude-dispatch test |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | task | task-8 | `AS_BUILT_PROJECTION_LIMITS` declares explicit byte limits for per-file hunks, total diff, plan tasks, story criteria, and governing-ADR decisions, and the corpus test projects the largest plan, stories file, and governing-ADR decision set present in the repository's `.docs/` corpus and asserts none exceeds its limit |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | no-change | none | widening relationship freshness and classification are untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | no-change | none | widening recovery and observability are untouched; as-built halts reuse the existing halt seam |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | the #2429 delivery boundary is untouched; this feature is the D6.2 consumer of its seam |
| adr-2026-09-02-adr-decision-citability-contract#D1 | task | task-3 | `resolveAsBuiltReferences` resolves an `adr-decision` reference only through `parseAdrDecisions` and `adrApprovalStatus` and accepts a `BLOCKED` result whose `REMEDIABLE` finding names an APPROVED ADR and a decision id `parseAdrDecisions` reports, returning the finding with its resolved reference, as asserted by the adr-reference test |
| adr-2026-09-02-adr-decision-citability-contract#D2 | no-change | none | `parseAdrDecisions` accepted shapes and its corpus test are untouched |
| adr-2026-09-02-adr-decision-citability-contract#D3 | task | task-3 | `resolveAsBuiltReferences` rejects a reference to a decision id the ADR does not declare with `field` `findings[0].reference.decision` and a `requirement` listing the ADR's declared decision ids, as asserted by the undeclared-decision test |
| adr-2026-09-02-adr-decision-citability-contract#D4 | no-change | none | the land-time citability gate is untouched |
| adr-2026-09-02-adr-decision-citability-contract#D5 | no-change | none | the ADR template's decision forms are untouched |
| adr-2026-09-02-adr-decision-citability-contract#D6 | task | task-1 | `AS_BUILT_VERDICT_SCHEMA` in as-built-contract.ts is a frozen JSON Schema with `additionalProperties: false` whose `verdict` enum is exactly `APPROVED`, `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, `BLOCKED`, whose finding `class` enum is exactly `REMEDIABLE`, `DESIGN`, and whose finding `reference` admits exactly the two kinds `adr-decision` (with an integer `decision`) and `plan-task`, as asserted by the schema-shape test |
| adr-2026-09-02-adr-decision-citability-contract#D7 | no-change | none | headingless legacy ADRs stay uncitable and untouched; the projection carries only plan-cited ADRs, whose decisions the land gate already requires to be citable, and ADRs added in the diff, which the land-time citability gate validates |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of 2-5 single-line falsifiable checks naming a mechanism
- [x] Dependencies are explicit and acyclic
- [x] Every citable decision of the four amended ADRs has exactly one Architecture Obligation Coverage row (35)
- [x] No task directs an amendment to another feature's sealed artifact
