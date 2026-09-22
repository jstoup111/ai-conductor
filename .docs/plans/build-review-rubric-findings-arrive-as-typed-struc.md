# Implementation Plan: build_review rubric findings arrive as typed, structurally keyed output (#2384)

**Date:** 2026-09-22
**Design:** .docs/architecture/build-review-rubric-findings-arrive-as-typed-struc.md
**Architecture review:** .docs/decisions/architecture-review-2026-09-22-build-review-rubric-findings-arrive-as-typed-struc.md
**Stories:** .docs/stories/build-review-rubric-findings-arrive-as-typed-struc.md
**Conflict check:** Clean as of 2026-09-22 (one degrading overlap accepted under adr-2026-08-19 D7.1)

## Summary

Put every build_review catalog member — built-in `testQuality` and `security`, custom-policy `custom-v1` — on one engine-owned rubric contract descriptor, dispatch all of them through the provider's native structured output via the #2429 `nativeSchema` seam, reject an invalid structured result naming the field under the mechanical-fault lane, strip the duplicate result-contract prose from the two skills, and bind the descriptor to the skill text through the integrity audits. Sixteen tasks across the build_review contract, registry, domain, coordinator, step-runner, provider-execution, event, skill, and audit surfaces. Finding identity and `contractVersion: v3` are preserved.

## Technical Approach

- **Descriptor (Tasks 1-3).** `RubricContractDescriptor` in a new `build-review-contract.ts`: `projection {version, build}`, `output {version, jsonSchema, parse}`, `identity {canonicalize}`. Built-in descriptors wrap the existing per-rubric projection branches and canonicalizers, so behavior is unchanged and the new type is the only new surface; `resolveBuildReviewContractCatalog` fails at authoring time on a missing part or duplicate id. The judged v3 JSON Schema is generated per rubric from `BUILD_REVIEW_FINDING_VOCABULARIES` with `additionalProperties: false` and exactly the four provider fields (adr-2026-08-19 D2.3); the custom-v1 schema uses `oneOf` over `custom-findings` and `unsupported-policy`. `renderRubricContractShape` walks the schema to produce the prompt text, so the advertised and accepted contracts have one source (adr-2026-08-13 D1.1). Search hints: `BUILD_REVIEW_RUBRIC_REGISTRY`, `deriveBuildReviewRubricProjections`, `canonicalizeBuildReviewFindingIdentity`, `BUILD_REVIEW_CUSTOM_REVIEWER_PAYLOAD_SCHEMA`, `renderBuildReviewPolicyContract`.
- **Dispatch (Tasks 4-6).** One `dispatchRubricContract` in `step-runners.ts` replaces the built-in `dispatchBuildReviewRubric` body and the custom-policy dispatch. Prompt = policy bundle + skill invocation + rendered shape + projection view; `InvokeOptions.nativeSchema = descriptor.output.jsonSchema`; payload = `invoked.finalStructuredResult` only. The adapters, `provider-execution.ts` capability gate, and the Codex scratch-home lifecycle are reused exactly as the PRD-widening consumer uses them (adr-2026-09-07 D6.1) — pattern to follow: the `remediate` step's `nativeSchema: reconciliation.nativeSchema` wiring and its "returned no native structured result" failure; allowed variation: where the build_review classification of that failure lives. Task 6 applies `code-removal` to the prose scrape, the repair turn, and the prose shape renderers (adr-2026-08-19 D7.1); the `remediate` step keeps its own use of the scrape helper.
- **Rejection and faults (Tasks 7-10).** `describeBuildReviewJudgedResultRejection` runs over the parsed structured result with the existing enumerated-problem shape plus root-object and duplicate-identity checks (adr-2026-08-19 D6). Two closed causes join the total `satisfies`-checked mapping (adr-2026-08-18-mechanical D2.2): `invalid-structured-result` is retryable under the three-lap bound; `native-schema-unsupported` is deterministic per lap and follows `projection-oversized`'s charged-once shape (D3.1). Both ride `build_review_rubric_mechanical_fault` with an optional `rejection` field; no new event type.
- **Custom parity (Task 11).** The custom member's `output.parse` routes to the existing custom parser and stamper; `unsupported-policy` stays a distinct branch result kind. Identity grammar, case-v2, and coverage identity are untouched (adr-2026-09-10 D7.1).
- **Skills, identity, audits (Tasks 12-15).** Both SKILL.md files lose `## Result contract (v3)` and their shape-asserting verification items and keep every concern-kind definition under `## Judgement` (adr-2026-08-16 D5.1, adr-2026-08-19 D10.1). The skill digest is a cache-key component, so cached judgements miss once; `contractVersion` stays v3 and dispositions keep matching (Task 13). The provider-contract audit gains `require_absent_pattern` rules over the three prose shapes with negative fixtures; the vocabulary guard compares the descriptor enum (read from the built dist) against the skill definitions both ways and keeps its three fail-closed modes.
- **Interactivity and parity (Task 16).** Rubric branches pin `interactive: false` so the Claude adapter's interactive `nativeSchemaUnsupported` refusal is unreachable in production and observable under test; Claude and Codex fixtures prove byte-identical stamping from equivalent structured results.
- **Sequencing.** Task 1 is the root; 2 and 3 hang off it; 4 joins 2 and 3; 5, 6, 9, 16 hang off 4; 7 off 2; 8 off 4 and 7; 10 off 9; 11 off 3 and 7; 12 off 2; 13 off 7; 14 off 12; 15 off 2 and 12. BUILD can fan out 2 and 3, then 5/6/7/9/12 concurrently.
- **Cross-boundary integration ownership.** Task 4 owns the build_review step → provider-execution boundary (dispatch through `runBuildReview` with recorded `InvokeOptions`); Task 5 owns the provider-execution → adapter boundary (argv fixtures); Task 8 owns the coordinator → step-runner fault routing through `runBuildReview`; Task 14 and Task 15 own the integrity-suite boundary by running the shell audits.

## Prerequisites

- #1986 (portable policy) and #2429 (`nativeSchema` seam) are merged on main; no open prerequisite.

## Tasks

### Task 1: A rubric contract descriptor type carried by every built-in registry entry
**Story:** Story 1 — the testQuality and security members expose a descriptor (projection v3, output v3, frozen JSON Schema, identity canonicalizer) and catalog resolution fails naming a member with a missing part or a duplicated id.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-contract.test.ts`: (a) `BUILD_REVIEW_RUBRIC_REGISTRY.testQuality.contract` and `.security.contract` each carry `projection.version === "v3"`, `output.version === "v3"`, an `Object.isFrozen` JSON Schema, and `identity.canonicalize(fixedFinding).id` equal to `canonicalizeBuildReviewFindingIdentity(fixedFinding).id`; (b) `resolveBuildReviewContractCatalog` over a registry entry whose `contract.output.jsonSchema` is absent throws naming the member and `output.jsonSchema`; (c) two entries with the same rubric id throw naming the duplicated id.
2. Verify RED: the `contract` member and `resolveBuildReviewContractCatalog` do not exist.
3. Implement: add `src/conductor/src/engine/build-review-contract.ts` exporting `RubricContractDescriptor` (`projection: {version, build}`, `output: {version, jsonSchema, parse}`, `identity: {canonicalize}`) and `resolveBuildReviewContractCatalog(members)` that validates every part is present and ids are unique; attach a descriptor to each `BUILD_REVIEW_RUBRIC_REGISTRY` entry in `build-review-registry.ts` whose `projection.build` wraps the existing per-rubric branch of `deriveBuildReviewRubricProjections` and whose `identity.canonicalize` wraps `canonicalizeBuildReviewFindingIdentity`. The JSON Schema object is supplied by Task 2; until then the registry imports a placeholder constant that Task 2 replaces.
4. Verify GREEN, then commit: "build_review: rubric contract descriptor on every registry entry".

**Done when:**
- `build-review-registry.ts` entries `testQuality` and `security` each carry a `contract` descriptor with `projection.version` and `output.version` both `v3` and a frozen `output.jsonSchema`, as asserted by the descriptor-shape test
- `contract.identity.canonicalize` on each built-in descriptor returns the same `id` as `canonicalizeBuildReviewFindingIdentity` for the fixed finding fixture, as asserted by the identity-parity test
- `resolveBuildReviewContractCatalog` in build-review-contract.ts throws naming the member and the missing part when `output.jsonSchema` is absent, and throws naming the duplicated id when two members share one, as asserted by the missing-part and duplicate-id tests

**Files likely touched:**
- `src/conductor/src/engine/build-review-contract.ts`
- `src/conductor/src/engine/build-review-registry.ts`
- `src/conductor/test/engine/build-review-contract.test.ts`

**Dependencies:** none

### Task 2: The judged v3 output JSON Schema is closed to the four provider fields and the engine vocabularies
**Story:** Story 1 — the rendered prompt shape is derived from the descriptor JSON Schema and names exactly the keys and enum members the schema admits; the judged v3 schema top-level properties are exactly the four closed provider fields.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-contract.test.ts`: (a) `BUILD_REVIEW_JUDGED_V3_SCHEMA.properties` own keys deep-equal `["findings","relocationAudit","counterfactualSensitivity","scopeResolutions"]` and `additionalProperties === false`; (b) for each built-in rubric the schema's `findings.items.properties.concernKind.enum` deep-equals `BUILD_REVIEW_FINDING_VOCABULARIES[rubric]`; (c) `renderRubricContractShape(descriptor)` output contains every top-level key and every enum member of the schema and no key or member outside it, checked by tokenizing the rendered text; (d) a schema variant with an extra top-level key fails test (a).
2. Verify RED: the schema constant and `renderRubricContractShape` do not exist.
3. Implement: in `build-review-domain.ts` add `BUILD_REVIEW_JUDGED_V3_SCHEMA` (frozen JSON Schema built per rubric from `BUILD_REVIEW_FINDING_VOCABULARIES`, the content-region anchor object with `path`, `contentHash`, `display`, optional `occurrence`, optional integer `confidence` 0-100, `counterfactualSensitivity` enum, `scopeResolutions` item shape) and `renderRubricContractShape(descriptor)` in build-review-contract.ts that walks the schema to render the prompt text; point each registry descriptor's `output.jsonSchema` at the per-rubric schema. Keep the schema inside the JSON Schema subset both provider CLIs document (object, array, string, integer, enum, required, additionalProperties; no `oneOf` for the built-in shape).
4. Verify GREEN, then commit: "build_review: judged v3 JSON Schema closed to the provider field set".

