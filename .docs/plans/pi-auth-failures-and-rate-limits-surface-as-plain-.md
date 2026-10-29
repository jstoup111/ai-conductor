# Implementation Plan: Pi auth failures, rate limits, and usage exhaustion are classified

**Date:** 2026-10-28
**Design:** [architecture review](../decisions/architecture-review-2026-10-28-pi-auth-failures-and-rate-limits-surface-as-plain-.md); [ADR](../decisions/adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output.md); [diagram](../architecture/pi-auth-failures-and-rate-limits-surface-as-plain-.md)
**Stories:** .docs/stories/pi-auth-failures-and-rate-limits-surface-as-plain-.md
**Conflict check:** Clean as of 2026-10-28 (two contradictions resolved by in-place story amendments)

## Summary

The Pi adapter classifies the auth-failure, rate-limit, and usage-exhaustion signatures that were
verified against captured Pi 1.0.0 output. A Pi auth failure parks on Pi's own credentials file
through a declared catalog capability, instead of falling through to the Claude credential poll.
Pi usage exhaustion reuses the existing suppression path, so the candidate ladder advances. There
are 12 tasks.

## Technical Approach

- **Fixtures (ADR D8).** New files under `src/conductor/test/fixtures/pi/`, named
  `pi-1.0.0-e<N>-<slug>.<ext>`. Each copies its ADR Evidence row's captured text exactly, framed like
  the existing `error-stop-live-capture.jsonl`: a `session` record, `agent_start`, the terminal
  assistant `message_end` with `provider`, `model`, zero `usage`, `stopReason: "error"` and
  `errorMessage`, then `agent_end` and `agent_settled`.
  - E1, `pi-1.0.0-e1-no-api-key.stderr.txt`, holds `No API key found for deepseek.` followed by a
    blank line and `Use /login to log into a provider via OAuth or API key. See:`.
  - E5, `pi-1.0.0-e5-oauth-refresh-failed.jsonl`, holds this captured prefix of the errorMessage:
    `OAuth refresh failed for anthropic: Anthropic token refresh request failed. url=https://platform.claude.com/v1/oauth/token; details=Error: HTTP request failed. status=400; url=https://platform.claude.com/v1/oauth/token; body={"error": "invalid_grant", "error_description": "Refresh token not found or invalid"}; stack=Error: HTTP request failed.`
  - E6, E8 and E9, the stub-upstream retry captures, also carry three earlier assistant
    `message_end` error stops with the same `errorMessage`, each followed by `agent_end` with
    `willRetry: true` and an `auto_retry_start` record, and then a final
    `auto_retry_end` with `success: false`. That is the order in which Pi emitted them.
  - E2 to E4 and E6 to E9 copy the `errorMessage` text of their ADR Evidence row in full.
- **Signature table (ADR D1, D2).** In `src/conductor/src/execution/pi-provider.ts`, export a
  frozen `PI_FAILURE_SIGNATURES` array of `{ kind, state?, pattern }`. Each pattern is a
  multiline-anchored RegExp, `^...` with the `m` flag and no `i` flag:
  - `auth`, `missing`: `/^No API key found for /m` and `/^No API key for provider: /m`;
  - `auth`, `unusable`: `/^Authentication failed for "/m`, `/^OAuth refresh failed for /m` and
    `/^401(?:: | )/m`;
  - `limit`: `/^429(?:: | )/m`.
  Export `PI_QUOTA_VOCABULARY_RE`, a case-insensitive RegExp alternating Pi's nine quota terms,
  copied from `pi-ai/dist/utils/retry.js` in ADR Context. A module-local
  `classifyPiFailure(text: string)` returns `'usage-exhausted' | 'rate-limited' | { auth: state } |
  undefined`. A `limit` match plus a vocabulary match is `usage-exhausted`. A `limit` match alone
  is `rate-limited`. Then auth is tried, in table order.
