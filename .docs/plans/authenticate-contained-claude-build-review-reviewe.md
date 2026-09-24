# Implementation Plan: Authenticate contained Claude build_review reviewers

**Date:** 2026-09-24
**Design:** none (technical track)
**Stories:** .docs/stories/authenticate-contained-claude-build-review-reviewe.md
**Conflict check:** Clean as of 2026-09-24

## Summary

Contained Claude build_review reviewers get the credential of the resolved build-auth mode (the daemon build token by default) through the provider env overlay, and a missing credential halts `needs-human` before any attempt is spent. 9 tasks.

## Technical Approach

- **One resolution, shared with the daemon gate.** A new `src/conductor/src/engine/review-credential.ts` extracts `resolveBuildAuthCredentialMode(config)` from `resolveSelfHostConfig` (so an absent `build_auth` block stays `daemon-token`). `resolveContainedReviewerCredential` returns a discriminated union: available `{ mode, variable, value }` or unavailable `{ mode, locator, state }`. The daemon-level `isBuildAuthMissing` predicate switches to the same helper (architecture-review condition 1). The operator's stored Claude login is never read, and no mode falls back to another.
- **Transport through the existing overlay.** A new optional `reviewCredentialEnv` invoke option is applied only in the contained branch of `ClaudeProvider.buildEnv`, after the filtered inherited env and before the engine's scratch paths, so the engine value overrides any inherited token. Allowlist, mounts, and probes are untouched (condition 4).
- **Deterministic closed cause.** `reviewer-credential-unavailable` joins `BuildReviewInfrastructureFailureReason`. The `projection-oversized` equality checks become one `isDeterministicBuildReviewFault` predicate, so the new cause is charged once, never retried, never bumps the mechanical counter, and halts `needs-human` (adr-2026-08-18 D3.1/D3.2, condition 2). The halt reason reuses `buildAuthRemediationMessage`.
- **Two call sites.** Both build_review containment branches in `step-runners.ts` (custom-policy member, and built-in peer in a custom lap) resolve before acquiring review scratch. Unavailable returns the infrastructure result through the existing policy-failure emission; available passes `reviewCredentialEnv`. Codex keeps its seeded login (condition 5).
- **Sequencing.** Tasks 1–3 are independent foundations. Task 4 builds on 3. Task 5 is the integration owner for the custom path, and Task 6 mirrors it. Tasks 7–9 prove the self-host, containment, and non-leak properties on top of the wiring. The daemon gate normally parks before build_review when the token is missing; the refusal is the backstop for interactive runs and races (conflict report).

## Prerequisites

- None. The daemon token reader, build-auth resolution, remediation message, and containment preparation already exist.

## Tasks

### Task 1: Resolve the contained reviewer credential from the resolved build-auth mode
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing table-driven tests in `test/engine/review-credential.test.ts` for a new `resolveContainedReviewerCredential({ config, env, readToken })` in `src/engine/review-credential.ts`: rows for `daemon-token` with token states ok, missing, empty and unreadable; `api-key` with and without `ANTHROPIC_API_KEY`; and a config with no `build_auth` block. Inject `readToken` (production default `readDaemonBuildToken` from `engine/self-host/daemon-build-token.ts`) and a recording filesystem seam.
2. Verify the tests fail (RED): the module does not exist.
3. Implement: extract `resolveBuildAuthCredentialMode(config)` returning `{ mode, tokenPath }` from `resolveSelfHostConfig`, so an absent block resolves to `daemon-token` exactly as today. The resolver returns a discriminated union: `{ kind: "available", mode, variable, value }` or `{ kind: "unavailable", mode, locator, state }`, where `state` is the closed set `missing` or `unreadable` (the token reader already folds an empty or whitespace-only file into `missing`). In `daemon-token` mode it reads only the resolved token path and yields variable `CLAUDE_CODE_OAUTH_TOKEN`; in `api-key` mode it reads no file and yields variable `ANTHROPIC_API_KEY` from the ambient env, or unavailable with locator `ANTHROPIC_API_KEY` and state `missing`. There is no fallback between modes, and no code path references the host Claude config directory. Switch the `isBuildAuthMissing` predicate in `src/daemon-cli.ts` to the extracted helper so the daemon gate and the reviewer share one resolution.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): resolve the contained reviewer credential from the build-auth mode".

