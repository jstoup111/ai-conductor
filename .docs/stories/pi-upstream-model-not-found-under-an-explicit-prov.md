**Status:** Accepted

# Stories: Pi upstream model-not-found under an explicit provider walks the Pi model ladder (#3505)

Track: technical. Tier: S. Source: intake jstoup111/ai-conductor#3505.

Scope: only the OpenRouter unknown-model rejection captured from Pi 1.0.0 on 2026-11-15 (E10 in the
adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output D1 amendment)
carries the model-unavailable signal. Every other upstream's unknown-model rejection stays an
ordinary failure. The model ladder, the boot probe, and the Claude and Codex adapters are unchanged.

## Story 1: An OpenRouter unknown-model rejection carries the model-unavailable signal

**Requirement:** issue #3505 desired outcome 1.

As an operator running a Pi step under an explicit OpenRouter provider, I want a model that OpenRouter does not know to be reported as unavailable so that the harness treats it as a model problem, not a step failure.

### Acceptance Criteria

#### Happy Path
- Given Pi exits 0 and its terminal assistant message has `stopReason: "error"` and `errorMessage` `400: {"message":"nonexistent-model-xyz is not a valid model ID","code":400}`, when the Pi adapter classifies the run, then the result has `success: false` and `modelUnavailable: true`, and has none of `authFailure`, `rateLimited`, `usageExhausted`, or `providerUnavailable`
- Given the same error stop for a model id containing a slash, such as `anthropic/claude-x`, when the adapter classifies the run, then the result has `modelUnavailable: true`
- Given the same error stop, when the result is returned, then its `output` is a fixed sentence naming Pi and an unknown model, and contains none of `400:`, `"code"`, or `is not a valid model ID`
- Given the same error stop on a dispatch that requested a native structured result, when the adapter classifies the run, then the result has `modelUnavailable: true` and its `output` does not report a missing structured result
- Given Pi also wrote `Warning: Model "nonexistent-model-xyz" not found for provider "openrouter". Using custom model id.` on stderr, when the adapter classifies the error stop, then the result is the same as with empty stderr

#### Negative Paths
- Given Pi exits 0 with a normal stop and assistant text content containing `400: {"message":"x is not a valid model ID","code":400}`, when the adapter classifies the run, then the run succeeds and the result has no `modelUnavailable`
- Given Pi exits 0 with a normal stop and stderr containing only the `Using custom model id.` warning, when the adapter classifies the run, then the run succeeds and the result has no `modelUnavailable`
- Given Pi exits 0 with `stopReason: "error"` and `errorMessage` `404: {"message":"Not Found"}`, when the adapter classifies the run, then the result is an ordinary failure with no `modelUnavailable`

### Done When
- [ ] A committed fixture `pi-1.0.0-e10-unknown-model-openrouter.jsonl` replayed through the adapter's injected subprocess yields `modelUnavailable: true` with a fixed-sentence output
- [ ] A test replaying the same fixture on a native-schema dispatch observes `modelUnavailable: true` and no missing-structured-result output

## Story 2: The Pi model ladder moves to its next rung on an OpenRouter unknown-model rejection

**Requirement:** issue #3505 desired outcome 1.

As an operator with a configured Pi model ladder, I want a retired OpenRouter model to fall to my next configured Pi model so that retries are not burned on a model that cannot succeed.

### Acceptance Criteria

#### Happy Path
- Given `llm_providers.pi.model_fallback_ladder` lists `openrouter/<first>` then a second Pi model, and Pi answers the first rung with the E10 error stop and the second with success, when the Pi step's provider dispatch runs, then it completes on the second model and the Pi subprocess was invoked once per rung with `--provider openrouter --model <first>` first
- Given the first rung was marked unavailable in that dispatch, when a later dispatch in the same process uses the same ladder, then it starts on the second model without invoking the first

#### Negative Paths
- Given every rung of the Pi ladder answers with the E10 error stop, when the Pi step's provider dispatch runs, then it fails with an output reporting Pi unavailable for the step with the unknown-model sentence, after invoking each rung once and no rung twice
- Given no Pi model ladder is configured, when Pi answers with the E10 error stop, then the Pi step's provider dispatch fails with an output reporting Pi unavailable for the step with the unknown-model sentence, after invoking Pi exactly once

### Done When
- [ ] A dispatch test that drives the real Pi adapter through a fake subprocess observes the second rung's success and the two `--model` arguments in order
- [ ] A dispatch test with every rung rejected observes one invocation per rung and a failed result whose output names Pi and the unknown-model sentence

## Story 3: No other Pi failure carries the model-unavailable signal

**Requirement:** issue #3505 desired outcomes 2 and 3.

As an operator, I want auth failures, rate limits, balance refusals, and server errors to keep their own handling so that a non-model failure never walks the model ladder.

### Acceptance Criteria

#### Happy Path
- Given each committed Pi 1.0.0 capture E2, E3, E4, E5, E6, E7, E8, and E9, when it is replayed through the adapter, then its result keeps the classification it had before this change and has no `modelUnavailable`
- Given the committed capture E11 (DeepSeek's `402: {"message":"Insufficient Balance ...` refusal, request id masked to zeros), when it is replayed, then the result is an ordinary failure with none of `modelUnavailable`, `authFailure`, `rateLimited`, or `usageExhausted`
- Given Pi exits 1 with the plain stderr `Error: Model "x" not found. Use --list-models to see available models.`, when the adapter classifies the run, then the result still has `modelUnavailable: true` as before this change

#### Negative Paths
- Given an error stop whose `errorMessage` is `401: {"message":"x is not a valid model ID","code":401}`, when the adapter classifies it, then the result has `authFailure: true` and no `modelUnavailable`
- Given an error stop whose `errorMessage` is `429: {"message":"x is not a valid model ID","code":429}`, when the adapter classifies it, then the result has `rateLimited: true` and no `modelUnavailable`
- Given Pi exits 1 with stderr `400: {"message":"x is not a valid model ID","code":400}`, when the adapter classifies the run, then the result is an ordinary failure with no `modelUnavailable`
- Given the default test suite runs, when the Pi capture tests execute, then every Pi run is served by an injected fake subprocess and the real `execa` is never called

### Done When
- [ ] The committed fixture `pi-1.0.0-e11-insufficient-balance-deepseek.jsonl` exists, contains no unmasked request id, and replays to an ordinary failure
- [ ] The capture test asserts the E10 and E11 fixtures' terminal `errorMessage` values byte for byte, and that `execa` is not called
- [ ] Tests for the 401-, 429-, and stderr-channel look-alikes observe no `modelUnavailable`
