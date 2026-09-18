# Implementation Plan: batched coverage-binding judge with per-batch checkpoints (#2493)

**Date:** 2026-09-18
**Stories:** .docs/stories/coverage-binding-serializes-judgments-and-loses-pa.md
**Conflict check:** Clean as of 2026-09-18 (0 blocking; 1 degrading accepted — see `.docs/conflicts/coverage-binding-serializes-judgments-and-loses-pa.md`)

## Summary

Replace `coverage_binding`'s one-session-per-claim loop with bounded batches (one fresh session per batch, verdicts keyed by engine-stamped digest, exact digest-set validation) and checkpoint the envelope after every batch so an interrupted run resumes from judged digests. Nine tasks; amends `adr-2026-08-31-coverage-binding-judge-step` D5 via D12–D15 (already committed on this branch).

## Technical Approach

- **Envelope module first** (`src/conductor/src/engine/coverage-binding-envelope.ts`): add the `partial` status (kept out of `COVERAGE_BINDING_COMPLETION_STATUSES`) and a `parseJudgeBatchPayload(payload, issuedDigests)` that lifts the existing fail-closed `parseJudgePayload` rules to an array keyed by digest and additionally requires returned-set == issued-set with no repeats. Both are pure and unit-tested in isolation.
- **Pure batch planner** (`src/conductor/src/engine/coverage-binding-batches.ts`): `planCoverageBindingBatches({ claims, previous, batchSize })` partitions claims into cached entries (any previous entry with `asserts`/`does-not-assert`, whatever the envelope status), `not-applicable` entries (D8), and pending claims chunked in claim order. This is the cache/not-applicable logic currently inline in `runCoverageBinding`, extracted so resume behavior is testable without a provider.
- **Config** (`config.ts`, `resolved-config.ts`): `coverage_binding.judge.batch_size`, positive integer, default 8, wired exactly like `enabled` (registry entry, fail-closed validator in the same block, resolved policy field).
- **Runner** (`runCoverageBinding` in `step-runners.ts`): plan → checkpoint `partial` → for each batch: build a prompt (`{ claims: [{digest, criterion, taskIds, doneWhen}] }` plus the rendered skill invocation), dispatch through the existing lifecycle-supervised / plain-invoke branches with a fresh session, parse with `parseJudgeBatchPayload`, append entries from the engine's claims (never from the payload), checkpoint `partial` → finally `done` / `refused`; on provider failure or a rejected batch, write `failed` with entries so far and return the existing `CoverageBindingPayloadError` shape (no `refusal`). Batches are sequential — no concurrency (scope boundary).
- **Skill** (`skills/coverage-binding/SKILL.md`): result contract becomes the `verdicts` array keyed by digest, with an explicit independence rule.
- Sequencing: Tasks 1–3 and 9 are independent leaves; Task 4 needs the `partial` status (1); Task 5 needs 2, 3, 4; Tasks 6 → 7, 8 layer checkpointing and failure handling on the batched runner.

## Prerequisites

- `adr-2026-08-31-coverage-binding-judge-step` D12–D15 amendment committed on this branch (done in DECIDE).
- Existing runner test fixtures for `coverage_binding` (fake provider, in-memory `CoverageBindingEnvelopeFilesystem`) — rediscover via `coverage-binding` in `src/conductor/test/engine/`.

## Tasks