**Done when:**
- In `api-key` mode with an ambient key, `resolveContainedReviewerCredential` returns available with variable `ANTHROPIC_API_KEY` and that key, returns no `CLAUDE_CODE_OAUTH_TOKEN`, and never calls its `readToken` seam, as asserted by the api-key table row.
- In `daemon-token` mode `resolveContainedReviewerCredential` returns unavailable with mode `daemon-token`, the token path as locator, and state `missing` for the absent and empty token fixtures and `unreadable` for the unreadable fixture.
- In `api-key` mode without an ambient key and with a readable token fixture, `resolveContainedReviewerCredential` returns unavailable with locator `ANTHROPIC_API_KEY` and state `missing`, and never calls `readToken`, so the daemon token is not used.
- For a config with no `build_auth` block, `resolveBuildAuthCredentialMode` returns `daemon-token`, and a spy test shows both `resolveContainedReviewerCredential` and the `isBuildAuthMissing` predicate in `daemon-cli.ts` obtain the mode from that one helper.
- Across every table row the recording filesystem seam shows reads only of the resolved `buildAuthTokenPath`, and no read of any path under the host Claude config directory.

**Files:** src/conductor/src/engine/review-credential.ts, src/conductor/src/daemon-cli.ts, src/conductor/test/engine/review-credential.test.ts

**Dependencies:** none

### Task 2: Apply the resolved credential in the contained Claude env overlay
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/execution/claude-provider.test.ts` that build the Claude provider env with a ready `reviewAccess` profile and a new `reviewCredentialEnv` invoke option.
2. Verify the tests fail (RED): the option does not exist and no credential reaches the contained env.
3. Implement: add optional `reviewCredentialEnv?: Readonly<Record<string, string>>` to `InvokeOptions` in `src/execution/llm-provider.ts`. In `ClaudeProvider.buildEnv`, contained branch only, spread it after the filtered inherited env and before the engine overlay (scratch HOME, CLAUDE_CONFIG_DIR, TMPDIR, XDG dirs), so it overrides an inherited value and cannot displace the scratch paths. The non-contained branch ignores the option. The review allowlist in `execution/child-environment.ts` is not changed.
4. Verify the tests pass (GREEN).
5. Commit: "feat(claude-provider): apply the review credential in the contained env overlay".

**Done when:**
- `ClaudeProvider.buildEnv` contained branch applies `reviewCredentialEnv` after the filtered inherited env, so an inherited `CLAUDE_CODE_OAUTH_TOKEN` is replaced by the supplied daemon token value.
- The contained env built with a supplied credential equals the contained env built without it plus exactly the one credential variable, as asserted by a key-set and value diff test.
- With `GITHUB_TOKEN` and `OPENAI_API_KEY` in the inherited env, the contained env built with a supplied credential contains neither variable.
- `buildEnv` for a non-contained invocation ignores `reviewCredentialEnv`, so a non-self-host non-contained env gains no `CLAUDE_CODE_OAUTH_TOKEN` from it.
- A supplied `{ ANTHROPIC_API_KEY }` credential yields that key and no `CLAUDE_CODE_OAUTH_TOKEN` in the contained env when none is inherited.

**Files:** src/conductor/src/execution/llm-provider.ts, src/conductor/src/execution/claude-provider.ts, src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** none

### Task 3: Add the deterministic reviewer-credential-unavailable closed cause
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/build-review-domain.test.ts` and `test/engine/build-review-cli.test.ts` for the new cause and for a `isDeterministicBuildReviewFault` predicate.
2. Verify the tests fail (RED).
3. Implement: add `reviewer-credential-unavailable` to `BuildReviewInfrastructureFailureReason` and its total mapping in `src/engine/build-review-domain.ts`, to `REDUCED_COVERAGE_REASONS` in `src/engine/build-review-dispositions.ts`, and to the closed reason list in `src/engine/build-review-artifacts.ts`. Local pattern: `projection-oversized` is the precedent. It is charged once, never retried, and never bumps the mechanical-fault counter (adr-2026-08-18 D3.1). Its routing seams are the equality checks against that reason in `src/engine/step-runners.ts` (lap result and halt routing) and `src/engine/build-review-cli.ts` (fault routing and counter bump); search for the literal `projection-oversized` to find them. Allowed variation: replace each equality check with one exported `isDeterministicBuildReviewFault(reason)` predicate true for exactly these two reasons, leaving `projection-oversized` behaviour byte-for-byte the same.
4. Verify the tests pass (GREEN), including the existing `projection-oversized` tests unchanged.
5. Commit: "feat(build-review): add the deterministic reviewer-credential-unavailable cause".

