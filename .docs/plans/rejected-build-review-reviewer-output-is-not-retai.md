# Implementation Plan: Rejected build_review reviewer output is retained for diagnosis

**Date:** 2026-10-10
**Design:** none (Tier S, technical track — `.docs/track/rejected-build-review-reviewer-output-is-not-retai.md`)
**Stories:** .docs/stories/rejected-build-review-reviewer-output-is-not-retai.md
**Conflict check:** Not required (Tier S)

## Summary

Retains every `build_review` reviewer response the engine rejects as `invalid-structured-result` — built-in and custom rubrics — as one engine-written evidence record per lap, rubric, and attempt; retains the custom-rubric reviewer prompt beside its lap artifact; records a per-region frozen-input comparison for custom rejections; and links each record from the existing fault event. Seven tasks.

## Technical Approach

- **Record writer (new module `src/conductor/src/engine/build-review-rejection-retention.ts`).** Exports `BUILD_REVIEW_REJECTION_DIRECTORY = '.pipeline/build-review-rejections'`, `BUILD_REVIEW_REJECTION_OUTPUT_LIMIT_BYTES = 1_048_576`, the record type, and `retainBuildReviewRejectedResponse(input, fs?) : Promise<string | undefined>`. Input: `{ pipelineDir, worktreeRoot, lapId, rubric, rubricKind: 'builtin' | 'custom', detail, rejection?, provider?, model?, structuredResult, output?, promptPath?, promptSha256?, regionComparison? }`. It writes `<pipelineDir>/build-review-rejections/<lapId>/<rubric>.<attempt>.json`, where `attempt` is 1 + the highest integer `N` among existing `<rubric>.<N>.json` names in that directory (1 when none). The write uses `writeFile(path, body, { flag: 'wx' })` so an existing record is never overwritten; on `EEXIST` it retries with the next ordinal (at most 8 tries). Record body (pretty JSON, trailing newline): `{ version: 1, rubric, rubricKind, lapId, attempt, reason: 'invalid-structured-result', detail, rejection?, provider?, model?, structuredResult, output?, outputBytes?, outputTruncated?, promptPath?, promptSha256?, regionComparison? }`. `structuredResult` is stored whole (`null` when the provider returned none). `output` is truncated to the longest prefix of at most `BUILD_REVIEW_REJECTION_OUTPUT_LIMIT_BYTES` UTF-8 bytes that does not split a character, with `outputBytes` = original UTF-8 length and `outputTruncated` boolean. No timestamp is stamped into the record (event-spine skill §3; the occurrence time lives on the event). It returns the record path relative to `worktreeRoot` (POSIX separators), or `undefined` on any error — it never throws.
- **Lap input digest.** `BUILD_REVIEW_ENGINE_OWNED_LAP_WRITES` in `src/conductor/src/engine/build-review-input-integrity.ts` gains `BUILD_REVIEW_REJECTION_DIRECTORY`, mapped through its existing `pipelineRelative`, so retained records are engine-owned writes that never make a lap `review-input-mutated`. The directory sits outside `.pipeline/build-review/<lapId>/`, which a custom-policy lap deletes before every replay, so earlier attempts survive.
- **Region comparison (pure, `src/conductor/src/engine/build-review-source-region-admission.ts`).** New export `compareBuildReviewCitedSourceRegions(value: unknown, changes, reader) : Promise<readonly BuildReviewCitedRegionComparison[]>`. It walks `value.findings[i].sourceRegions[j]` and keeps only entries with a string `path` and safe-integer `startLine`/`endLine` (a non-string `contentHash` is recorded as absent). For every kept entry, in citation order and without stopping at the first failure, it reuses the admission rule: no matching change → `outside-changed-input`; side is `baseline` for change kind `D`, else `head`; a read throw or `absent` blob → `frozen-blob-unavailable`; `hashBuildReviewFrozenSourceLines` returning `undefined` → `range-outside-blob` with `frozenLineCount`; a computed hash unequal to the cited one → `content-hash-mismatch`; equal → `match`. Entry: `{ finding, region, path, startLine, endLine, citedContentHash?, side?, status, frozenContentHash?, frozenLineCount? }`; `frozenContentHash` is present only for `match` and `content-hash-mismatch`, and `frozenLineCount` whenever a blob was read. A value with no well-formed region yields `[]`. `admitBuildReviewCustomSourceRegions` is not changed.
- **Event field.** The `build_review_rubric_infrastructure_failure` variant in `src/conductor/src/types/events.ts` gains optional `retainedResponsePath?: string`. No new variant.
- **Built-in path.** `BuildReviewDispatchFailure` (`src/conductor/src/engine/build-review-domain.ts`) gains optional `retainedResponsePath`; `makeBuildReviewDispatchFailure` accepts it in its `invalid-structured-result` structured-failure argument and `parseBuildReviewDispatchFailure` preserves a non-empty string value. In `dispatchBuildReviewRubric` (`src/conductor/src/engine/step-runners.ts`), each of the three `invalid-structured-result` returns (the `structuredResultFailure` branch, the non-object branch, and the failed-validation branch) first calls `retainBuildReviewRejectedResponse` with `pipelineDir: join(this.projectDir, '.pipeline')` (the same root as the built-in `<rubric>.prompt.txt`), `rubricKind: 'builtin'`, the `detail` and `rejection` it is about to return, `structuredResult: initial.finalStructuredResult ?? null`, and `output: initial.output`, and passes the returned path into the failure. In `build-review-coordinator.ts`, the infrastructure-failure outcome keeps `failure?.retainedResponsePath` beside its branch (never inside the branch result, whose artifact parser is exact-key) and the emitted event adds `retainedResponsePath` when present.
- **Custom path.** `dispatchInstalledBuildReviewPolicy` gains a trailing optional `pipelineDir` parameter (default `this.buildReviewPipelineDir()`); `runRubricBuildReviewInner` passes `effectivePipelineDir`. Before invoking, it writes the composed prompt (the exact `options.prompt` passed to `dispatchRubricContract`) to `<pipelineDir>/build-review/<lapId>/<rubricId>.prompt.txt` best-effort (`mkdir` + `writeFile`, errors swallowed, as the built-in prompt write does) and remembers its worktree-relative path (POSIX separators) as `promptPath` and the `sha256` hex of its bytes as `promptSha256` only when the write succeeded. `settleCustomStructuredRejection` and the `unsupported-policy` branch call `retainBuildReviewRejectedResponse` with `rubricKind: 'custom'`, `structuredResult: invoked.finalStructuredResult ?? null`, `output: invoked.output`, the prompt fields, the candidate provider and actual model, the same `failure.detail` and `rejection`, and `regionComparison` from `compareBuildReviewCitedSourceRegions(invoked.finalStructuredResult, inputs.sourceSnapshot.sourceChanges ?? [], frozenReader)`, where `frozenReader` reads through `BuildReviewScopeSource(this.gitRunner, headSha)` exactly as admission does. Their existing `build_review_rubric_infrastructure_failure` emissions add `retainedResponsePath` when defined.
- **Invariant.** Retention runs after the rejection's `detail` and `rejection` are fixed and only adds a returned path; the failure `reason`, `detail`, `rejection`, kickback-ledger charge, cache writes, and verdict are computed exactly as today.
- **Test pattern.** Follow `.agents/skills/write-tests/SKILL.md`. Unit tests use a `mkdtemp` root removed in `finally`. Built-in entry tests extend the `build_review` block of `src/conductor/test/engine/step-runners.test.ts` (search hint: `persists the exact dispatched rubric prompt beside the lap artifact`): `createMockProvider`, `scopedPlan()`, `scopedGit()`, testQuality opt-in config, `inspectTestSuite` returning CURRENT, then `runner.run('build_review', emptyState)`; capture events with a `ConductorEventEmitter` passed as the runner's `events` option (search hint: `events.on('coverage_binding_judged'`), and read `readKickbackLedger(dir)`. Custom tests extend `src/conductor/test/engine/build-review-step.test.ts` (search hint: `runs a resolved custom member through the recording-provider dispatcher after its policy bundle`): a mocked `ProviderRuntimeSet` runtime, `buildReviewPolicyCatalog`/`buildReviewPolicyCapture` fakes, and a direct `dispatchInstalledBuildReviewPolicy` call; allowed variation: `sourceChanges` names the fixture file and the `gitRunner` answers `git show <headSha>:<path>` with fixed blob text.