### Task 1: Add the `partial` envelope status and keep it out of the completion set
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`: `parseCoverageBindingEnvelope` round-trips an envelope with `status: "partial"` and two entries; `COVERAGE_BINDING_ENVELOPE_STATUSES` contains `partial`; `COVERAGE_BINDING_COMPLETION_STATUSES` deep-equals `['disabled', 'done']`. Add a test in `src/conductor/test/engine/artifacts.test.ts` asserting the coverage_binding completion derivation reports incomplete for an on-disk envelope whose status is `partial` and complete for `done`.
2. Verify tests fail (RED).
3. Implement: add `'partial'` to `COVERAGE_BINDING_ENVELOPE_STATUSES` in `src/conductor/src/engine/coverage-binding-envelope.ts`; widen `CoverageBindingEnvelope.status` through the derived type; leave `COVERAGE_BINDING_COMPLETION_STATUSES` untouched. Pattern: the existing status union and `parseCoverageBindingEnvelope` `includes` check in the same file; allowed variation none.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): add partial envelope status outside the completion set"

**Done when:**
- `COVERAGE_BINDING_ENVELOPE_STATUSES` in `src/conductor/src/engine/coverage-binding-envelope.ts` contains `partial` and `parseCoverageBindingEnvelope` accepts and round-trips a `partial` envelope, as asserted by the partial round-trip test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `COVERAGE_BINDING_COMPLETION_STATUSES` still equals `['disabled', 'done']`, and the completion derivation in `src/conductor/src/engine/artifacts.ts` reports coverage_binding incomplete for a `partial` envelope, as asserted by the partial-incomplete test in `src/conductor/test/engine/artifacts.test.ts`
- Every pre-existing status (`disabled`, `done`, `failed`, `refused`) still parses, as asserted by the status round-trip test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — add `partial` to the status union
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — round-trip and completion-set tests
- `src/conductor/test/engine/artifacts.test.ts` — partial envelope is not completion evidence

**Dependencies:** none

### Task 2: Parse a batch judge payload and reject any digest-set mismatch
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts` for a new `parseJudgeBatchPayload(payload: string, issuedDigests: readonly string[])`: accepts a `{"verdicts":[...]}` payload whose digests equal the issued set once each with `asserts` / `does-not-assert`+non-empty `missingAssertion` entries; rejects with a reason naming the digest for (a) one issued digest missing, (b) a digest not in the issued set, (c) a digest returned twice; rejects with a reason naming the shape violation for (d) `verdict: "maybe"`, (e) `asserts` carrying `missingAssertion`, (f) `does-not-assert` without a non-empty `missingAssertion`, (g) a payload that is not an object with a `verdicts` array, (h) extra top-level keys or extra entry keys.
2. Verify tests fail (RED).
3. Implement `parseJudgeBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` returning `{ ok: true; verdicts: ReadonlyMap<string, CoverageBindingJudgePayload> }` or `{ ok: false; reason: string }`. Pattern: the existing `parseJudgePayload` and `exactKeys` helpers in the same file — fail-closed exact-key checks, closed vocabulary, first violation named in `reason`; allowed variation: the array wrapper and the issued-set equality check. Reuse `parseJudgePayload`-equivalent per-entry logic rather than duplicating the vocabulary check.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): parse batch judge payloads with exact digest-set validation"

**Done when:**
- `parseJudgeBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` returns `ok: true` with one verdict per issued digest only when the returned digest set equals the issued set with no repeats and every entry parses under the closed vocabulary, as asserted by the accepted-batch test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `parseJudgeBatchPayload` returns `ok: false` with a reason naming the offending digest for a missing, foreign, or duplicate digest, as asserted by the missing/foreign/duplicate tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `parseJudgeBatchPayload` returns `ok: false` with a reason naming the shape violation for a bad verdict word, `missingAssertion` misuse, a non-object or non-array payload, or extra keys, as asserted by the malformed-entry tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- Per-entry verdict recording uses the engine claim for `criterion`, `taskIds`, and `doneWhen`; `parseJudgeBatchPayload` exposes only `digest`, `verdict`, and `missingAssertion` per entry, as asserted by the returned-shape test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — `parseJudgeBatchPayload` beside `parseJudgePayload`
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — acceptance and rejection cases

**Dependencies:** none

### Task 3: Register and validate `coverage_binding.judge.batch_size`
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: a config without `batch_size` resolves `coverage_binding.judge.batch_size` to 8; `batch_size: 1` resolves to 1; `batch_size` of `0`, `-3`, `2.5`, and `"8"` each fail validation with the message `coverage_binding.judge.batch_size must be a positive integer`; `batch_sizes: 8` fails validation naming the unknown key `batch_sizes`; the consumer registry entry for `coverage_binding.judge` deep-equals `['enabled', 'batch_size']`.
2. Verify tests fail (RED).
3. Implement: add `batch_size` to `CONFIG_CONSUMER_KEY_SETS['coverage_binding.judge']` and validate it as a positive integer in the same block that validates `enabled` in `src/conductor/src/engine/config.ts`; expose `batch_size` with default 8 in the resolved coverage_binding policy in `src/conductor/src/engine/resolved-config.ts`. Pattern: the existing `enabled` validation and the `validation_concurrency` positive-integer check in `src/conductor/src/engine/config.ts`; allowed variation: message text names this key. Add the key row to `docs/reference/configuration.md` beside `coverage_binding.judge.enabled`.
4. Verify tests pass (GREEN).
5. Commit: "feat(config): register coverage_binding.judge.batch_size"

**Done when:**
- `src/conductor/src/engine/config.ts` accepts `coverage_binding.judge.batch_size` as a positive integer and lists it in `CONFIG_CONSUMER_KEY_SETS['coverage_binding.judge']`, as asserted by the registry and accepted-value tests in `src/conductor/test/engine/config.test.ts`
- Config loading fails with `coverage_binding.judge.batch_size must be a positive integer` for `0`, a negative number, a non-integer, and a string, and fails naming the unknown key for `batch_sizes`, as asserted by the rejection tests in `src/conductor/test/engine/config.test.ts`
- The resolved config in `src/conductor/src/engine/resolved-config.ts` exposes `batch_size` with default 8 when the key is absent, as asserted by the default-resolution test in `src/conductor/test/engine/config.test.ts`