**Done when:**
- `BuildReviewInfrastructureFailureReason`, the domain mapping, `REDUCED_COVERAGE_REASONS`, and the artifacts reason list all include `reviewer-credential-unavailable`, and the build-review-domain totality test passes.
- `isDeterministicBuildReviewFault` returns true for `projection-oversized` and `reviewer-credential-unavailable` and false for `provider-error`, and no `projection-oversized` equality check remains in `step-runners.ts` or `build-review-cli.ts`.
- A lap settling `reviewer-credential-unavailable` leaves the mechanical-fault counter unchanged and consumes no kickback budget, as asserted by reading the build_review ledger after the lap.
- A `projection-oversized` lap still publishes its aggregate, skips the mechanical-fault counter, and halts `needs-human`, as asserted by the existing projection-oversized tests passing unchanged.
- A lap whose Claude member settles `provider-error` still bumps the mechanical-fault counter by one and re-runs under the existing allowance.

**Files:** src/conductor/src/engine/build-review-domain.ts, src/conductor/src/engine/build-review-dispositions.ts, src/conductor/src/engine/build-review-artifacts.ts, src/conductor/src/engine/build-review-cli.ts, src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-domain.test.ts, src/conductor/test/engine/build-review-cli.test.ts

**Dependencies:** none

### Task 4: Halt needs-human with the credential and its remediation
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing test in `test/engine/build-review-step.test.ts`: a lap whose only infrastructure failure is an uncovered `reviewer-credential-unavailable` returns a `needs-human` refusal with a specific reason.
2. Verify the test fails (RED).
3. Implement: in the build_review step result routing in `src/engine/step-runners.ts`, next to the existing projection-oversized human-action refusal (same uncovered-rubric condition, so a recorded reduced-coverage decision still lets the operator past it), return `refusal: { kind: "needs-human", reason }`. The reason names the rubric, the mode, the credential locator, and its state. In `daemon-token` mode it appends `buildAuthRemediationMessage(tokenPath)` from `engine/self-host/build-auth-message.ts`; in `api-key` mode it names `ANTHROPIC_API_KEY`. It never includes a credential value.
4. Verify the test passes (GREEN).
5. Commit: "feat(build-review): halt needs-human naming the missing reviewer credential".

**Done when:**
- The build_review step returns a `needs-human` refusal for an uncovered `reviewer-credential-unavailable` failure whose reason names the rubric, the mode, the credential path or variable, and its state.
- In `daemon-token` mode the refusal reason contains the `buildAuthRemediationMessage` text for the token path, and in `api-key` mode it names `ANTHROPIC_API_KEY`.
- When the rubric carries a recorded reduced-coverage decision, the same failure does not produce the `needs-human` refusal, matching the projection-oversized uncovered-rubric condition.

**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-step.test.ts

**Dependencies:** 3