## Prerequisites

- Stories carry `**Status:** Accepted`.

## Tasks

### Task 1: Rejected-response record writer

**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/build-review-rejection-retention.test.ts` (temp root, cleanup in `finally`): (a) two calls for lap `lap-a` rubric `eventSpine` return `.pipeline/build-review-rejections/lap-a/eventSpine.1.json` then `.../eventSpine.2.json`; the first file's bytes are identical before and after the second call; record 2 has `attempt` 2 and both have `version` 1, `reason` `invalid-structured-result`, and the supplied `detail`, `rejection`, and `structuredResult`; (b) a 1048577-byte output made of `'a'` repeated 1048575 times plus `'é'` (2 bytes) is stored as the 1048575-byte prefix, with `outputTruncated` true and `outputBytes` 1048577, while a 2 MiB `structuredResult` string field is stored whole; (c) when `<root>/.pipeline/build-review-rejections` is a regular file, the call resolves `undefined` and does not throw.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/build-review-rejection-retention.ts` exactly as in Technical Approach.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(build-review): retain rejected reviewer responses per lap attempt"

**Done when:**
- [test] A `retainBuildReviewRejectedResponse` test asserts two rejections for one lap and rubric return `eventSpine.1.json` then `eventSpine.2.json`, record 2 carries `attempt` 2, and `eventSpine.1.json` is byte-for-byte unchanged by the second write.
- [test] The same test asserts each record carries `version` 1, `rubric`, `reason` `invalid-structured-result`, and the supplied `detail`, `rejection`, `structuredResult`, and `output`.
- [test] A `retainBuildReviewRejectedResponse` test asserts output over 1048576 UTF-8 bytes is stored as exactly the longest prefix of at most 1048576 bytes that does not split a character (the 1048575-byte prefix for the fixture), with `outputTruncated` true and `outputBytes` equal to the original length, while `structuredResult` is stored whole.
- [test] A `retainBuildReviewRejectedResponse` test asserts the writer resolves `undefined` without throwing when a regular file occupies the retention directory path.