**Files:**
- `src/conductor/src/engine/config.ts` — registry entry and fail-closed validator
- `src/conductor/src/engine/resolved-config.ts` — resolved `batch_size` default 8
- `src/conductor/test/engine/config.test.ts` — default, accepted, rejected, unknown-key cases
- `docs/reference/configuration.md` — key reference row

**Dependencies:** none

### Task 4: Plan batches: partition claims into cached, not-applicable, and pending chunks
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-batches.test.ts` for a new pure `planCoverageBindingBatches({ claims, previous, batchSize })` in `src/conductor/src/engine/coverage-binding-batches.ts`: 20 judgeable claims, no previous envelope, batchSize 8 → three batches of 8, 8, 4 in claim order; a previous envelope (status `partial`) carrying `asserts` for 12 digests → 12 cached entries and one batch of the 8 uncached claims; a claim whose `applicability` is `not-applicable` → a `not-applicable` entry and absence from every batch even when the previous envelope carries `asserts` under its digest; a previous entry whose digest matches no current claim is dropped; a claim whose `Done when` changed (new digest) is pending.
2. Verify tests fail (RED).
3. Implement `planCoverageBindingBatches` in `src/conductor/src/engine/coverage-binding-batches.ts` returning `{ entries: CoverageBindingEnvelopeEntry[]; batches: readonly (readonly PendingClaim[])[] }` where each pending claim carries its `claimDigest`. Pattern: the cache-hit / not-applicable branches currently inline in `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` — same `entryFor` shape and digest identity; allowed variation: extracted to a pure function, chunking added.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): pure batch planner over claims and the previous envelope"

**Done when:**
- `planCoverageBindingBatches` in `src/conductor/src/engine/coverage-binding-batches.ts` chunks pending claims in claim order into batches of at most `batchSize`, yielding 8/8/4 for 20 pending claims at size 8, as asserted by the chunking test in `src/conductor/test/engine/coverage-binding-batches.test.ts`
- `planCoverageBindingBatches` treats a previous entry with `asserts` or `does-not-assert` as a cache hit regardless of the previous envelope status, so 12 cached of 20 yields one batch of 8, as asserted by the partial-cache test in `src/conductor/test/engine/coverage-binding-batches.test.ts`
- `planCoverageBindingBatches` records a `not-applicable` claim as an entry and never places it in a batch, even when a previous entry shares its digest, as asserted by the not-applicable test in `src/conductor/test/engine/coverage-binding-batches.test.ts`
- `planCoverageBindingBatches` drops a previous entry whose digest matches no current claim and marks a claim whose digest changed as pending, as asserted by the stale-digest test in `src/conductor/test/engine/coverage-binding-batches.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-batches.ts` — new pure batch planner
- `src/conductor/test/engine/coverage-binding-batches.test.ts` — partition and chunking tests

**Dependencies:** 1

### Task 5: Dispatch one fresh judge session per batch with digest-stamped claims
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts` using a recording fake provider (existing runner test fixture pattern for `coverage_binding`: fake `provider.invoke`, in-memory envelope filesystem): 20 judgeable claims, `batch_size` 8 → exactly 3 `invoke` calls, each prompt's JSON body listing that batch's claims with keys exactly `digest`, `criterion`, `taskIds`, `doneWhen`, and `digest === claimDigest(claim)`; each prompt contains the rendered `coverage-binding` skill invocation; `batch_size` 1 with 5 claims → 5 calls of one claim each; each call uses a fresh session id with `resume: false`.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` (`src/conductor/src/engine/step-runners.ts`): replace the per-claim loop with `planCoverageBindingBatches`, then for each batch build a prompt whose instructions name the multi-claim contract and whose body is `JSON.stringify({ claims: [...] })`, dispatch through the existing `dispatchProviderWithLifecycleSupervision` / `executeAuxiliaryProviderCandidates` branch (memberId = first digest of the batch) or the plain `provider.invoke` branch, and parse with `parseJudgeBatchPayload(output, batchDigests)`. Pattern: the existing dispatch branches in this function — fresh id, `resume: false`, model ladder; allowed variation: prompt shape and memberId.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): judge claims per bounded batch"

**Done when:**
- `runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` dispatches exactly ⌈pending/batch_size⌉ provider sessions, each with a fresh session id and `resume: false`, yielding 3 sessions of 8/8/4 for 20 claims at size 8 and 5 sessions at size 1 for 5 claims, as asserted by the dispatch-count tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- Each batch prompt body lists only that batch's claims with keys exactly `digest`, `criterion`, `taskIds`, `doneWhen`, where `digest` equals `claimDigest` of the same claim text, as asserted by the prompt-shape test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- Each batch prompt carries the rendered `coverage-binding` skill invocation via `renderAuxiliarySkillInvocation`, as asserted by the prompt-prefix test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- `runCoverageBinding` reads `batch_size` from the resolved `coverage_binding` config, as asserted by the batch-size-1 test in `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — batched dispatch in `runCoverageBinding`
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — dispatch count, prompt shape, session freshness