### Task 5: Wire credential resolution into the custom-policy member path
**Story:** 1
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/build-review-step.test.ts` that drive a custom-policy lap with a Claude member through the real containment call site, using a stubbed provider runtime that records launches and a daemon-token fixture.
2. Verify the tests fail (RED): no credential reaches the launch, and with no token the member launches and fails with `provider-error`.
3. Implement: in the custom-policy member path of `src/engine/step-runners.ts`, for a Claude candidate, call `resolveContainedReviewerCredential` with `this.config` and `process.env` before `acquireReviewScratchHome`. When unavailable, return the member as an infrastructure failure with reason `reviewer-credential-unavailable` and a detail naming mode, locator and state, through the existing policy-failure emission, so no scratch is acquired and no provider is launched. When available, pass `reviewCredentialEnv: { [variable]: value }` beside `reviewAccess` in the dispatched invoke options. Codex candidates keep the existing seeded-login branch untouched.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): supply the daemon credential to contained custom-policy reviewers".

**Done when:**
- In the custom-policy member path, a Claude member with a readable daemon-token fixture reaches the stubbed provider launch with `reviewCredentialEnv` carrying `CLAUDE_CODE_OAUTH_TOKEN` equal to the fixture, and the member settles with a judged verdict.
- With no daemon token fixture in `daemon-token` mode, and separately in `api-key` mode with no ambient key, the custom-policy member path makes zero provider launches and acquires no review scratch, emits `build_review_rubric_infrastructure_failure` with reason `reviewer-credential-unavailable`, and the step returns a `needs-human` refusal.
- A launched Claude member whose stubbed provider returns an authentication rejection settles with reason `provider-error`, not `reviewer-credential-unavailable`.
- Re-running the step after the halt is cleared, still with no token fixture, again makes zero provider launches, refuses with `reviewer-credential-unavailable`, and leaves the mechanical-fault counter unchanged.

**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-step.test.ts

**Dependencies:** 1, 2, 3, 4

### Task 6: Wire credential resolution into the built-in-peer path of a custom-policy lap
**Story:** 1
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/build-review-step.test.ts` for a custom-policy lap whose built-in peer rubric runs on Claude under containment, and for a built-in-only lap with no custom member.
2. Verify the tests fail (RED).
3. Implement: in the built-in-peer containment branch of `src/engine/step-runners.ts` (the branch that materializes the frozen input for built-in rubrics when a custom member participates), apply the same resolution as Task 5 before scratch acquisition when the containment provider is Claude: return the `reviewer-credential-unavailable` infrastructure result when unavailable, and pass `reviewCredentialEnv` when available. The built-in-only route, which has no containment, does not call the resolver.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): supply the daemon credential to contained built-in peers".

**Done when:**
- In the built-in-peer path of a custom-policy lap, a Claude peer with a readable daemon-token fixture reaches the provider launch with `reviewCredentialEnv` carrying the fixture token, and the peer settles with a judged verdict.
- With no daemon token fixture, the contained built-in peer makes zero provider launches and settles with reason `reviewer-credential-unavailable`.
- A built-in-only lap with no custom member and no daemon token dispatches exactly as before, never calls `resolveContainedReviewerCredential`, and raises no credential refusal.

**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-step.test.ts

**Dependencies:** 5

### Task 7: Supply the daemon token to contained reviewers on self-host projects
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `test/engine/build-review-step.test.ts`: a self-host custom-policy lap in `daemon-token` mode with a readable token fixture, whose Claude candidate also carries a self-host env overlay.
2. Verify the test fails (RED) if the self-host overlay can displace the engine-supplied credential.
3. Implement: confirm in `ClaudeProvider.buildEnv` that `reviewCredentialEnv` is applied after `filterReviewChildEnvironment` of the self-host env, adjusting the spread order if needed.
4. Verify the test passes (GREEN).
5. Commit: "test(build-review): self-host contained reviewers receive the daemon token".