- **Where classification runs (ADR D2, D3).** In `PiProvider.invoke`, after the ENOENT or 127
  return and after the existing missing-terminal-assistant return, compute the classified text:
  - `parsed.terminalAssistantErrorMessage` when `exitCode === 0` and
    `parsed.terminalAssistantStopReason === 'error'`;
  - otherwise `stderr` when `exitCode !== 0`.
  Run `classifyPiFailure` on it **before** the native-schema missing-structured-result return. A
  classified result returns at once. An unclassified exit-0 error stop keeps today's D14 return
  (output is the `errorMessage`). An unclassified non-zero exit keeps today's `modelUnavailable`
  and `exitFacts` path. `parsePiJsonl` is unchanged. It already keeps only the terminal assistant
  message's stop reason and error, so an earlier error stop that Pi retried is never classified.
- **Result shapes (ADR D4).** Every classified result carries `success: false`, the observed
  `exitCode`, `failedUsage`, and `gitGuardInstalled`.
  - Rate limit: `rateLimited: true` and output `Pi request was rate-limited by its upstream provider.`
  - Usage exhausted: `rateLimited: true`, `usageExhausted: true`, `waitSeconds: 3600`, and output
    `Pi upstream provider usage is exhausted.`
  - Auth: `authFailure: true`, `authentication: { provider: 'pi', source: 'cached-login', state }`,
    and output `Pi authentication failed: the upstream provider credential is missing or was rejected.`
  The outputs are fixed strings, built through `piDisplayName()`, and never include the classified
  text (architecture-review C2). Local pattern: the Codex adapter's fixed `authFailure` output and
  `CODEX_USAGE_EXHAUSTED_RE` handling in `codex-provider.ts` (rate limits precede auth; usage
  exhaustion is a rate limit with a 3600-second wait).
- **Contract and catalog (ADR D4, D5).**
  - `src/conductor/src/execution/provider-catalog.ts`: add `'credentialFileRecovery'` to
    `ProviderCapability`, and add optional `credentialRecoveryFile?: string` to
    `BuiltInProviderDescriptorBase`. The Pi descriptor sets `capabilities.credentialFileRecovery:
    true` and `credentialRecoveryFile: 'auth.json'`. `PROVIDER_CAPABILITY_OWNERS` is unchanged.
  - `src/conductor/src/execution/llm-provider.ts`: `AuthenticationReadinessBase.provider` becomes
    `ProviderWith<'readiness'>['id'] | ProviderWith<'credentialFileRecovery'>['id']`.
    `AuthenticationSource` and the `authenticationSource` event field are untouched.
  - `ProviderRuntimeSet.readinessFor` already refuses a provider without `readiness`, so a Pi record
    never reaches the readiness loop.
- **The park branch (ADR D6).** In `src/conductor/src/engine/conductor.ts` `parkOnAuthFailure`,
  insert a branch after the readiness `if` block and before `if (this.selfHost && shPark.buildAuthMode === 'api-key')`:
  - When `authentication` is defined and its descriptor `supportsProviderCapability(descriptor,
    'credentialFileRecovery')` with a `credentialRecoveryFile`, resolve
    `home = process.env[descriptor.homeVariable] ?? join(homedir(), descriptor.defaultHome)` (the
    same resolution the self-host provisioning block uses) and `file = join(home, descriptor.credentialRecoveryFile)`.
  - Emit `credentials_park` with reason `` `${descriptor.displayName} credentials rejected or missing — waiting for the ${descriptor.displayName} credentials file to change` ``.
  - Call `waitForCredentialsChange({ initialState: 'expired', credentialsPath: file, globalConfigDir: '', timeoutMs: shPark.authParkTimeoutMinutes * 60 * 1000, sleep: this.sleep, now: () => Date.now(), contentClassifier: parsesAsJsonObject })`,
    where the module-local `parsesAsJsonObject` returns true only when `JSON.parse` yields a
    non-null, non-array object.
  - `refreshed` returns `{ disposition: 'recovered' }`. `timeout` returns `halt` with reason
    `` `${name} credentials did not change before the auth park timed out.\nCredentials file: ${file}\nStore a working credential with ${name} (/login), or fix the upstream provider's environment key and restart the daemon, then re-queue this feature.` ``
  - Local pattern: the daemon-token branch directly below, which uses the same
    `waitForCredentialsChange` and `contentClassifier` call shape and the same halt structure.
    Allowed variation: the file comes from the descriptor, not from `resolveSelfHostConfig`.
  The serial `result.authFailure` branch and the group JOIN already pass `result.authentication`
  through, so neither call site changes.