**Done when:**
- `BUILD_REVIEW_JUDGED_V3_SCHEMA` in build-review-domain.ts has top-level `properties` exactly `findings`, `relocationAudit`, `counterfactualSensitivity`, `scopeResolutions` with `additionalProperties: false`, as asserted by the closed-field-set test
- each built-in schema's `concernKind` enum deep-equals `BUILD_REVIEW_FINDING_VOCABULARIES` for that rubric, as asserted by the enum-parity test
- `renderRubricContractShape` in build-review-contract.ts renders text whose tokens include every schema top-level key and enum member and nothing outside them, as asserted by the rendered-shape token test

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/src/engine/build-review-contract.ts`
- `src/conductor/src/engine/build-review-registry.ts`
- `src/conductor/test/engine/build-review-contract.test.ts`

**Dependencies:** Task 1

### Task 3: custom-v1 is a descriptor whose reviewer shape is rendered from its JSON Schema
**Story:** Story 5 — a resolved custom member exposes a v1 descriptor admitting custom-findings and unsupported-policy, and the policy contract renders the reviewer-facing shape from that schema.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-policy-contract.test.ts` and `build-review-contract.test.ts`: (a) a resolved custom member's `contract.output.version === "v1"` and its `jsonSchema` admits (via a minimal in-test JSON Schema walker over `oneOf`) both `{kind:"custom-findings",version:"v1",findings:[]}` and `{kind:"unsupported-policy",requirement:"x"}`; (b) `renderBuildReviewPolicyContract` output names exactly `kind`, `version`, `findings` for the findings payload and `kind`, `requirement` for the alternative, tokenized from the schema, and no other top-level key; (c) `contract.identity.canonicalize` returns the same `custom-v1` id as `stampBuildReviewCustomJudgedResult` produces for a fixed finding.
2. Verify RED: the custom member carries no `contract` and the policy contract renders from `BUILD_REVIEW_CUSTOM_REVIEWER_PAYLOAD_SCHEMA`.
3. Implement: add `BUILD_REVIEW_CUSTOM_V1_SCHEMA` (JSON Schema with `oneOf` over the two payload kinds, bounds from the existing `MAX_CUSTOM_*` constants) in build-review-domain.ts; in `build-review-policy-resolver.ts` attach a `RubricContractDescriptor` to each resolved custom member (projection = the frozen-input view already built, output = the v1 schema plus the existing custom parser, identity = the existing custom canonicalizer); in `build-review-policy-contract.ts` render the reviewer shape with `renderRubricContractShape(descriptor)`. The key-list constant loses its last caller here and is deleted in Task 6.
4. Verify GREEN, then commit: "build_review: custom-v1 reviewer contract is a descriptor rendered from its schema".

**Done when:**
- a resolved custom member in build-review-policy-resolver.ts carries a descriptor with `output.version` `v1` whose JSON Schema admits both the `custom-findings` payload and the `unsupported-policy` alternative, as asserted by the custom-descriptor test
- `renderBuildReviewPolicyContract` renders the reviewer shape from the custom descriptor's JSON Schema naming exactly `kind`, `version`, `findings` and `kind`, `requirement`, as asserted by the rendered-custom-shape test
- the custom descriptor's `identity.canonicalize` returns the same `custom-v1` id as the pre-change stamping path for the fixed finding, as asserted by the custom-identity-parity test

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/src/engine/build-review-policy-resolver.ts`
- `src/conductor/src/engine/build-review-policy-contract.ts`
- `src/conductor/test/engine/build-review-policy-contract.test.ts`
- `src/conductor/test/engine/build-review-contract.test.ts`

**Dependencies:** Task 1

### Task 4: One generic dispatch passes the descriptor schema natively and reads only the structured result
**Story:** Story 2 — every member is dispatched through one function that sets nativeSchema from the descriptor, the stamped findings come from finalStructuredResult, prose is never parsed, and the custom branch still carries the policy bundle before the skill invocation.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-step.test.ts` with a recording fake provider: (a) dispatching a `testQuality` branch records `InvokeOptions.nativeSchema` deep-equal to the descriptor's `output.jsonSchema`; (b) a fake result with `finalStructuredResult` = payload A and `output` = prose wrapping payload B yields a stamped result whose findings equal A and the prose parser spy is never called; (c) a fake result with `success: true`, prose payload, and no `finalStructuredResult` is rejected with a rejection whose field is the root and whose problem says a structured result is required; (d) a `custom-v1` branch is dispatched through the same exported function (spy on `dispatchRubricContract`) and its prompt begins with the policy bundle text followed by the skill invocation.
2. Verify RED: `nativeSchema` is not set and findings come from `extractJudgedResultCandidate(invoked.output)`.
3. Implement: in `step-runners.ts` replace the built-in `dispatchBuildReviewRubric` body and the custom-policy dispatch with one `dispatchRubricContract(branch, descriptor, projection)` that assembles prompt = policy bundle + skill invocation + `renderRubricContractShape` + projection view, invokes with `nativeSchema: descriptor.output.jsonSchema`, and hands `invoked.finalStructuredResult` to `descriptor.output.parse`; a missing or non-object structured result is a rejection at the root (Task 7 owns the diagnosis wording). Do not import the prose-scrape helper.
4. Verify GREEN, then commit: "build_review: one native-schema dispatch for every rubric contract".

**Done when:**
- `dispatchRubricContract` in step-runners.ts sets `InvokeOptions.nativeSchema` to the descriptor's `output.jsonSchema` for a built-in branch, as asserted by the recorded-options test
- the stamped result's findings equal `finalStructuredResult` and the prose `output` is never parsed when both carry a payload, as asserted by the structured-wins test
- a successful result with a prose payload and no `finalStructuredResult` is rejected at the root as requiring a structured result, as asserted by the absent-structured-result test
- a `custom-v1` branch passes through the same `dispatchRubricContract` function with the policy bundle text preceding the skill invocation in its prompt, as asserted by the shared-dispatch test

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/src/engine/build-review-coordinator.ts`
- `src/conductor/test/engine/build-review-step.test.ts`

**Dependencies:** Task 2, Task 3

### Task 5: Both provider adapters receive the descriptor schema and settle the scratch file
**Story:** Story 2 — the Claude fixture receives --json-schema with the serialized descriptor schema, the Codex fixture receives --output-schema naming a file under the engine-owned scratch home whose bytes equal the schema and which is removed after settlement, a scratch-home failure is a mechanical fault, and a Codex stream without a structured item is a failure.
**Type:** happy-path

**Steps:**
1. Write failing fixture tests in `src/conductor/test/execution/claude-provider.test.ts` and `codex-provider.test.ts` driven through `provider-execution.ts`: (a) a rubric invocation with `nativeSchema` = the `security` descriptor schema records `--json-schema <serialized>` on the Claude argv; (b) the Codex argv carries `--output-schema <path>` where `<path>` is under the invocation scratch home and its bytes equal the serialized schema, and after settlement the path no longer exists; (c) a scratch home whose creation is forced to fail yields a candidate result `success: false` whose reason names the scratch home and no file exists outside the scratch directory; (d) a Codex `exec --json` fixture that requested a schema and ends with no structured item settles `success: false` naming the missing structured result, with `output` still holding the transcript.
2. Verify RED: no build_review invocation reaches the adapters with `nativeSchema` (a, b fail on argv), and (c) has no build_review-specific classification.
3. Implement: the adapters already honor `nativeSchema`; the work is the fixture wiring through `provider-execution.ts` for a rubric candidate and, in `build-review-coordinator.ts`, classifying a scratch-home failure (`nativeSchemaScratch` teardown/creation error) as a mechanical fault with `detail` naming the scratch home. Reuse the existing `unsupportedNativeSchemaProviderResult` and scratch lifecycle unchanged.
4. Verify GREEN, then commit: "build_review: adapter fixtures prove the descriptor schema reaches both providers".

**Done when:**
- the Claude fixture argv carries `--json-schema` with the serialized descriptor schema for a rubric invocation, as asserted by the claude-argv test
- the Codex fixture argv carries `--output-schema` naming a file under the invocation scratch home whose bytes equal the serialized schema and which does not exist after settlement, as asserted by the codex-argv and scratch-removed tests
- a forced scratch-home creation failure settles the branch as a mechanical fault whose detail names the scratch home and leaves no file outside the scratch directory, as asserted by the scratch-failure test
- a Codex stream that requested a schema and ends without a structured item settles `success: false` naming the missing structured result while `output` retains the transcript, as asserted by the missing-structured-item test

**Files likely touched:**
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/src/engine/build-review-coordinator.ts`
- `src/conductor/test/execution/claude-provider.test.ts`
- `src/conductor/test/execution/codex-provider.test.ts`