**Done when:**
- With a self-host config in `daemon-token` mode and a readable token fixture, the contained Claude member launch receives `CLAUDE_CODE_OAUTH_TOKEN` equal to the fixture through `reviewCredentialEnv`.
- A self-host env overlay carrying a different `CLAUDE_CODE_OAUTH_TOKEN` does not displace the engine-supplied value in the contained env built by `ClaudeProvider.buildEnv`.

**Files:** src/conductor/src/execution/claude-provider.ts, src/conductor/test/engine/build-review-step.test.ts

**Dependencies:** 5

### Task 8: Prove containment is unchanged when a credential is supplied
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write tests in `test/engine/build-review-containment.test.ts` comparing member preparation with and without a resolved credential, and a mixed Claude and Codex lap.
2. Run them against the Task 5 and Task 6 wiring; they are expected to pass, because the credential travels only through the env overlay.
3. Commit: "test(build-review): containment is unchanged by the reviewer credential".

**Done when:**
- `prepareBuildReviewContainment` produces identical mount arguments and identical write-probe and host-state-probe results for a Claude member prepared with and without a resolved credential.
- After member preparation with a resolved credential, listing review scratch finds no `.credentials.json`, no build-auth token file, and no copy of the host Claude config directory.
- The env of a contained Codex member in the same lap carries no `CLAUDE_CODE_OAUTH_TOKEN` and no `ANTHROPIC_API_KEY`, and its `codex-home/auth.json` seed is still written by `copySelectedCodexLogin`.

**Files:** src/conductor/test/engine/build-review-containment.test.ts

**Verify-only:** yes

**Dependencies:** 5, 6

### Task 9: Prove the credential value never reaches telemetry or halts
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing-first test in `test/engine/build-review-step.test.ts` that runs one lap with a distinctive daemon-token fixture value and one lap with no token, and captures every emitted event, refusal detail, halt reason, and daemon log line.
2. If any capture contains the value, remove it at its source in `src/engine/step-runners.ts`; the credential detail builder names mode, locator and state only.
3. Commit: "test(build-review): the reviewer credential never appears in telemetry".

**Done when:**
- Across a lap with a distinctive daemon-token fixture and a lap with no token, no captured event payload, refusal detail, halt reason, or daemon log line contains the fixture value.
- The `reviewer-credential-unavailable` detail matches a pattern naming the mode, the token path, and the state, and contains no credential value.

**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-step.test.ts

**Dependencies:** 5, 6

## Task Dependency Graph

```text
Task 1, Task 2, Task 3        (independent foundations)
Task 3 -> Task 4
Task 1, Task 2, Task 3, Task 4 -> Task 5
Task 5 -> Task 6
Task 5 -> Task 7
Task 5, Task 6 -> Task 8
Task 5, Task 6 -> Task 9
```

## Integration Points