- **Sequencing.** Task 1 lands the fixtures and the signature table. Task 2 lands the contract and
  the catalog. Tasks 3 to 7 wire classification into the adapter. Task 8 proves the candidate walk.
  Tasks 9 and 10 add the park. Tasks 11 and 12 prove the serial-loop rate-limit and exhaustion
  paths end to end.

## Prerequisites

- None. Pi 1.0.0's output shapes are captured in the ADR Evidence table.

## Tasks

### Task 1: Commit the Pi 1.0.0 failure captures and the anchored signature table
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider-failure-captures.test.ts` for every Done-when check below. Hard-code the nine ADR Evidence strings in the test as the expected prefixes.
2. Verify RED.
3. Implement: add the nine fixtures exactly as Technical Approach describes, and export `PI_FAILURE_SIGNATURES` and `PI_QUOTA_VOCABULARY_RE` from `pi-provider.ts` (no wiring into `invoke` yet).
4. Verify GREEN.
5. Commit: "test(pi): commit Pi 1.0.0 failure captures and signature table".

**Done when:**
- [test] `pi-provider-failure-captures.test.ts` asserts that each fixture `pi-1.0.0-e1-…` to `pi-1.0.0-e9-…` exists under `src/conductor/test/fixtures/pi/` and that its stderr text or terminal assistant `errorMessage` begins with its ADR Evidence string byte for byte.
- [test] The same test asserts that each of the seven ADR D1 signatures in `PI_FAILURE_SIGNATURES`, plus `PI_QUOTA_VOCABULARY_RE`, matches at least one fixture's classified text.
- [test] The same test asserts that every pattern in `PI_FAILURE_SIGNATURES` carries the `m` flag and no `i` flag, and that its source starts with `^`.
- [test] The same test replays each JSONL fixture through a `PiProvider` built with an injected subprocess factory, asserts that factory received every invocation, and asserts a `vi.mock` of `execa` recorded zero calls.

**Files likely touched:**
- `src/conductor/test/fixtures/pi/` — nine new capture fixtures
- `src/conductor/src/execution/pi-provider.ts` — exported signature table and quota vocabulary
- `src/conductor/test/execution/pi-provider-failure-captures.test.ts` — fixture tests

**Dependencies:** none

### Task 2: Declare Pi's credential-file recovery and admit Pi in the authentication record
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/provider-catalog.test.ts` and `src/conductor/test/execution/llm-provider-contract.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the catalog and contract changes in Technical Approach.
4. Verify GREEN.
5. Commit: "feat(provider): declare Pi credential-file auth recovery".

**Done when:**
- [test] `provider-catalog.test.ts` asserts the Pi descriptor has `capabilities.credentialFileRecovery === true` and `credentialRecoveryFile === 'auth.json'`, and that neither the Claude nor the Codex descriptor declares `credentialFileRecovery` or `credentialRecoveryFile`.
- [test] `llm-provider-contract.test.ts` asserts with `expectTypeOf` that `InvokeResult['authentication']` accepts `{ provider: 'pi', source: 'cached-login', state: 'unusable' }`, and with `// @ts-expect-error` that it rejects `{ provider: 'claude', source: 'cached-login', state: 'unusable' }`.
- The diff leaves `PROVIDER_CAPABILITY_OWNERS`, `AuthenticationSource`, and the `authenticationSource` field of `types/events.ts` unchanged.

**Files likely touched:**
- `src/conductor/src/execution/provider-catalog.ts` — capability, descriptor field, Pi declaration
- `src/conductor/src/execution/llm-provider.ts` — widened `authentication` provider type
- `src/conductor/test/execution/provider-catalog.test.ts` — tests
- `src/conductor/test/execution/llm-provider-contract.test.ts` — type tests

**Dependencies:** none

### Task 3: Pi rate limits are classified from the terminal error stop
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for every Done-when check below, driving `PiProvider` with its injected fake subprocess and the Task 1 fixtures.
2. Verify RED.
3. Implement: the classified-text selection and `classifyPiFailure` call in `invoke`, and the rate-limit result shape from Technical Approach. Follow the Codex adapter pattern: rate limits precede auth, and the output is a fixed sentence.
4. Verify GREEN.
5. Commit: "feat(pi): classify Pi rate limits".