**Files:** `src/conductor/src/engine/build-review-rejection-retention.ts`, `src/conductor/test/engine/build-review-rejection-retention.test.ts`

**Dependencies:** none

### Task 2: Retained records are engine-owned lap writes

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/build-review-input-integrity.test.ts` following its `excludes the engine-owned in-lap writes while prior-lap build-review evidence stays hashed` pattern: a tree with `/evidence/build-review-rejections/lap-a/eventSpine.1.json` and `/evidence/build-review/lap-old/portable.json`; capture with `evidenceRootExcludes: BUILD_REVIEW_ENGINE_OWNED_LAP_WRITES`; rewrite both files; assert `diffBuildReviewInputDigests` returns only `['evidenceRoot:build-review/lap-old/portable.json']`.
2. Verify the test fails (RED).
3. Implement: add `BUILD_REVIEW_REJECTION_DIRECTORY` (imported from `./build-review-rejection-retention.js`) to `BUILD_REVIEW_ENGINE_OWNED_LAP_WRITES`.
4. Verify the test passes (GREEN).
5. Commit with message: "fix(build-review): keep retained rejections out of the lap input digest"

**Done when:**
- [test] A `diffBuildReviewInputDigests` test asserts a rewritten `build-review-rejections/lap-a/eventSpine.1.json` present at capture is not reported as a changed input, so the lap gate's `review-input-mutated` settlement (which fires only on a non-empty change list) is not triggered by it.
- [test] The same test asserts a rewritten prior-lap `build-review/lap-old/portable.json` is still reported, so the exclusion is limited to the retention directory.

**Files:** `src/conductor/src/engine/build-review-input-integrity.ts`, `src/conductor/test/engine/build-review-input-integrity.test.ts`

**Dependencies:** Task 1

### Task 3: Non-short-circuit cited-region comparison

**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/build-review-source-region-comparison.test.ts` with a fake `BuildReviewFrozenSourceReader` serving `src/a.ts` (head, 5 lines) and changes `[{ path: 'src/a.ts', kind: 'M' }]`: (a) a payload citing `src/a.ts:1-2` with the hash `hashBuildReviewFrozenSourceLines` gives and `src/a.ts:3-4` with a wrong hash returns two entries in order with `status` `match` then `content-hash-mismatch`, each with `side` `head`, the cited bounds and hash, and `frozenContentHash`; (b) a region in `src/other.ts` returns `outside-changed-input` with no `frozenContentHash`; (c) `src/a.ts:4-9` returns `range-outside-blob` with `frozenLineCount` 5 and no `frozenContentHash`; (d) a reader that throws returns `frozen-blob-unavailable`; (e) `{ kind: 'custom-findings', findings: 'not-an-array' }`, `null`, and a payload whose regions lack integer bounds each return `[]`; (f) when the first cited region fails, a second matching region still gets a `match` entry.
2. Verify the tests fail (RED).
3. Implement `compareBuildReviewCitedSourceRegions` in `src/conductor/src/engine/build-review-source-region-admission.ts` exactly as in Technical Approach, reusing `hashBuildReviewFrozenSourceLines`; leave `admitBuildReviewCustomSourceRegions` unchanged.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(build-review): compare every cited region with the frozen input"