**Dependencies:** Task 4

### Task 6: Retire the prose scrape, the repair turn, and the prose shape renderers from build_review
**Story:** Story 2 — the build_review dispatch module has no import of the scrape helper and a rejected branch makes exactly one invocation with no repair prompt.
**Type:** refactor

**Steps:**
1. Apply the `code-removal` skill. Write the surviving-behavior tests first in `src/conductor/test/engine/build-review-step.test.ts`: (a) the build_review dispatch path's module source (read via `fs`) matches no `extractJudgedResultCandidate` identifier; (b) a branch whose structured result is rejected records exactly one `invoke` call on the fake provider and no second prompt containing the word `repair`; (c) the security and testQuality prompts contain the descriptor-rendered shape and no text from the retired `renderBuildReviewProviderPayloadShape`.
2. Verify RED: (a) and (c) fail because the scrape helper and prose renderers are still imported; (b) fails because the repair turn re-invokes.
3. Implement the deletion: remove the build_review call sites of `extractJudgedResultCandidate` (the remediate-step callers outside build_review are untouched), delete the repair-turn block and `validateRubricOutput` predicate, `RUBRIC_REPAIR_PROMPT_EXCERPT_CAP_BYTES`, `renderBuildReviewProviderPayloadShape`, `renderBuildReviewJudgedResultShape`, `renderBuildReviewCustomReviewerPayloadShape`, and `BUILD_REVIEW_CUSTOM_REVIEWER_PAYLOAD_SCHEMA` with their now-orphaned tests. Surviving behavior: every rubric still dispatches, validates, stamps, and settles through Task 4's path.
4. Verify GREEN, then commit: "build_review: remove prose scrape, repair turn, and prose shape renderers".

**Done when:**
- the build_review dispatch source in step-runners.ts contains no reference to the prose-scrape extraction helper, as asserted by the no-scrape-import test
- a branch whose structured result is rejected makes exactly one provider invocation and sends no repair prompt, as asserted by the single-invocation test
- the rubric prompt carries the descriptor-rendered shape and none of the retired prose shape text, as asserted by the prompt-shape test

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/src/engine/build-review-policy-contract.ts`
- `src/conductor/test/engine/build-review-step.test.ts`
- `src/conductor/test/engine/build-review-domain.test.ts`

**Dependencies:** Task 4

### Task 7: The rejection diagnosis runs over the structured result and names the field
**Story:** Story 3 — a hash absent from the projection, an out-of-enum concernKind, a duplicate identity, and a non-object root are each rejected naming the field path and the form required, and an unexplained rejection names no untested cause.
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-domain.test.ts`: (a) a structured result whose finding anchor `contentHash` is not in the projection is rejected with a problem whose `field` is `findings[0].anchor.locus.contentHash` and whose `required` says it must equal a projected hash; (b) a `concernKind` outside the enum yields `field` `findings[0].concernKind` with the admitted members listed; (c) two findings canonicalizing to one id yield a problem naming the duplicate id; (d) a root that is a JSON string yields `field` `$` requiring an object; (e) a rejection no enumerated check explains is reported as `unexplained` and its problem list names no field absent from the payload.
2. Verify RED: the diagnosis takes a scraped candidate and has no root-shape or structured-result entry point.
3. Implement: make `describeBuildReviewJudgedResultRejection` and `parseBuildReviewJudgedResult` in build-review-domain.ts accept the descriptor's parsed structured result, add the root-object check and the duplicate-identity check as enumerated problems, and keep the `MAX_REJECTION_PROBLEMS` cap and the unexplained fallback unchanged. `descriptor.output.parse` for the built-in members calls this pair.
4. Verify GREEN, then commit: "build_review: field-named rejection over the structured result".

**Done when:**
- `describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test
- an out-of-enum `concernKind` is rejected naming `findings[0].concernKind` with the admitted members listed, as asserted by the enum-rejection test
- two findings that canonicalize to one identity are rejected naming the duplicate id, and a string root is rejected at `$` requiring an object, as asserted by the duplicate-identity and root-shape tests
- a rejection no enumerated check explains is reported as unexplained and names no field absent from the payload, as asserted by the unexplained-rejection test

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/test/engine/build-review-domain.test.ts`

**Dependencies:** Task 2

### Task 8: An invalid structured result settles absent under the mechanical-fault lane
**Story:** Story 3 — invalid-structured-result publishes no aggregate, charges no kickback, ticks no cap, carries the rejection on the fault event, halts needs-human after three laps, and leaves a clean sibling rubric intact.
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-step.test.ts` through `runBuildReview`: (a) a lap whose only rubric is rejected settles the branch `absent` with reason `invalid-structured-result`, writes no aggregate verdict for that rubric, leaves the kickback ledger count and the convergence counter unchanged, and increments `mechanicalFaults` by one; (b) the emitted `build_review_rubric_mechanical_fault` event carries the field-named rejection; (c) three consecutive such laps return the `needs-human` halt shape naming the rubric and cause; (d) a lap with one rejected rubric and one clean rubric with a finding retains the clean rubric's judged result and marks only the rejected rubric `absent`.
2. Verify RED: the coordinator classifies a rejected structured result under the retired `invalid-provider-result` path.
3. Implement: in `build-review-coordinator.ts` add `invalid-structured-result` to `BuildReviewInfrastructureFailureReason`, the coordinator reason union, and the `satisfies`-checked total cause mapping in build-review-domain.ts (removing the prose-scrape `no parseable JSON object` reason); route it through the existing `bumpMechanicalFaultsInLedger` path in `runBuildReview`; attach the rejection to the fault event payload (Task 10 owns the event type field).
4. Verify GREEN, then commit: "build_review: invalid structured result is a retryable mechanical fault".

**Done when:**
- `runBuildReview` settles a rejected structured result `absent` with reason `invalid-structured-result`, publishes no aggregate verdict for that rubric, and leaves the kickback ledger and convergence counter unchanged while `mechanicalFaults` increments by one, as asserted by the invalid-result-lap test
- the `build_review_rubric_mechanical_fault` event for an `invalid-structured-result` carries the field-named rejection, as asserted by the fault-event-rejection test
- three consecutive `invalid-structured-result` laps return the `needs-human` halt naming the rubric and cause, as asserted by the three-lap-halt test
- a lap with one rejected rubric and one clean rubric retains the clean judged result and marks only the rejected rubric `absent`, as asserted by the clean-sibling test

**Files likely touched:**
- `src/conductor/src/engine/build-review-coordinator.ts`
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/build-review-step.test.ts`

**Dependencies:** Task 4, Task 7

### Task 9: A candidate set without native structured-output capability is a deterministic fault charged once
**Story:** Story 4 — an incapable-only candidate set launches no provider and settles native-schema-unsupported with a recovery action, an incapable candidate is skipped when a capable one exists, the fault is charged once and recorded again as deterministic next lap, an adapter-reported nativeSchemaUnsupported classifies the same way, and the cause mapping is exhaustive.
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-coordinator.test.ts` and `build-review-step.test.ts`: (a) a branch whose only candidate's runtime reports no `nativeOutputSchema` capability records zero provider launches and settles `absent` with reason `native-schema-unsupported` and a `detail` carrying the recovery action naming the provider; (b) one capable + one incapable candidate: the incapable is skipped, the capable invoked with the schema, no fault recorded; (c) after a `native-schema-unsupported` lap the ledger `mechanicalFaults` increments by one and the branch is not re-dispatched within the lap; (d) the next lap with the same candidate set records the fault again with the operator lever naming the candidate set; (e) a capable candidate whose adapter returns `nativeSchemaUnsupported: true` classifies as `native-schema-unsupported`, not `invalid-structured-result`; (f) the total cause mapping test fails to compile when a reason lacks a cause.
2. Verify RED: the capability skip in `provider-execution.ts` surfaces as a generic candidate skip with no build_review cause.
3. Implement: add `native-schema-unsupported` to the reason unions and the total mapping in build-review-domain.ts; in `build-review-coordinator.ts` map `unsupportedNativeSchemaProviderResult` (`nativeSchemaUnsupported: true`, `providerInvocationSkipped: true`) and the adapter-reported form to that cause; in `runBuildReview` treat it like `projection-oversized` (charged once, no re-dispatch within the lap) per adr-2026-08-18-mechanical D3.1, but recorded again on a later lap because the candidate set can change.
4. Verify GREEN, then commit: "build_review: native-schema-unsupported is a deterministic mechanical fault".

**Done when:**
- a branch whose only candidate lacks `nativeOutputSchema` capability launches no provider and settles `absent` with reason `native-schema-unsupported` and a recovery action naming the provider, as asserted by the incapable-only test
- with one capable and one incapable candidate the incapable is skipped, the capable is invoked with the schema, and no fault is recorded, as asserted by the mixed-candidates test
- a `native-schema-unsupported` lap increments `mechanicalFaults` by one without a second dispatch in that lap and is recorded again on the next lap with the operator lever naming the candidate set, as asserted by the charged-once and next-lap tests
- an adapter-reported `nativeSchemaUnsupported: true` classifies as `native-schema-unsupported` rather than `invalid-structured-result`, and the `satisfies`-checked cause mapping rejects a reason without a cause, as asserted by the adapter-refusal and exhaustiveness tests

**Files likely touched:**
- `src/conductor/src/engine/build-review-coordinator.ts`
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/build-review-coordinator.test.ts`
- `src/conductor/test/engine/build-review-step.test.ts`

