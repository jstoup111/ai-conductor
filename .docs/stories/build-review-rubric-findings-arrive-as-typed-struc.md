**Status:** Accepted

# build_review rubric findings arrive as typed, structurally keyed output (#2384)

## Context

build_review rubric judges already return an engine-stamped `judged` envelope with content-anchored finding identity, but the provider payload is scraped out of the session's final message (raw trim, then a fenced block, then the outermost brace slice) and the built-in and custom-policy rubrics each carry their own prose-rendered output shape on separate dispatch paths. The #2429 native structured-output seam exists and is used only by the PRD-widening reconciliation. These stories put every catalog member — built-in `testQuality` and `security`, and custom-policy `custom-v1` — on one engine-owned rubric contract descriptor, dispatch all of them through the provider's native structured output, and leave `skills/build-review-*/SKILL.md` carrying judgement guidance only. Finding identity and `contractVersion: v3` are preserved. Governing decisions: adr-2026-08-13 D1.1/D1.2/D2.2, adr-2026-09-07 D6.1, adr-2026-08-19 D7.1/D10.1/D2.3, adr-2026-08-16 D5.1, adr-2026-09-10 D7.1, adr-2026-08-18-mechanical-rubric-faults D2.2. Technical track, Large tier; scope boundary in `.docs/track/build-review-rubric-findings-arrive-as-typed-struc.md`.

## Story 1: Every catalog member supplies one rubric contract descriptor

As the build_review coordinator, I want each effective catalog member to hand me a single descriptor carrying its input projection contract, its output contract, and its identity canonicalizer so that dispatch never branches on whether a member is built-in or project-declared.

### Acceptance Criteria

#### Happy Path
- Given the built-in registry, when the effective catalog is resolved with no custom policy, then the `testQuality` and `security` members each expose a descriptor whose projection version is `v3`, whose output contract version is `v3`, whose output JSON Schema is a frozen object, and whose identity canonicalizer produces the same finding id as today's built-in canonicalizer for a fixed finding.
- Given a validated custom policy declaration, when the effective catalog is resolved, then the custom member exposes a descriptor whose output contract version is `v1`, whose JSON Schema admits the `custom-findings` payload and the `unsupported-policy` alternative, and whose identity canonicalizer produces the same `custom-v1` id as today for a fixed finding.
- Given any descriptor, when its prompt shape is rendered, then the rendered text is derived from the descriptor's JSON Schema and names exactly the top-level keys and enum members the schema admits.

#### Negative Paths
- Given a registry entry constructed without an output JSON Schema, when the catalog is resolved, then resolution fails at authoring time with a message naming the member and the missing descriptor part, and no dispatch is attempted for any member.
- Given two descriptors that declare the same rubric id, when the catalog is resolved, then resolution fails naming the duplicated id rather than dispatching either.
- Given a descriptor whose JSON Schema admits a top-level key outside the closed provider field set for its contract, when the built-in catalog is constructed, then a unit test asserting the `judged` v3 schema's top-level `properties` equal exactly `findings`, `relocationAudit`, `counterfactualSensitivity`, `scopeResolutions` fails.

### Done When
- [ ] A `RubricContractDescriptor` type exists with projection, output, and identity parts, and every `BUILD_REVIEW_RUBRIC_REGISTRY` entry and every resolved custom member carries one.
- [ ] A unit test asserts the three descriptors' versions, frozen JSON Schema objects, and identity parity with the pre-change canonicalizers for fixed findings.
- [ ] A unit test asserts the `judged` v3 schema's top-level properties are exactly the four closed provider fields and its `concernKind` enums equal the engine vocabularies for `testQuality` and `security`.
- [ ] A unit test asserts catalog resolution fails, naming the member, when a descriptor part is absent or a rubric id is duplicated.

## Story 2: One generic dispatch requests the provider's native structured output for every member

As the build_review coordinator, I want a single dispatch path to send the descriptor's JSON Schema through the provider's native structured-output option and to treat the terminal structured result as the only source of the payload so that no rubric output is ever recovered from prose or markdown.

### Acceptance Criteria

#### Happy Path
- Given a `testQuality` branch with an admitted projection and a Claude candidate, when the branch is dispatched, then the recorded invocation options carry `nativeSchema` equal to the descriptor's JSON Schema and the Claude adapter fixture receives `--json-schema` with that schema serialized.
- Given the same branch with a Codex candidate, when the branch is dispatched, then the Codex adapter fixture receives `--output-schema` naming a file under the invocation's engine-owned scratch home whose bytes equal the serialized schema, and the scratch home is removed after the invocation settles.
- Given a provider result whose `finalStructuredResult` is a valid payload and whose `output` text is a valid payload wrapped in prose with a different `findings` array, when the branch is validated, then the stamped result's findings equal the structured result's findings and the prose payload is never parsed.
- Given a `custom-v1` branch, when it is dispatched, then it passes through the same dispatch function as the built-in branches with its own descriptor's schema and the policy bundle text still precedes the skill invocation in the prompt.