**Done when:**
- [test] A `compareBuildReviewCitedSourceRegions` test asserts two cited head-side regions return entries in citation order with `status` `match` and `content-hash-mismatch`, each carrying the cited bounds, cited hash, `side` `head`, and engine-computed `frozenContentHash`.
- [test] A `compareBuildReviewCitedSourceRegions` test asserts a region outside the changed input returns `outside-changed-input` without `frozenContentHash`, and a region past the blob end returns `range-outside-blob` with `frozenLineCount` 5.
- [test] A `compareBuildReviewCitedSourceRegions` test asserts a thrown read returns `frozen-blob-unavailable` and a matching region cited after a failing one still returns `match`.
- [test] A `compareBuildReviewCitedSourceRegions` test asserts a payload with no well-formed `findings[].sourceRegions[]` entry returns an empty array.

**Files:** `src/conductor/src/engine/build-review-source-region-admission.ts`, `src/conductor/test/engine/build-review-source-region-comparison.test.ts`

**Dependencies:** none

### Task 4: Built-in rejections are retained and linked from the fault event

**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test in the `build_review` block of `src/conductor/test/engine/step-runners.test.ts` using the pattern of `persists the exact dispatched rubric prompt beside the lap artifact` (mock provider, `scopedPlan()`, `scopedGit()`, testQuality enabled, CURRENT suite evidence, `runner.run('build_review', emptyState)`), with a `ConductorEventEmitter` passed as `events` collecting `build_review_rubric_infrastructure_failure`. The provider resolves `{ success: true, exitCode: 0, output: 'reviewer final message', finalStructuredResult: { findings: [{ concernKind: 'test-insensitive' }] } }`. Assert: the lap's `.pipeline/build-review-rejections/<lap>/testQuality.1.json` exists with `version` 1, `rubric` `testQuality`, `rubricKind` `builtin`, `attempt` 1, `reason` `invalid-structured-result`, `output` `reviewer final message`, a `structuredResult` whose `findings` deep-equals the provider's findings, and `detail` and `rejection` equal to the ledger's `lastMechanicalFault.detail` and the event's `rejection`; the event's `retainedResponsePath` equals `.pipeline/build-review-rejections/<lap>/testQuality.1.json`.
2. Verify the test fails (RED).
3. Implement: the optional `retainedResponsePath` on the event variant, on `BuildReviewDispatchFailure` with `makeBuildReviewDispatchFailure` and `parseBuildReviewDispatchFailure` support, the three retention calls in `dispatchBuildReviewRubric`, and the coordinator propagation onto the emitted event, exactly as in Technical Approach.
4. Verify the test passes (GREEN).
5. Commit with message: "feat(build-review): retain rejected built-in rubric responses"