**Done when:**
- [test] In `pi-provider.test.ts`, the E6 and E8 fixtures at exit 0 each yield `success: false` and `rateLimited: true`, with `usageExhausted`, `authFailure`, `modelUnavailable`, and `waitSeconds` all undefined.
- [test] The E9 fixture yields no `rateLimited`, `usageExhausted`, or `authFailure`; a terminal error stop with `errorMessage` `upstream said 429: busy` yields no `rateLimited`; and the E6 fixture's earlier error stops followed by a terminal `stopReason: "stop"` text message yield `success: true` with no `rateLimited`.
- [test] An exit-0 stream ending in `stopReason: "stop"` with assistant text `HTTP 429: rate limit reached` yields `success: true` and no `rateLimited`.
- [test] The E6 result's output is `Pi request was rate-limited by its upstream provider.` and contains none of `Rate limit reached for requests`, `rate_limit_exceeded`, or `{"message"`.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — classification in `invoke`
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 1

### Task 4: A rate-limited native-schema dispatch reports the rate limit, not a parse failure
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: move the classification ahead of the native-schema missing-structured-result return.
4. Verify GREEN.
5. Commit: "fix(pi): classify before the structured-result check".

**Done when:**
- [test] A `nativeSchema` dispatch whose stream is the E6 fixture, with no `submit_result`, yields `rateLimited: true`, and its output does not contain `missing structured result`.
- [test] A `nativeSchema` dispatch exiting 0 with a terminal `stopReason: "stop"` and no `submit_result` still yields output `Pi provider parse failure: missing structured result.`

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — return order
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 3

### Task 5: Pi usage exhaustion is classified with an hour-scale wait
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the usage-exhausted result shape from Technical Approach. Follow the Codex pattern for `CODEX_USAGE_EXHAUSTED_RE`: exhaustion is a rate limit with `usageExhausted` and a 3600-second `waitSeconds`.
4. Verify GREEN.
5. Commit: "feat(pi): classify Pi usage exhaustion".

**Done when:**
- [test] The E7 fixture yields `success: false`, `rateLimited: true`, `usageExhausted: true`, and `waitSeconds` 3600.
- [test] A terminal error stop whose `errorMessage` begins `429: ` and contains `Monthly usage limit reached` yields `usageExhausted: true`, while ones beginning `500: ` with `insufficient_quota` and `402: ` with `Insufficient Balance` each yield no `usageExhausted` and no `rateLimited`.
- [test] The E7 result's output is `Pi upstream provider usage is exhausted.` and contains neither `insufficient_quota` nor `billing details`.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — usage-exhausted mapping
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 3

### Task 6: Pi auth failures carry the auth signal and a Pi authentication record
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the auth result shape from Technical Approach.
4. Verify GREEN.
5. Commit: "feat(pi): classify Pi auth failures".

**Done when:**
- [test] The E1 stderr at exit 1 yields `success: false`, `authFailure: true`, and `authentication` deep-equal to `{ provider: 'pi', source: 'cached-login', state: 'missing' }`; the same stderr preceded by the line `Warning: Model "x" not found for provider "deepseek". Using custom model id.` yields `authFailure: true`; and an exit-0 error stop `No API key for provider: cline` yields `authFailure: true` with `authentication.state` `missing`.
- [test] The E2, E3, E4 and E5 fixtures, and exit-1 stderr beginning `Authentication failed for "anthropic". Credentials may have expired`, each yield `authFailure: true` with `authentication.state` `unusable`.
- [test] An exit-0 `stopReason: "stop"` stream with assistant text `401: Unauthorized` yields `success: true` and no `authFailure`; an error stop beginning `403: ` yields no `authFailure`; and exit-1 stderr `Error: Model "nonexistent-model-xyz" not found. Use --list-models to see available models.` yields `modelUnavailable: true` and no `authFailure`.
- [test] The E2 result's output is `Pi authentication failed: the upstream provider credential is missing or was rejected.` and contains none of `****0000`, `request_id`, `Authentication Fails`, or `{"message"`, and the E5 result's output contains none of `invalid_grant`, `platform.claude.com`, or `stack=`.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — auth mapping
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 2, Task 3

### Task 7: Unmatched Pi failures stay ordinary step failures
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for every Done-when check below. Some may already pass; keep them as regression pins.
2. Verify RED for the new line-anchoring case.
3. Implement any correction the tests expose. No new behavior is intended.
4. Verify GREEN.
5. Commit: "test(pi): pin unclassified Pi failures".