#### Negative Paths
- Given a provider result with `success: true`, a prose `output` containing a well-formed payload, and no `finalStructuredResult`, when the branch is validated, then it is rejected as an absent structured result and the prose payload is not used.
- Given a provider result whose `finalStructuredResult` is a JSON string rather than an object, when the branch is validated, then it is rejected naming the root as the offending field and the form it requires.
- Given the built-in dispatch, when the retired prose-scrape extraction is referenced from the build_review path, then a test asserting the build_review dispatch module has no import of the scrape helper fails, so the scrape path cannot be silently re-wired.
- Given a Codex candidate whose scratch home cannot be created, when the branch is dispatched, then the branch settles as a mechanical fault naming the scratch-home failure and no schema file is written outside the invocation scratch directory.

### Done When
- [ ] Built-in and custom rubric dispatch share one function in `step-runners.ts` that passes `nativeSchema` from the descriptor for every member.
- [ ] Adapter fixture tests for Claude and Codex assert the native schema option is received with the descriptor's serialized schema and that the Codex scratch file is removed after settlement.
- [ ] A coordinator test asserts a valid prose payload is ignored whenever `finalStructuredResult` is present or absent.
- [ ] The build_review dispatch path has no caller of the prose-scrape extraction; the `code-removal` skill governs its retirement.

## Story 3: An invalid structured result is rejected naming the field and settles as a mechanical fault

As the build_review coordinator, I want a structured result that fails the descriptor's contract to be rejected with the field named and routed through the mechanical-fault lane so that a contract violation never becomes a semantic verdict, never burns kickback budget, and is never repaired by a second prompt.

### Acceptance Criteria

#### Happy Path
- Given a structured result whose finding cites a content-region `contentHash` absent from the projection, when it is validated, then the rejection names `findings[0].anchor.locus.contentHash` and states that it must equal a hash the projection lists, and the branch settles `absent` with cause `invalid-structured-result`.
- Given a structured result whose `concernKind` is outside the descriptor enum, when it is validated, then the rejection names `findings[0].concernKind` and lists the admitted members, and the branch settles `absent` with cause `invalid-structured-result`.
- Given two findings in one structured result that canonicalize to the same identity, when it is validated, then the rejection names the duplicate finding id and the branch settles `absent`.
- Given an `invalid-structured-result` fault, when the lap settles, then no aggregate is published for that rubric, no kickback is charged, no convergence cap ticks, and the fault event carries the field-named rejection.

#### Negative Paths
- Given an `invalid-structured-result` on the first dispatch, when the branch settles, then exactly one provider invocation was made for that branch and no repair prompt was sent.
- Given a rejection whose cause is not explained by any enumerated check, when the diagnosis is rendered, then it reports the rejection as unexplained and names no field absent from the payload.
- Given `invalid-structured-result` faults on three consecutive laps for the same rubric, when the third settles, then the feature halts `needs-human` under the existing mechanical-fault bound rather than a fourth dispatch.
- Given a structured result rejected for a contract violation and a second rubric in the same lap that judged cleanly, when the lap settles, then the clean rubric's result is retained and only the rejected rubric is `absent`.

### Done When
- [ ] `describeBuildReviewJudgedResultRejection` runs over the structured result and its enumerated problems name the field path and the form required for hash membership, enum membership, and duplicate identity.
- [ ] The coordinator's terminal classification maps a rejected structured result to `invalid-structured-result` and the fault-cause mapping is total with the prose-scrape causes removed.
- [ ] A test asserts exactly one invocation per branch on rejection and that the repair-prompt path has no remaining caller.
- [ ] A test asserts three consecutive `invalid-structured-result` laps halt `needs-human` and a clean sibling rubric survives a rejected one.

## Story 4: A provider without native structured-output capability is a deterministic mechanical fault

As the build_review coordinator, I want a lap whose admitted candidates cannot honor a native schema to settle once as `native-schema-unsupported` so that the gate never silently falls back to prose and never retries a fault that cannot clear within the lap.

### Acceptance Criteria

#### Happy Path
- Given a rubric branch whose only admitted candidate's provider declares no `nativeOutputSchema` capability, when the branch is dispatched, then no provider process is launched, the branch settles `absent` with cause `native-schema-unsupported`, and the fault carries the recovery action naming the provider.
- Given a branch with one capable and one incapable candidate, when it is dispatched, then the incapable candidate is skipped, the capable candidate is invoked with the schema, and no fault is recorded.
- Given a `native-schema-unsupported` fault, when the lap settles, then the fault is charged once against the mechanical allowance and the branch is not re-dispatched within that lap.