**Done when:**
- [test] A `runner.run('build_review')` test with a provider returning a contract-violating testQuality payload asserts `.pipeline/build-review-rejections/<lap>/testQuality.1.json` carries `version` 1, `rubric` `testQuality`, `attempt` 1, `reason` `invalid-structured-result`, the provider's final output text, and the rejected structured value.
- [test] The same test asserts the record's `detail` equals the kickback ledger's `lastMechanicalFault.detail` and its `rejection` equals the emitted event's `rejection`.
- [test] The same test asserts the emitted `build_review_rubric_infrastructure_failure` event carries `retainedResponsePath` equal to that record's worktree-relative path.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/build-review-domain.ts`, `src/conductor/src/engine/build-review-coordinator.ts`, `src/conductor/src/types/events.ts`, `src/conductor/test/engine/step-runners.test.ts`

**Dependencies:** Task 1

### Task 5: Built-in retention never changes the outcome

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/step-runners.test.ts` with Task 4's fixture: (a) before `runner.run`, write a regular file at `<dir>/.pipeline/build-review-rejections`; assert the step result `output`, `currentLapMechanicalFault` true, the ledger's `mechanicalFaults` 1 and `lastMechanicalFault` `{ rubric: 'testQuality', reason: 'invalid-structured-result', detail }` equal those of Task 4's run, the event has the same `reason`, `cause`, `rejection`, and `excerpt` and no `retainedResponsePath`, and `.pipeline/build-review.json` is still absent; (b) with a provider returning a valid testQuality judgement (reuse the file's existing passing-testQuality payload fixture), assert `.pipeline/build-review-rejections` does not exist after the run.
2. Verify the tests fail against any retention that alters the outcome (RED); if Task 4's implementation already satisfies them, record that and keep them as the guard.
3. Implement: correct any path where a retention failure changes the returned failure or event, or where an accepted result writes a record.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(build-review): built-in retention never alters the fault outcome"

**Done when:**
- [test] A `runner.run('build_review')` test with a regular file occupying `.pipeline/build-review-rejections` asserts the same step `output`, `mechanicalFaults` 1, and `lastMechanicalFault` rubric, reason, and detail as the retained run, and no published `.pipeline/build-review.json`.
- [test] The same test asserts the emitted `build_review_rubric_infrastructure_failure` event keeps the same `reason`, `cause`, `rejection`, and `excerpt` and has no `retainedResponsePath`.
- [test] A `runner.run('build_review')` test with an accepted testQuality judgement asserts no `.pipeline/build-review-rejections` directory exists afterwards.

**Files:** `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/src/engine/step-runners.ts`

**Dependencies:** Task 4

### Task 6: Custom rejections retain the response, prompt, and region comparison

**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-step.test.ts` using the pattern of `runs a resolved custom member through the recording-provider dispatcher after its policy bundle` (mocked runtime, catalog/capture fakes, a `ConductorEventEmitter` as `events`, direct `dispatchInstalledBuildReviewPolicy(entry, inputs, lapId, undefined, undefined, capabilityFor, pipelineDir)` with `pipelineDir = join(projectDir, '.pipeline')`; variation: the entry uses `BUILD_REVIEW_CUSTOM_V1_CONTRACT` unchanged with id `eventSpine`, `sourceChanges` is `[{ path: 'src/a.ts', kind: 'M' }]`, and `gitRunner` answers `git show head:src/a.ts` with five fixed lines). The provider returns a `custom-findings` payload with one finding citing `src/a.ts:1-2` with its correct hash and `src/a.ts:3-4` with a wrong hash. Assert: (a) `<pipelineDir>/build-review/<lap>/eventSpine.prompt.txt` equals the `prompt` the provider invocation received; (b) `.pipeline/build-review-rejections/<lap>/eventSpine.1.json` has `rubricKind` `custom`, `attempt` 1, a `structuredResult` whose `JSON.stringify` is identical to that of the provider's `finalStructuredResult`, the same `detail` and `rejection` as the emitted event's `excerpt` and `rejection`, `promptPath` equal to the prompt file's worktree-relative path, `promptSha256` equal to the prompt file's SHA-256 hex, and `regionComparison` entries in citation order with statuses `match` then `content-hash-mismatch`, each carrying the cited bounds, cited hash, `side` `head`, and `frozenContentHash`; (c) the event carries `retainedResponsePath` naming the record; (d) after deleting `<pipelineDir>/build-review/<lap>/` (as a lap replay does) and dispatching again with the same payload, `eventSpine.2.json` exists with `attempt` 2 and `eventSpine.1.json` is byte-for-byte unchanged.
2. Verify the tests fail (RED).
3. Implement the `pipelineDir` parameter, the custom prompt write, and the retention calls in `settleCustomStructuredRejection` and the `unsupported-policy` branch, with `retainedResponsePath` added to their existing events, exactly as in Technical Approach; pass `effectivePipelineDir` from `runRubricBuildReviewInner`.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(build-review): retain custom rubric prompts and rejected responses"