**Done when:**
- [test] Exit-1 stderr `boom: tool crashed` yields no `authFailure`, `rateLimited`, `usageExhausted`, `modelUnavailable`, or `providerUnavailable`, and carries `exitFacts`.
- [test] The existing `error-stop-live-capture.jsonl` fixture yields `success: false`, output `Free tier request failed.`, and no recovery flag, and an error stop whose first line begins `Warning: 429 retries scheduled` yields no `rateLimited`.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 6

### Task 8: A Pi auth failure or rate limit holds the candidate walk on Pi
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` for every Done-when check below. Use a real `PiProvider` with an injected fake subprocess replaying the Task 1 fixtures, and the file's `fakeProvider` for claude.
2. Verify RED.
3. No production change is expected beyond Tasks 3 and 6. `hasRecoveryPrecedence` already holds the walk.
4. Verify GREEN.
5. Commit: "test(provider-execution): Pi auth and rate limits hold the ladder".

**Done when:**
- [test] `executeProviderCandidates` with candidates pi then claude, where Pi replays the E2 fixture, invokes the claude fake zero times and returns `authFailure: true` and `actualProvider: 'pi'`.
- [test] The same walk with Pi replaying the E6 fixture invokes the claude fake zero times and returns `rateLimited: true`.

**Files likely touched:**
- `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` — tests

**Dependencies:** Task 6

### Task 9: A Pi auth failure parks on the Pi credentials file in the serial loop
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-auth-park.test.ts` for every Done-when check below. Follow the file's existing daemon-token park tests. Use a fake clock and sleep, a temp `PI_CODING_AGENT_DIR` (or a temp `HOME` with it unset), and a temp `CLAUDE_CONFIG_DIR`, and restore the environment after each test.
2. Verify RED.
3. Implement the `parkOnAuthFailure` branch and `parsesAsJsonObject` from Technical Approach. Follow the daemon-token branch's `waitForCredentialsChange` call and halt structure; the file comes from the descriptor.
4. Verify GREEN.
5. Commit: "feat(conductor): park Pi auth failures on Pi credentials".

**Done when:**
- [test] With `PI_CODING_AGENT_DIR` set to a temp dir holding `auth.json`, a serial build step whose first dispatch returns the Pi auth-failure result, and whose `auth.json` is rewritten during the park with a later mtime and a JSON object, emits `credentials_park` with reason `Pi credentials rejected or missing — waiting for the Pi credentials file to change`, dispatches Pi a second time, and leaves the attempt counter unchanged.
- [test] With `PI_CODING_AGENT_DIR` unset and `HOME` set to a temp dir, rewriting `<HOME>/.pi/agent/auth.json` during the park resumes it.
- [test] A park whose `auth.json` never changes, with a one-minute `auth_park_timeout_minutes` and the fake clock, writes a `needs-human` HALT whose reason contains `Pi credentials did not change`, the `auth.json` path, and `re-queue this feature`, and contains none of `.credentials.json`, `OAuth token`, `Authentication Fails`, or `{"message"`.
- [test] Rewriting `auth.json` with `{not json` and a later mtime does not resume the park before the timeout, and advancing the mtime of `$CLAUDE_CONFIG_DIR/.credentials.json` with fresh credentials during a Pi park does not resume it.
- The diff leaves every pre-existing test body in `conductor-auth-park.test.ts` unchanged, and those tests pass.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `parkOnAuthFailure` credential-file branch
- `src/conductor/test/engine/conductor-auth-park.test.ts` — tests

**Dependencies:** Task 2

