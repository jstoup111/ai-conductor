**Status:** Accepted

# Stories: Pi auth failures, rate limits, and usage exhaustion are classified (#2718)

Technical track. Sources: `.docs/track/pi-auth-failures-and-rate-limits-surface-as-plain-.md`,
`.docs/decisions/adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output.md`
(D1 to D8 and its Evidence table E1 to E9), and
`.docs/decisions/architecture-review-2026-10-28-pi-auth-failures-and-rate-limits-surface-as-plain-.md`
(conditions C1 to C4).

## Story 1: A Pi rate limit waits and retries like a Claude or Codex rate limit

**Requirement:** Intake outcome 2 (a Pi rate limit is handled exactly as Claude and Codex rate limits are); ADR D1, D3, D4, D7

As an operator running `llm_provider: [pi, claude]`, I want a rate-limited Pi to wait and retry
instead of failing the step so that a transient upstream throttle does not cost a retry or halt the
feature.

### Acceptance Criteria

#### Happy Path
- Given Pi exits 0 and its terminal assistant message has `stopReason: "error"` and the captured E6 `errorMessage` beginning `429: {"message":"Rate limit reached for requests"`, when the adapter classifies the run, then the result has `success: false` and `rateLimited: true`, has no `usageExhausted`, `authFailure`, or `modelUnavailable`, and has no `waitSeconds`.
- Given Pi exits 0 with an error stop whose `errorMessage` is the captured E8 Anthropic shape beginning `429 {"type":"error"`, when the adapter classifies the run, then the result has `rateLimited: true` and no `usageExhausted`.
- Given a native-schema Pi dispatch that exits 0 with the E6 error stop and no `submit_result`, when the adapter classifies the run, then the result has `rateLimited: true` and its output does not say `missing structured result`.
- Given the conductor's serial loop dispatches a step to a ladder of pi then claude and Pi returns the E6 rate limit, when the loop handles the result, then it emits a `rate_limit` event with `waitSeconds` 300 and no `reason`, invokes Pi again after the wait without consuming the step's retry budget, and never invokes claude for that attempt.

#### Negative Paths
- Given Pi exits 0 with an error stop whose `errorMessage` is the captured E9 text beginning `500: {"message":"The server had an error`, when the adapter classifies the run, then the result has no `rateLimited`, `usageExhausted`, or `authFailure` flag.
- Given Pi exits 0 with `stopReason: "stop"` and assistant text `HTTP 429: rate limit reached`, when the adapter classifies the run, then the result has `success: true` and no `rateLimited` flag.
- Given Pi exits 0 with a terminal error stop whose `errorMessage` is `upstream said 429: busy`, when the adapter classifies the run, then the result has no `rateLimited` flag, because the status is not at the start of a line.
- Given Pi's stream holds an earlier error stop with the E6 text followed by a terminal assistant message with `stopReason: "stop"`, when the adapter classifies the run, then the result has `success: true` and no `rateLimited` flag.
- Given a rate-limited Pi result, when the adapter returns it, then its output names Pi and the rate limit and contains none of `Rate limit reached for requests`, `rate_limit_exceeded`, or `{"message"`.

### Done When
- [ ] Pi adapter tests drive the E6, E8 and E9 fixtures and the success-text and mid-line negatives, and assert the flags above.
- [ ] A conductor serial-loop test with a pi then claude ladder asserts the 300-second `rate_limit` event, a second Pi invocation, budget intact, and zero claude invocations.

## Story 2: Pi usage exhaustion advances the candidate-fallback ladder

**Requirement:** Intake outcome 2 (Pi usage exhaustion advances the candidate-fallback ladder exactly as Codex exhaustion does); ADR D1, D4, D7

As an operator running `llm_provider: [pi, claude]`, I want a quota-exhausted Pi to be suppressed as
an exhausted Codex is, so that other dispatches during the window run on claude instead of an
exhausted provider.

### Acceptance Criteria