**Done when:**
- [test] A `dispatchInstalledBuildReviewPolicy` test asserts `build-review/<lap>/eventSpine.prompt.txt` under the passed pipeline directory equals the prompt the provider invocation received.
- [test] The same test asserts `.pipeline/build-review-rejections/<lap>/eventSpine.1.json` exists and carries a `structuredResult` whose `JSON.stringify` is identical to `JSON.stringify` of the provider's `finalStructuredResult`, the event's `detail` and `rejection`, `promptPath` equal to the worktree-relative path of `build-review/<lap>/eventSpine.prompt.txt`, and `promptSha256` equal to the prompt file's SHA-256.
- [test] The same test asserts the emitted `build_review_rubric_infrastructure_failure` event carries `retainedResponsePath` naming `eventSpine.1.json`.
- [test] The same test asserts the record's `regionComparison` has two entries in citation order with `status` `match` then `content-hash-mismatch`, each carrying the cited bounds, the cited hash, `side` `head`, and the engine-computed `frozenContentHash`.
- [test] A replay test asserts that after the lap directory is deleted and the member is dispatched again, `eventSpine.2.json` carries `attempt` 2 and `eventSpine.1.json` is byte-for-byte unchanged.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/build-review-step.test.ts`

**Dependencies:** Tasks 1, 3, 4

### Task 7: Custom retention and prompt writes never change the outcome

**Story:** 2
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/build-review-step.test.ts` with Task 6's fixture: (a) create a regular file at `<pipelineDir>/build-review/<lap>` so the prompt write fails; assert the provider is still invoked once, the member's returned `member.result` is the same `infrastructure-failure` with reason `invalid-structured-result` and the same `detail` as Task 6's run, and the retained record omits `promptPath` and `promptSha256`; (b) with a valid `custom-findings` payload whose regions all match, assert the member settles judged exactly as without the prompt file (same `member.result.verdict`) when the prompt write fails; (c) with a regular file at `.pipeline/build-review-rejections`, assert the same `member.result` reason and detail and an event without `retainedResponsePath`; (d) a fixture returning `{ kind: 'custom-findings', version: 'v1' }` (root contract failure) yields a record with that whole `structuredResult` and `regionComparison` `[]`.
2. Verify the tests fail against any write that alters the outcome (RED); if Task 6's implementation already satisfies them, record that and keep them as the guard.
3. Implement: correct any path where a failed prompt or record write changes invocation, result, or event.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(build-review): custom prompt and retention writes never alter review"

**Done when:**
- [test] A `dispatchInstalledBuildReviewPolicy` test with an unwritable prompt path asserts the provider is invoked once, the rejected member keeps reason `invalid-structured-result` and the same detail, and its retained record omits `promptPath` and `promptSha256`.
- [test] A `dispatchInstalledBuildReviewPolicy` test with an unwritable prompt path and an all-matching payload asserts the member settles judged with the same verdict as with a writable prompt path.
- [test] A `dispatchInstalledBuildReviewPolicy` test with a regular file at `.pipeline/build-review-rejections` asserts the same rejected reason and detail and an emitted event without `retainedResponsePath`.
- [test] A `dispatchInstalledBuildReviewPolicy` test with a root-contract-violating payload asserts the record holds that whole `structuredResult` and an empty `regionComparison`.

**Files:** `src/conductor/test/engine/build-review-step.test.ts`, `src/conductor/src/engine/step-runners.ts`

**Dependencies:** Tasks 1, 3, 6

## Task Dependency Graph

```
Task 1 ──► Task 2
Task 1 ──► Task 4 ──► Task 5
Task 3 ─┐
Task 1 ─┼─► Task 6 ──► Task 7
Task 4 ─┘
```