**Dependencies:** 2, 3, 4

### Task 6: Checkpoint a `partial` envelope after the cache pass and after every accepted batch
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts` with an in-memory envelope filesystem that records every `writeFile`/`rename`: after the cache pass (12 cached + 2 not-applicable) and before the first `invoke`, a `partial` envelope with those 14 entries exists; after batch 1 of 3 is accepted and before batch 2 is dispatched, the envelope is `partial` with 14 + 8 entries; starting from a `partial` envelope carrying 16 of 20 digests → one `invoke` of 4 claims and a final `done` envelope of 20 entries; all `asserts` → final status `done` and `success: true`; a `coverage_binding_judged` event is emitted once per claim.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` (`src/conductor/src/engine/step-runners.ts`): call `writeEnvelope('partial', entries)` once after `planCoverageBindingBatches` returns and again after each accepted batch's entries are appended; keep the final `writeEnvelope('done', entries)`. The writer is the existing `writeCoverageBindingEnvelope` (sibling temp file + rename); no new writer.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): checkpoint partial envelope per batch"

**Done when:**
- `runCoverageBinding` writes a `partial` envelope through `writeCoverageBindingEnvelope` after the cache pass, before any dispatch, carrying every cached and not-applicable entry, as asserted by the pre-dispatch checkpoint test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- `runCoverageBinding` rewrites the envelope as `partial` with all entries so far after each accepted batch and before the next dispatch, as asserted by the between-batches checkpoint test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- A run starting from a `partial` envelope of 16/20 digests dispatches one batch of the 4 missing claims and ends with a `done` envelope of 20 entries, as asserted by the resume test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- A run whose verdicts are all `asserts` or `not-applicable` ends with envelope status `done`, `success: true`, and one `coverage_binding_judged` event per claim, as asserted by the all-asserts test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- The envelope write path is still the sibling-temp-file-and-rename `writeCoverageBindingEnvelope`, so a kill between temp write and rename leaves the previous envelope parseable, as asserted by the interrupted-rename test in `src/conductor/test/engine/coverage-binding-envelope.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — partial checkpoints in `runCoverageBinding`
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — checkpoint, resume, done-status tests
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — interrupted-rename keeps previous envelope

**Dependencies:** 5

### Task 7: Reject a bad batch as an infrastructure failure that keeps earlier verdicts
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`: batch 1 accepted, batch 2 returns 7 of 8 verdicts → step result `success: false`, `infrastructureFailure` is a `CoverageBindingPayloadError` whose message names the missing digest, no `refusal` field, envelope status `failed` carrying batch 1's entries and none of batch 2's, no third `invoke`; batch 2's provider dispatch returns `success: false` → `failed` envelope with batch 1's entries and no third `invoke`; a following run from that `failed` envelope dispatches only batch 2's digests.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` (`src/conductor/src/engine/step-runners.ts`): on a provider failure or a `{ ok: false }` batch parse, `writeEnvelope('failed', entries)` with entries so far and return the existing `CoverageBindingPayloadError` result shape (no `refusal`); never append any entry from the rejected batch.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): reject a bad batch without discarding accepted verdicts"

**Done when:**
- A batch whose payload fails `parseJudgeBatchPayload` makes `runCoverageBinding` return `success: false` with a `CoverageBindingPayloadError` naming the violation and no `refusal`, records none of that batch's entries, and dispatches no further batch, as asserted by the rejected-batch test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- A provider dispatch failure on batch N returns a failure whose message names the failed batch by its 1-based index and the batch count, writes a `failed` envelope carrying every entry from batches before N, and stops dispatching, as asserted by the provider-failure test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- A run resumed from a `failed` envelope dispatches only the digests that envelope lacks, as asserted by the resume-after-failed test in `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — failed-envelope branch keeps earlier entries
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — rejected batch and provider failure cases

**Dependencies:** 6

