# Halt record

Status: halted
Slug: build-review-rubric-findings-arrive-as-typed-struc
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-build-review-rubric-findings-arrive-as-typed-struc
Head SHA: 42ee4b673e4670ae8ce59eecd69d8e382b079391
Halted at: 2026-09-22T22:10:54.501Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 negative: Given a registry entry constructed without an output JSON Schema, when the catalog is resolved, then resolution fails at authoring time with a message naming the member and the missing descriptor part, and no dispatch is attempted for any member.
Task ids: 1
Done when checks: `build-review-registry.ts` entries `testQuality` and `security` each carry a `contract` descriptor with `projection.version` and `output.version` both `v3` and a frozen `output.jsonSchema`, as asserted by the descriptor-shape test | `contract.identity.canonicalize` on each built-in descriptor returns the same `id` as `canonicalizeBuildReviewFindingIdentity` for the fixed finding fixture, as asserted by the identity-parity test | `resolveBuildReviewContractCatalog` in build-review-contract.ts throws naming the member and the missing part when `output.jsonSchema` is absent, and throws naming the duplicated id when two members share one, as asserted by the missing-part and duplicate-id tests
Missing assertion: The cited checks require catalog resolution to throw for a missing output JSON Schema, but do not assert that no member dispatch is attempted.

Criterion: Story 1 negative: Given two descriptors that declare the same rubric id, when the catalog is resolved, then resolution fails naming the duplicated id rather than dispatching either.
Task ids: 1
Done when checks: `build-review-registry.ts` entries `testQuality` and `security` each carry a `contract` descriptor with `projection.version` and `output.version` both `v3` and a frozen `output.jsonSchema`, as asserted by the descriptor-shape test | `contract.identity.canonicalize` on each built-in descriptor returns the same `id` as `canonicalizeBuildReviewFindingIdentity` for the fixed finding fixture, as asserted by the identity-parity test | `resolveBuildReviewContractCatalog` in build-review-contract.ts throws naming the member and the missing part when `output.jsonSchema` is absent, and throws naming the duplicated id when two members share one, as asserted by the missing-part and duplicate-id tests
Missing assertion: The cited checks require catalog resolution to throw naming a duplicated id, but do not assert that neither descriptor is dispatched.

Criterion: Story 3 happy: Given a structured result whose finding cites a content-region `contentHash` absent from the projection, when it is validated, then the rejection names `findings[0].anchor.locus.contentHash` and states that it must equal a hash the projection lists, and the branch settles `absent` with cause `invalid-structured-result`.
Task ids: 7
Done when checks: `describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test | an out-of-enum `concernKind` is rejected naming `findings[0].concernKind` with the admitted members listed, as asserted by the enum-rejection test | two findings that canonicalize to one identity are rejected naming the duplicate id, and a string root is rejected at `$` requiring an object, as asserted by the duplicate-identity and root-shape tests | a rejection no enumerated check explains is reported as unexplained and names no field absent from the payload, as asserted by the unexplained-rejection test
Missing assertion: The cited checks assert the rejection message for an unlisted content hash, but do not assert that the branch settles absent with cause invalid-structured-result.

Criterion: Story 3 happy: Given a structured result whose `concernKind` is outside the descriptor enum, when it is validated, then the rejection names `findings[0].concernKind` and lists the admitted members, and the branch settles `absent` with cause `invalid-structured-result`.
Task ids: 7
Done when checks: `describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test | an out-of-enum `concernKind` is rejected naming `findings[0].concernKind` with the admitted members listed, as asserted by the enum-rejection test | two findings that canonicalize to one identity are rejected naming the duplicate id, and a string root is rejected at `$` requiring an object, as asserted by the duplicate-identity and root-shape tests | a rejection no enumerated check explains is reported as unexplained and names no field absent from the payload, as asserted by the unexplained-rejection test
Missing assertion: The cited checks assert the concernKind rejection message and admitted members, but do not assert that the branch settles absent with cause invalid-structured-result.

Criterion: Story 3 happy: Given two findings in one structured result that canonicalize to the same identity, when it is validated, then the rejection names the duplicate finding id and the branch settles `absent`.
Task ids: 7
Done when checks: `describeBuildReviewJudgedResultRejection` names `findings[0].anchor.locus.contentHash` and the projected-hash requirement for an unlisted hash, as asserted by the unlisted-hash test | an out-of-enum `concernKind` is rejected naming `findings[0].concernKind` with the admitted members listed, as asserted by the enum-rejection test | two findings that canonicalize to one identity are rejected naming the duplicate id, and a string root is rejected at `$` requiring an object, as asserted by the duplicate-identity and root-shape tests | a rejection no enumerated check explains is reported as unexplained and names no field absent from the payload, as asserted by the unexplained-rejection test
Missing assertion: The cited checks require rejection naming the duplicate finding id, but do not explicitly require the branch to settle `absent`.