#### Happy Path
- Given Pi exits 0 with an error stop whose `errorMessage` is the captured E7 text beginning `429: {"message":"You exceeded your current quota`, when the adapter classifies the run, then the result has `success: false`, `rateLimited: true`, `usageExhausted: true`, and `waitSeconds` 3600.
- Given a terminal error stop whose `errorMessage` begins `429: ` and contains `Monthly usage limit reached`, when the adapter classifies the run, then the result has `usageExhausted: true`.
- Given the conductor's serial loop dispatches a step to a ladder of pi then claude and Pi returns the E7 usage exhaustion, when the loop handles the result, then `providerAvailability` reports `pi` unavailable and a `rate_limit` event with reason `usage-exhausted` and provider `pi` is emitted; and given a second dispatch through `executeProviderCandidates` with the same availability store before that deadline, then it records a `provider-suppressed` refusal for pi and invokes claude.

#### Negative Paths
- Given a terminal error stop whose `errorMessage` begins `500: ` and contains `insufficient_quota`, when the adapter classifies the run, then the result has no `usageExhausted` or `rateLimited` flag.
- Given a terminal error stop whose `errorMessage` begins `402: ` and contains `Insufficient Balance`, when the adapter classifies the run, then the result has no `usageExhausted` or `rateLimited` flag.
- Given a usage-exhausted Pi result, when the adapter returns it, then its output names Pi and usage exhaustion and contains neither `insufficient_quota` nor `billing details`.

### Done When
- [ ] Pi adapter tests drive the E7 fixture and the vocabulary positive and negatives above.
- [ ] A conductor serial-loop test with a pi then claude ladder asserts the suppression and the `usage-exhausted` `rate_limit` event, and a second candidate walk on the same store asserts the `provider-suppressed` refusal and a claude invocation.

## Story 3: A Pi auth failure is reported as an auth failure and holds the ladder

**Requirement:** Intake outcome 1 (a Pi auth failure is reported as an auth failure and the ladder does not advance); ADR D1, D2, D4, D7

As an operator, I want Pi credential failures reported as auth failures so that the engine parks for
new credentials instead of burning retries or moving to another provider.

### Acceptance Criteria

#### Happy Path
- Given Pi exits 1 with the captured E1 stderr `No API key found for deepseek.`, when the adapter classifies the run, then the result has `success: false`, `authFailure: true`, and `authentication` equal to `{ provider: 'pi', source: 'cached-login', state: 'missing' }`.
- Given Pi exits 1 with stderr whose first line is `Warning: Model "x" not found for provider "deepseek". Using custom model id.` and whose second line is `No API key found for deepseek.`, when the adapter classifies the run, then the result has `authFailure: true`.
- Given Pi exits 0 with an error stop whose `errorMessage` is `No API key for provider: cline`, when the adapter classifies the run, then the result has `authFailure: true` and `authentication.state` `missing`.
- Given Pi exits 0 with an error stop whose `errorMessage` is each of the captured E2, E3, E4 and E5 texts, when the adapter classifies each run, then each result has `authFailure: true` and `authentication.state` `unusable`.
- Given Pi exits 1 with stderr beginning `Authentication failed for "anthropic". Credentials may have expired`, when the adapter classifies the run, then the result has `authFailure: true` and `authentication.state` `unusable`.
- Given a candidate list of pi then claude and Pi returns the E2 auth failure, when `executeProviderCandidates` runs the step, then claude is never invoked and the returned result has `authFailure: true` and `actualProvider` `pi`.

#### Negative Paths
- Given Pi exits 0 with `stopReason: "stop"` and assistant text `401: Unauthorized`, when the adapter classifies the run, then the result has `success: true` and no `authFailure` flag.
- Given Pi exits 1 with stderr `Error: Model "nonexistent-model-xyz" not found. Use --list-models to see available models.`, when the adapter classifies the run, then the result has `modelUnavailable: true` and no `authFailure` flag.
- Given Pi exits 0 with an error stop whose `errorMessage` begins `403: `, when the adapter classifies the run, then the result has no `authFailure` flag.
- Given a Pi auth-failure result for E2, when the adapter returns it, then its output names Pi and authentication and contains none of `****0000`, `request_id`, `Authentication Fails`, or `{"message"`.
- Given a Pi auth-failure result for E5, when the adapter returns it, then its output contains none of `invalid_grant`, `platform.claude.com`, or `stack=`.

### Done When
- [ ] Pi adapter tests drive the E1 to E5 fixtures and the D14 and `Authentication failed` shapes, and assert the flags, the `authentication` record, and the redacted output.
- [ ] A provider-execution test with a pi then claude candidate list asserts zero claude invocations after a Pi auth failure.

## Story 4: A Pi auth failure parks on Pi's credentials file and resumes when it changes