### Task 10: A Pi auth failure in a concurrent group parks once and redispatches only the failed member
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-auth-park.test.ts` for every Done-when check below. Follow the existing grouped Codex readiness tests, such as "resumes only the auth-failed grouped member after its scheduled Codex readiness recheck".
2. Verify RED.
3. No production change is expected beyond Task 9. The JOIN already passes the no-verdict outcome's `authentication`.
4. Verify GREEN.
5. Commit: "test(conductor): grouped Pi auth park".

**Done when:**
- [test] A two-member group where member A returns the Pi auth-failure result and member B succeeds emits one Pi `credentials_park`, redispatches only member A after `auth.json` changes, and never redispatches member B.
- [test] The same group with an unchanged `auth.json` reaches the timeout and writes a `needs-human` HALT naming the Pi credentials file, without redispatching either member.

**Files likely touched:**
- `src/conductor/test/engine/conductor-auth-park.test.ts` — tests

**Dependencies:** Task 9

### Task 11: A Pi rate limit waits and retries Pi in the serial loop without burning budget
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` for every Done-when check below. Drive the file's `Conductor` harness with a ladder of pi then claude and an injected sleep. Pi replays the E6 fixture once and then a successful stream.
2. Verify RED.
3. No production change is expected beyond Task 3. The serial `result.rateLimited` branch is provider-agnostic.
4. Verify GREEN.
5. Commit: "test(conductor): Pi rate limit waits and retries".

**Done when:**
- [test] A serial run with a pi then claude ladder, where Pi first replays the E6 fixture, emits exactly one `rate_limit` event with `waitSeconds` 300, provider `pi`, and no `reason`, invokes Pi twice, and invokes claude zero times.
- [test] The same run completes the step on its first attempt number, so the rate-limited dispatch consumed no retry budget.

**Files likely touched:**
- `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` — tests

**Dependencies:** Task 3

### Task 12: Pi usage exhaustion suppresses Pi so other dispatches in the window fall back to claude
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` for every Done-when check below, with the same harness as Task 11. Pi replays the E7 fixture, and the provider availability store is the injected daemon-scoped one.
2. Verify RED.
3. No production change is expected beyond Task 5. Suppression is keyed by `actualProvider`.
4. Verify GREEN.
5. Commit: "test(conductor): Pi usage exhaustion advances the ladder".

**Done when:**
- [test] A serial run with a pi then claude ladder, where Pi replays the E7 fixture, leaves `providerAvailability.isAvailable('pi')` false and emits a `rate_limit` event with reason `usage-exhausted` and provider `pi`.
- [test] A second `executeProviderCandidates` walk with candidates pi then claude, given the same availability store before the suppression deadline, records a `provider_attempt` for pi with `invoked: false` and reason `provider-suppressed` and invokes the claude fake once.

**Files likely touched:**
- `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` — tests

**Dependencies:** Task 5

## Task Dependency Graph

- Task 1: none
- Task 2: none
- Task 3: Task 1
- Task 4: Task 3
- Task 5: Task 3
- Task 6: Task 2, Task 3
- Task 7: Task 6
- Task 8: Task 6
- Task 9: Task 2
- Task 10: Task 9
- Task 11: Task 3
- Task 12: Task 5

## Integration Points

- `PiProvider.invoke` is reached by every Pi dispatch through `createProviderRuntimeSet`. Tasks 8, 11
  and 12 prove classification through `executeProviderCandidates` and the serial loop.
- `parkOnAuthFailure` is reached by the serial loop and the group JOIN. Tasks 9 and 10 prove both.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D1 | task | task-1, task-3, task-5, task-6 | each of the seven ADR D1 signatures in `PI_FAILURE_SIGNATURES`, plus `PI_QUOTA_VOCABULARY_RE`, matches at least one fixture's classified text |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D2 | task | task-1, task-3, task-7 | every pattern in `PI_FAILURE_SIGNATURES` carries the `m` flag and no `i` flag, and that its source starts with `^` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D3 | task | task-4, task-6 | yields `rateLimited: true`, and its output does not contain `missing structured result` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D4 | task | task-2, task-3, task-5, task-6 | `authentication` deep-equal to `{ provider: 'pi', source: 'cached-login', state: 'missing' }` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D5 | task | task-2 | the Pi descriptor has `capabilities.credentialFileRecovery === true` and `credentialRecoveryFile === 'auth.json'` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D6 | task | task-9, task-10 | emits `credentials_park` with reason `Pi credentials rejected or missing — waiting for the Pi credentials file to change`, dispatches Pi a second time, and leaves the attempt counter unchanged |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D7 | task | task-8, task-11, task-12 | invokes the claude fake zero times and returns `authFailure: true` and `actualProvider: 'pi'` |
| adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output#D8 | task | task-1 | its stderr text or terminal assistant `errorMessage` begins with its ADR Evidence string byte for byte |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions; plan review sweeps this at Medium and Large tier