**Dependencies:** Task 4

### Task 10: The two new causes ride the existing mechanical-fault event
**Story:** Story 4 — the event-sink exhaustiveness check admits native-schema-unsupported and invalid-structured-result on build_review_rubric_mechanical_fault with an optional rejection field and no new event type.
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts`: (a) emitting `build_review_rubric_mechanical_fault` with `cause: "native-schema-unsupported"` and with `cause: "invalid-structured-result"` plus an optional `rejection` field type-checks and passes the `EVENT_SINKS` exhaustiveness test with no new event member; (b) an event object without `rejection` still satisfies the union (`satisfies` fixture); (c) a fault lap writes only existing event types to the events log and creates no other file.
2. Verify RED: the closed cause set on the event type rejects the two members.
3. Implement: extend the cause union on `build_review_rubric_mechanical_fault` in `src/conductor/src/types/events.ts` with the two members and add optional `rejection?: BuildReviewJudgedResultRejection`; the sink registry needs no new entry.
4. Verify GREEN, then commit: "build_review: publish native-schema causes on the existing mechanical-fault event".

**Done when:**
- `build_review_rubric_mechanical_fault` in events.ts admits `native-schema-unsupported` and `invalid-structured-result` as causes and an optional `rejection` field, and the `EVENT_SINKS` exhaustiveness test passes with no new event member, as asserted by the cause-union and exhaustiveness tests
- a fault lap writes only existing event types to the events log and creates no sidecar file, as asserted by the no-sidecar test

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/test/engine/event-sinks.test.ts`

**Dependencies:** Task 9

### Task 11: custom-v1 structured results are validated and stamped on the seam unchanged
**Story:** Story 5 — a custom-findings result is stamped exactly as today with unchanged ids, unsupported-policy is a valid alternative, and out-of-region sources, non-integer confidence, and provider-supplied envelope fields are handled as field-named rejections or ignored.
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-finding-identity.test.ts` and `build-review-coordinator.test.ts`: (a) a `custom-findings` structured result with in-region sources stamps rubric, lap, provider, bundle digest, verdict, case id, effect id equal to the pre-change golden and identical `custom-v1` ids; (b) an `unsupported-policy` result settles as the explicit unsupported-policy branch result, not `invalid-structured-result` and not an empty-findings PASS; (c) a source region outside the admitted frozen regions is rejected naming `findings[0].sourceRegions[0]` and settles `absent` with `invalid-structured-result`; (d) `confidence: 85.5` is rejected naming `findings[0].confidence` requiring an integer 0-100; (e) a payload carrying top-level `rubric` and `lapId` is accepted with the engine-stamped values, the provider values ignored.
2. Verify RED: the custom path parses `invoked.output` and has no structured-result entry.
3. Implement: route `descriptor.output.parse` for the custom member to the existing `parseBuildReviewCustomJudgedResult` + `stampBuildReviewCustomJudgedResult` over the structured result; extend the custom rejection diagnosis with `sourceRegions` and `confidence` field paths; keep `unsupported-policy` as a distinct result kind on the branch.
4. Verify GREEN, then commit: "build_review: custom-v1 validated and stamped from the structured result".

**Done when:**
- a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test
- an `unsupported-policy` structured result settles as the explicit unsupported-policy result rather than `invalid-structured-result` or an empty-findings success, as asserted by the unsupported-policy test
- an out-of-region source is rejected naming `findings[0].sourceRegions[0]` and a `confidence` of `85.5` is rejected naming `findings[0].confidence` requiring an integer 0-100, as asserted by the custom-rejection tests
- provider-supplied `rubric` and `lapId` on a custom payload are ignored and the stamped values come from the engine, as asserted by the envelope-ignored test

**Files likely touched:**
- `src/conductor/src/engine/build-review-finding-identity.ts`
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/src/engine/build-review-coordinator.ts`
- `src/conductor/test/engine/build-review-finding-identity.test.ts`
- `src/conductor/test/engine/build-review-coordinator.test.ts`

**Dependencies:** Task 3, Task 7

### Task 12: The two build_review skills carry judgement guidance only
**Story:** Story 6 — neither SKILL.md has a result-contract section, JSON example, field list, or grammar sentence; each still defines every vocabulary member; the prompt shape comes only from the descriptor.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-skill-contract.test.ts` and `build-review-rubric-skills.test.ts`: (a) neither `skills/build-review-test-quality/SKILL.md` nor `skills/build-review-security/SKILL.md` matches `/^## Result contract/m`, a fenced block containing `"findings"`, a line beginning `**Closed vocabulary:**` or `**Reference grammar:**`, or the sentence `Return exactly one provider payload`; (b) every member of `BUILD_REVIEW_FINDING_VOCABULARIES[rubric]` appears as a backticked term in that skill's `## Judgement` section; (c) the assembled `security` prompt's shape block equals `renderRubricContractShape(descriptor)` and no line of the SKILL.md text is a shape sentence (no `{`-prefixed line, no `field` list).
2. Verify RED: both files carry `## Result contract (v3)` and the current tests assert those sentences.
3. Implement: delete the `## Result contract (v3)` sections and the shape-asserting `## Verification` items from both skills; keep `## Purpose`, `## Input projection (v3)`, and `## Judgement` (with every concern kind defined and its non-finding clauses); replace the removed contract assertions in the two test files with the absence and definition assertions above. Note in Steps for BUILD: the skill digest is a cache-key component, so this edit invalidates every cached judgement once by design.
4. Verify GREEN, then commit: "build_review skills: judgement guidance only; shape comes from the descriptor".

**Done when:**
- neither build_review SKILL.md contains a `## Result contract` section, a fenced `"findings"` payload, a closed-vocabulary or reference-grammar line, or the payload-instruction sentence, as asserted by the no-shape-prose test
- every member of each rubric's engine vocabulary appears as a defined term in that skill's `## Judgement` section, as asserted by the vocabulary-definition test
- the assembled rubric prompt's shape block equals `renderRubricContractShape` output and the skill text contributes no shape sentence, as asserted by the prompt-shape-source test

**Files likely touched:**
- `skills/build-review-test-quality/SKILL.md`
- `skills/build-review-security/SKILL.md`
- `src/conductor/test/engine/build-review-skill-contract.test.ts`
- `src/conductor/test/engine/build-review-rubric-skills.test.ts`

**Dependencies:** Task 2

