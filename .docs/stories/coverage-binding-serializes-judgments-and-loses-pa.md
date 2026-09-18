**Status:** Accepted

# Coverage binding judges claims in bounded batches and checkpoints after each (#2493)

Track: technical (no PRD — acceptance criteria live here)
Tier: M
Governing decisions: `adr-2026-08-31-coverage-binding-judge-step` D12, D13, D14, D15 (amended 2026-09-18).

## Story 1: Pending claims are judged per bounded batch in one fresh session each

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D12

As the daemon operator, I want `coverage_binding` to judge many claims per provider session so that a multi-criterion feature completes in far fewer sessions than it has criteria.

### Acceptance Criteria

#### Happy Path
- Given `coverage_binding.judge.enabled` is true, `batch_size` is 8, and the spec assembles 20 judgeable claims with no previous envelope, when the step runs, then exactly 3 provider sessions are dispatched, in claim order, carrying 8, 8, and 4 claims respectively
- Given a batch prompt is built, when its JSON body is inspected, then each claim entry carries exactly `digest`, `criterion`, `taskIds`, and `doneWhen`, the `digest` equals `claimDigest(claim)`, and the prompt names the multi-claim result contract from `skills/coverage-binding/SKILL.md`
- Given 20 judgeable claims and a previous envelope already carrying `asserts` for 12 of their digests, when the step runs, then only the 8 uncached claims are dispatched, in one batch, and all 20 appear in the written envelope
- Given a claim whose cited task has no `Done when` block, when batches are planned, then that claim is recorded `not-applicable` and is not included in any batch prompt

#### Negative Paths
- Given `batch_size` is 8 and 20 judgeable claims, when the second batch's provider dispatch fails (non-success result), then the step returns failure naming the failed batch, the envelope status is `failed`, and no third batch is dispatched
- Given a batch prompt is built, when a claim's digest is recomputed from the prompt's `criterion` and `doneWhen`, then it equals the prompt's `digest` field — a prompt whose digest does not match its own claim text is never dispatched
- Given a previous envelope carries `asserts` for a digest but the claim's `Done when` text has since changed, when batches are planned, then the changed claim's new digest is a cache miss and it is dispatched
- Given a claim with no `Done when` block and a previous envelope carrying `asserts` under the same digest, when batches are planned, then the claim is still recorded `not-applicable`, never as a cache hit

### Done When
- [ ] `runCoverageBinding` dispatches ⌈pending/batch_size⌉ sessions for N pending claims, each session prompt listing that batch's claims with engine-stamped digests
- [ ] A unit test with 20 claims and `batch_size` 8 asserts exactly 3 dispatches with 8/8/4 claims in claim order
- [ ] A unit test with a 12-of-20 cached envelope asserts one dispatch of the 8 uncached claims and 20 envelope entries
- [ ] `skills/coverage-binding/SKILL.md` states the multi-claim `{ "verdicts": [ { "digest", "verdict", "missingAssertion"? } ] }` result contract and forbids inferring one claim's verdict from another

## Story 2: A batch verdict is accepted only when its digest set equals the issued set

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D13

As the engine, I want to accept a batch payload only when it answers every issued digest exactly once so that a missing, duplicate, foreign, or malformed verdict can never satisfy the gate.

### Acceptance Criteria

#### Happy Path
- Given a batch of 8 issued digests, when the provider returns `{"verdicts":[…]}` with those 8 digests each exactly once and each verdict `asserts` or `does-not-assert` with a non-empty `missingAssertion` only on `does-not-assert`, then all 8 entries are recorded and a `coverage_binding_judged` event is emitted per claim
- Given an accepted batch, when the returned verdicts are recorded, then each envelope entry's `criterion`, `taskIds`, and `doneWhen` come from the engine's claim for that digest, never from the payload

#### Negative Paths
- Given a batch of 8 issued digests, when the provider returns 7 verdicts (one digest missing), then the step returns a `CoverageBindingPayloadError` infrastructure failure naming the missing digest and records none of the 7
- Given a batch of 8 issued digests, when the provider returns 9 verdicts including a digest not issued in that batch, then the batch is rejected as a `CoverageBindingPayloadError` naming the foreign digest and none of the 9 is recorded
- Given a batch of 8 issued digests, when the provider returns the same digest twice, then the batch is rejected as a `CoverageBindingPayloadError` naming the duplicate digest
- Given a batch payload, when one entry carries `verdict: "maybe"`, an `asserts` entry carries `missingAssertion`, or a `does-not-assert` entry lacks a non-empty `missingAssertion`, then the whole batch is rejected as a `CoverageBindingPayloadError` and no entry from it is recorded
- Given a batch payload, when it is not a JSON object with a `verdicts` array, or `verdicts` carries extra keys, then it is rejected as a `CoverageBindingPayloadError` with a reason naming the shape violation
- Given a rejected batch, when the step result is inspected, then it carries no `refusal` and the retry classifier treats it as an ordinary retryable infrastructure failure, not `needs-human`