#### Negative Paths
- Given a `native-schema-unsupported` fault, when the next lap begins with the same candidate set, then the fault is recorded again as deterministic rather than treated as cleared, and the operator lever names the candidate set as the cause.
- Given a candidate whose provider declares the capability but the adapter returns `nativeSchemaUnsupported: true` on invocation, when the branch settles, then it is classified `native-schema-unsupported`, not `invalid-structured-result`.
- Given the fault-cause mapping, when a new branch reason is added without a cause, then the exhaustiveness test over the closed mapping fails at authoring time.

### Done When
- [ ] `native-schema-unsupported` is a closed cause in the mechanical-fault mapping, charged once per lap and never retried within the lap.
- [ ] A test asserts an incapable-only candidate set launches no provider and settles `absent` with the cause and recovery action.
- [ ] A test asserts an adapter-reported `nativeSchemaUnsupported` result classifies as `native-schema-unsupported`.
- [ ] The event-sink exhaustiveness check admits both new causes on `build_review_rubric_infrastructure_failure`.

## Story 5: The custom-v1 reviewer contract is a descriptor on the shared seam

As a project that declares a custom build_review rubric, I want my reviewer's payload to be requested and validated through the same native-schema seam as the built-in rubrics so that the shape my reviewer is shown is the shape the engine accepts and an unsupported-policy outcome is a valid result rather than a parse failure.

### Acceptance Criteria

#### Happy Path
- Given a resolved custom member, when its policy contract is rendered, then the reviewer-facing shape text is derived from the descriptor's JSON Schema and names exactly `kind`, `version`, `findings` for the findings payload and `kind`, `requirement` for the unsupported-policy alternative.
- Given a custom reviewer's structured result of kind `custom-findings` with source regions inside the admitted frozen regions, when it is validated, then the engine stamps rubric, lap, provider, bundle digest, verdict, case id, and effect id exactly as today and the `custom-v1` finding ids equal the pre-change ids for the same findings.
- Given a custom reviewer's structured result of kind `unsupported-policy` with a non-empty `requirement`, when it is validated, then the branch settles as an explicit unsupported-policy result, not as `invalid-structured-result` and not as an empty-findings success.

#### Negative Paths
- Given a custom structured result whose finding cites a source region outside the admitted frozen regions, when it is validated, then the rejection names `findings[0].sourceRegions[0]` and the branch settles `absent` with cause `invalid-structured-result`.
- Given a custom structured result whose `confidence` is `85.5`, when it is validated, then the rejection names `findings[0].confidence` and requires an integer from 0 to 100.
- Given a custom structured result that carries a top-level `rubric` or `lapId` field, when it is validated, then the provider-supplied envelope fields are ignored and the stamped values come from the engine, unchanged from today.

### Done When
- [ ] `renderBuildReviewPolicyContract` renders the reviewer shape from the custom descriptor's JSON Schema; the separate key-list constant has no remaining caller.
- [ ] A test asserts `custom-v1` finding ids and stamped envelope fields are unchanged for a fixed fixture before and after the migration.
- [ ] A test asserts `unsupported-policy` is a valid structured alternative and an out-of-region source or non-integer confidence is a field-named rejection.

## Story 6: Skills carry judgement guidance only and identity is preserved at contract v3

As the operator, I want the two build_review skills to teach the judge what a finding is and not how to format one, and I want every existing disposition and cached identity to keep meaning what it meant, so that rewriting the skill text costs one cache miss and nothing else.

### Acceptance Criteria

#### Happy Path
- Given `skills/build-review-test-quality/SKILL.md` and `skills/build-review-security/SKILL.md`, when read, then each has no `## Result contract` section, no fenced JSON payload example, no per-field list of result keys, and no reference-grammar sentence, while each still defines every member of its rubric's concern-kind vocabulary and its non-finding conditions.
- Given a rubric prompt assembled for `security`, when inspected, then the shape block in the prompt equals the descriptor's rendered shape and the SKILL.md text contributes no shape sentences.
- Given a disposition record accepted before the migration for a `testQuality` finding, when the same finding is raised after the migration, then it matches the record on `id` and `canonicalJson` and is suppressed exactly as before, with `contractVersion` still `v3`.
- Given a cache entry written before the migration for the same snapshot, when looked up after the migration, then it misses on engine identity and the fresh entry records `contractVersion: v3` and `projectionVersion: v3`.

#### Negative Paths
- Given a finding whose summary wording differs from an accepted disposition's but whose anchor and concern kind are identical, when it is raised after the migration, then it still matches the disposition, proving identity remains wording-insensitive.
- Given a cache entry declaring `contractVersion: v4`, when parsed, then it is rejected as invalid, proving the accepted version set did not advance.
- Given the two SKILL.md files, when either regains a fenced JSON object containing a `findings` key, then the integrity suite fails (Story 7) before the change can land.