### Task 8: Retain every judged entry when a batch refuses with `does-not-assert`
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-runner.test.ts`: three batches where batch 2 returns one `does-not-assert` → all three batches are still dispatched, envelope status `refused` carrying every judged entry, step result carries `refusal: { kind: 'needs-human' }` and an `output` naming the refused criterion, its task ids, its `Done when` checks, and the `missingAssertion`.
2. Verify tests fail (RED).
3. Implement in `runCoverageBinding` (`src/conductor/src/engine/step-runners.ts`): keep the existing post-loop `refused` branch and detail rendering; ensure a `does-not-assert` inside a batch does not short-circuit remaining batches.
4. Verify tests pass (GREEN).
5. Commit: "feat(coverage-binding): refused envelope retains every batch verdict"

**Done when:**
- When any batch returns `does-not-assert`, `runCoverageBinding` still dispatches the remaining batches, writes a `refused` envelope carrying every judged entry, and returns the existing `needs-human` refusal naming each refused criterion, as asserted by the refused-batch test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- The refusal `output` names the criterion, task ids, `Done when` checks, and `missingAssertion` for each refused claim, as asserted by the refusal-detail test in `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Files:**
- `src/conductor/src/engine/step-runners.ts` — refused branch over batched entries
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — refusal retention and detail

**Dependencies:** 6

### Task 9: State the multi-claim result contract in the coverage-binding skill
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/coverage-binding-runner.test.ts` (or the existing skills contract test) asserting `skills/coverage-binding/SKILL.md` contains the literal `"verdicts"` contract, the `digest` key, and the sentence forbidding inference of one claim's verdict from another.
2. Verify test fails (RED).
3. Implement: rewrite the `## Result contract` of `skills/coverage-binding/SKILL.md` to `{ "verdicts": [ { "digest": "...", "verdict": "asserts" }, { "digest": "...", "verdict": "does-not-assert", "missingAssertion": "..." } ] }` — one entry per supplied claim, keyed by the supplied `digest`; update the judgement policy to say each claim is judged independently and no claim's verdict may be inferred from another claim.
4. Verify test passes (GREEN).
5. Commit: "feat(coverage-binding): multi-claim judge result contract"

**Done when:**
- `skills/coverage-binding/SKILL.md` states the `{ "verdicts": [ { "digest", "verdict", "missingAssertion"? } ] }` result contract, one entry per supplied claim keyed by the supplied `digest`, and forbids inferring one claim's verdict from another, as asserted by the skill-contract test in `src/conductor/test/engine/coverage-binding-runner.test.ts`
- `skills/coverage-binding/SKILL.md` keeps `verdict` closed to `asserts` or `does-not-assert` with `missingAssertion` only on `does-not-assert`, as asserted by the skill-contract test in `src/conductor/test/engine/coverage-binding-runner.test.ts`

**Files:**
- `skills/coverage-binding/SKILL.md` — multi-claim result contract and independence rule
- `src/conductor/test/engine/coverage-binding-runner.test.ts` — skill contract assertion

**Dependencies:** none

## Task Dependency Graph

```text
1 ─┐
2 ─┼─▶ 4 ─▶ 5 ─▶ 6 ─┬─▶ 7
3 ─┘              └─▶ 8
9 (independent)
```

## Integration Points