**Requirement:** Intake outcome 1 (the run parks as it does for Claude and Codex); ADR D5, D6

As an operator, I want a Pi auth failure to wait for me to fix Pi's credentials and then resume, so
that an expired or missing Pi credential neither halts the feature at once nor waits on Claude's
credentials.

### Acceptance Criteria

#### Happy Path
- Given the Pi catalog descriptor, when it is read, then it declares the `credentialFileRecovery` capability with `credentialRecoveryFile` `auth.json`, and neither the Claude nor the Codex descriptor declares that capability.
- Given `PI_CODING_AGENT_DIR` names a directory holding `auth.json` and the serial loop receives a Pi auth-failure result for the build step, when the park runs and the file's mtime advances with content that parses as a JSON object, then a `credentials_park` event with reason `Pi credentials rejected or missing — waiting for the Pi credentials file to change` is emitted, Pi is dispatched again, and the step's retry budget is unchanged.
- Given `PI_CODING_AGENT_DIR` is unset, when a Pi auth-failure park resolves its file, then it watches `auth.json` under the Pi descriptor's default home.
- Given a concurrent group whose member fails with a Pi auth-failure no-verdict outcome, when the group JOIN parks and the Pi credentials file changes, then the failed member is redispatched and its completed siblings are not.

#### Negative Paths
- Given a Pi auth-failure park whose credentials file never changes, when `auth_park_timeout_minutes` elapses, then the loop writes a `needs-human` HALT whose reason names Pi, the credentials file path, and the remedy, and contains no provider output.
- Given a Pi auth-failure park and a `$CLAUDE_CONFIG_DIR/.credentials.json` whose mtime advances with fresh credentials during the park, when the park runs, then it does not resume, and its timeout HALT reason contains neither `.credentials.json` nor `OAuth token`.
- Given a Pi auth-failure park whose credentials file is rewritten with content that is not valid JSON, when the poll observes the new mtime, then the park does not resume.
- Given a Claude auth-failure result carrying no `authentication` record, when the park runs, then it polls the Claude operator credentials as before; and given a Codex auth failure, the readiness branch runs as before.

### Done When
- [ ] A catalog test asserts the Pi declaration and its absence on Claude and Codex.
- [ ] Conductor tests cover the Pi park's resume, timeout HALT, invalid-JSON non-resume, unset `PI_CODING_AGENT_DIR` default, and indifference to Claude credential changes.
- [ ] A group JOIN test covers the redispatch of only the Pi auth-failed member.
- [ ] The existing Claude and Codex park tests pass without edits.

## Story 5: Unmatched Pi output stays an ordinary failure, and every signature has a committed capture

**Requirement:** Intake outcomes 3 and 4 (no false fallback on a real step failure; the default suite makes no real Pi call and signatures are proven against committed captures); ADR D1, D2, D8

As a maintainer, I want only the verified Pi shapes classified, each proven by a committed capture,
so that a real step failure never parks or falls back and a Pi upgrade that changes a shape fails a
named test.

### Acceptance Criteria

#### Happy Path
- Given the fixtures directory `src/conductor/test/fixtures/pi/`, when the classification tests run, then each of E1 to E9 has a committed fixture whose terminal `errorMessage` or stderr begins with the ADR Evidence text byte for byte, and each anchored signature in ADR D1 is matched by at least one fixture.
- Given the Pi classification tests run, when they execute, then every Pi subprocess is the adapter's injected fake and no real `pi` executable is spawned.

#### Negative Paths
- Given Pi exits 1 with stderr `boom: tool crashed`, when the adapter classifies the run, then the result has no `authFailure`, `rateLimited`, `usageExhausted`, `modelUnavailable`, or `providerUnavailable` flag, and it carries `exitFacts`.
- Given Pi exits 0 with an error stop whose `errorMessage` is `Free tier request failed.`, when the adapter classifies the run, then the result has `success: false`, its output is `Free tier request failed.`, and it has no recovery flag.
- Given Pi exits 0 with an error stop whose `errorMessage` begins `Warning: 429 retries scheduled` on its first line, when the adapter classifies the run, then the result has no `rateLimited` flag.

### Done When
- [ ] Committed fixtures for E1 to E9 exist under `src/conductor/test/fixtures/pi/`.
- [ ] Pi adapter tests assert the unmatched-output negatives above.