### Done When
- [ ] Both SKILL.md files have no result-contract, JSON example, field-list, or grammar prose and retain every vocabulary member as a judgement definition.
- [ ] A test asserts a pre-migration disposition matches a post-migration finding with identical anchor and concern kind regardless of summary wording.
- [ ] A test asserts `parseBuildReviewCacheEntry` still rejects `contractVersion: v4` and a pre-migration entry misses on engine identity.

## Story 7: The audits bind the descriptor to the skill text and forbid output-format prose

As the harness integrity suite, I want the provider-contract audit to fail a build_review skill that re-introduces output-format prose and the vocabulary drift guard to bind the descriptor's schema enum to the skill's judgement definitions in both directions so that the engine and the skills cannot drift apart again.

### Acceptance Criteria

#### Happy Path
- Given the shipped `skills/build-review-*/SKILL.md` files, when `test/test_provider_skill_contracts.sh` runs, then the build_review rule passes and reports the forbidden patterns it checked.
- Given the descriptor enum for `security` and the ten kinds the security SKILL.md defines, when `test/check_build_review_rubric_skill_vocabularies.sh` runs, then it reports the two sets equal and passes.
- Given the vocabulary guard's fail-closed modes, when the engine module cannot be imported or the skill's definitions cannot be classified, then the guard fails with `!unenforced` or `!unclassifiable` exactly as today.

#### Negative Paths
- Given a build_review SKILL.md fixture containing a `## Result contract` heading, when the provider-contract audit runs against it, then the audit fails naming the file and the matched pattern.
- Given a fixture containing a fenced block with a `"findings":` key or a sentence beginning `Return exactly one provider payload`, when the audit runs, then it fails naming the pattern.
- Given a descriptor enum that admits a kind the SKILL.md does not define, when the vocabulary guard runs, then it fails naming the unpaired member; given a SKILL.md that defines a kind the enum does not admit, then it fails naming that member.
- Given a fixture where the security SKILL.md still defines all ten kinds but the `## Judgement` section is renamed, when the guard runs, then it fails `!unclassifiable` rather than passing on zero definitions.

### Done When
- [ ] `test/test_provider_skill_contracts.sh` has a build_review rule using `require_absent_pattern` over result-contract headings, fenced findings payloads, and payload-instruction sentences, and it runs under `test/test_harness_integrity.sh`.
- [ ] `test/check_build_review_rubric_skill_vocabularies.sh` compares the descriptor JSON Schema enum against the SKILL.md judgement definitions in both directions and keeps its three fail-closed modes.
- [ ] Negative fixtures for each forbidden pattern and each unpaired-member direction fail the respective check.
- [ ] `build-review-skill-contract.test.ts` and `build-review-rubric-skills.test.ts` assert the absence of shape prose and the presence of every vocabulary definition instead of asserting the removed contract sentences.

## Story 8: Rubric dispatch is non-interactive and behaves identically on both providers

As the operator running build_review under either conductor mode and either provider, I want the rubric dispatch to never open an interactive session and to produce the same stamped result from equivalent structured output so that the native-schema seam cannot be refused by an interactive invocation and Claude/Codex parity holds.

### Acceptance Criteria

#### Happy Path
- Given the conductor in interactive mode, when build_review fans out its rubrics, then every rubric invocation is recorded with `interactive: false` and carries `nativeSchema`.
- Given equivalent structured results from a Claude fixture and a Codex fixture for the same projection, when both are validated, then the stamped envelopes and finding ids are byte-identical.
- Given a Codex structured result delivered as the terminal item of the `exec --json` stream, when the adapter settles, then `finalStructuredResult` holds the parsed object and `output` still carries the transcript text unchanged.

#### Negative Paths
- Given a test that forces a rubric invocation with `interactive: true`, when it reaches the Claude adapter, then the adapter returns `nativeSchemaUnsupported: true` and the coordinator classifies it `native-schema-unsupported`, proving the refusal is observable rather than silent.
- Given a Codex fixture that requested a schema and ends without a structured item, when the adapter settles, then the result is a failure naming the missing structured result, not a success with prose output.
- Given a Claude fixture whose terminal envelope carries `structuredOutput` and a Codex fixture whose terminal item carries the equivalent object with a different key order, when both are canonicalized, then the finding ids are identical.

### Done When
- [ ] A test asserts every build_review rubric invocation under interactive conductor mode is recorded non-interactive with `nativeSchema` set.
- [ ] Parity fixtures for Claude and Codex assert byte-identical stamped envelopes and finding ids from equivalent structured results.
- [ ] Adapter fixtures assert a missing structured result after a schema request is a failure on both providers.