- After Task 5: a custom-policy Claude reviewer on a non-self-host project authenticates with the daemon token, and a missing token halts `needs-human` with zero launches.
- After Task 6: every contained Claude member of a custom-policy lap is covered.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a non-self-host project with no `build_auth` block and a readable daemon build token, when a custom-policy build_review member is dispatched to Claude under containment, then the reviewer's environment carries the daemon token as `CLAUDE_CODE_OAUTH_TOKEN` and the member settles with a judged verdict. | 5, 2 | "In the custom-policy member path, a Claude member with a readable daemon-token fixture reaches the stubbed provider launch with `reviewCredentialEnv` carrying `CLAUDE_CODE_OAUTH_TOKEN` equal to the fixture, and the member settles with a judged verdict." | diff-local |
| Story 1 happy: Given the same project and a lap that includes a custom-policy member, when a built-in peer rubric of that lap is dispatched to Claude under containment, then that peer's environment also carries the daemon token and the peer settles with a judged verdict. | 6, 2 | "In the built-in-peer path of a custom-policy lap, a Claude peer with a readable daemon-token fixture reaches the provider launch with `reviewCredentialEnv` carrying the fixture token, and the peer settles with a judged verdict." | diff-local |
| Story 1 happy: Given a self-host project in `daemon-token` mode with a readable daemon build token, when a contained Claude member is dispatched, then its environment carries the same daemon token as `CLAUDE_CODE_OAUTH_TOKEN`. | 7 | "With a self-host config in `daemon-token` mode and a readable token fixture, the contained Claude member launch receives `CLAUDE_CODE_OAUTH_TOKEN` equal to the fixture through `reviewCredentialEnv`." | diff-local |
| Story 1 negative: Given a reviewer launched with the daemon token, when the provider rejects it with an authentication error during the review, then the member settles with the existing retryable `provider-error` cause and not with `reviewer-credential-unavailable`. | 5 | "A launched Claude member whose stubbed provider returns an authentication rejection settles with reason `provider-error`, not `reviewer-credential-unavailable`." | diff-local |
| Story 1 negative: Given the daemon environment already carries a different `CLAUDE_CODE_OAUTH_TOKEN`, when a contained Claude reviewer's environment is built in `daemon-token` mode, then the variable holds the daemon token and not the inherited value. | 2 | "`ClaudeProvider.buildEnv` contained branch applies `reviewCredentialEnv` after the filtered inherited env, so an inherited `CLAUDE_CODE_OAUTH_TOKEN` is replaced by the supplied daemon token value." | diff-local |
| Story 2 happy: Given a project in `api-key` mode with `ANTHROPIC_API_KEY` in the daemon environment, when a contained Claude member is prepared, then the reviewer receives that key, no `CLAUDE_CODE_OAUTH_TOKEN` is added, and the daemon token file is not read. | 1, 2 | "In `api-key` mode with an ambient key, `resolveContainedReviewerCredential` returns available with variable `ANTHROPIC_API_KEY` and that key, returns no `CLAUDE_CODE_OAUTH_TOKEN`, and never calls its `readToken` seam, as asserted by the api-key table row." | diff-local |
| Story 2 happy: Given a project with no `build_auth` block, when a contained Claude member is prepared, then the credential is resolved in `daemon-token` mode, the same mode the daemon-level credential gate resolves for that project. | 1 | "For a config with no `build_auth` block, `resolveBuildAuthCredentialMode` returns `daemon-token`, and a spy test shows both `resolveContainedReviewerCredential` and the `isBuildAuthMissing` predicate in `daemon-cli.ts` obtain the mode from that one helper." | diff-local |
| Story 2 negative: Given `daemon-token` mode whose token file is missing, empty, or unreadable, when a contained Claude member is prepared, then no reviewer is launched and the member is refused with `reviewer-credential-unavailable` naming the mode, the token path, and its state. | 1, 5 | "In `daemon-token` mode `resolveContainedReviewerCredential` returns unavailable with mode `daemon-token`, the token path as locator, and state `missing` for the absent and empty token fixtures and `unreadable` for the unreadable fixture." | diff-local |
| Story 2 negative: Given `api-key` mode with no `ANTHROPIC_API_KEY` in the daemon environment and a readable daemon token, when a contained Claude member is prepared, then no reviewer is launched, the member is refused with `reviewer-credential-unavailable` naming the missing API key, and the daemon token is not used. | 1, 5 | "In `api-key` mode without an ambient key and with a readable token fixture, `resolveContainedReviewerCredential` returns unavailable with locator `ANTHROPIC_API_KEY` and state `missing`, and never calls `readToken`, so the daemon token is not used." | diff-local |
| Story 2 negative: Given any mode, when a contained Claude member is prepared, then the operator's stored Claude login under the host config directory is not read. | 1 | "Across every table row the recording filesystem seam shows reads only of the resolved `buildAuthTokenPath`, and no read of any path under the host Claude config directory." | diff-local |
| Story 3 happy: Given a contained Claude member dispatched with the daemon token, when the reviewer is launched, then its mount set, write probes, and host-state probe are identical to a dispatch without a credential and its environment differs only by the one credential variable. | 8, 2 | "`prepareBuildReviewContainment` produces identical mount arguments and identical write-probe and host-state-probe results for a Claude member prepared with and without a resolved credential." | diff-local |
| Story 3 happy: Given a contained Claude member dispatched with the daemon token, when review scratch is inspected after launch preparation, then it contains no credential file and no copy of the host Claude config directory. | 8 | "After member preparation with a resolved credential, listing review scratch finds no `.credentials.json`, no build-auth token file, and no copy of the host Claude config directory." | diff-local |
| Story 3 negative: Given the daemon environment also holds tracker or other-provider secrets such as `GITHUB_TOKEN` and `OPENAI_API_KEY`, when a contained Claude reviewer environment is built, then none of them is present. | 2 | "With `GITHUB_TOKEN` and `OPENAI_API_KEY` in the inherited env, the contained env built with a supplied credential contains neither variable." | diff-local |
| Story 3 negative: Given a resolved credential, when events, refusal detail, halt bodies, and daemon log lines for the lap are inspected, then the credential value appears in none of them. | 9 | "Across a lap with a distinctive daemon-token fixture and a lap with no token, no captured event payload, refusal detail, halt reason, or daemon log line contains the fixture value." | diff-local |
| Story 3 negative: Given a contained Codex member in the same lap, when its environment is built, then it carries no Claude credential and its seeded Codex login behaves as before. | 8 | "The env of a contained Codex member in the same lap carries no `CLAUDE_CODE_OAUTH_TOKEN` and no `ANTHROPIC_API_KEY`, and its `codex-home/auth.json` seed is still written by `copySelectedCodexLogin`." | diff-local |
| Story 3 negative: Given a non-contained Claude step in the same non-self-host run, when its environment is built, then no daemon token is added to it. | 2 | "`buildEnv` for a non-contained invocation ignores `reviewCredentialEnv`, so a non-self-host non-contained env gains no `CLAUDE_CODE_OAUTH_TOKEN` from it." | diff-local |
| Story 4 happy: Given `daemon-token` mode and no daemon token file, when a lap with a contained Claude member runs, then no Claude reviewer is launched, the member settles with `reviewer-credential-unavailable`, and the feature halts `needs-human` with a body naming the mode, the token path and its state, and the shared build-auth remediation message. | 5, 4 | "With no daemon token fixture in `daemon-token` mode, and separately in `api-key` mode with no ambient key, the custom-policy member path makes zero provider launches and acquires no review scratch, emits `build_review_rubric_infrastructure_failure` with reason `reviewer-credential-unavailable`, and the step returns a `needs-human` refusal." | diff-local |
| Story 4 happy: Given that refusal, when the build_review ledger is read afterwards, then the mechanical-fault counter is unchanged and no kickback budget was consumed. | 3 | "A lap settling `reviewer-credential-unavailable` leaves the mechanical-fault counter unchanged and consumes no kickback budget, as asserted by reading the build_review ledger after the lap." | diff-local |
| Story 4 negative: Given the operator clears that halt without supplying a credential, when build_review runs again, then it refuses again in the same way before any reviewer launch and the mechanical-fault counter is still unchanged. | 5 | "Re-running the step after the halt is cleared, still with no token fixture, again makes zero provider launches, refuses with `reviewer-credential-unavailable`, and leaves the mechanical-fault counter unchanged." | diff-local |
| Story 4 negative: Given a lap whose settled cause is `projection-oversized`, when it is routed after this change, then it still publishes its aggregate, skips the mechanical-fault counter, and halts `needs-human` exactly as before. | 3 | "A `projection-oversized` lap still publishes its aggregate, skips the mechanical-fault counter, and halts `needs-human`, as asserted by the existing projection-oversized tests passing unchanged." | diff-local |
| Story 4 negative: Given a lap whose Claude member fails with a transient `provider-error`, when it is routed after this change, then it still consumes one mechanical-fault lap and re-runs under the existing allowance. | 3 | "A lap whose Claude member settles `provider-error` still bumps the mechanical-fault counter by one and re-runs under the existing allowance." | diff-local |
| Story 4 negative: Given a built-in-only lap with no custom member, when it runs without a daemon token, then its dispatch and enablement behave as before this change and no credential refusal is raised. | 6 | "A built-in-only lap with no custom member and no daemon token dispatches exactly as before, never calls `resolveContainedReviewerCredential`, and raises no credential refusal." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-07-daemon-owned-build-credential#D1 | existing | none | The BuildAuthProvider seam exists as `resolveSelfHostConfig` build-auth resolution plus `readDaemonBuildToken`; Task 1 reuses it unchanged. |
| adr-2026-07-07-daemon-owned-build-credential#D2 | no-change | none | This feature copies no operator credential file into any sandbox or scratch; Decision 2 constrains the design and adds no work. |
| adr-2026-07-07-daemon-owned-build-credential#D3 | existing | none | The no-silent-fallback preflight and daemon gate already exist; the reviewer refusal reuses their mode resolution without changing them. |
| adr-2026-07-07-daemon-owned-build-credential#D4 | no-change | none | Park-and-poll on the daemon token source is unchanged; the reviewer refusal is a needs-human halt, not a park. |
| adr-2026-07-07-daemon-owned-build-credential#D5 | existing | none | The real-binary smoke that proves the daemon token authenticates a headless claude from a fresh config dir already exists and covers the contained reviewer. |
| adr-2026-07-07-daemon-owned-build-credential#D6 | task | task-1, task-5 | For a config with no `build_auth` block, `resolveBuildAuthCredentialMode` returns `daemon-token`, and a spy test shows both `resolveContainedReviewerCredential` and the `isBuildAuthMissing` predicate in `daemon-cli.ts` obtain the mode from that one helper. |
| adr-2026-07-07-daemon-owned-build-credential#D7 | task | task-2, task-8 | The contained env built with a supplied credential equals the contained env built without it plus exactly the one credential variable, as asserted by a key-set and value diff test. |
| adr-2026-07-07-daemon-owned-build-credential#D8 | task | task-4, task-5 | In `daemon-token` mode the refusal reason contains the `buildAuthRemediationMessage` text for the token path, and in `api-key` mode it names `ANTHROPIC_API_KEY`. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D1 | existing | none | Mechanical faults are already classified apart at every routing seam by the infrastructure-failure reason; the new cause joins that closed union. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D2 | task | task-3 | `BuildReviewInfrastructureFailureReason`, the domain mapping, `REDUCED_COVERAGE_REASONS`, and the artifacts reason list all include `reviewer-credential-unavailable`, and the build-review-domain totality test passes. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D3 | task | task-3 | A lap settling `reviewer-credential-unavailable` leaves the mechanical-fault counter unchanged and consumes no kickback budget, as asserted by reading the build_review ledger after the lap. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D4 | existing | none | The three-lap mechanical counter is unchanged; Task 3 keeps provider-error charging it and exempts only deterministic causes. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D5 | task | task-4 | The build_review step returns a `needs-human` refusal for an uncovered `reviewer-credential-unavailable` failure whose reason names the rubric, the mode, the credential path or variable, and its state. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D6 | task | task-3, task-4 | When the rubric carries a recorded reduced-coverage decision, the same failure does not produce the `needs-human` refusal, matching the projection-oversized uncovered-rubric condition. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D7 | no-change | none | Reduced-coverage identity stays {rubric, closed reason}; the new reason is a new member of the closed set, not a new key shape. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D8 | no-change | none | A judged finding still blocks; the credential refusal is raised before judging and never substitutes for a finding decision. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D9 | no-change | none | Reduced-coverage stamping is unchanged; the new reason uses the existing stamping path. |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D10 | task | task-5 | With no daemon token fixture in `daemon-token` mode, and separately in `api-key` mode with no ambient key, the custom-policy member path makes zero provider launches and acquires no review scratch, emits `build_review_rubric_infrastructure_failure` with reason `reviewer-credential-unavailable`, and the step returns a `needs-human` refusal. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
