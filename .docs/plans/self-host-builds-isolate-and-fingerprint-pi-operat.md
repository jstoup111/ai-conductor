# Implementation Plan: Self-host builds isolate and fingerprint Pi operator state

**Date:** 2026-10-03
**Design:** none (technical track)
**Stories:** .docs/stories/self-host-builds-isolate-and-fingerprint-pi-operat.md
**Conflict check:** Clean as of 2026-10-03

## Summary

Pi gains the `selfHost` capability. A Pi self-host candidate runs in a throwaway `PI_CODING_AGENT_DIR` holding one Pi-resolved credential, and the live Pi home is fingerprinted with a Pi volatile list. The conductor, provider home and live boundary read a catalog-declared self-host shape instead of branching on provider ids. 11 tasks.

## Technical Approach

- **Catalog first (Task 1).** Each `selfHost` descriptor gains `selfHostShape`, with `isolation`, `selectedAuthPath`, `claudeBuildPreflights`, `agentsSkillsLink` and `scrubVariables`, per adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D24. Claude and codex values reproduce today's branches exactly, so their behavior is unchanged.
- **Consumers read the shape (Tasks 2, 6, 7, 8).** `provider-home.ts` scrubs the union of every catalog home variable and declared extra, and links `.agents/skills` only when the shape says so. `live-boundary.ts` replaces its `environmentPrefix` branches with an exhaustive `Record<SelfHostProviderId, …>` table. `conductor.ts` selects the provider-home path, selected auth path and Claude-only preflights from the shape.
- **Pi credential (Tasks 3–5), D25.** New `execution/pi-self-host-auth.ts`, patterned on `execution/codex-self-host-auth.ts` (fs seam, mkdir, write, chmod 0600). It runs `pi auth print-api-key --provider <p>` against the operator's live environment, where `<p>` is the provider segment of the candidate model (`parsePiModelId`). It writes a one-entry `auth.json` and returns no env and no args. Every failure is a branded `ProviderSetupUnavailableError` (capability `self-host-isolation`), which the candidate loop already treats as setup-unavailable fallback authority. `provisionProviderHome` must rethrow that branded error rather than rewrap it. `SelfHostAuthContext` gains optional `model`, which the conductor fills from `candidate.model`.
- **Lifecycle reuse (Tasks 9, 10).** Scratch leasing, teardown and sweep are already provider-neutral (adr-2026-08-09-worktree-local-provider-scratch). Task 10 proves pi leases follow them, and Task 9 owns the conductor-level dispatch integration: no-spawn on refusal, redaction, teardown, and the live-boundary halt at the next dispatch boundary.
- **Guard (Task 11).** The existing provider-literal structural test gains an AST check that forbids provider-shaped self-host branches in the three consumer modules.
- **Out of scope (track boundary).** HOME-relative `~/.agents/skills` isolation, OS write containment (#2851), and providers registered by Pi extensions or packages, which are refused at setup.

## Prerequisites

- None. #1889 (Pi cost) may land first. If it has, Task 1 updates its provider-catalog assertion that lists `selfHost` among pi's undeclared capabilities.

## Tasks

### Task 1: Pi declares selfHost and every selfHost descriptor declares its self-host shape
**Story:** 1
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in the provider-catalog test: pi's `selfHost` capability, the absent `selfHost` owner entry, and a `selfHostShape` block on claude, codex and pi with fields `isolation` (`claude-config-sandbox` or `provider-home`), `selectedAuthPath`, `claudeBuildPreflights`, `agentsSkillsLink` and `scrubVariables`. Update any existing provider-catalog assertion that lists `selfHost` among pi's undeclared capabilities.
2. Verify the tests fail (RED).
3. Implement in the catalog: add `selfHost: true` to pi's capabilities, remove `selfHost` from `PROVIDER_CAPABILITY_OWNERS`, add the `selfHostShape` field to `BuiltInProviderDescriptor` (required on descriptors that declare `selfHost`), and fill it: claude `claude-config-sandbox`, `.credentials.json`, preflights true, no agents link, scrub `CLAUDE_CODE_OAUTH_TOKEN`; codex `provider-home`, `auth.json`, preflights false, agents link true, no extra scrub; pi `provider-home`, `auth.json`, preflights false, agents link false, scrub `PI_CODING_AGENT_SESSION_DIR`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(catalog): pi declares selfHost; catalog declares self-host shape"

**Done when:**
- provider-catalog test asserts `supportsProviderCapability('pi', 'selfHost')` returns true and `PROVIDER_CAPABILITY_OWNERS` has no `selfHost` key
- provider-catalog test asserts `selfHostShape.isolation` is `provider-home` for codex and pi and `claude-config-sandbox` for claude
- provider-catalog test asserts `selfHostShape.selectedAuthPath` is `.credentials.json` for claude and `auth.json` for codex and pi
- provider-catalog test asserts `selfHostShape.claudeBuildPreflights` is true only for claude, `agentsSkillsLink` is true only for codex, and `scrubVariables` is `['CLAUDE_CODE_OAUTH_TOKEN']` for claude, `[]` for codex and `['PI_CODING_AGENT_SESSION_DIR']` for pi

**Files:** src/conductor/src/execution/provider-catalog.ts; src/conductor/test/execution/provider-catalog.test.ts

**Dependencies:** none

### Task 2: Provider home derives its env scrub and skills view from the catalog shape
**Story:** 1
**Story:** 3
**Story:** 4
**Type:** refactor

**Steps:**
1. Write failing provider-home tests: the pi child env scrub, the codex env parity plus the added `PI_*` scrub, the codex `.agents/skills` link and pi's lack of one, the pruned pi `skills/` copy, and rethrow of a branded `ProviderSetupUnavailableError` from `prepareSelfHostAuth` with lease release.
2. Verify the tests fail (RED).
3. Implement in `provider-home.ts`: `ThrowawayProviderHome.childEnv()` deletes every catalog descriptor's `homeVariable` and every descriptor's `selfHostShape.scrubVariables` before setting its own home variable; the `.agents/skills` link is created when `selfHostShape.agentsSkillsLink` is true instead of comparing `homeVariable`; the catch block in `provisionProviderHome` rethrows an `isProviderSetupUnavailableError` error unchanged after releasing the scratch lease (it is never rewrapped as `ProviderHomeProvisionError`).
4. Verify the tests pass (GREEN).
5. Commit: "refactor(self-host): provider home reads catalog self-host shape"

**Done when:**
- provider-home test: for a pi home whose parent env sets `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_OAUTH_TOKEN`, `childEnv()` sets `PI_CODING_AGENT_DIR` to the home and omits the other four
- provider-home test: a codex home's `childEnv()` equals its pre-change value except that `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR` are absent, and the codex home still links `.agents/skills` to its own `skills`
- provider-home test: a pi home has no `.agents` entry and its `skills/` holds the worktree skills minus every `OPERATOR_ONLY_SKILLS` entry
- provider-home test: when `prepareSelfHostAuth` throws a `ProviderSetupUnavailableError`, `provisionProviderHome` rethrows that same branded error, the scratch lease is released, and no `self-host-pi-` directory remains under the scratch base

**Files:** src/conductor/src/engine/self-host/provider-home.ts; src/conductor/test/engine/self-host/provider-home.test.ts

**Dependencies:** Task 1

### Task 3: Pi self-host auth writes a one-entry auth.json from a Pi-resolved key
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests for a new `preparePiSelfHostAuth({ executable, model, homeDir, parentEnv, run })` in `execution/pi-self-host-auth.ts`, using an injected fake runner. Mirror `execution/codex-self-host-auth.ts`: the fs seam, `mkdir` of the home, write then `chmod 0o600`.
2. Verify the tests fail (RED).
3. Implement: take the provider segment of `model` with `parsePiModelId`, run `<executable> auth print-api-key --provider <p>` through `run` with `parentEnv` (the operator's live Pi home) passed through `scrubTmuxEnvironment`, `cwd` set to `homeDir` so no project-local `.pi/` is reachable, and a 30000 ms timeout, trim stdout, write `{ "<p>": { "type": "api_key", "key": "<key>" } }` to `<homeDir>/auth.json` with mode 0600, and return `{ args: [] }` with no `env`. The default runner is execa guarded by `assertRealExecAllowed`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(pi): resolve one provider credential for an isolated self-host home"

**Done when:**
- pi-self-host-auth test: with a fake runner printing `K` for model `openrouter/some-model`, `preparePiSelfHostAuth` writes `<home>/auth.json` that parses to exactly `{ "openrouter": { "type": "api_key", "key": "K" } }` with file mode 0600
- pi-self-host-auth test: the fake runner was called exactly once, with argv `auth print-api-key --provider openrouter`, `cwd` equal to the isolated home, and an env whose `PI_CODING_AGENT_DIR` equals the parent environment's value
- pi-self-host-auth test: the returned preparation has no `env` key and an empty `args` array, so `K` is in neither
- pi-self-host-auth test: with an operator Pi home fixture whose `auth.json` holds five provider entries, the isolated `auth.json` holds only the `openrouter` entry

**Files:** src/conductor/src/execution/pi-self-host-auth.ts; src/conductor/test/execution/pi-self-host-auth.test.ts

**Dependencies:** none

### Task 4: Pi self-host auth refuses unresolvable providers without leaking the key
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests for the refusal paths of `preparePiSelfHostAuth`: non-zero exit, Pi's unknown-provider error for an extension provider, empty or whitespace stdout, a timed-out runner, and a failing run whose stderr contains the key text.
2. Verify the tests fail (RED).
3. Implement: each failure throws `ProviderSetupUnavailableError` with `provider` from the catalog's pi id, `capability: 'self-host-isolation'`, a reason naming the provider segment and the exit status, and a recovery action. The reason carries the provider segment, the exit status (or `timed out`), and Pi's unknown-provider classification when stdout or stderr matches `Unknown provider`. It never quotes resolver stdout or stderr text, so key material cannot reach it even when only stderr carries it. Nothing is written before a key is accepted.
4. Verify the tests pass (GREEN).
5. Commit: "feat(pi): refuse unresolvable self-host credentials as setup-unavailable"

**Done when:**
- pi-self-host-auth test: a runner exiting 1 makes `preparePiSelfHostAuth` throw a `ProviderSetupUnavailableError` with provider `pi`, capability `self-host-isolation`, and a reason naming `openrouter`, and no `auth.json` exists in the home
- pi-self-host-auth test: a runner exiting 1 with stdout `Error: Unknown provider "qoder".` for model `qoder/m` throws the same refusal with a reason naming `qoder`
- pi-self-host-auth test: a runner exiting 0 with empty or whitespace-only stdout throws the refusal and no `auth.json` is written; a runner that times out also throws the refusal
- pi-self-host-auth test: for a failing run whose stderr contains `K`, the thrown error's message, reason and recovery action contain no `K`

**Files:** src/conductor/src/execution/pi-self-host-auth.ts; src/conductor/test/execution/pi-self-host-auth.test.ts

**Dependencies:** Task 3

### Task 5: PiProvider exposes self-host auth and executable resolution
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests: `PiProvider.resolveSelfHostExecutable` and `PiProvider.prepareSelfHostAuth`, the latter receiving the candidate model through `SelfHostAuthContext.model`, and the provider-runtime `selfHostAuthFor` seam returning a function for the pi runtime.
2. Verify the tests fail (RED).
3. Implement: add optional `model?: string` to `SelfHostAuthContext` in `llm-provider.ts`; add `resolveSelfHostExecutable()` returning the constructor executable and `prepareSelfHostAuth(context)` delegating to `preparePiSelfHostAuth` with `context.model` to `PiProvider`, with an injectable runner for tests.
4. Verify the tests pass (GREEN).
5. Commit: "feat(pi): wire self-host auth into the Pi adapter"

**Done when:**
- pi-provider test: `PiProvider.resolveSelfHostExecutable()` returns the executable the adapter was constructed with
- pi-provider test: `prepareSelfHostAuth({ provider, homeDir, model: 'deepseek/x' })` calls the injected runner with `--provider deepseek` and writes a one-entry `auth.json` keyed `deepseek`
- provider-runtime test: `selfHostAuthFor` returns a defined function for a registered pi runtime

**Files:** src/conductor/src/execution/pi-provider.ts; src/conductor/src/execution/llm-provider.ts; src/conductor/test/execution/pi-provider.test.ts; src/conductor/test/engine/provider-runtime.test.ts

**Dependencies:** Tasks 1, 3

### Task 6: Live boundary fingerprints Pi state with an exhaustive per-provider volatile table
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing live-boundary tests for pi: churn limited to `sessions/`, `models-store.json` and `auth.json` verifies ok; a `settings.json`, `trust.json` or `extensions/` change fails under both an uncontained and a contained verdict; a root `sessions.json` fails. Claude and codex lists stay unchanged.
2. Verify the tests fail (RED).
3. Implement in `live-boundary.ts`: replace the `environmentPrefix` branches of `providerStateVolatile` with `PROVIDER_STATE_VOLATILE: Readonly<Record<SelfHostProviderId, readonly string[]>>`, holding the existing claude and codex arrays unchanged and pi `['sessions', 'models-store.json']`. `fingerprintLiveBoundary` adds the provider's catalog `selfHostShape.selectedAuthPath` to the exclusions alongside any `selectedAuthPaths` argument.
4. Verify the tests pass (GREEN).
5. Commit: "feat(live-boundary): fingerprint Pi provider state"

**Done when:**
- live-boundary test: for provider pi, a provider-state change limited to added or changed `sessions/` entries, `models-store.json` and `auth.json` makes `verifyLiveBoundary` return ok
- live-boundary test: for provider pi, a change to `settings.json` or `trust.json`, or an added `extensions/x.ts`, makes `verifyLiveBoundary` return not ok with a reason containing `provider state` and the changed path, under both an uncontained and a contained verdict
- live-boundary test: for provider pi, an added root-level `sessions.json` makes `verifyLiveBoundary` return not ok
- `PROVIDER_STATE_VOLATILE` is typed `Readonly<Record<SelfHostProviderId, readonly string[]>>`, so deleting its pi key fails `tsc`, and the claude and codex entries deep-equal the pre-change arrays
- live-boundary test: under a contained verdict, a `settings.json` edit in the provider home makes `verifyLiveBoundary` return not ok for provider pi and for provider claude alike, and the two reasons are equal once each provider-home path is replaced by the same placeholder, each containing `provider state` and `settings.json`

> **Amended 2026-10-04 by #1887 (coverage_binding refusal):** The last Done when check above was added so Story 2's contained-dispatch criterion is asserted as parity with a contained claude dispatch, not only as a pi failure.

**Files:** src/conductor/src/engine/self-host/live-boundary.ts; src/conductor/test/engine/self-host/live-boundary.test.ts

**Dependencies:** Task 1

### Task 7: Conductor prepares self-host candidates from the catalog shape
**Story:** 1
**Story:** 4
**Type:** refactor

**Steps:**
1. Write failing conductor tests in a new `conductor-self-host-shape` test with fake guardrails and a fake pi resolver: pi candidate preparation through `provisionProviderHome`, per-provider `selectedAuthPaths`, two sequential pi candidates with different providers, and refusal when the pi runtime lacks the self-host seams.
2. Verify the tests fail (RED).
3. Implement in `prepareCandidateSelfHost`: `usesProviderHome` becomes `provider.selfHostShape.isolation === 'provider-home'`, `selectedAuthPaths` becomes `[provider.selfHostShape.selectedAuthPath]`, the missing-seam refusal message names the provider id and `self-host-isolation`, and the `prepareSelfHostAuth` wrapper passes `model: candidate.model` into the auth context.
4. Verify the tests pass (GREEN).
5. Commit: "refactor(conductor): self-host candidate preparation reads catalog shape"

**Done when:**
- conductor self-host test: a pi candidate with model `openrouter/m` is prepared through `provisionProviderHome`, and its invocation env's `PI_CODING_AGENT_DIR` lies under the feature worktree's `.daemon/scratch` and differs from the operator Pi home
- conductor self-host test: `fingerprintLiveBoundary` receives `selectedAuthPaths` `['auth.json']` for pi and codex candidates and `['.credentials.json']` for a claude candidate
- conductor self-host test: pi candidates `openrouter/m` then `deepseek/m` each get a home whose `auth.json` holds only its own provider key
- conductor self-host test: a pi runtime without `prepareSelfHostAuth` or `resolveSelfHostExecutable` makes preparation throw a `ProviderSetupUnavailableError` naming pi and capability `self-host-isolation`, and the fingerprint, scratch-acquire and `provisionProviderHome` fakes were never called

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-self-host-shape.test.ts

**Dependencies:** Tasks 1, 2, 5

### Task 8: Claude-only self-host preflights are selected by catalog shape
**Story:** 4
**Type:** refactor

**Steps:**
1. Write failing conductor tests: a pi dispatch with daemon-token build auth and no token file, a pi dispatch without `build_auth` and with expired Claude credentials, and a claude dispatch with daemon-token build auth and no token file.
2. Verify the tests fail (RED).
3. Implement in the self-host step path of `conductor.ts`: the daemon build-token preflight, the token read and the operator Claude credential preflight run only when the preferred provider's `selfHostShape.claudeBuildPreflights` is true. The legacy concurrency refusal and the legacy no-providerExecution branch use `selfHostShape.isolation === 'provider-home'` instead of comparing with `CODEX_PROVIDER`.
4. Verify the tests pass (GREEN).
5. Commit: "refactor(conductor): Claude-only self-host preflights come from catalog shape"

**Done when:**
- conductor self-host test: a pi dispatch with daemon-token build auth and a missing token file writes no build-token HALT marker and reaches pi candidate preparation
- conductor self-host test: a pi dispatch with no `harness_self_host.build_auth` block and an expired operator Claude credential never calls `preflightCredentialsCheck`
- conductor self-host test: a claude dispatch with daemon-token build auth and a missing token file writes the existing build-token HALT marker

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-self-host-shape.test.ts

**Dependencies:** Task 7

### Task 9: Pi self-host dispatch lifecycle through the conductor
**Story:** 1
**Story:** 2
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in a new `conductor-pi-self-host` test that drive a pi self-host dispatch through the candidate path, with a temporary operator Pi home, a fake resolver and a fake pi invoke: resolver failure, a key-bearing resolver stderr, success with teardown, failure and abort teardown, and live Pi home edits during the dispatch.
2. Verify the tests fail (RED).
3. Implement only what the tests expose in the conductor's candidate wiring. The expected production change is none beyond Tasks 2, 6 and 7, so record any genuine fix in this task's commit.
4. Verify the tests pass (GREEN).
5. Commit: "test(self-host): pi dispatch lifecycle through the conductor"

**Done when:**
- conductor pi test: with a resolver exiting 1, the pi candidate settles setup-unavailable naming pi and `openrouter`, the fake pi invoke is never called, and the scratch lease is released
- conductor pi test: with a failing resolver whose stderr contains `K`, no emitted event payload and no written HALT text contains `K`
- conductor pi test: a successful pi dispatch's invocation argv and env contain no `K`, and after teardown its home directory and `auth.json` no longer exist and its lease is released
- conductor pi test: a pi dispatch whose invoke fails, and one that is aborted, each still remove the home directory and its `auth.json`
- conductor pi test: when the live Pi home's `settings.json` changes during a dispatch, `pendingLiveBoundaryHalt` is a reason containing `provider state` and `settings.json` and the next dispatch boundary writes the HALT marker, while a dispatch that changes only `sessions/` sets no pending halt
- conductor pi test: with a failing resolver whose stderr contains `K`, the refusal diagnostic (the `ProviderSetupUnavailableError` message and the settled candidate's reason), every emitted event payload, and the written HALT text each do not contain `K`
- conductor pi test: when the live Pi home's `settings.json` changes before verification, the live-boundary verification result is not ok with a reason containing `provider state` and `settings.json`, and the next dispatch boundary writes the HALT marker carrying that reason

> **Amended 2026-10-04 by #1887 (coverage_binding refusal):** The last two Done when checks were added so Story 1's no-`K` criterion covers the refusal diagnostic as well as events and HALT text, and Story 2's pre-verification criterion asserts the verification failure itself, not only the pending halt.

**Files:** src/conductor/test/engine/conductor-pi-self-host.test.ts; src/conductor/src/engine/conductor.ts

**Dependencies:** Tasks 4, 6, 7

### Task 10: Scratch lease and sweep cover Pi homes
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write tests in the provider-scratch test covering a pi lease: acquire and release, an abandoned pi lease whose owner pid is dead, and a live pi lease owned by a running pid. The sweep is keyed by lease contents, not provider, so these are expected to pass on existing code.
2. Run them. If any fails, fix `provider-scratch.ts` in this task and drop the verify-only marker from the commit.
3. Commit with `Evidence: satisfied-by` or a test commit: "test(scratch): pi leases follow the existing sweep"

**Done when:**
- provider-scratch test: `acquireScratchHome` with provider pi creates a lease that `releaseScratchHome` removes
- provider-scratch test: `sweepScratch` removes an abandoned pi lease whose owner pid is dead, together with its home, exactly as it does for the equivalent codex lease fixture
- provider-scratch test: `sweepScratch` keeps a pi lease and its home while the owner pid is a running process

**Files:** src/conductor/test/engine/self-host/provider-scratch.test.ts

**Verify-only:** yes

**Dependencies:** Task 1

### Task 11: Structural test rejects provider-shaped self-host branches
**Story:** 4
**Type:** negative-path

**Steps:**
1. Extend `provider-id-literals.test.ts`, using the TypeScript AST it already loads, with a check over `engine/conductor.ts`, `engine/self-host/provider-home.ts` and `engine/self-host/live-boundary.ts`. It reports any binary comparison whose operand is a `.homeVariable` or `.environmentPrefix` property access and whose other operand is a string literal, and any comparison with the `CLAUDE_PROVIDER` or `CODEX_PROVIDER` constants that selects a self-host branch.
2. Verify the check flags an in-test fixture source containing `provider.homeVariable === 'CODEX_HOME'` (RED on the fixture).
3. Verify it reports no finding on the three production modules after Tasks 2, 6, 7 and 8 (GREEN).
4. Commit: "test(structural): forbid provider-shaped self-host branches"

**Done when:**
- provider-id-literals test: the new check reports a finding for an in-test fixture containing `provider.homeVariable === 'CODEX_HOME'` and one for `provider?.environmentPrefix === 'CODEX_'`
- provider-id-literals test: the new check reports zero findings for `engine/conductor.ts`, `engine/self-host/provider-home.ts` and `engine/self-host/live-boundary.ts`
- provider-id-literals test: the new check reports a finding for in-test fixtures containing `provider.homeVariable === 'CLAUDE_CONFIG_DIR'`, `'CODEX_HOME' !== provider.homeVariable` and `provider.environmentPrefix === 'CLAUDE_'`
- provider-id-literals test: the `homeVariable`/`environmentPrefix` string-literal rule scans every production `.ts` file under `src/conductor/src` except `execution/provider-catalog.ts` and the provider adapter modules (`execution/claude-provider.ts`, `execution/codex-provider.ts`, `execution/pi-provider.ts`), and reports zero findings
- `engine/self-host/sandbox-build-env.ts` selects its sandbox provider by `selfHostShape.isolation === 'claude-config-sandbox'`, with no `homeVariable` comparison
- provider-id-literals test: the complete structural test file passes with zero production provider-literal findings, including `execution/pi-self-host-auth.ts` and `engine/self-host/live-boundary.ts`, without weakening existing rules or adding adapter exemptions
- pi-self-host-auth test: existing success, refusal, timeout and credential non-disclosure checks pass with catalog-derived provider identity and unchanged rendered diagnostics
- live-boundary test: existing Claude, Codex and Pi volatile-path and protected-state checks pass with catalog-derived table keys and the exhaustive table type retained

> **Amended 2026-10-04 by #1887 (coverage_binding refusal):** Story 4's criterion covers all production source outside the catalog and provider adapters and both `CODEX_HOME` and `CLAUDE_CONFIG_DIR`. The `homeVariable`/`environmentPrefix` literal rule therefore scans that whole surface, not only the three modules in Step 1; the `CLAUDE_PROVIDER`/`CODEX_PROVIDER` constant rule keeps Step 1's three-module scope. The wider scan reaches `sandboxProvider()` in `engine/self-host/sandbox-build-env.ts`, which finds the claude descriptor by `homeVariable === 'CLAUDE_CONFIG_DIR'`; this task rewrites that lookup to read the catalog's `selfHostShape` (Task 1).

> **Amended 2026-10-04 by #1887 (operator-approved plan-gap recovery):** Task 11 also owns the feature-introduced provider-literal cleanup in `execution/pi-self-host-auth.ts` (Tasks 3 and 4), the Pi adapter's self-host auth guard in `execution/pi-provider.ts` (Task 4), and `engine/self-host/live-boundary.ts` (Task 6). The structural suite reports violations there, but the original task scope did not authorize their repair. Retain every existing structural rule, fixture and Done when check; do not add adapter exemptions or reduce the scanned surface to obtain GREEN. In the Pi auth helper, derive the provider id and display name from the existing catalog (`PI_PROVIDER` and its descriptor), replacing literal provider identification and diagnostic text while preserving the rendered messages, refusal classification, credential handling and redaction behavior. In the volatile table, use computed keys derived from the existing catalog provider constants, preserving its exhaustive `Readonly<Record<SelfHostProviderId, readonly string[]>>` type and all three providers' existing arrays. This is catalog-conformance cleanup, not new auth or fingerprint behavior.
>
> Execution order: preserve and finish the existing task-11 structural-test and sandbox-selector edits, establish the scoped structural failure, apply the two production cleanups above, then run the scoped union of `provider-id-literals.test.ts`, `pi-self-host-auth.test.ts` and `live-boundary.test.ts` through `ai-conductor scoped-run`. Do not reset completed task evidence or change accepted stories.

**Files:** src/conductor/test/engine/provider-id-literals.test.ts; src/conductor/src/engine/self-host/sandbox-build-env.ts; src/conductor/src/execution/pi-self-host-auth.ts; src/conductor/src/engine/self-host/live-boundary.ts; src/conductor/src/execution/pi-provider.ts

**Dependencies:** Tasks 1, 2, 3, 4, 6, 7, 8

## Task Dependency Graph

```text
Task 1 ──┬─> Task 2 ──┐
         ├─> Task 6 ──┼──────────────┐
         ├─> Task 10  │              │
Task 3 ──┼─> Task 4 ──┼──────────┐   │
         └─> Task 5 ──┴─> Task 7 ┼─> Task 9
                          Task 7 ──> Task 8
Tasks 1, 2, 3, 4, 6, 7, 8 ──> Task 11
```

## Integration Points

- After Task 7, a pi self-host candidate is prepared end to end with fakes (home, credential, fingerprint).
- After Task 9, the full pi dispatch lifecycle is proven through the conductor candidate path.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the pi catalog descriptor, when `supportsProviderCapability` is queried for `selfHost`, then it returns true, and `PROVIDER_CAPABILITY_OWNERS` no longer has a `selfHost` entry. | 1 | "provider-catalog test asserts `supportsProviderCapability('pi', 'selfHost')` returns true and `PROVIDER_CAPABILITY_OWNERS` has no `selfHost` key" | diff-local |
| Story 1 happy: Given a self-host dispatch whose candidate is pi with model `openrouter/some-model` and a resolver that prints key `K`, when the candidate is prepared, then the child environment's `PI_CODING_AGENT_DIR` names a fresh directory under the feature worktree's `.daemon/scratch` and not the operator's Pi home. | 7 | "conductor self-host test: a pi candidate with model `openrouter/m` is prepared through `provisionProviderHome`, and its invocation env's `PI_CODING_AGENT_DIR` lies under the feature worktree's `.daemon/scratch` and differs from the operator Pi home" | diff-local |
| Story 1 happy: Given the same dispatch, when the candidate is prepared, then the isolated home's `auth.json` parses to exactly one entry, keyed `openrouter`, with `type` `api_key` and `key` `K`, and has file mode 0600. | 3 | "pi-self-host-auth test: with a fake runner printing `K` for model `openrouter/some-model`, `preparePiSelfHostAuth` writes `<home>/auth.json` that parses to exactly `{ "openrouter": { "type": "api_key", "key": "K" } }` with file mode 0600" | diff-local |
| Story 1 happy: Given the same dispatch, when the candidate is prepared, then the credential resolver was invoked once as `pi auth print-api-key --provider openrouter` with the operator's live Pi home, and the isolated home's `skills/` holds the worktree skills minus the operator-only skills. | 3, 2 | "pi-self-host-auth test: the fake runner was called exactly once, with argv `auth print-api-key --provider openrouter`, `cwd` equal to the isolated home, and an env whose `PI_CODING_AGENT_DIR` equals the parent environment's value" | diff-local |
| Story 1 happy: Given a pi candidate whose model provider is `deepseek` after an earlier `openrouter` candidate, when each candidate is prepared, then each isolated home's `auth.json` holds only that candidate's own provider entry. | 7 | "conductor self-host test: pi candidates `openrouter/m` then `deepseek/m` each get a home whose `auth.json` holds only its own provider key" | diff-local |
| Story 1 negative: Given a pi candidate whose credential resolver exits non-zero, when the candidate is prepared, then preparation fails as a provider-setup refusal naming pi and the provider, no pi model subprocess is spawned, and the scratch lease is released. | 9 | "conductor pi test: with a resolver exiting 1, the pi candidate settles setup-unavailable naming pi and `openrouter`, the fake pi invoke is never called, and the scratch lease is released" | diff-local |
| Story 1 negative: Given a pi candidate whose model provider is registered only by a Pi extension so the resolver prints `Unknown provider`, when the candidate is prepared, then preparation fails as a provider-setup refusal naming that provider and no isolated home remains on disk. | 4, 2 | "pi-self-host-auth test: a runner exiting 1 with stdout `Error: Unknown provider "qoder".` for model `qoder/m` throws the same refusal with a reason naming `qoder`" | diff-local |
| Story 1 negative: Given a pi candidate whose resolver exits 0 with empty or whitespace-only output, when the candidate is prepared, then preparation fails as a provider-setup refusal and no `auth.json` is written. | 4 | "pi-self-host-auth test: a runner exiting 0 with empty or whitespace-only stdout throws the refusal and no `auth.json` is written; a runner that times out also throws the refusal" | diff-local |
| Story 1 negative: Given a resolver failure whose stderr contains the key text `K`, when the refusal diagnostic, events and HALT text are produced, then none of them contain `K`. | 9 | "conductor pi test: with a failing resolver whose stderr contains `K`, no emitted event payload and no written HALT text contains `K`" | diff-local |
| Story 1 negative: Given a prepared pi candidate, when its invocation argv and environment are inspected, then neither contains the key `K`. | 9 | "conductor pi test: a successful pi dispatch's invocation argv and env contain no `K`, and after teardown its home directory and `auth.json` no longer exist and its lease is released" | diff-local |
| Story 1 negative: Given a parent environment that sets `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_OAUTH_TOKEN`, when a pi isolated home builds its child environment, then `PI_CODING_AGENT_DIR` is the isolated home and the other four are absent. | 2 | "provider-home test: for a pi home whose parent env sets `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_OAUTH_TOKEN`, `childEnv()` sets `PI_CODING_AGENT_DIR` to the home and omits the other four" | diff-local |
| Story 1 negative: Given an operator Pi home whose `auth.json` holds entries for five providers, when a pi candidate for one of them is prepared, then the isolated `auth.json` holds no entry for the other four. | 3 | "pi-self-host-auth test: with an operator Pi home fixture whose `auth.json` holds five provider entries, the isolated `auth.json` holds only the `openrouter` entry" | diff-local |
| Story 2 happy: Given a pi self-host candidate fingerprinted against a live Pi home, when only files under `sessions/` are added or changed before verification, then live-boundary verification passes. | 6 | "live-boundary test: for provider pi, a provider-state change limited to added or changed `sessions/` entries, `models-store.json` and `auth.json` makes `verifyLiveBoundary` return ok" | diff-local |
| Story 2 happy: Given the same candidate, when only `models-store.json` and `auth.json` change before verification, then live-boundary verification passes. | 6 | "live-boundary test: for provider pi, a provider-state change limited to added or changed `sessions/` entries, `models-store.json` and `auth.json` makes `verifyLiveBoundary` return ok" | diff-local |
| Story 2 negative: Given a pi self-host candidate, when `settings.json` in the live Pi home changes before verification, then verification fails with a reason naming the provider state surface and `settings.json`, and the run halts at the next dispatch boundary. | 9 | "conductor pi test: when the live Pi home's `settings.json` changes during a dispatch, `pendingLiveBoundaryHalt` is a reason containing `provider state` and `settings.json` and the next dispatch boundary writes the HALT marker, while a dispatch that changes only `sessions/` sets no pending halt" | diff-local |
| Story 2 negative: Given a pi self-host candidate, when a file is added under `extensions/` or `trust.json` changes in the live Pi home, then verification fails naming that path. | 6 | "live-boundary test: for provider pi, a change to `settings.json` or `trust.json`, or an added `extensions/x.ts`, makes `verifyLiveBoundary` return not ok with a reason containing `provider state` and the changed path, under both an uncontained and a contained verdict" | diff-local |
| Story 2 negative: Given a pi self-host candidate whose dispatch is proven contained, when the operator edits `settings.json` in the live Pi home during the dispatch, then verification still fails naming `settings.json`, the same result a contained claude dispatch gets for a Claude `settings.json` edit. | 6 | "live-boundary test: for provider pi, a change to `settings.json` or `trust.json`, or an added `extensions/x.ts`, makes `verifyLiveBoundary` return not ok with a reason containing `provider state` and the changed path, under both an uncontained and a contained verdict" | diff-local |
| Story 2 negative: Given a pi self-host candidate, when a file named `sessions.json` is added at the live Pi home root, then verification fails, because only the `sessions` directory itself is excluded. | 6 | "live-boundary test: for provider pi, an added root-level `sessions.json` makes `verifyLiveBoundary` return not ok" | diff-local |
| Story 3 happy: Given a pi candidate whose dispatch completes, when its teardown runs, then the isolated home directory is removed and its scratch lease is released. | 9 | "conductor pi test: a successful pi dispatch's invocation argv and env contain no `K`, and after teardown its home directory and `auth.json` no longer exist and its lease is released" | diff-local |
| Story 3 happy: Given a pi scratch lease left by a run that was killed before teardown, when the next scratch sweep runs for that worktree, then the abandoned pi home and its lease are removed, exactly as for an abandoned codex lease. | 10 | "provider-scratch test: `sweepScratch` removes an abandoned pi lease whose owner pid is dead, together with its home, exactly as it does for the equivalent codex lease fixture" | diff-local |
| Story 3 negative: Given a pi candidate whose dispatch fails or is aborted, when the candidate's teardown runs, then the isolated home is removed and the one-entry `auth.json` no longer exists on disk. | 9 | "conductor pi test: a pi dispatch whose invoke fails, and one that is aborted, each still remove the home directory and its `auth.json`" | diff-local |
| Story 3 negative: Given a pi candidate whose credential resolution fails after the scratch lease was acquired, when preparation unwinds, then the lease is released and no `self-host-pi-` directory remains under `.daemon/scratch`. | 2 | "provider-home test: when `prepareSelfHostAuth` throws a `ProviderSetupUnavailableError`, `provisionProviderHome` rethrows that same branded error, the scratch lease is released, and no `self-host-pi-` directory remains under the scratch base" | diff-local |
| Story 3 negative: Given a live pi lease owned by a running attempt, when a concurrent sweep runs, then that lease and its home are kept. | 10 | "provider-scratch test: `sweepScratch` keeps a pi lease and its home while the owner pid is a running process" | diff-local |
| Story 4 happy: Given a pi self-host dispatch with daemon-token build auth configured and no token file present, when the dispatch starts, then no daemon build-token HALT is written and the pi candidate is prepared. | 8 | "conductor self-host test: a pi dispatch with daemon-token build auth and a missing token file writes no build-token HALT marker and reaches pi candidate preparation" | diff-local |
| Story 4 happy: Given a pi self-host dispatch with no `harness_self_host.build_auth` block and an expired operator Claude credential, when the dispatch starts, then the operator Claude credentials preflight does not run for it. | 8 | "conductor self-host test: a pi dispatch with no `harness_self_host.build_auth` block and an expired operator Claude credential never calls `preflightCredentialsCheck`" | diff-local |
| Story 4 happy: Given a claude self-host dispatch with daemon-token build auth configured and no token file present, when the dispatch starts, then the existing daemon build-token HALT is written as today. | 8 | "conductor self-host test: a claude dispatch with daemon-token build auth and a missing token file writes the existing build-token HALT marker" | diff-local |
| Story 4 happy: Given claude, codex and pi self-host candidates, when each fingerprints its live provider home, then the excluded selected auth path is `.credentials.json` for claude and `auth.json` for codex and pi. | 7 | "conductor self-host test: `fingerprintLiveBoundary` receives `selectedAuthPaths` `['auth.json']` for pi and codex candidates and `['.credentials.json']` for a claude candidate" | diff-local |
| Story 4 negative: Given a codex self-host candidate, when it is prepared, then its isolated home still receives the `.agents/skills` link and its child environment is unchanged from today apart from the added scrub of `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`. | 2 | "provider-home test: a codex home's `childEnv()` equals its pre-change value except that `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR` are absent, and the codex home still links `.agents/skills` to its own `skills`" | diff-local |
| Story 4 negative: Given a pi self-host candidate whose runtime provider lacks `prepareSelfHostAuth` or `resolveSelfHostExecutable`, when the candidate is prepared, then preparation refuses with a provider-setup refusal naming pi and the self-host-isolation capability, before any fingerprint, lease or home is created. | 7 | "conductor self-host test: a pi runtime without `prepareSelfHostAuth` or `resolveSelfHostExecutable` makes preparation throw a `ProviderSetupUnavailableError` naming pi and capability `self-host-isolation`, and the fingerprint, scratch-acquire and `provisionProviderHome` fakes were never called" | diff-local |
| Story 4 negative: Given production source outside the catalog and provider adapters, when the structural provider-literal test runs, then no `homeVariable` comparison against `CODEX_HOME` or `CLAUDE_CONFIG_DIR` and no `environmentPrefix` comparison selects a self-host path. | 11 | "provider-id-literals test: the new check reports zero findings for `engine/conductor.ts`, `engine/self-host/provider-home.ts` and `engine/self-host/live-boundary.ts`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D1 | existing | none | The provider-id-literals structural test already walks every production module under src/, so the new pi-self-host-auth module is covered; it takes the pi id from the catalog. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D2 | task | task-1 | `supportsProviderCapability('pi', 'selfHost')` returns true |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D3 | no-change | none | Boot-time discovery in engine/provider-discovery.ts is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D4 | no-change | none | The not-installed configuration error is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D5 | task | task-5 | `PiProvider.resolveSelfHostExecutable()` returns the executable the adapter was constructed with |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D6 | task | task-1 | `PROVIDER_CAPABILITY_OWNERS` has no `selfHost` key |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D7 | no-change | none | engine/live-e2e-providers.ts and its Pi smoke leg are not edited; tests use fake Pi runners. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D8 | no-change | none | Discovery and fail-fast scope are not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D9 | no-change | none | The compose launcher is not edited by any task; Pi still lacks interactiveLaunch. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D10 | no-change | none | Compose launcher host selection is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D11 | no-change | none | The compose launcher non-probing rule is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D12 | no-change | none | Pi model and thinking argv construction is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D13 | existing | none | Config validation already requires llm_providers.pi.model, so every Pi candidate carries a provider/model id that D25 parses. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D14 | no-change | none | Exit-0 stream classification is not edited by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D15 | no-change | none | The harness Pi extension asset is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D16 | no-change | none | Pi nativeSchema handling is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D17 | no-change | none | Pi read-only review argv is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D18 | no-change | none | D18 governs model invocations; the D25 auth resolver is not an invoke and runs with cwd at the throwaway home, so no project-local .pi file is reachable. Pi invoke argv is not touched. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D19 | no-change | none | Pi usage parsing is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D20 | no-change | none | Pi cost precedence is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D21 | no-change | none | TokenUsage.attributedModel is not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D22 | no-change | none | costSelfReporting and COST_SELF_REPORTING_PROVIDERS are not touched by any task. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D23 | task | task-1, task-2, task-7, task-9, task-10 | is prepared through `provisionProviderHome` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D24 | task | task-1, task-2, task-6, task-7, task-8, task-11 | is typed `Readonly<Record<SelfHostProviderId, readonly string[]>>` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D25 | task | task-3, task-4, task-5, task-9 | writes `<home>/auth.json` that parses to exactly |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D26 | task | task-6 | limited to added or changed `sessions/` entries, `models-store.json` and `auth.json` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [x] Dependencies are explicit and acyclic