### Done When
- [ ] `parseJudgeBatchPayload(payload, issuedDigests)` in `coverage-binding-envelope.ts` returns `{ok:true, verdicts}` only when the returned digest set equals `issuedDigests` with no repeats and every verdict parses; otherwise `{ok:false, reason}` naming the first violation (missing/foreign/duplicate/malformed)
- [ ] Unit tests cover each rejection: missing digest, foreign digest, duplicate digest, bad verdict vocabulary, `missingAssertion` misuse, non-object/extra-key payload
- [ ] `runCoverageBinding` maps a `{ok:false}` batch to `CoverageBindingPayloadError` with `success:false`, no `refusal`, and records zero entries from that batch

## Story 3: The envelope is checkpointed after every batch and resume re-dispatches only unjudged digests

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D14

As the daemon operator, I want an interrupted `coverage_binding` run to keep every completed verdict so that the resumed run pays only for what was not judged.

### Acceptance Criteria

#### Happy Path
- Given 20 judgeable claims and `batch_size` 8, when the first batch is accepted, then `.pipeline/coverage-binding.json` is rewritten with status `partial` carrying the 8 judged entries plus every cached and `not-applicable` entry, before the second batch is dispatched
- Given a run whose cache pass resolves 12 cached and 2 `not-applicable` entries, when batch dispatch begins, then a `partial` envelope carrying those 14 entries already exists on disk
- Given a `partial` envelope carrying 16 of 20 digests, when a new run starts, then only the 4 missing digests are dispatched and the final envelope is `done` with all 20 entries
- Given a run whose batches all succeed with every verdict `asserts` or `not-applicable`, when the last batch is accepted, then the envelope status becomes `done` and the step succeeds

#### Negative Paths
- Given a `partial` envelope on disk, when the engine's completion check reads `.pipeline/coverage-binding.json`, then `coverage_binding` is not treated as complete and the step is re-dispatched
- Given a `partial` envelope written by an interrupted run, when the process is killed between the temp-file write and the rename, then the previous envelope remains intact and parseable and the next run resumes from it
- Given a `partial` envelope carrying 16 digests, when the next run's cache pass finds that a claim's text changed so its digest is absent, then that claim is dispatched and the stale entry is not carried into the new envelope
- Given batches 1 and 2 are accepted and batch 3 is rejected, when the step returns failure, then the envelope status is `failed` and still carries every entry from batches 1 and 2, and the next run dispatches only batch 3's digests
- Given any batch returns a `does-not-assert` verdict, when the run completes its batches, then the envelope status is `refused`, every judged entry is retained, and the step returns the existing `needs-human` refusal naming each refused criterion

### Done When
- [ ] `COVERAGE_BINDING_ENVELOPE_STATUSES` includes `partial`; `COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged (`disabled`, `done`) and a test asserts `partial` is excluded and `artifacts.ts` completion returns incomplete for a `partial` envelope
- [ ] `runCoverageBinding` calls `writeCoverageBindingEnvelope` with `partial` after the cache pass and after each accepted batch; a test with a dispatch that throws on batch 2 asserts the on-disk envelope holds batch 1's entries
- [ ] A test starting from a `partial` envelope of 16/20 digests asserts one dispatch of 4 claims and a final `done` envelope of 20 entries
- [ ] `parseCoverageBindingEnvelope` accepts `partial` and every pre-existing status; a test round-trips a `partial` envelope

## Story 4: `coverage_binding.judge.batch_size` is a validated, registered config key

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D15

As the daemon operator, I want to bound how many claims one judge session receives so that prompt size and verdict quality stay controlled.

### Acceptance Criteria

#### Happy Path
- Given `coverage_binding.judge.batch_size` is absent, when config is loaded, then the resolved value is 8
- Given `coverage_binding: { judge: { enabled: true, batch_size: 1 } }`, when 5 judgeable claims run, then 5 sessions of one claim each are dispatched
- Given the config-key consumer registry is enumerated, when `coverage_binding.judge` is inspected, then its accepted key set is exactly `enabled` and `batch_size`

#### Negative Paths
- Given `batch_size: 0`, `batch_size: -3`, or `batch_size: 2.5`, when config is loaded, then loading fails closed with an error naming `coverage_binding.judge.batch_size must be a positive integer`
- Given `batch_size: "8"`, when config is loaded, then loading fails closed with the same error rather than coercing the string
- Given `coverage_binding: { judge: { enabled: true, batch_sizes: 8 } }`, when config is loaded, then loading fails closed naming the unknown key `batch_sizes`

### Done When
- [ ] `config.ts` validates `coverage_binding.judge.batch_size` as a positive integer in the same block that validates `enabled`, and `CONFIG_CONSUMER_KEY_SETS['coverage_binding.judge']` lists `batch_size`
- [ ] `resolved-config.ts` exposes `batch_size` with default 8 and `runCoverageBinding` reads it from the resolved config
- [ ] Unit tests cover the default, `batch_size: 1`, each rejected value (0, negative, non-integer, string), and the unknown sibling key
- [ ] `docs/reference/configuration.md` documents `coverage_binding.judge.batch_size` (positive integer, default 8)
