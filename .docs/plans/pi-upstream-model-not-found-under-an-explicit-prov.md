# Implementation Plan: Pi upstream model-not-found under an explicit provider walks the Pi model ladder (#3505)

**Date:** 2026-11-15
**Design:** none (technical track, Tier S; see `.docs/track/pi-upstream-model-not-found-under-an-explicit-prov.md`)
**Stories:** .docs/stories/pi-upstream-model-not-found-under-an-explicit-prov.md
**Conflict check:** not required at Tier S

## Summary

Make the Pi adapter report `modelUnavailable` for OpenRouter's unknown-model rejection, the one upstream shape captured from real Pi 1.0.0 output, so the existing Pi model ladder moves to its next rung. Every other upstream stays an ordinary failure. The work is 5 tasks.

## Technical Approach

- **One signature, one channel.** `src/conductor/src/execution/pi-provider.ts` exports a new `PI_UPSTREAM_MODEL_UNAVAILABLE_RE = /^400: \{"message":"[^"\r\n]+ is not a valid model ID"/m`. It is case-sensitive and anchored at a line start, as the D1 signatures of adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output are. It is a separate export, not an entry of `PI_FAILURE_SIGNATURES`, whose kinds are auth and limit only. It is tested only against the terminal assistant `errorMessage` of an exit-0 run with `stopReason: "error"`, the channel it was captured on (the ADR's #3505 amendment). Pi's stderr on a non-zero exit, assistant text, and Pi's `Using custom model id.` stderr warning are never tested against it.
- **Precedence.** In `PiProvider.invoke`, the new check runs after `classifyPiFailure` returns `undefined` (so usage exhaustion, rate limit and auth keep winning, D3) and before the `options.nativeSchema` missing-structured-result check and the generic `stopReason: "error"` ordinary-failure return. On a match it returns `{ success: false, output: 'Pi upstream provider reports the requested model as unknown.', exitCode, modelUnavailable: true, ...failedUsage, gitGuardInstalled }`, building the display name with `piDisplayName()` as the D4 sentences do. The output is a fixed sentence and never carries the provider body (D4).
- **No engine change.** When the last candidate is unavailable for the step, `executeProviderCandidates` returns `All configured providers are unavailable for step <step>: <provider> (<reason>)`, where the reason is the adapter's `output`; that result does not carry `modelUnavailable` itself, so Task 5 asserts on the output.
- **Ladder reuse.** `ModelAvailability.invokeWithLadderResolved` (`engine/model-availability.ts`) already marks a rung dead and walks to the next on `modelUnavailable` for any provider, and `executeProviderCandidates` (`engine/provider-execution.ts`) resolves the Pi ladder from `llm_providers.pi.model_fallback_ladder`. The existing `provider-execution-pi-fallback.test.ts` proves this with a stub Pi provider. Task 5 proves it with the real adapter.
- **Captures.** Two committed fixtures under `src/conductor/test/fixtures/pi/`, framed like `pi-1.0.0-e3-invalid-key-openrouter.jsonl` (one assistant `message_end` with `content: ""`, `usage` input and output 0, `stopReason: "error"`, then `{"type":"agent_end"}`), carry the verbatim `errorMessage` values from the #3505 amendment of the ADR:
  - `pi-1.0.0-e10-unknown-model-openrouter.jsonl`, `provider: "openrouter"`, `model: "nonexistent-model-xyz"`, `errorMessage`: `400: {"message":"nonexistent-model-xyz is not a valid model ID","code":400}`.
  - `pi-1.0.0-e11-insufficient-balance-deepseek.jsonl`, `provider: "deepseek"`, `model: "nonexistent-model-xyz"`, `errorMessage`: `402: {"message":"Insufficient Balance (request_id: 00000000-0000-0000-0000-000000000000)","type":"insufficient_balance_error","param":null,"code":"invalid_request_error"}`. The request id is masked to zeros.
- **Pattern context (tests).** Adapter tests follow the `PiProvider captured failure classification` describe block in `test/execution/pi-provider.test.ts`: a `vi.fn<PiSubprocessFactory>()` spawn, `readFixture(name)`, and the `errorStream(message)` / `textStream(text)` helpers that build a one-line terminal `message_end`. Capture-table tests follow `test/execution/pi-provider-failure-captures.test.ts` (the `captures` map of fixture name to verbatim evidence, and the `execa` mock asserted never called). Ladder tests follow `configured ladder in normal provider-aware dispatch` and `Pi classified failures hold the provider walk` in `test/engine/provider-execution-pi-fallback.test.ts`, which build a real `PiProvider` over a fake spawn and call `executeProviderCandidates` with `runtimeSet(config, { pi })`. Allowed variation: the fake spawn chooses its response from the `--model` argument it receives. Search hints: `errorStream(`, `readFixture(`, `runtimeSet(piConfig`.
- **"Ordinary failure"** in every check below means `success: false` and none of `modelUnavailable`, `authFailure`, `rateLimited`, `usageExhausted`, or `providerUnavailable` on the result.
- **Sequencing.** Task 1 commits the fixtures. Task 2 adds the signature. Tasks 3, 4 and 5 then prove the negative paths, the unchanged classifications, and the ladder walk, and are independent of each other.

## Prerequisites

- None.

## Tasks

### Task 1: Commit the E10 and E11 Pi captures and pin them in the capture table
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test: in `test/execution/pi-provider-failure-captures.test.ts`, add `pi-1.0.0-e10-unknown-model-openrouter.jsonl` and `pi-1.0.0-e11-insufficient-balance-deepseek.jsonl` to the `captures` map with their verbatim `errorMessage` values from the Technical Approach, and assert each fixture's parsed `terminalAssistantErrorMessage` equals its map value exactly (not only `startsWith`). Both new fixtures are `.jsonl`, so the existing replay test also replays them through the injected subprocess.
2. Verify test fails (RED): the fixtures do not exist.
3. Implement: create both fixtures with the framing and values given in the Technical Approach.
4. Verify test passes (GREEN).
5. Commit with message: "test(pi): commit unknown-model and insufficient-balance captures".

**Done when:**
- [test] `pi-provider-failure-captures.test.ts` asserts that `parsePiJsonl` yields a terminal `errorMessage` for `pi-1.0.0-e10-unknown-model-openrouter.jsonl` equal to `400: {"message":"nonexistent-model-xyz is not a valid model ID","code":400}` and for `pi-1.0.0-e11-insufficient-balance-deepseek.jsonl` equal to the E11 text with request id `00000000-0000-0000-0000-000000000000`, byte for byte.
- [test] The capture replay test serves every capture, including E10 and E11, only through the `PiProvider`'s injected subprocess factory and asserts the mocked `execa` is never called.
- `pi-1.0.0-e11-insufficient-balance-deepseek.jsonl` contains no request id other than `00000000-0000-0000-0000-000000000000`.

**Files likely touched:**
- `src/conductor/test/fixtures/pi/pi-1.0.0-e10-unknown-model-openrouter.jsonl` — new capture
- `src/conductor/test/fixtures/pi/pi-1.0.0-e11-insufficient-balance-deepseek.jsonl` — new capture
- `src/conductor/test/execution/pi-provider-failure-captures.test.ts` — capture map and exact-match assertion

**Dependencies:** none

### Task 2: Classify the OpenRouter unknown-model error stop as modelUnavailable
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: in the `PiProvider captured failure classification` block of `test/execution/pi-provider.test.ts`, replay `pi-1.0.0-e10-unknown-model-openrouter.jsonl` through the fake spawn (exit 0, empty stderr) and assert the result. Add cases for `errorStream('400: {"message":"anthropic/claude-x is not a valid model ID","code":400}')`, for the E10 fixture on an invocation that passes `nativeSchema`, and for the E10 fixture with stderr `Warning: Model "nonexistent-model-xyz" not found for provider "openrouter". Using custom model id.`
2. Verify test fails (RED): today the error stop is an ordinary failure.
3. Implement: export `PI_UPSTREAM_MODEL_UNAVAILABLE_RE` and add the exit-0 error-stop check in `PiProvider.invoke` after `classifyPiFailure` and before the `nativeSchema` check, returning the fixed sentence with `modelUnavailable: true`, as in the Technical Approach.
4. Verify test passes (GREEN).
5. Commit with message: "feat(pi): classify OpenRouter unknown-model rejections as model-unavailable".

**Done when:**
- [test] Replaying `pi-1.0.0-e10-unknown-model-openrouter.jsonl` through `PiProvider.invoke` returns `success: false` and `modelUnavailable: true`, and the result has none of `authFailure`, `rateLimited`, `usageExhausted`, or `providerUnavailable`.
- [test] An exit-0 error stop with `errorMessage` `400: {"message":"anthropic/claude-x is not a valid model ID","code":400}` returns `modelUnavailable: true` from `PiProvider.invoke`.
- [test] The E10 result's `output` is exactly `Pi upstream provider reports the requested model as unknown.` and contains none of `400:`, `"code"`, or `is not a valid model ID`.
- [test] Replaying E10 on an invocation that passes `nativeSchema` returns `modelUnavailable: true` and an `output` that does not contain `missing structured result`.
- [test] Replaying E10 with the `Using custom model id.` warning on stderr returns a result deep-equal to the empty-stderr E10 result.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — new signature export and error-stop classification
- `src/conductor/test/execution/pi-provider.test.ts` — E10 classification cases

**Dependencies:** Task 1

### Task 3: Leave successful runs and other error stops unclassified
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write test: in the same describe block, cover (a) exit 0 with `textStream('400: {"message":"x is not a valid model ID","code":400}')` and empty stderr; (b) exit 0 with a normal `textStream('hi')` and stderr holding only the `Using custom model id.` warning; (c) exit 0 with `errorStream('404: {"message":"Not Found"}')`.
2. Verify case (a) fails if the Task 2 check is widened to assistant text, and case (c) fails if the signature is widened to any 4xx status (temporarily, then restore). Case (b) pins that the `Using custom model id.` warning is never itself a signal.
3. Implement: no production change beyond Task 2 is expected. If a case fails, narrow the Task 2 check to the exit-0 terminal `errorMessage` channel.
4. Verify tests pass (GREEN).
5. Commit with message: "test(pi): unknown-model signature ignores text, warnings, and other error stops".

**Done when:**
- [test] A normal-stop run whose assistant text is `400: {"message":"x is not a valid model ID","code":400}` returns `success: true` from `PiProvider.invoke` with no `modelUnavailable` property.
- [test] A normal-stop run whose stderr holds only the `Using custom model id.` warning returns `success: true` with no `modelUnavailable` property.
- [test] An exit-0 error stop with `errorMessage` `404: {"message":"Not Found"}` returns an ordinary failure: `success: false` and none of `modelUnavailable`, `authFailure`, `rateLimited`, `usageExhausted`, or `providerUnavailable`.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider.test.ts` — negative cases

**Dependencies:** Task 2

### Task 4: Keep every other captured and look-alike Pi failure off the model-unavailable signal
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write test: in `test/execution/pi-provider.test.ts`, replay E2, E3, E4, E5, E6, E7, E8 and E9 through `PiProvider.invoke` with exit 0 and assert each keeps its class (E2, E3, E4, E5 `authFailure: true`; E6, E8 `rateLimited: true` without `usageExhausted`; E7 `rateLimited: true` and `usageExhausted: true`; E9 ordinary failure) and has no `modelUnavailable`. Replay E11 and assert an ordinary failure. Cover the exit-1 stderr `Error: Model "x" not found. Use --list-models to see available models.` case, the error stops `401: {"message":"x is not a valid model ID","code":401}` and `429: {"message":"x is not a valid model ID","code":429}`, and exit 1 with stderr `400: {"message":"x is not a valid model ID","code":400}`.
2. Verify the exit-1 stderr `400:` case fails if the Task 2 check is also applied to Pi's stderr on a non-zero exit (temporarily, then restore). The `401:` and `429:` look-alikes pin that the existing auth and limit classes still win; they cannot match the `400:` signature.
3. Implement: no production change beyond Task 2 is expected.
4. Verify tests pass (GREEN).
5. Commit with message: "test(pi): other Pi failures never carry model-unavailable".

**Done when:**
- [test] Replaying each of E2, E3, E4 and E5 through `PiProvider.invoke` returns `authFailure: true`, E6 and E8 return `rateLimited: true` without `usageExhausted`, E7 returns `rateLimited: true` with `usageExhausted: true`, E9 returns an ordinary failure, and none of the eight results has `modelUnavailable`.
- [test] Replaying `pi-1.0.0-e11-insufficient-balance-deepseek.jsonl` returns an ordinary failure with none of `modelUnavailable`, `authFailure`, `rateLimited`, or `usageExhausted`.
- [test] Exit 1 with stderr `Error: Model "x" not found. Use --list-models to see available models.` still returns `modelUnavailable: true`.
- [test] The `401:` look-alike error stop returns `authFailure: true` and the `429:` look-alike returns `rateLimited: true`, and neither result has `modelUnavailable`.
- [test] Exit 1 with stderr `400: {"message":"x is not a valid model ID","code":400}` returns an ordinary failure with no `modelUnavailable`.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider.test.ts` — capture and look-alike cases

**Dependencies:** Task 2

### Task 5: Walk the configured Pi ladder on the real adapter's unknown-model result
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: in `test/engine/provider-execution-pi-fallback.test.ts`, configure `llm_providers.pi` with `model: 'openrouter/retired-model'` and `model_fallback_ladder: ['openrouter/retired-model', 'openrouter/live-model']`, build a real `PiProvider` over a fake spawn that returns the E10 fixture when its args contain `--model retired-model` and the `terminal-assistant.jsonl` success stream otherwise, and call `executeProviderCandidates` with `runtimeSet(config, { pi })` for a Pi-routed step. Run a second dispatch on the same runtime set. Add a case whose spawn returns E10 for every rung, and a case with no `llm_providers.pi` ladder configured. Build a fresh runtime set, and so a fresh `ModelAvailability`, for every case other than the second dispatch, so dead-rung state never leaks between cases.
2. Verify test fails (RED) before Task 2: the E10 result is an ordinary failure and no second rung is tried.
3. Implement: no production change beyond Task 2 is expected.
4. Verify test passes (GREEN).
5. Commit with message: "test(pi): unknown-model rejection walks the configured Pi ladder".

**Done when:**
- [test] `executeProviderCandidates` returns `success: true` with `resolvedModel: 'openrouter/live-model'`, and the fake spawn received exactly two calls whose arguments contain `--provider openrouter --model retired-model` and then `--provider openrouter --model live-model`.
- [test] A second `executeProviderCandidates` dispatch on the same runtime set completes on `openrouter/live-model` and its fake spawn receives no call containing `--model retired-model`.
- [test] When the fake spawn returns E10 for every rung, `executeProviderCandidates` returns `success: false` with an `output` containing `All configured providers are unavailable for step`, `pi (` and `Pi upstream provider reports the requested model as unknown.`, and the spawn received exactly one call per configured rung with no `--model` value repeated.
- [test] With no `llm_providers.pi` ladder configured and the fake spawn returning E10, `executeProviderCandidates` returns `success: false` with an `output` containing `All configured providers are unavailable for step`, `pi (` and `Pi upstream provider reports the requested model as unknown.`, after exactly one Pi spawn call.

**Files likely touched:**
- `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` — real-adapter ladder cases

**Dependencies:** Task 2

## Optional Task Dependency Graph

```
Task 1 ──> Task 2 ──┬──> Task 3
                    ├──> Task 4
                    └──> Task 5
```

## Integration Points

- After Task 2: a real Pi dispatch under `--provider openrouter` for an unknown model reaches the ladder as `modelUnavailable`.
- After Task 5: the configured Pi ladder is proven to advance through `executeProviderCandidates`, the provider dispatch entry every Pi step uses.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D1 | task | task-2 | Replaying `pi-1.0.0-e10-unknown-model-openrouter.jsonl` through `PiProvider.invoke` returns `success: false` and `modelUnavailable: true` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D2 | task | task-3 | A normal-stop run whose assistant text is `400: {"message":"x is not a valid model ID","code":400}` returns `success: true` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D3 | task | task-4 | The `401:` look-alike error stop returns `authFailure: true` and the `429:` look-alike returns `rateLimited: true` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D4 | task | task-2 | The E10 result's `output` is exactly `Pi upstream provider reports the requested model as unknown.` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D5 | no-change | none | The credential-file recovery capability is declared for auth failures only; this feature adds no capability and changes no catalog descriptor. |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D6 | no-change | none | The credential-file park is entered only for `authFailure`; a `modelUnavailable` result never reaches `parkOnAuthFailure`. |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D7 | no-change | none | D7 governs auth, rate-limit and exhaustion ladder behavior; those results keep their classes (Task 4) and the model ladder is the existing `ModelAvailability` walk. |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D8 | task | task-1 | asserts the mocked `execa` is never called |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given Pi exits 0 and its terminal assistant message has `stopReason: "error"` and `errorMessage` `400: {"message":"nonexistent-model-xyz is not a valid model ID","code":400}`, when the Pi adapter classifies the run, then the result has `success: false` and `modelUnavailable: true`, and has none of `authFailure`, `rateLimited`, `usageExhausted`, or `providerUnavailable` | 2 | "returns `success: false` and `modelUnavailable: true`, and the result has none of `authFailure`, `rateLimited`, `usageExhausted`, or `providerUnavailable`" | diff-local |
| Story 1 happy: Given the same error stop for a model id containing a slash, such as `anthropic/claude-x`, when the adapter classifies the run, then the result has `modelUnavailable: true` | 2 | "`400: {"message":"anthropic/claude-x is not a valid model ID","code":400}` returns `modelUnavailable: true` from `PiProvider.invoke`" | diff-local |
| Story 1 happy: Given the same error stop, when the result is returned, then its `output` is a fixed sentence naming Pi and an unknown model, and contains none of `400:`, `"code"`, or `is not a valid model ID` | 2 | "The E10 result's `output` is exactly `Pi upstream provider reports the requested model as unknown.` and contains none of `400:`, `"code"`, or `is not a valid model ID`" | diff-local |
| Story 1 happy: Given the same error stop on a dispatch that requested a native structured result, when the adapter classifies the run, then the result has `modelUnavailable: true` and its `output` does not report a missing structured result | 2 | "Replaying E10 on an invocation that passes `nativeSchema` returns `modelUnavailable: true` and an `output` that does not contain `missing structured result`" | diff-local |
| Story 1 happy: Given Pi also wrote `Warning: Model "nonexistent-model-xyz" not found for provider "openrouter". Using custom model id.` on stderr, when the adapter classifies the error stop, then the result is the same as with empty stderr | 2 | "Replaying E10 with the `Using custom model id.` warning on stderr returns a result deep-equal to the empty-stderr E10 result" | diff-local |
| Story 1 negative: Given Pi exits 0 with a normal stop and assistant text content containing `400: {"message":"x is not a valid model ID","code":400}`, when the adapter classifies the run, then the run succeeds and the result has no `modelUnavailable` | 3 | "A normal-stop run whose assistant text is `400: {"message":"x is not a valid model ID","code":400}` returns `success: true` from `PiProvider.invoke` with no `modelUnavailable` property" | diff-local |
| Story 1 negative: Given Pi exits 0 with a normal stop and stderr containing only the `Using custom model id.` warning, when the adapter classifies the run, then the run succeeds and the result has no `modelUnavailable` | 3 | "A normal-stop run whose stderr holds only the `Using custom model id.` warning returns `success: true` with no `modelUnavailable` property" | diff-local |
| Story 1 negative: Given Pi exits 0 with `stopReason: "error"` and `errorMessage` `404: {"message":"Not Found"}`, when the adapter classifies the run, then the result is an ordinary failure with no `modelUnavailable` | 3 | "An exit-0 error stop with `errorMessage` `404: {"message":"Not Found"}` returns an ordinary failure" | diff-local |
| Story 2 happy: Given `llm_providers.pi.model_fallback_ladder` lists `openrouter/<first>` then a second Pi model, and Pi answers the first rung with the E10 error stop and the second with success, when the Pi step's provider dispatch runs, then it completes on the second model and the Pi subprocess was invoked once per rung with `--provider openrouter --model <first>` first | 5 | "`executeProviderCandidates` returns `success: true` with `resolvedModel: 'openrouter/live-model'`, and the fake spawn received exactly two calls whose arguments contain `--provider openrouter --model retired-model` and then `--provider openrouter --model live-model`" | diff-local |
| Story 2 happy: Given the first rung was marked unavailable in that dispatch, when a later dispatch in the same process uses the same ladder, then it starts on the second model without invoking the first | 5 | "A second `executeProviderCandidates` dispatch on the same runtime set completes on `openrouter/live-model` and its fake spawn receives no call containing `--model retired-model`" | diff-local |
| Story 2 negative: Given every rung of the Pi ladder answers with the E10 error stop, when the Pi step's provider dispatch runs, then it fails with an output reporting Pi unavailable for the step with the unknown-model sentence, after invoking each rung once and no rung twice | 5 | "When the fake spawn returns E10 for every rung, `executeProviderCandidates` returns `success: false` with an `output` containing `All configured providers are unavailable for step`" | diff-local |
| Story 2 negative: Given no Pi model ladder is configured, when Pi answers with the E10 error stop, then the Pi step's provider dispatch fails with an output reporting Pi unavailable for the step with the unknown-model sentence, after invoking Pi exactly once | 5 | "With no `llm_providers.pi` ladder configured and the fake spawn returning E10, `executeProviderCandidates` returns `success: false`" | diff-local |
| Story 3 happy: Given each committed Pi 1.0.0 capture E2, E3, E4, E5, E6, E7, E8, and E9, when it is replayed through the adapter, then its result keeps the classification it had before this change and has no `modelUnavailable` | 4 | "none of the eight results has `modelUnavailable`" | diff-local |
| Story 3 happy: Given the committed capture E11 (DeepSeek's `402: {"message":"Insufficient Balance ...` refusal, request id masked to zeros), when it is replayed, then the result is an ordinary failure with none of `modelUnavailable`, `authFailure`, `rateLimited`, or `usageExhausted` | 4 | "Replaying `pi-1.0.0-e11-insufficient-balance-deepseek.jsonl` returns an ordinary failure with none of `modelUnavailable`, `authFailure`, `rateLimited`, or `usageExhausted`" | diff-local |
| Story 3 happy: Given Pi exits 1 with the plain stderr `Error: Model "x" not found. Use --list-models to see available models.`, when the adapter classifies the run, then the result still has `modelUnavailable: true` as before this change | 4 | "Exit 1 with stderr `Error: Model "x" not found. Use --list-models to see available models.` still returns `modelUnavailable: true`" | diff-local |
| Story 3 negative: Given an error stop whose `errorMessage` is `401: {"message":"x is not a valid model ID","code":401}`, when the adapter classifies it, then the result has `authFailure: true` and no `modelUnavailable` | 4 | "The `401:` look-alike error stop returns `authFailure: true`" | diff-local |
| Story 3 negative: Given an error stop whose `errorMessage` is `429: {"message":"x is not a valid model ID","code":429}`, when the adapter classifies it, then the result has `rateLimited: true` and no `modelUnavailable` | 4 | "the `429:` look-alike returns `rateLimited: true`, and neither result has `modelUnavailable`" | diff-local |
| Story 3 negative: Given Pi exits 1 with stderr `400: {"message":"x is not a valid model ID","code":400}`, when the adapter classifies the run, then the result is an ordinary failure with no `modelUnavailable` | 4 | "Exit 1 with stderr `400: {"message":"x is not a valid model ID","code":400}` returns an ordinary failure with no `modelUnavailable`" | diff-local |
| Story 3 negative: Given the default test suite runs, when the Pi capture tests execute, then every Pi run is served by an injected fake subprocess and the real `execa` is never called | 1 | "asserts the mocked `execa` is never called" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