### Task 13: Dispositions and cache identity are preserved at contract v3
**Story:** Story 6 — a pre-migration disposition still matches a post-migration finding regardless of summary wording, a pre-migration cache entry misses on engine identity with versions still v3, and a v4 cache entry is rejected.
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-dispositions.test.ts` and `build-review-cache.test.ts`: (a) a disposition record written from a pre-migration fixture finding matches (`matchesBuildReviewDisposition`) a post-migration finding with the same anchor and concern kind and a different summary, and `deriveEffectiveBuildReviewVerdict` suppresses it; (b) a pre-migration cache entry for the same snapshot misses with `engine-version-mismatch` and the freshly written entry records `contractVersion: "v3"` and `projectionVersion: "v3"`; (c) `parseBuildReviewCacheEntry` rejects `contractVersion: "v4"`.
2. Verify RED only for (b)'s fresh-entry assertion if the write path changed shape; (a) and (c) are preservation checks expected GREEN — record that in the test names.
3. Implement whatever (b) requires in the cache write path (`tryWriteBuildReviewCacheEntry` reads versions from the descriptor per adr-2026-08-13 D2.2); no change to identity or disposition code.
4. Verify GREEN, then commit: "build_review: dispositions and cache versions preserved at v3 under descriptor dispatch".

**Done when:**
- `matchesBuildReviewDisposition` matches a pre-migration record against a post-migration finding with identical anchor and concern kind and different summary, and the effective verdict suppresses it, as asserted by the wording-insensitive-match test
- a pre-migration cache entry misses with `engine-version-mismatch` and the fresh entry written through `tryWriteBuildReviewCacheEntry` carries `contractVersion` `v3` and `projectionVersion` `v3` read from the descriptor, as asserted by the cache-version test
- `parseBuildReviewCacheEntry` rejects an entry declaring `contractVersion: "v4"`, as asserted by the rejected-v4 test

**Files likely touched:**
- `src/conductor/src/engine/build-review-cache.ts`
- `src/conductor/test/engine/build-review-dispositions.test.ts`
- `src/conductor/test/engine/build-review-cache.test.ts`

**Dependencies:** Task 7

### Task 14: The provider-contract audit forbids output-format prose in build_review skills
**Story:** Story 7 — the audit passes on the shipped skills, fails a fixture with a result-contract heading, a fenced findings payload, or the payload-instruction sentence, and the integrity suite fails when a skill regains such prose.
**Type:** negative-path

**Steps:**
1. Write the audit rule first as failing shell assertions in `test/test_provider_skill_contracts.sh`: for each `skills/build-review-*/SKILL.md`, `require_absent_pattern` over `^## Result contract`, a fenced block containing `"findings":`, and `^Return exactly one provider payload`; add negative fixtures under `test/fixtures/build-review-skill-prose/` (one per pattern) and a self-test loop that asserts the rule fails naming the fixture and the pattern.
2. Verify RED: the shipped skills still carry the prose (before Task 12 lands) or the fixtures are not yet rejected.
3. Implement: the rule and fixtures above; confirm `test/test_harness_integrity.sh` already invokes the audit so no wiring change is needed.
4. Verify GREEN, then commit: "integrity: provider-contract audit forbids output-format prose in build_review skills".

**Done when:**
- `test/test_provider_skill_contracts.sh` passes on the shipped build_review skills and prints the forbidden patterns it checked, as asserted by running the audit
- the audit fails naming the file and the matched pattern for each fixture carrying a `## Result contract` heading, a fenced `"findings":` payload, or the `Return exactly one provider payload` sentence, as asserted by the fixture self-test loop
- a build_review skill that regains a fenced `"findings"` payload fails `test/test_harness_integrity.sh` through the audit, as asserted by the integrity self-test

**Files likely touched:**
- `test/test_provider_skill_contracts.sh`
- `test/fixtures/build-review-skill-prose/result-contract-heading.md`
- `test/fixtures/build-review-skill-prose/fenced-findings.md`
- `test/fixtures/build-review-skill-prose/payload-sentence.md`

**Dependencies:** Task 12

### Task 15: The vocabulary drift guard binds the descriptor enum to the skill definitions in both directions
**Story:** Story 7 — the guard reports the descriptor enum and the skill-defined kinds equal, keeps its three fail-closed modes, and fails naming the unpaired member in either direction or !unclassifiable when the definitions cannot be found.
**Type:** negative-path

**Steps:**
1. Write failing assertions in `test/check_build_review_rubric_skill_vocabularies.sh`: read the descriptor enum by importing the built dist's contract module and printing `output.jsonSchema...concernKind.enum` per rubric; extract the backticked kinds defined under `## Judgement` in each SKILL.md; assert set equality both ways naming any unpaired member; keep `!unenforced` (import failure), `!unclassifiable` (no `## Judgement` section or zero definitions), and `!baseline-rejected` modes. Add fixtures: a skill defining an extra kind, a schema enum with an extra member (via an env override the script honors only under test), and a skill with `## Judgement` renamed.
2. Verify RED: the current script compares parser-accepted grammar against the `Closed vocabulary` line that Task 12 removed.
3. Implement: rewrite the comparison source as above; the three modes and the integrity-suite registration are unchanged.
4. Verify GREEN, then commit: "integrity: vocabulary guard binds descriptor enum to skill judgement definitions".

**Done when:**
- `test/check_build_review_rubric_skill_vocabularies.sh` reports the descriptor enum and the skill-defined kinds equal for both rubrics and passes, as asserted by running the guard
- the guard fails naming the unpaired member when the enum admits a kind the skill does not define or the skill defines a kind the enum does not admit, as asserted by the two unpaired fixtures
- the guard fails `!unclassifiable` when the `## Judgement` section is absent and `!unenforced` when the engine module cannot be imported, as asserted by the renamed-section and import-failure fixtures

**Files likely touched:**
- `test/check_build_review_rubric_skill_vocabularies.sh`
- `test/fixtures/build-review-skill-vocab/extra-skill-kind.md`
- `test/fixtures/build-review-skill-vocab/renamed-judgement.md`

**Dependencies:** Task 2, Task 12

### Task 16: Rubric dispatch is non-interactive in both conductor modes and byte-identical across providers
**Story:** Story 8 — every rubric invocation under interactive conductor mode is recorded non-interactive with nativeSchema, a forced interactive invocation surfaces the adapter refusal as native-schema-unsupported, and equivalent Claude and Codex structured results stamp byte-identical envelopes and ids.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-step.test.ts` and `build-review-coordinator.test.ts`: (a) with the conductor constructed in `interactive` mode, `runBuildReview` records every rubric invocation with `interactive: false` and `nativeSchema` set; (b) a test that forces `interactive: true` on a rubric invocation through the Claude adapter fixture yields `nativeSchemaUnsupported: true` and the coordinator classifies the branch `native-schema-unsupported`; (c) a Claude fixture terminal envelope with `structuredOutput` and a Codex fixture terminal item with the same object in a different key order stamp deep-equal envelopes and identical finding ids.
2. Verify RED: (a) fails until Task 4 sets `nativeSchema`; (b) fails until Task 9 classifies the refusal; (c) is a parity proof over the Task 4 path.
3. Implement: assert the auxiliary-candidate path pins `interactive: false` for rubric branches in step-runners.ts (add the explicit option if the current path inherits it implicitly); no adapter change.
4. Verify GREEN, then commit: "build_review: rubric dispatch is non-interactive and provider-parity is pinned".

**Done when:**
- under interactive conductor mode every build_review rubric invocation is recorded with `interactive: false` and `nativeSchema` set, as asserted by the interactive-mode dispatch test
- a forced interactive rubric invocation surfaces the Claude adapter's `nativeSchemaUnsupported: true` and classifies as `native-schema-unsupported`, as asserted by the forced-interactive test
- equivalent Claude and Codex structured results with different key order stamp deep-equal envelopes and identical finding ids, as asserted by the provider-parity test

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/build-review-step.test.ts`
- `src/conductor/test/engine/build-review-coordinator.test.ts`

**Dependencies:** Task 4, Task 9

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ──┬── Task 4 ──┬── Task 5
         │           │            ├── Task 6
         │           │            ├── Task 8 (also needs Task 7)
         │           │            ├── Task 9 ─── Task 10
         │           │            └── Task 16 (also needs Task 9)
         │           ├── Task 7 ──┬── Task 11 (also needs Task 3)
         │           │            └── Task 13
         │           ├── Task 12 ─┬── Task 14
         │           │            └── Task 15 (also needs Task 2)
         └── Task 3 ──── Task 4