- After Task 5: the runner judges claims per batch end-to-end against a fake provider (entry point: the `coverage_binding` branch of `DefaultStepRunner.run`).
- After Task 6: an interrupted run resumes from a `partial` envelope through the same entry point.
- After Task 7: a rejected batch reaches the step retry ladder as a `CoverageBindingPayloadError` with earlier verdicts retained.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `coverage_binding.judge.enabled` is true, `batch_size` is 8, and the spec assembles 20 judgeable claims with no previous envelope, when the step runs, then exactly 3 provider sessions are dispatched, in claim order, carrying 8, 8, and 4 claims respectively | 5 | "`runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` dispatches exactly ⌈pending/batch_size⌉ provider sessions, each with a fresh session id and `resume: false`, yielding 3 sessions of 8/8/4 for 20 claims at size 8 and 5 sessions at size 1 for 5 claims" | diff-local |
| Story 1 happy: Given a batch prompt is built, when its JSON body is inspected, then each claim entry carries exactly `digest`, `criterion`, `taskIds`, and `doneWhen`, the `digest` equals `claimDigest(claim)`, and the prompt names the multi-claim result contract from `skills/coverage-binding/SKILL.md` | 5 | "Each batch prompt body lists only that batch's claims with keys exactly `digest`, `criterion`, `taskIds`, `doneWhen`, where `digest` equals `claimDigest` of the same claim text" | diff-local |
| Story 1 happy: Given 20 judgeable claims and a previous envelope already carrying `asserts` for 12 of their digests, when the step runs, then only the 8 uncached claims are dispatched, in one batch, and all 20 appear in the written envelope | 4 | "`planCoverageBindingBatches` treats a previous entry with `asserts` or `does-not-assert` as a cache hit regardless of the previous envelope status, so 12 cached of 20 yields one batch of 8" | diff-local |
| Story 1 happy: Given a claim whose cited task has no `Done when` block, when batches are planned, then that claim is recorded `not-applicable` and is not included in any batch prompt | 4 | "`planCoverageBindingBatches` records a `not-applicable` claim as an entry and never places it in a batch, even when a previous entry shares its digest" | diff-local |
| Story 1 negative: Given `batch_size` is 8 and 20 judgeable claims, when the second batch's provider dispatch fails (non-success result), then the step returns failure naming the failed batch, the envelope status is `failed`, and no third batch is dispatched | 7 | "A provider dispatch failure on batch N returns a failure whose message names the failed batch by its 1-based index and the batch count, writes a `failed` envelope carrying every entry from batches before N, and stops dispatching" | diff-local |
| Story 1 negative: Given a batch prompt is built, when a claim's digest is recomputed from the prompt's `criterion` and `doneWhen`, then it equals the prompt's `digest` field — a prompt whose digest does not match its own claim text is never dispatched | 5 | "Each batch prompt body lists only that batch's claims with keys exactly `digest`, `criterion`, `taskIds`, `doneWhen`, where `digest` equals `claimDigest` of the same claim text" | diff-local |
| Story 1 negative: Given a previous envelope carries `asserts` for a digest but the claim's `Done when` text has since changed, when batches are planned, then the changed claim's new digest is a cache miss and it is dispatched | 4 | "`planCoverageBindingBatches` drops a previous entry whose digest matches no current claim and marks a claim whose digest changed as pending" | diff-local |
| Story 1 negative: Given a claim with no `Done when` block and a previous envelope carrying `asserts` under the same digest, when batches are planned, then the claim is still recorded `not-applicable`, never as a cache hit | 4 | "`planCoverageBindingBatches` records a `not-applicable` claim as an entry and never places it in a batch, even when a previous entry shares its digest" | diff-local |
| Story 2 happy: Given a batch of 8 issued digests, when the provider returns `{"verdicts":[…]}` with those 8 digests each exactly once and each verdict `asserts` or `does-not-assert` with a non-empty `missingAssertion` only on `does-not-assert`, then all 8 entries are recorded and a `coverage_binding_judged` event is emitted per claim | 2 | "`parseJudgeBatchPayload` in `src/conductor/src/engine/coverage-binding-envelope.ts` returns `ok: true` with one verdict per issued digest only when the returned digest set equals the issued set with no repeats and every entry parses under the closed vocabulary" | diff-local |
| Story 2 happy: Given an accepted batch, when the returned verdicts are recorded, then each envelope entry's `criterion`, `taskIds`, and `doneWhen` come from the engine's claim for that digest, never from the payload | 2 | "Per-entry verdict recording uses the engine claim for `criterion`, `taskIds`, and `doneWhen`; `parseJudgeBatchPayload` exposes only `digest`, `verdict`, and `missingAssertion` per entry" | diff-local |
| Story 2 negative: Given a batch of 8 issued digests, when the provider returns 7 verdicts (one digest missing), then the step returns a `CoverageBindingPayloadError` infrastructure failure naming the missing digest and records none of the 7 | 2 | "`parseJudgeBatchPayload` returns `ok: false` with a reason naming the offending digest for a missing, foreign, or duplicate digest" | diff-local |
| Story 2 negative: Given a batch of 8 issued digests, when the provider returns 9 verdicts including a digest not issued in that batch, then the batch is rejected as a `CoverageBindingPayloadError` naming the foreign digest and none of the 9 is recorded | 2 | "`parseJudgeBatchPayload` returns `ok: false` with a reason naming the offending digest for a missing, foreign, or duplicate digest" | diff-local |
| Story 2 negative: Given a batch of 8 issued digests, when the provider returns the same digest twice, then the batch is rejected as a `CoverageBindingPayloadError` naming the duplicate digest | 2 | "`parseJudgeBatchPayload` returns `ok: false` with a reason naming the offending digest for a missing, foreign, or duplicate digest" | diff-local |
| Story 2 negative: Given a batch payload, when one entry carries `verdict: "maybe"`, an `asserts` entry carries `missingAssertion`, or a `does-not-assert` entry lacks a non-empty `missingAssertion`, then the whole batch is rejected as a `CoverageBindingPayloadError` and no entry from it is recorded | 2 | "`parseJudgeBatchPayload` returns `ok: false` with a reason naming the shape violation for a bad verdict word, `missingAssertion` misuse, a non-object or non-array payload, or extra keys" | diff-local |
| Story 2 negative: Given a batch payload, when it is not a JSON object with a `verdicts` array, or `verdicts` carries extra keys, then it is rejected as a `CoverageBindingPayloadError` with a reason naming the shape violation | 2 | "`parseJudgeBatchPayload` returns `ok: false` with a reason naming the shape violation for a bad verdict word, `missingAssertion` misuse, a non-object or non-array payload, or extra keys" | diff-local |
| Story 2 negative: Given a rejected batch, when the step result is inspected, then it carries no `refusal` and the retry classifier treats it as an ordinary retryable infrastructure failure, not `needs-human` | 7 | "A batch whose payload fails `parseJudgeBatchPayload` makes `runCoverageBinding` return `success: false` with a `CoverageBindingPayloadError` naming the violation and no `refusal`, records none of that batch's entries, and dispatches no further batch" | diff-local |
| Story 3 happy: Given 20 judgeable claims and `batch_size` 8, when the first batch is accepted, then `.pipeline/coverage-binding.json` is rewritten with status `partial` carrying the 8 judged entries plus every cached and `not-applicable` entry, before the second batch is dispatched | 6 | "`runCoverageBinding` rewrites the envelope as `partial` with all entries so far after each accepted batch and before the next dispatch" | diff-local |
| Story 3 happy: Given a run whose cache pass resolves 12 cached and 2 `not-applicable` entries, when batch dispatch begins, then a `partial` envelope carrying those 14 entries already exists on disk | 6 | "`runCoverageBinding` writes a `partial` envelope through `writeCoverageBindingEnvelope` after the cache pass, before any dispatch, carrying every cached and not-applicable entry" | diff-local |
| Story 3 happy: Given a `partial` envelope carrying 16 of 20 digests, when a new run starts, then only the 4 missing digests are dispatched and the final envelope is `done` with all 20 entries | 6 | "A run starting from a `partial` envelope of 16/20 digests dispatches one batch of the 4 missing claims and ends with a `done` envelope of 20 entries" | diff-local |
| Story 3 happy: Given a run whose batches all succeed with every verdict `asserts` or `not-applicable`, when the last batch is accepted, then the envelope status becomes `done` and the step succeeds | 6 | "A run whose verdicts are all `asserts` or `not-applicable` ends with envelope status `done`, `success: true`, and one `coverage_binding_judged` event per claim" | diff-local |
| Story 3 negative: Given a `partial` envelope on disk, when the engine's completion check reads `.pipeline/coverage-binding.json`, then `coverage_binding` is not treated as complete and the step is re-dispatched | 1 | "`COVERAGE_BINDING_COMPLETION_STATUSES` still equals `['disabled', 'done']`, and the completion derivation in `src/conductor/src/engine/artifacts.ts` reports coverage_binding incomplete for a `partial` envelope" | diff-local |
| Story 3 negative: Given a `partial` envelope written by an interrupted run, when the process is killed between the temp-file write and the rename, then the previous envelope remains intact and parseable and the next run resumes from it | 6 | "The envelope write path is still the sibling-temp-file-and-rename `writeCoverageBindingEnvelope`, so a kill between temp write and rename leaves the previous envelope parseable" | diff-local |
| Story 3 negative: Given a `partial` envelope carrying 16 digests, when the next run's cache pass finds that a claim's text changed so its digest is absent, then that claim is dispatched and the stale entry is not carried into the new envelope | 4 | "`planCoverageBindingBatches` drops a previous entry whose digest matches no current claim and marks a claim whose digest changed as pending" | diff-local |
| Story 3 negative: Given batches 1 and 2 are accepted and batch 3 is rejected, when the step returns failure, then the envelope status is `failed` and still carries every entry from batches 1 and 2, and the next run dispatches only batch 3's digests | 7 | "A provider dispatch failure on batch N returns a failure whose message names the failed batch by its 1-based index and the batch count, writes a `failed` envelope carrying every entry from batches before N, and stops dispatching" | diff-local |
| Story 3 negative: Given any batch returns a `does-not-assert` verdict, when the run completes its batches, then the envelope status is `refused`, every judged entry is retained, and the step returns the existing `needs-human` refusal naming each refused criterion | 8 | "When any batch returns `does-not-assert`, `runCoverageBinding` still dispatches the remaining batches, writes a `refused` envelope carrying every judged entry, and returns the existing `needs-human` refusal naming each refused criterion" | diff-local |
| Story 4 happy: Given `coverage_binding.judge.batch_size` is absent, when config is loaded, then the resolved value is 8 | 3 | "The resolved config in `src/conductor/src/engine/resolved-config.ts` exposes `batch_size` with default 8 when the key is absent" | diff-local |
| Story 4 happy: Given `coverage_binding: { judge: { enabled: true, batch_size: 1 } }`, when 5 judgeable claims run, then 5 sessions of one claim each are dispatched | 5 | "`runCoverageBinding` in `src/conductor/src/engine/step-runners.ts` dispatches exactly ⌈pending/batch_size⌉ provider sessions, each with a fresh session id and `resume: false`, yielding 3 sessions of 8/8/4 for 20 claims at size 8 and 5 sessions at size 1 for 5 claims" | diff-local |
| Story 4 happy: Given the config-key consumer registry is enumerated, when `coverage_binding.judge` is inspected, then its accepted key set is exactly `enabled` and `batch_size` | 3 | "`src/conductor/src/engine/config.ts` accepts `coverage_binding.judge.batch_size` as a positive integer and lists it in `CONFIG_CONSUMER_KEY_SETS['coverage_binding.judge']`" | diff-local |
| Story 4 negative: Given `batch_size: 0`, `batch_size: -3`, or `batch_size: 2.5`, when config is loaded, then loading fails closed with an error naming `coverage_binding.judge.batch_size must be a positive integer` | 3 | "Config loading fails with `coverage_binding.judge.batch_size must be a positive integer` for `0`, a negative number, a non-integer, and a string, and fails naming the unknown key for `batch_sizes`" | diff-local |
| Story 4 negative: Given `batch_size: "8"`, when config is loaded, then loading fails closed with the same error rather than coercing the string | 3 | "Config loading fails with `coverage_binding.judge.batch_size must be a positive integer` for `0`, a negative number, a non-integer, and a string, and fails naming the unknown key for `batch_sizes`" | diff-local |
| Story 4 negative: Given `coverage_binding: { judge: { enabled: true, batch_sizes: 8 } }`, when config is loaded, then loading fails closed naming the unknown key `batch_sizes` | 3 | "Config loading fails with `coverage_binding.judge.batch_size must be a positive integer` for `0`, a negative number, a non-integer, and a string, and fails naming the unknown key for `batch_sizes`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-31-coverage-binding-judge-step#D1 | no-change | none | The criterion-claim contract and its two carriers are untouched; claims still enter through `assembleCoverageBindingClaims` unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D2 | no-change | none | Land-time Done-when quote grounding in `coherence-validator.ts` is not touched by a BUILD-phase execution change. |
| adr-2026-08-31-coverage-binding-judge-step#D3 | no-change | none | Tier-S land engagement of the criterion layer is unaffected; this feature changes no land gate. |
| adr-2026-08-31-coverage-binding-judge-step#D4 | existing | none | `coverage_binding` remains the same BUILD-phase entry in `ALL_STEPS` (`steps.ts`); placement and prerequisites are not edited. |
| adr-2026-08-31-coverage-binding-judge-step#D5 | task | task-5 | each with a fresh session id and `resume: false` |
| adr-2026-08-31-coverage-binding-judge-step#D6 | task | task-8 | returns the existing `needs-human` refusal naming each refused criterion |
| adr-2026-08-31-coverage-binding-judge-step#D7 | existing | none | The `coverage_binding.judge.enabled` gate and the `disabled` envelope branch at the top of `runCoverageBinding` are untouched. |
| adr-2026-08-31-coverage-binding-judge-step#D8 | task | task-4 | records a `not-applicable` claim as an entry and never places it in a batch |
| adr-2026-08-31-coverage-binding-judge-step#D9 | task | task-6 | one `coverage_binding_judged` event per claim |
| adr-2026-08-31-coverage-binding-judge-step#D10 | no-change | none | The seventh correction cell on M/L criterion rows is a land-time parser concern; batching reads claims through the same shared parser and requires nothing of the cell. |
| adr-2026-08-31-coverage-binding-judge-step#D11 | no-change | none | Correction-reference resolution lives in `runCoherenceGate` at land; no BUILD consumer reads the cell and this feature adds none. |
| adr-2026-08-31-coverage-binding-judge-step#D12 | task | task-4, task-5 | chunks pending claims in claim order into batches of at most `batchSize` |
| adr-2026-08-31-coverage-binding-judge-step#D13 | task | task-2, task-7 | returns `ok: true` with one verdict per issued digest only when the returned digest set equals the issued set with no repeats |
| adr-2026-08-31-coverage-binding-judge-step#D14 | task | task-1, task-6 | rewrites the envelope as `partial` with all entries so far after each accepted batch and before the next dispatch |
| adr-2026-08-31-coverage-binding-judge-step#D15 | task | task-3 | lists it in `CONFIG_CONSUMER_KEY_SETS['coverage_binding.judge']` |

## Verification

- [ ] All 13 happy-path and 19 negative-path criteria map to a task (Coverage Check above)
- [ ] No task exceeds ~5 minutes; every task has a falsifiable `Done when:` block on single lines
- [ ] Dependencies acyclic (graph above)
- [ ] D1–D15 each have exactly one obligation row