Criterion: Story 5 negative: Given a custom structured result whose finding cites a source region outside the admitted frozen regions, when it is validated, then the rejection names `findings[0].sourceRegions[0]` and the branch settles `absent` with cause `invalid-structured-result`.
Task ids: 11
Done when checks: a `custom-findings` structured result is stamped with the same rubric, lap, provider, bundle digest, verdict, case id, effect id and the same `custom-v1` ids as the pre-change golden, as asserted by the custom-stamping-parity test | an `unsupported-policy` structured result settles as the explicit unsupported-policy result rather than `invalid-structured-result` or an empty-findings success, as asserted by the unsupported-policy test | an out-of-region source is rejected naming `findings[0].sourceRegions[0]` and a `confidence` of `85.5` is rejected naming `findings[0].confidence` requiring an integer 0-100, as asserted by the custom-rejection tests | provider-supplied `rubric` and `lapId` on a custom payload are ignored and the stamped values come from the engine, as asserted by the envelope-ignored test
Missing assertion: The cited checks require rejection naming the out-of-region path, but do not explicitly require the branch to settle absent with cause `invalid-structured-result`.

Criterion: Story 6 happy: Given a disposition record accepted before the migration for a `testQuality` finding, when the same finding is raised after the migration, then it matches the record on `id` and `canonicalJson` and is suppressed exactly as before, with `contractVersion` still `v3`.
Task ids: 13
Done when checks: `matchesBuildReviewDisposition` matches a pre-migration record against a post-migration finding with identical anchor and concern kind and different summary, and the effective verdict suppresses it, as asserted by the wording-insensitive-match test | a pre-migration cache entry misses with `engine-version-mismatch` and the fresh entry written through `tryWriteBuildReviewCacheEntry` carries `contractVersion` `v3` and `projectionVersion` `v3` read from the descriptor, as asserted by the cache-version test | `parseBuildReviewCacheEntry` rejects an entry declaring `contractVersion: "v4"`, as asserted by the rejected-v4 test
Missing assertion: The cited checks do not require that the pre- and post-migration finding match specifically on `id` and `canonicalJson`, or that the disposition record retains `contractVersion` `v3`.

Criterion: Story 6 negative: Given the two SKILL.md files, when either regains a fenced JSON object containing a `findings` key, then the integrity suite fails (Story 7) before the change can land.
Task ids: 14
Done when checks: `test/test_provider_skill_contracts.sh` passes on the shipped build_review skills and prints the forbidden patterns it checked, as asserted by running the audit | the audit fails naming the file and the matched pattern for each fixture carrying a `## Result contract` heading, a fenced `"findings":` payload, or the `Return exactly one provider payload` sentence, as asserted by the fixture self-test loop | a build_review skill that regains a fenced `"findings"` payload fails `test/test_harness_integrity.sh` through the audit, as asserted by the integrity self-test
Missing assertion: The cited check asserts that the integrity suite fails through the audit, but does not explicitly assert that failure prevents the change from landing.

Criterion: Story 8 happy: Given equivalent structured results from a Claude fixture and a Codex fixture for the same projection, when both are validated, then the stamped envelopes and finding ids are byte-identical.
Task ids: 16
Done when checks: under interactive conductor mode every build_review rubric invocation is recorded with `interactive: false` and `nativeSchema` set, as asserted by the interactive-mode dispatch test | a forced interactive rubric invocation surfaces the Claude adapter's `nativeSchemaUnsupported: true` and classifies as `native-schema-unsupported`, as asserted by the forced-interactive test | equivalent Claude and Codex structured results with different key order stamp deep-equal envelopes and identical finding ids, as asserted by the provider-parity test
Missing assertion: The cited check requires deep-equal envelopes and identical finding ids, but does not require byte-identical envelopes or finding ids.

Criterion: Story 8 happy: Given a Codex structured result delivered as the terminal item of the `exec --json` stream, when the adapter settles, then `finalStructuredResult` holds the parsed object and `output` still carries the transcript text unchanged.
Task ids: 5
Done when checks: the Claude fixture argv carries `--json-schema` with the serialized descriptor schema for a rubric invocation, as asserted by the claude-argv test | the Codex fixture argv carries `--output-schema` naming a file under the invocation scratch home whose bytes equal the serialized schema and which does not exist after settlement, as asserted by the codex-argv and scratch-removed tests | a forced scratch-home creation failure settles the branch as a mechanical fault whose detail names the scratch home and leaves no file outside the scratch directory, as asserted by the scratch-failure test | a Codex stream that requested a schema and ends without a structured item settles `success: false` naming the missing structured result while `output` retains the transcript, as asserted by the missing-structured-item test
Missing assertion: No cited check requires a terminal Codex stream item to populate finalStructuredResult with a parsed object while preserving output unchanged.

Criterion: Story 8 negative: Given a Claude fixture whose terminal envelope carries `structuredOutput` and a Codex fixture whose terminal item carries the equivalent object with a different key order, when both are canonicalized, then the finding ids are identical.
Task ids: 16
Done when checks: under interactive conductor mode every build_review rubric invocation is recorded with `interactive: false` and `nativeSchema` set, as asserted by the interactive-mode dispatch test | a forced interactive rubric invocation surfaces the Claude adapter's `nativeSchemaUnsupported: true` and classifies as `native-schema-unsupported`, as asserted by the forced-interactive test | equivalent Claude and Codex structured results with different key order stamp deep-equal envelopes and identical finding ids, as asserted by the provider-parity test
Missing assertion: The cited check requires equivalent Claude and Codex structured results with different key order to produce deep-equal envelopes and identical finding ids, but does not require the specified Claude structuredOutput envelope or Codex terminal-item forms.
```