## Integration Points

- After Task 4: a built-in rubric rejection observed through `runner.run('build_review')` leaves a readable record linked from its fault event.
- After Task 6: a custom-rubric rejection leaves its record, prompt, and region comparison, linked from its fault event, through the production custom dispatch path.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a built-in `testQuality` reviewer whose structured result the engine rejects as `invalid-structured-result` on lap `<lap>`, when `build_review` settles that rubric, then `.pipeline/build-review-rejections/<lap>/testQuality.1.json` exists with `version` 1, `rubric` `testQuality`, `attempt` 1, `reason` `invalid-structured-result`, the same `detail` and `rejection` the fault carries, the rejected structured value, and the provider's final output text. | 4 | "A `runner.run('build_review')` test with a provider returning a contract-violating testQuality payload asserts `.pipeline/build-review-rejections/<lap>/testQuality.1.json` carries `version` 1, `rubric` `testQuality`, `attempt` 1, `reason` `invalid-structured-result`, the provider's final output text, and the rejected structured value." | diff-local |
| Story 1 happy: Given an installed custom rubric `eventSpine` whose structured result the engine rejects on lap `<lap>`, when the custom member settles, then `.pipeline/build-review-rejections/<lap>/eventSpine.1.json` exists and its `structuredResult` deep-equals the provider's `finalStructuredResult` byte-for-byte as JSON. | 6 | "The same test asserts `.pipeline/build-review-rejections/<lap>/eventSpine.1.json` exists and carries a `structuredResult` whose `JSON.stringify` is identical to `JSON.stringify` of the provider's `finalStructuredResult`, the event's `detail` and `rejection`, `promptPath` equal to the worktree-relative path of `build-review/<lap>/eventSpine.prompt.txt`, and `promptSha256` equal to the prompt file's SHA-256." | diff-local |
| Story 1 happy: Given a retained record exists for a rejection, when the engine emits that rejection's `build_review_rubric_infrastructure_failure` event, then the event carries `retainedResponsePath` naming that record's path relative to the worktree root. | 4, 6 | "The same test asserts the emitted `build_review_rubric_infrastructure_failure` event carries `retainedResponsePath` equal to that record's worktree-relative path." | diff-local |
| Story 1 happy: Given `eventSpine.1.json` already exists for lap `<lap>`, when the same lap is replayed and `eventSpine` is rejected again, then `eventSpine.2.json` is written with `attempt` 2 and `eventSpine.1.json` is byte-for-byte unchanged. | 6, 1 | "A replay test asserts that after the lap directory is deleted and the member is dispatched again, `eventSpine.2.json` carries `attempt` 2 and `eventSpine.1.json` is byte-for-byte unchanged." | diff-local |
| Story 1 negative: Given the rejection retention directory cannot be created because a regular file occupies its path, when a rubric's structured result is rejected, then the fault keeps the same `reason`, `detail`, and `rejection`, the mechanical-fault classification is unchanged, and the emitted event has no `retainedResponsePath`. | 5, 7 | "The same test asserts the emitted `build_review_rubric_infrastructure_failure` event keeps the same `reason`, `cause`, `rejection`, and `excerpt` and has no `retainedResponsePath`." | diff-local |
| Story 1 negative: Given a reviewer whose structured result the engine accepts, when `build_review` settles that rubric, then no file is written under `.pipeline/build-review-rejections/` for that rubric. | 5 | "A `runner.run('build_review')` test with an accepted testQuality judgement asserts no `.pipeline/build-review-rejections` directory exists afterwards." | diff-local |
| Story 1 negative: Given a rejected response whose final output text exceeds 1048576 UTF-8 bytes, when it is retained, then the record's `output` is the first 1048576 bytes of that text cut on a character boundary, `outputTruncated` is true, `outputBytes` is the original byte length, and `structuredResult` is not truncated. | 1 | "A `retainBuildReviewRejectedResponse` test asserts output over 1048576 UTF-8 bytes is stored as exactly the longest prefix of at most 1048576 bytes that does not split a character (the 1048575-byte prefix for the fixture), with `outputTruncated` true and `outputBytes` equal to the original length, while `structuredResult` is stored whole." | diff-local |
| Story 1 negative: Given a custom-policy lap starts while a retained record from an earlier attempt of the same lap exists, when the lap's input digest settles, then that record is not listed as a changed input and the lap is not failed as `review-input-mutated`. | 2 | "A `diffBuildReviewInputDigests` test asserts a rewritten `build-review-rejections/lap-a/eventSpine.1.json` present at capture is not reported as a changed input, so the lap gate's `review-input-mutated` settlement (which fires only on a non-empty change list) is not triggered by it." | diff-local |
| Story 2 happy: Given an installed custom rubric `eventSpine` dispatched on lap `<lap>`, when its reviewer is invoked, then `build-review/<lap>/eventSpine.prompt.txt` under the lap's pipeline directory holds exactly the prompt text passed to the provider invocation. | 6 | "A `dispatchInstalledBuildReviewPolicy` test asserts `build-review/<lap>/eventSpine.prompt.txt` under the passed pipeline directory equals the prompt the provider invocation received." | diff-local |
| Story 2 happy: Given a retained rejection record for a custom rubric whose prompt file was written, when the record is read, then it carries `promptPath` naming that prompt file and `promptSha256` equal to the SHA-256 of the prompt file's bytes. | 6 | "The same test asserts `.pipeline/build-review-rejections/<lap>/eventSpine.1.json` exists and carries a `structuredResult` whose `JSON.stringify` is identical to `JSON.stringify` of the provider's `finalStructuredResult`, the event's `detail` and `rejection`, `promptPath` equal to the worktree-relative path of `build-review/<lap>/eventSpine.prompt.txt`, and `promptSha256` equal to the prompt file's SHA-256." | diff-local |
| Story 2 negative: Given the custom prompt file cannot be written, when the custom reviewer is dispatched, then the reviewer is still invoked, its judged or rejected outcome is unchanged, and a retained rejection record for that dispatch omits `promptPath` and `promptSha256`. | 7 | "A `dispatchInstalledBuildReviewPolicy` test with an unwritable prompt path asserts the provider is invoked once, the rejected member keeps reason `invalid-structured-result` and the same detail, and its retained record omits `promptPath` and `promptSha256`." | diff-local |
| Story 3 happy: Given a rejected custom payload whose findings cite two head-side regions of a changed file, where the first region's `contentHash` matches the frozen head bytes and the second's does not, when the record is retained, then its `regionComparison` has two entries in citation order with `status` `match` and `content-hash-mismatch`, each carrying the cited bounds, the cited hash, the frozen `side` `head`, and the engine-computed `frozenContentHash`. | 6, 3 | "The same test asserts the record's `regionComparison` has two entries in citation order with `status` `match` then `content-hash-mismatch`, each carrying the cited bounds, the cited hash, `side` `head`, and the engine-computed `frozenContentHash`." | diff-local |
| Story 3 negative: Given a rejected custom payload citing a region in a file that is not part of the frozen changed input, when the record is retained, then that region's comparison entry has `status` `outside-changed-input` and no `frozenContentHash`. | 3 | "A `compareBuildReviewCitedSourceRegions` test asserts a region outside the changed input returns `outside-changed-input` without `frozenContentHash`, and a region past the blob end returns `range-outside-blob` with `frozenLineCount` 5." | diff-local |
| Story 3 negative: Given a rejected custom payload citing a region whose `endLine` is past the end of the frozen blob, when the record is retained, then that region's comparison entry has `status` `range-outside-blob` and carries the frozen blob's `frozenLineCount`. | 3 | "A `compareBuildReviewCitedSourceRegions` test asserts a region outside the changed input returns `outside-changed-input` without `frozenContentHash`, and a region past the blob end returns `range-outside-blob` with `frozenLineCount` 5." | diff-local |
| Story 3 negative: Given a rejected custom payload that fails the root payload contract and contains no well-formed `findings[].sourceRegions[]` entry, when the record is retained, then the record is still written with the full `structuredResult` and an empty `regionComparison`. | 7 | "A `dispatchInstalledBuildReviewPolicy` test with a root-contract-violating payload asserts the record holds that whole `structuredResult` and an empty `regionComparison`." | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