```

## Integration Points

- After Task 4: a real `runBuildReview` lap with a fake provider dispatches every catalog member with `nativeSchema` and stamps from the structured result.
- After Task 8 and Task 9: both new causes route through the mechanical-fault lane end to end through the build_review step.
- After Task 12 and Task 14: `test/test_harness_integrity.sh` passes with the rewritten skills and the new audit rule.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the built-in registry, when the effective catalog is resolved with no custom policy, then the `testQuality` and `security` members each expose a descriptor whose projection version is `v3`, whose output contract version is `v3`, whose output JSON Schema is a frozen object, and whose identity canonicalizer produces the same finding id as today's built-in canonicalizer for a fixed finding. | 1 | "`build-review-registry.ts` entries `testQuality` and `security` each carry a `contract` descriptor with `projection.version` and `output.version` both `v3` and a frozen `output.jsonSchema`, as asserted by the descriptor-shape test" | diff-local |
| Story 1 happy: Given a validated custom policy declaration, when the effective catalog is resolved, then the custom member exposes a descriptor whose output contract version is `v1`, whose JSON Schema admits the `custom-findings` payload and the `unsupported-policy` alternative, and whose identity canonicalizer produces the same `custom-v1` id as today for a fixed finding. | 3 | "a resolved custom member in build-review-policy-resolver.ts carries a descriptor with `output.version` `v1` whose JSON Schema admits both the `custom-findings` payload and the `unsupported-policy` alternative, as asserted by the custom-descriptor test" | diff-local |
| Story 1 happy: Given any descriptor, when its prompt shape is rendered, then the rendered text is derived from the descriptor's JSON Schema and names exactly the top-level keys and enum members the schema admits. | 2 | "`BUILD_REVIEW_JUDGED_V3_SCHEMA` in build-review-domain.ts has top-level `properties` exactly `findings`, `relocationAudit`, `counterfactualSensitivity`, `scopeResolutions` with `additionalProperties: false`, as asserted by the closed-field-set test" | diff-local |
| Story 1 negative: Given a registry entry constructed without an output JSON Schema, when the catalog is resolved, then resolution fails at authoring time with a message naming the member and the missing descriptor part, and no dispatch is attempted for any member. | 1 | "`build-review-registry.ts` entries `testQuality` and `security` each carry a `contract` descriptor with `projection.version` and `output.version` both `v3` and a frozen `output.jsonSchema`, as asserted by the descriptor-shape test" | diff-local |
| Story 1 negative: Given two descriptors that declare the same rubric id, when the catalog is resolved, then resolution fails naming the duplicated id rather than dispatching either. | 1 | "`build-review-registry.ts` entries `testQuality` and `security` each carry a `contract` descriptor with `projection.version` and `output.version` both `v3` and a frozen `output.jsonSchema`, as asserted by the descriptor-shape test" | diff-local |
| Story 1 negative: Given a descriptor whose JSON Schema admits a top-level key outside the closed provider field set for its contract, when the built-in catalog is constructed, then a unit test asserting the `judged` v3 schema's top-level `properties` equal exactly `findings`, `relocationAudit`, `counterfactualSensitivity`, `scopeResolutions` fails. | 2 | "`BUILD_REVIEW_JUDGED_V3_SCHEMA` in build-review-domain.ts has top-level `properties` exactly `findings`, `relocationAudit`, `counterfactualSensitivity`, `scopeResolutions` with `additionalProperties: false`, as asserted by the closed-field-set test" | diff-local |
| Story 2 happy: Given a `testQuality` branch with an admitted projection and a Claude candidate, when the branch is dispatched, then the recorded invocation options carry `nativeSchema` equal to the descriptor's JSON Schema and the Claude adapter fixture receives `--json-schema` with that schema serialized. | 4 | "`dispatchRubricContract` in step-runners.ts sets `InvokeOptions.nativeSchema` to the descriptor's `output.jsonSchema` for a built-in branch, as asserted by the recorded-options test" | diff-local |
| Story 2 happy: Given the same branch with a Codex candidate, when the branch is dispatched, then the Codex adapter fixture receives `--output-schema` naming a file under the invocation's engine-owned scratch home whose bytes equal the serialized schema, and the scratch home is removed after the invocation settles. | 5 | "the Claude fixture argv carries `--json-schema` with the serialized descriptor schema for a rubric invocation, as asserted by the claude-argv test" | diff-local |
| Story 2 happy: Given a provider result whose `finalStructuredResult` is a valid payload and whose `output` text is a valid payload wrapped in prose with a different `findings` array, when the branch is validated, then the stamped result's findings equal the structured result's findings and the prose payload is never parsed. | 4 | "`dispatchRubricContract` in step-runners.ts sets `InvokeOptions.nativeSchema` to the descriptor's `output.jsonSchema` for a built-in branch, as asserted by the recorded-options test" | diff-local |
| Story 2 happy: Given a `custom-v1` branch, when it is dispatched, then it passes through the same dispatch function as the built-in branches with its own descriptor's schema and the policy bundle text still precedes the skill invocation in the prompt. | 4 | "`dispatchRubricContract` in step-runners.ts sets `InvokeOptions.nativeSchema` to the descriptor's `output.jsonSchema` for a built-in branch, as asserted by the recorded-options test" | diff-local |
| Story 2 negative: Given a provider result with `success: true`, a prose `output` containing a well-formed payload, and no `finalStructuredResult`, when the branch is validated, then it is rejected as an absent structured result and the prose payload is not used. | 4 | "`dispatchRubricContract` in step-runners.ts sets `InvokeOptions.nativeSchema` to the descriptor's `output.jsonSchema` for a built-in branch, as asserted by the recorded-options test" | diff-local |
| Story 2 negative: Given a provider result whose `finalStructuredResult` is a JSON string rather than an object, when the branch is validated, then it is rejected naming the root as the offending field and the form it requires. | 7 | "`describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test" | diff-local |
| Story 2 negative: Given the built-in dispatch, when the retired prose-scrape extraction is referenced from the build_review path, then a test asserting the build_review dispatch module has no import of the scrape helper fails, so the scrape path cannot be silently re-wired. | 6 | "the build_review dispatch source in step-runners.ts contains no reference to the prose-scrape extraction helper, as asserted by the no-scrape-import test" | diff-local |
| Story 2 negative: Given a Codex candidate whose scratch home cannot be created, when the branch is dispatched, then the branch settles as a mechanical fault naming the scratch-home failure and no schema file is written outside the invocation scratch directory. | 5 | "the Claude fixture argv carries `--json-schema` with the serialized descriptor schema for a rubric invocation, as asserted by the claude-argv test" | diff-local |
| Story 3 happy: Given a structured result whose finding cites a content-region `contentHash` absent from the projection, when it is validated, then the rejection names `findings[0].anchor.locus.contentHash` and states that it must equal a hash the projection lists, and the branch settles `absent` with cause `invalid-structured-result`. | 7 | "`describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test" | diff-local |
| Story 3 happy: Given a structured result whose `concernKind` is outside the descriptor enum, when it is validated, then the rejection names `findings[0].concernKind` and lists the admitted members, and the branch settles `absent` with cause `invalid-structured-result`. | 7 | "`describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test" | diff-local |
| Story 3 happy: Given two findings in one structured result that canonicalize to the same identity, when it is validated, then the rejection names the duplicate finding id and the branch settles `absent`. | 7 | "`describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test" | diff-local |
| Story 3 happy: Given an `invalid-structured-result` fault, when the lap settles, then no aggregate is published for that rubric, no kickback is charged, no convergence cap ticks, and the fault event carries the field-named rejection. | 8 | "`runBuildReview` settles a rejected structured result `absent` with reason `invalid-structured-result`, publishes no aggregate verdict for that rubric, and leaves the kickback ledger and convergence counter unchanged while `mechanicalFaults` increments by one, as asserted by the invalid-result-lap test" | diff-local |
| Story 3 negative: Given an `invalid-structured-result` on the first dispatch, when the branch settles, then exactly one provider invocation was made for that branch and no repair prompt was sent. | 6 | "the build_review dispatch source in step-runners.ts contains no reference to the prose-scrape extraction helper, as asserted by the no-scrape-import test" | diff-local |
| Story 3 negative: Given a rejection whose cause is not explained by any enumerated check, when the diagnosis is rendered, then it reports the rejection as unexplained and names no field absent from the payload. | 7 | "`describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test" | diff-local |
| Story 3 negative: Given `invalid-structured-result` faults on three consecutive laps for the same rubric, when the third settles, then the feature halts `needs-human` under the existing mechanical-fault bound rather than a fourth dispatch. | 8 | "`runBuildReview` settles a rejected structured result `absent` with reason `invalid-structured-result`, publishes no aggregate verdict for that rubric, and leaves the kickback ledger and convergence counter unchanged while `mechanicalFaults` increments by one, as asserted by the invalid-result-lap test" | diff-local |
| Story 3 negative: Given a structured result rejected for a contract violation and a second rubric in the same lap that judged cleanly, when the lap settles, then the clean rubric's result is retained and only the rejected rubric is `absent`. | 8 | "`runBuildReview` settles a rejected structured result `absent` with reason `invalid-structured-result`, publishes no aggregate verdict for that rubric, and leaves the kickback ledger and convergence counter unchanged while `mechanicalFaults` increments by one, as asserted by the invalid-result-lap test" | diff-local |
| Story 4 happy: Given a rubric branch whose only admitted candidate's provider declares no `nativeOutputSchema` capability, when the branch is dispatched, then no provider process is launched, the branch settles `absent` with cause `native-schema-unsupported`, and the fault carries the recovery action naming the provider. | 9 | "a branch whose only candidate lacks `nativeOutputSchema` capability launches no provider and settles `absent` with reason `native-schema-unsupported` and a recovery action naming the provider, as asserted by the incapable-only test" | diff-local |
| Story 4 happy: Given a branch with one capable and one incapable candidate, when it is dispatched, then the incapable candidate is skipped, the capable candidate is invoked with the schema, and no fault is recorded. | 9 | "a branch whose only candidate lacks `nativeOutputSchema` capability launches no provider and settles `absent` with reason `native-schema-unsupported` and a recovery action naming the provider, as asserted by the incapable-only test" | diff-local |
| Story 4 happy: Given a `native-schema-unsupported` fault, when the lap settles, then the fault is charged once against the mechanical allowance and the branch is not re-dispatched within that lap. | 9 | "a branch whose only candidate lacks `nativeOutputSchema` capability launches no provider and settles `absent` with reason `native-schema-unsupported` and a recovery action naming the provider, as asserted by the incapable-only test" | diff-local |
| Story 4 negative: Given a `native-schema-unsupported` fault, when the next lap begins with the same candidate set, then the fault is recorded again as deterministic rather than treated as cleared, and the operator lever names the candidate set as the cause. | 9 | "a branch whose only candidate lacks `nativeOutputSchema` capability launches no provider and settles `absent` with reason `native-schema-unsupported` and a recovery action naming the provider, as asserted by the incapable-only test" | diff-local |
| Story 4 negative: Given a candidate whose provider declares the capability but the adapter returns `nativeSchemaUnsupported: true` on invocation, when the branch settles, then it is classified `native-schema-unsupported`, not `invalid-structured-result`. | 9 | "a branch whose only candidate lacks `nativeOutputSchema` capability launches no provider and settles `absent` with reason `native-schema-unsupported` and a recovery action naming the provider, as asserted by the incapable-only test" | diff-local |
| Story 4 negative: Given the fault-cause mapping, when a new branch reason is added without a cause, then the exhaustiveness test over the closed mapping fails at authoring time. | 9 | "a branch whose only candidate lacks `nativeOutputSchema` capability launches no provider and settles `absent` with reason `native-schema-unsupported` and a recovery action naming the provider, as asserted by the incapable-only test" | diff-local |
| Story 5 happy: Given a resolved custom member, when its policy contract is rendered, then the reviewer-facing shape text is derived from the descriptor's JSON Schema and names exactly `kind`, `version`, `findings` for the findings payload and `kind`, `requirement` for the unsupported-policy alternative. | 3 | "a resolved custom member in build-review-policy-resolver.ts carries a descriptor with `output.version` `v1` whose JSON Schema admits both the `custom-findings` payload and the `unsupported-policy` alternative, as asserted by the custom-descriptor test" | diff-local |
| Story 5 happy: Given a custom reviewer's structured result of kind `custom-findings` with source regions inside the admitted frozen regions, when it is validated, then the engine stamps rubric, lap, provider, bundle digest, verdict, case id, and effect id exactly as today and the `custom-v1` finding ids equal the pre-change ids for the same findings. | 11 | "a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test" | diff-local |
| Story 5 happy: Given a custom reviewer's structured result of kind `unsupported-policy` with a non-empty `requirement`, when it is validated, then the branch settles as an explicit unsupported-policy result, not as `invalid-structured-result` and not as an empty-findings success. | 11 | "a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test" | diff-local |
| Story 5 negative: Given a custom structured result whose finding cites a source region outside the admitted frozen regions, when it is validated, then the rejection names `findings[0].sourceRegions[0]` and the branch settles `absent` with cause `invalid-structured-result`. | 11 | "a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test" | diff-local |
| Story 5 negative: Given a custom structured result whose `confidence` is `85.5`, when it is validated, then the rejection names `findings[0].confidence` and requires an integer from 0 to 100. | 11 | "a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test" | diff-local |
| Story 5 negative: Given a custom structured result that carries a top-level `rubric` or `lapId` field, when it is validated, then the provider-supplied envelope fields are ignored and the stamped values come from the engine, unchanged from today. | 11 | "a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test" | diff-local |
| Story 6 happy: Given `skills/build-review-test-quality/SKILL.md` and `skills/build-review-security/SKILL.md`, when read, then each has no `## Result contract` section, no fenced JSON payload example, no per-field list of result keys, and no reference-grammar sentence, while each still defines every member of its rubric's concern-kind vocabulary and its non-finding conditions. | 12 | "neither build_review SKILL.md contains a `## Result contract` section, a fenced `"findings"` payload, a closed-vocabulary or reference-grammar line, or the payload-instruction sentence, as asserted by the no-shape-prose test" | diff-local |
| Story 6 happy: Given a rubric prompt assembled for `security`, when inspected, then the shape block in the prompt equals the descriptor's rendered shape and the SKILL.md text contributes no shape sentences. | 12 | "neither build_review SKILL.md contains a `## Result contract` section, a fenced `"findings"` payload, a closed-vocabulary or reference-grammar line, or the payload-instruction sentence, as asserted by the no-shape-prose test" | diff-local |
| Story 6 happy: Given a disposition record accepted before the migration for a `testQuality` finding, when the same finding is raised after the migration, then it matches the record on `id` and `canonicalJson` and is suppressed exactly as before, with `contractVersion` still `v3`. | 13 | "`matchesBuildReviewDisposition` matches a pre-migration record against a post-migration finding with identical anchor and concern kind and different summary, and the effective verdict suppresses it, as asserted by the wording-insensitive-match test" | diff-local |
| Story 6 happy: Given a cache entry written before the migration for the same snapshot, when looked up after the migration, then it misses on engine identity and the fresh entry records `contractVersion: v3` and `projectionVersion: v3`. | 13 | "`matchesBuildReviewDisposition` matches a pre-migration record against a post-migration finding with identical anchor and concern kind and different summary, and the effective verdict suppresses it, as asserted by the wording-insensitive-match test" | diff-local |
| Story 6 negative: Given a finding whose summary wording differs from an accepted disposition's but whose anchor and concern kind are identical, when it is raised after the migration, then it still matches the disposition, proving identity remains wording-insensitive. | 13 | "`matchesBuildReviewDisposition` matches a pre-migration record against a post-migration finding with identical anchor and concern kind and different summary, and the effective verdict suppresses it, as asserted by the wording-insensitive-match test" | diff-local |
| Story 6 negative: Given a cache entry declaring `contractVersion: v4`, when parsed, then it is rejected as invalid, proving the accepted version set did not advance. | 13 | "`matchesBuildReviewDisposition` matches a pre-migration record against a post-migration finding with identical anchor and concern kind and different summary, and the effective verdict suppresses it, as asserted by the wording-insensitive-match test" | diff-local |
| Story 6 negative: Given the two SKILL.md files, when either regains a fenced JSON object containing a `findings` key, then the integrity suite fails (Story 7) before the change can land. | 14 | "`test/test_provider_skill_contracts.sh` passes on the shipped build_review skills and prints the forbidden patterns it checked, as asserted by running the audit" | diff-local |
| Story 7 happy: Given the shipped `skills/build-review-*/SKILL.md` files, when `test/test_provider_skill_contracts.sh` runs, then the build_review rule passes and reports the forbidden patterns it checked. | 14 | "`test/test_provider_skill_contracts.sh` passes on the shipped build_review skills and prints the forbidden patterns it checked, as asserted by running the audit" | diff-local |
| Story 7 happy: Given the descriptor enum for `security` and the ten kinds the security SKILL.md defines, when `test/check_build_review_rubric_skill_vocabularies.sh` runs, then it reports the two sets equal and passes. | 15 | "`test/check_build_review_rubric_skill_vocabularies.sh` reports the descriptor enum and the skill-defined kinds equal for both rubrics and passes, as asserted by running the guard" | diff-local |
| Story 7 happy: Given the vocabulary guard's fail-closed modes, when the engine module cannot be imported or the skill's definitions cannot be classified, then the guard fails with `!unenforced` or `!unclassifiable` exactly as today. | 15 | "`test/check_build_review_rubric_skill_vocabularies.sh` reports the descriptor enum and the skill-defined kinds equal for both rubrics and passes, as asserted by running the guard" | diff-local |
| Story 7 negative: Given a build_review SKILL.md fixture containing a `## Result contract` heading, when the provider-contract audit runs against it, then the audit fails naming the file and the matched pattern. | 14 | "`test/test_provider_skill_contracts.sh` passes on the shipped build_review skills and prints the forbidden patterns it checked, as asserted by running the audit" | diff-local |
| Story 7 negative: Given a fixture containing a fenced block with a `"findings":` key or a sentence beginning `Return exactly one provider payload`, when the audit runs, then it fails naming the pattern. | 14 | "`test/test_provider_skill_contracts.sh` passes on the shipped build_review skills and prints the forbidden patterns it checked, as asserted by running the audit" | diff-local |
| Story 7 negative: Given a descriptor enum that admits a kind the SKILL.md does not define, when the vocabulary guard runs, then it fails naming the unpaired member; given a SKILL.md that defines a kind the enum does not admit, then it fails naming that member. | 15 | "`test/check_build_review_rubric_skill_vocabularies.sh` reports the descriptor enum and the skill-defined kinds equal for both rubrics and passes, as asserted by running the guard" | diff-local |
| Story 7 negative: Given a fixture where the security SKILL.md still defines all ten kinds but the `## Judgement` section is renamed, when the guard runs, then it fails `!unclassifiable` rather than passing on zero definitions. | 15 | "`test/check_build_review_rubric_skill_vocabularies.sh` reports the descriptor enum and the skill-defined kinds equal for both rubrics and passes, as asserted by running the guard" | diff-local |
| Story 8 happy: Given the conductor in interactive mode, when build_review fans out its rubrics, then every rubric invocation is recorded with `interactive: false` and carries `nativeSchema`. | 16 | "under interactive conductor mode every build_review rubric invocation is recorded with `interactive: false` and `nativeSchema` set, as asserted by the interactive-mode dispatch test" | diff-local |
| Story 8 happy: Given equivalent structured results from a Claude fixture and a Codex fixture for the same projection, when both are validated, then the stamped envelopes and finding ids are byte-identical. | 16 | "under interactive conductor mode every build_review rubric invocation is recorded with `interactive: false` and `nativeSchema` set, as asserted by the interactive-mode dispatch test" | diff-local |
| Story 8 happy: Given a Codex structured result delivered as the terminal item of the `exec --json` stream, when the adapter settles, then `finalStructuredResult` holds the parsed object and `output` still carries the transcript text unchanged. | 5 | "the Claude fixture argv carries `--json-schema` with the serialized descriptor schema for a rubric invocation, as asserted by the claude-argv test" | diff-local |
| Story 8 negative: Given a test that forces a rubric invocation with `interactive: true`, when it reaches the Claude adapter, then the adapter returns `nativeSchemaUnsupported: true` and the coordinator classifies it `native-schema-unsupported`, proving the refusal is observable rather than silent. | 16 | "under interactive conductor mode every build_review rubric invocation is recorded with `interactive: false` and `nativeSchema` set, as asserted by the interactive-mode dispatch test" | diff-local |
| Story 8 negative: Given a Codex fixture that requested a schema and ends without a structured item, when the adapter settles, then the result is a failure naming the missing structured result, not a success with prose output. | 5 | "the Claude fixture argv carries `--json-schema` with the serialized descriptor schema for a rubric invocation, as asserted by the claude-argv test" | diff-local |
| Story 8 negative: Given a Claude fixture whose terminal envelope carries `structuredOutput` and a Codex fixture whose terminal item carries the equivalent object with a different key order, when both are canonicalized, then the finding ids are identical. | 16 | "under interactive conductor mode every build_review rubric invocation is recorded with `interactive: false` and `nativeSchema` set, as asserted by the interactive-mode dispatch test" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D1 | task | task-1 | `build-review-registry.ts` entries `testQuality` and `security` each carry a `contract` descriptor with `projection.version` and `output.version` both `v3` and a frozen `output.jsonSchema`, as asserted by the descriptor-shape test |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D2 | task | task-13 | a pre-migration cache entry misses with `engine-version-mismatch` and the fresh entry written through `tryWriteBuildReviewCacheEntry` carries `contractVersion` `v3` and `projectionVersion` `v3` read from the descriptor, as asserted by the cache-version test |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | no-change | none | PRD-widening authority records are untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | no-change | none | widening storage is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | no-change | none | original-decision capture is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | legacy widening authority is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | no-change | none | the unmatched-NC judgment is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | task | task-4 | `dispatchRubricContract` in step-runners.ts sets `InvokeOptions.nativeSchema` to the descriptor's `output.jsonSchema` for a built-in branch, as asserted by the recorded-options test |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | no-change | none | widening input bounds and retry rules are untouched; build_review bounds come from max_projection_bytes |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | no-change | none | widening freshness recheck is untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | no-change | none | widening recovery and observability are untouched |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | the delivery boundary of #2429 is untouched; this feature consumes its seam under D6.1 |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D1 | existing | none | `stampBuildReviewDispatchedCandidate` binds `lapId` and `snapshotDigest` from the projection on the fresh path today and Task 4 hands it the structured payload unchanged |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D2 | task | task-2 | `BUILD_REVIEW_JUDGED_V3_SCHEMA` in build-review-domain.ts has top-level `properties` exactly `findings`, `relocationAudit`, `counterfactualSensitivity`, `scopeResolutions` with `additionalProperties: false`, as asserted by the closed-field-set test |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D3 | task | task-13 | `parseBuildReviewCacheEntry` rejects an entry declaring `contractVersion: "v4"`, as asserted by the rejected-v4 test |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D4 | task | task-11 | provider-supplied `rubric` and `lapId` on a custom payload are ignored and the stamped values come from the engine, as asserted by the envelope-ignored test |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D5 | existing | none | the settlement-time rubric invariant in `build-review-coordinator.ts` compares branch rubric to projection rubric and is not touched |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D6 | task | task-7 | `describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D7 | task | task-6 | a branch whose structured result is rejected makes exactly one provider invocation and sends no repair prompt, as asserted by the single-invocation test |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D8 | task | task-8 | `runBuildReview` settles a rejected structured result `absent` with reason `invalid-structured-result`, publishes no aggregate verdict for that rubric, and leaves the kickback ledger and convergence counter unchanged while `mechanicalFaults` increments by one, as asserted by the invalid-result-lap test |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D9 | existing | none | `Task N:` plan-task normalization in the anchor parser is unchanged and remains inside the plan-task kind |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D10 | task | task-12 | neither build_review SKILL.md contains a `## Result contract` section, a fenced `"findings"` payload, a closed-vocabulary or reference-grammar line, or the payload-instruction sentence, as asserted by the no-shape-prose test |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D1 | task | task-2 | each built-in schema's `concernKind` enum deep-equals `BUILD_REVIEW_FINDING_VOCABULARIES` for that rubric, as asserted by the enum-parity test |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D2 | existing | none | `parseBuildReviewFindingConcernKind` still normalizes before validating with the single-member ambiguity guard |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D3 | task | task-7 | an out-of-enum `concernKind` is rejected naming `findings[0].concernKind` with the admitted members listed, as asserted by the enum-rejection test |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D4 | task | task-13 | `parseBuildReviewCacheEntry` rejects an entry declaring `contractVersion: "v4"`, as asserted by the rejected-v4 test |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D5 | task | task-15 | `test/check_build_review_rubric_skill_vocabularies.sh` reports the descriptor enum and the skill-defined kinds equal for both rubrics and passes, as asserted by running the guard |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D6 | no-change | none | the effective-verdict predicate is still consulted at each exit; no exit is added or hoisted |
| adr-2026-08-16-closed-build-review-finding-vocabularies#D7 | no-change | none | no disposition is version-invalidated because the contract version stays v3 |
| adr-2026-09-10-portable-build-review-policy#D1 | no-change | none | one public gate and the declaration/execution-policy split are untouched |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | installed-catalog adapters and semantic identity are untouched |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | the content-addressed policy bundle is untouched and still precedes the skill invocation (Task 4) |
| adr-2026-09-10-portable-build-review-policy#D4 | task | task-3 | `renderBuildReviewPolicyContract` renders the reviewer shape from the custom descriptor's JSON Schema naming exactly `kind`, `version`, `findings` and `kind`, `requirement`, as asserted by the rendered-custom-shape test |
| adr-2026-09-10-portable-build-review-policy#D5 | no-change | none | the frozen source view and read-only invocation profile for custom laps are untouched |
| adr-2026-09-10-portable-build-review-policy#D6 | no-change | none | policy-dependent cache operations stay inside candidate preparation |
| adr-2026-09-10-portable-build-review-policy#D7 | task | task-11 | a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test |
| adr-2026-09-10-portable-build-review-policy#D8 | no-change | none | adjudicator policy and scope evidence are untouched |
| adr-2026-09-10-portable-build-review-policy#D9 | no-change | none | the case-v2 contract is untouched |
| adr-2026-09-10-portable-build-review-policy#D10 | no-change | none | one authority across attended and daemon execution is untouched |
| adr-2026-09-10-portable-build-review-policy#D11 | no-change | none | durable effects and convergence limits are reused unchanged |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-10 | `build_review_rubric_mechanical_fault` in events.ts admits `native-schema-unsupported` and `invalid-structured-result` as causes and an optional `rejection` field, and the `EVENT_SINKS` exhaustiveness test passes with no new event member, as asserted by the cause-union and exhaustiveness tests |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D1 | task | task-8 | `runBuildReview` settles a rejected structured result `absent` with reason `invalid-structured-result`, publishes no aggregate verdict for that rubric, and leaves the kickback ledger and convergence counter unchanged while `mechanicalFaults` increments by one, as asserted by the invalid-result-lap test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D2 | task | task-9 | an adapter-reported `nativeSchemaUnsupported: true` classifies as `native-schema-unsupported` rather than `invalid-structured-result`, and the `satisfies`-checked cause mapping rejects a reason without a cause, as asserted by the adapter-refusal and exhaustiveness tests |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D3 | task | task-8 | `runBuildReview` settles a rejected structured result `absent` with reason `invalid-structured-result`, publishes no aggregate verdict for that rubric, and leaves the kickback ledger and convergence counter unchanged while `mechanicalFaults` increments by one, as asserted by the invalid-result-lap test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D4 | task | task-8 | three consecutive `invalid-structured-result` laps return the `needs-human` halt naming the rubric and cause, as asserted by the three-lap-halt test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D5 | task | task-8 | three consecutive `invalid-structured-result` laps return the `needs-human` halt naming the rubric and cause, as asserted by the three-lap-halt test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D6 | no-change | none | reduced coverage remains a distinct record kind; the two new causes are reasons, not records |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D7 | no-change | none | identity stays `{rubric, closed reason}`; each new cause is one more closed member |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D8 | task | task-8 | a lap with one rejected rubric and one clean rubric retains the clean judged result and marks only the rejected rubric `absent`, as asserted by the clean-sibling test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D9 | no-change | none | reduced coverage is still stamped by `deriveEffectiveBuildReviewVerdict` at the same places |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D10 | task | task-10 | `build_review_rubric_mechanical_fault` in events.ts admits `native-schema-unsupported` and `invalid-structured-result` as causes and an optional `rejection` field, and the `EVENT_SINKS` exhaustiveness test passes with no new event member, as asserted by the cause-union and exhaustiveness tests |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks on single lines
- [x] Dependencies are explicit and acyclic
- [x] No terminal catch-all validation task; Tasks 4, 5, 8, 14, 15 own the boundary proofs
