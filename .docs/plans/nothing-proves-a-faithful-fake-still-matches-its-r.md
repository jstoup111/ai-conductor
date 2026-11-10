# Implementation Plan: Paired fake-and-real contracts for external boundaries (#1990)

**Date:** 2026-11-08
**Design:** .docs/architecture/nothing-proves-a-faithful-fake-still-matches-its-r.md
**Stories:** .docs/stories/nothing-proves-a-faithful-fake-still-matches-its-r.md
**Conflict check:** Clean as of 2026-11-08 (`.docs/conflicts/nothing-proves-a-faithful-fake-still-matches-its-r.md`)

## Summary

This plan builds the reusable boundary-contract harness, the registry `contract` field and its obligation check, shared
Claude and Pi fakes, and the `llm` contract. That contract has a default-tier fake leg and three opt-in real smoke legs.
The work is 11 tasks. There is no production (`src/conductor/src/`) change.

## Technical Approach

- **Harness.** `src/conductor/test/contracts/boundary-contract.ts` exports two functions.
  - `defineBoundaryContract<S>({ boundary, expectations })` returns a frozen contract. Its `expectations` is an ordered
    list of `{ name, run(subject) }`. Definition throws when the list is empty or a name repeats, and the error names
    the boundary.
  - `runBoundaryContract(contract, { adapter, leg, create })` registers
    `describe('«boundary» contract [«adapter» «leg»]')` with one `it(name)` per expectation, so the full title is
    `«boundary» contract [«adapter» «leg»] › «name»`. Each case calls `create()` itself. A throwing factory fails every
    case with that error; it never yields a zero-assertion pass. `leg` is the closed union `'fake' | 'real'`.
- **Registry field.** In `src/conductor/test/structural/boundary-registry.ts` (landed by #3660 on `origin/main`),
  `BoundaryEntry` gains `contract: BoundaryContractEntry | null`. `BoundaryContractEntry` is
  `{ module, legs: readonly { adapter, fake, fakeLeg, realLeg }[] }`. All paths are relative to `src/conductor/`,
  except `adapter`, which uses the registry's existing `src/conductor/src/`-relative adapter-module form. `llm` is
  populated and the seven pending entries are `null`.
- **Obligation check.** A pure checker, `checkBoundaryContractObligations(registry, files)` in
  `src/conductor/test/structural/boundary-contract-obligation.ts`, returns every violation as a typed list. `files`
  maps each path to its source text. `boundary-contract-obligation.test.ts` drives it with fixture registries and
  finally with the real registry and real file contents. It reads files and runs nothing.
- **Fakes.** `test/fixtures/claude-provider-fake.ts` and `test/fixtures/pi-provider-fake.ts` follow the existing
  `createCodexProviderFake` shape: return `{ provider, calls }`, check `spawnPermit` before recording anything and throw on a denied permit as the real adapters do, never
  launch a CLI, and accept an optional script override. Their capability declarations match the real adapters
  (`supportsSessionResume = false`, `{ synchronousSpawnPermit: true }`, `{ nativeOutputSchema: true }`,
  `{ deliversSystemPrompt: true }`), and a permitted native-schema request returns a `finalStructuredResult`. The
  Codex fake gains the same native-schema behavior, and it throws on a denied permit instead of returning a failed result, which is a divergence plan review found. It keeps its thread-id and resume semantics.
- **llm contract.** `test/contracts/llm.contract.ts` defines four expectations against `LLMProvider`, in this order:
  1. `declares the adapter capabilities`
  2. `refuses a denied spawn permit before spawning`
  3. `completes a minimal invocation`
  4. `returns a native-schema terminal result`

  No expectation asserts model text content.
- **Legs.** `test/contracts/llm.contract.test.ts` is the default-tier fake leg for all three adapters.
  `test/contracts/llm-real-leg.ts` is a shared real-leg body. It builds the real adapter from the existing
  `LIVE_E2E_PROVIDERS` descriptor, meters `InvokeResult.tokenUsage` (`input + output`), and after the run asserts the
  `resolveLiveE2ETokenCap()` bound through the existing `assertTokenCap`, emitting a spend line. Three thin files,
  `test/contracts/llm-{claude,codex,pi}.contract.smoke.test.ts`, each declare `const smokeCapability = 'credentialed:«adapter»';`
  and call the body.
- **Smoke-run integration.** The existing smoke runner (`runSmokeCli` in `src/engine/smoke-runner.ts`) needs no change.
  Task 9 proves its ledger and gate behavior for the three new files by injecting `discover`, `runVitest`,
  `hasCommand` and `environment`, and updates the structural known-file discovery list.
- **Focused local pattern basis.**
  - *Shared faithful fake.* Traits to keep: it returns an `LLMProvider` plus recorded calls, checks the permit before
    any work, never spawns, and declares capabilities identical to its adapter. Allowed variation: a per-adapter
    script hook. Search hint: `createCodexProviderFake`.
  - *Shared body, one file per provider.* Traits to keep: one body module, and thin per-adapter smoke files that each
    declare one credentialed capability. Search hints: `defineLiveE2EProviderSmoke`, `test/engine/daemon-e2e-live-*.smoke.test.ts`.

## Prerequisites

- `src/conductor/test/structural/boundary-registry.ts` from #3660, which is present on `origin/main`. The daemon's build
  branch is cut from `origin/main`.

## Tasks

### Task 1: Boundary contract harness
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/contracts/boundary-contract.test.ts` for every Done-when check below. Use a toy two-expectation contract over a plain object subject, and inspect the registered Vitest task titles and results through a nested `describe` run in-process.
2. Implement `defineBoundaryContract` and `runBoundaryContract` as described in Technical Approach.
3. Verify GREEN and commit.

**Done when:**
- [test] `boundary-contract.test.ts` asserts that running one contract with expectations `declares the adapter capabilities` and `completes a minimal invocation` for adapter `claude` registers exactly two cases, titled `llm contract [claude fake] › declares the adapter capabilities` and `llm contract [claude fake] › completes a minimal invocation`.
- [test] The same test runs the identical contract object on leg `real` and asserts the two case titles carry the same expectation names under the prefix `llm contract [claude real] ›`, differing only in the leg token.
- [test] A subject that violates only the second expectation produces exactly one failed case, titled `llm contract [claude fake] › completes a minimal invocation` (naming boundary, adapter, leg and expectation), while the first case still runs and passes.
- [test] `defineBoundaryContract` throws an error naming boundary `llm` and the duplicated expectation name for a duplicate name, throws an error naming `llm` and the word `empty` for an empty expectation list, and in both cases registers no case.
- [test] A leg whose `create` factory throws `Error('factory boom')` reports every expectation case as failed with `factory boom` in its message, and zero cases pass.

**Files likely touched:**
- `src/conductor/test/contracts/boundary-contract.ts` — the harness.
- `src/conductor/test/contracts/boundary-contract.test.ts` — the harness tests.

**Dependencies:** none

### Task 2: Registry `contract` field
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Update `src/conductor/test/structural/boundary-registry.test.ts`. Its deep-equality expectations for the `llm` entry and the whole registry must include the new `contract` field, the test must fail first, and the existing registry tests keep their other assertions.
2. Add the `BoundaryContractEntry` type and the `contract` field to `BoundaryEntry`. Populate `llm` with module `test/contracts/llm.contract.ts` and three legs. The adapters are `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts`. The fakes are `test/fixtures/claude-provider-fake.ts`, `test/fixtures/codex-provider-fake.ts` and `test/fixtures/pi-provider-fake.ts`. Every leg's fake leg is `test/contracts/llm.contract.test.ts`, and the real legs are `test/contracts/llm-{claude,codex,pi}.contract.smoke.test.ts`. Set the seven pending entries to `contract: null`.
3. Verify GREEN and commit.

**Done when:**
- [test] `boundary-registry.test.ts` deep-equals `BOUNDARY_REGISTRY.llm.contract` to the module `test/contracts/llm.contract.ts` with exactly three legs, one per registered llm adapter module, naming the fake, fake-leg and real-leg paths listed in Steps.
- [test] `boundary-registry.test.ts` asserts `contract` is `null` for each of `git`, `gh`, `tmux`, `process`, `clock`, `otel` and `filesystem`, while the existing eight-name completeness and adapter-path assertions still pass unchanged.

**Files likely touched:**
- `src/conductor/test/structural/boundary-registry.ts` — `contract` field and values.
- `src/conductor/test/structural/boundary-registry.test.ts` — updated deep-equality expectations.

**Dependencies:** none

### Task 3: Obligation checker over fixture registries
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/structural/boundary-contract-obligation.test.ts` for every Done-when check below. Use fixture registries and an in-memory `files` map of path to source text.
2. Implement `checkBoundaryContractObligations(registry, files)` in `src/conductor/test/structural/boundary-contract-obligation.ts`. It returns typed violations, each with `boundary`, `rule`, and the offending `path` or `adapter`. It applies every rule to a ported boundary and to any pending boundary whose contract is non-null.
3. Verify GREEN and commit.

**Done when:**
- [test] A fixture with `llm` ported and complete legs for all three adapters, plus a pending `git` with `contract: null`, plus a pending `gh` with a complete early contract, yields an empty violation list; and every violating fixture in the checks below except `ported-without-contract` is run twice, once with its boundary `ported` and once `pending` with that same non-null contract, and both runs return the identical violation list, proving a pending boundary's early contract receives every ported-boundary rule (`missing-leg`, `unregistered-adapter`, `missing-file`, `fake-leg-is-smoke`, `real-leg-not-smoke`, `missing-capability`, `missing-contract-import`).
- [test] A ported boundary with `contract: null` yields one violation naming that boundary with rule `ported-without-contract`; an adapter module with no leg yields `missing-leg` naming the boundary and that adapter; a leg whose adapter is not registered yields `unregistered-adapter` naming the boundary and the adapter.
- [test] A leg whose fake module, fake-leg file, real-leg file or contract module is absent from `files` yields `missing-file` naming the boundary and that path, as asserted once for each of the four path kinds.
- [test] A fake-leg path ending `.smoke.test.ts` yields `fake-leg-is-smoke` naming the file; a real-leg path not ending `.smoke.test.ts` yields `real-leg-not-smoke` naming the file; a real-leg source with no `smokeCapability` declaration yields `missing-capability` naming the file; a leg source that does not import the contract module yields `missing-contract-import` naming the file and the module path.
- [test] One fixture carrying three violations across two boundaries returns all three in one list, and the test's failure message lists every violation rather than the first only.

**Files likely touched:**
- `src/conductor/test/structural/boundary-contract-obligation.ts` — the pure checker.
- `src/conductor/test/structural/boundary-contract-obligation.test.ts` — fixture-driven cases.

**Dependencies:** Task 2

### Task 4: Shared Claude provider fake
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/fixtures/claude-provider-fake.test.ts` for every Done-when check below.
2. Implement `createClaudeProviderFake(script?)` following the `createCodexProviderFake` traits: return `{ provider, calls }`, check `spawnPermit` before recording or calling the script, never spawn a process, and let a script override return a result. A denied permit throws `Error('Claude fake process spawn denied: «reason»')`, mirroring `ClaudeProvider`, which throws on denial. Allowed variation: no thread-id minting.
3. Verify GREEN and commit.

**Done when:**
- [test] `createClaudeProviderFake().provider` declares `supportsSessionResume === false`, `lifecycleCapability` `{ synchronousSpawnPermit: true }`, `nativeSchemaCapability` `{ nativeOutputSchema: true }` and `systemPromptCapability` `{ deliversSystemPrompt: true }`, each compared to the corresponding property of a real `ClaudeProvider` instance without invoking it.
- [test] A permitted invocation with no script returns `success: true`, `exitCode: 0` and non-empty `output`, and appends exactly one entry to `calls`; a permitted invocation carrying `nativeSchema` returns a defined `finalStructuredResult`.
- [test] An invocation whose `spawnPermit` returns `{ permitted: false, reason: 'revoked' }` rejects with an error whose message contains `revoked`, as the real adapter does, leaves `calls` empty, and never notifies `onSpawn`.
- [test] A script override returning `{ success: false, output: 'scripted', exitCode: 3 }` is returned unchanged and the call is still recorded.
- [test] The fake module source read from disk imports none of `execa`, `child_process` or `node:child_process`, and the existing structural case `keeps every unmocked live-provider session smoke-only and excluded from default Vitest` passes with `test/fixtures/claude-provider-fake.ts` present.

**Files likely touched:**
- `src/conductor/test/fixtures/claude-provider-fake.ts` — the fake.
- `src/conductor/test/fixtures/claude-provider-fake.test.ts` — the fake's tests.

**Dependencies:** none

### Task 5: Shared Pi provider fake
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/fixtures/pi-provider-fake.test.ts` for every Done-when check below.
2. Implement `createPiProviderFake(script?)` with the same traits as Task 4, including throwing on a denied permit before recording or calling the script, which mirrors `PiProvider`. Allowed variation: Pi-specific default output text.
3. Verify GREEN and commit.

**Done when:**
- [test] `createPiProviderFake().provider` declares `supportsSessionResume === false`, `lifecycleCapability` `{ synchronousSpawnPermit: true }`, `nativeSchemaCapability` `{ nativeOutputSchema: true }` and `systemPromptCapability` `{ deliversSystemPrompt: true }`, each compared to the corresponding property of a real `PiProvider` instance without invoking it.
- [test] A permitted invocation with no script returns `success: true`, `exitCode: 0` and non-empty `output`, and appends exactly one entry to `calls`; a permitted invocation carrying `nativeSchema` returns a defined `finalStructuredResult`.
- [test] An invocation whose `spawnPermit` returns `{ permitted: false, reason: 'revoked' }` rejects with an error whose message contains `revoked`, as the real adapter does, leaves `calls` empty, and never notifies `onSpawn`.
- [test] A script override returning `{ success: false, output: 'scripted', exitCode: 3 }` is returned unchanged and the call is still recorded.
- [test] The fake module source read from disk imports none of `execa`, `child_process` or `node:child_process`, and the existing structural case `keeps every unmocked live-provider session smoke-only and excluded from default Vitest` passes with `test/fixtures/pi-provider-fake.ts` present.

**Files likely touched:**
- `src/conductor/test/fixtures/pi-provider-fake.ts` — the fake.
- `src/conductor/test/fixtures/pi-provider-fake.test.ts` — the fake's tests.

**Dependencies:** none

### Task 6: Codex fake native-schema result and denied-permit recording
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/fixtures/codex-provider-fake.test.ts` for every Done-when check below.
2. Change `createCodexProviderFake` so that a permitted invocation with `nativeSchema` and no script returns a defined `finalStructuredResult`. Also change it so that a denied permit throws `Error('Codex fake process spawn denied: «reason»')` instead of returning a failed result, mirroring `CodexProvider`, which throws on denial. Keep the permit check before any recording, the thread-id minting, and the resume rejection unchanged.
3. Verify GREEN and commit.

**Done when:**
- [test] `codex-provider-fake.test.ts` asserts a permitted invocation carrying `nativeSchema` returns `success: true` with a defined `finalStructuredResult`, and asserts the fake's four capability declarations equal those of a real `CodexProvider` instance without invoking it.
- [test] The same test asserts a denied `spawnPermit` (`reason: 'revoked'`) rejects with an error whose message contains `revoked`, leaves `calls` and `threadIds` empty, and never notifies `onSpawn`; a script override result is returned unchanged with the call recorded.
- [test] The same test asserts a `resume: true` invocation still returns `no rollout found for thread id «sessionId»` and a fresh invocation still mints one thread id, as `codex-fresh-session-per-step-contract.acceptance.test.ts` continues to pass unchanged.
- [test] The Codex fake module source read from disk imports none of `execa`, `child_process` or `node:child_process`, and the existing structural case `keeps every unmocked live-provider session smoke-only and excluded from default Vitest` passes with `test/fixtures/codex-provider-fake.ts` present.

**Files likely touched:**
- `src/conductor/test/fixtures/codex-provider-fake.ts` — native-schema result.
- `src/conductor/test/fixtures/codex-provider-fake.test.ts` — new tests.

**Dependencies:** none

### Task 7: llm contract and its default-tier fake leg
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write `src/conductor/test/contracts/llm.contract.ts` with the four expectations from Technical Approach, using `defineBoundaryContract`.
   - *Capabilities:* assert the four declarations equal `false`, `{ synchronousSpawnPermit: true }`, `{ nativeOutputSchema: true }` and `{ deliversSystemPrompt: true }`.
   - *Denied permit:* invoke with a `spawnPermit` returning `{ permitted: false, reason: 'revoked' }` and a counting `onSpawn`, then assert that the invocation rejects with an error whose message contains `revoked` and that `onSpawn` is never notified.
   - *Minimal invocation:* a one-line prompt; assert `success === true`, `exitCode === 0` and non-empty `output` only.
   - *Native schema:* a one-boolean schema. Create a root with `mkdtemp` under `os.tmpdir()`, and create `«root»/.daemon/scratch/contract-«n»/home` with `mkdir({ recursive: true })` before invoking. `writeScratchSchema` accepts only an existing home beneath `«nativeSchemaScratchRoot»/.daemon/scratch/`, and Codex and Pi refuse a native schema without one. Pass the root as `cwd` and `nativeSchemaScratchRoot` and the home as `nativeSchemaScratchHome`, and remove the root in `finally`. Assert `success === true` and that `finalStructuredResult` is a non-null object.
2. Write `src/conductor/test/contracts/llm.contract.test.ts`. It calls `runBoundaryContract` for adapters `claude`, `codex` and `pi` on leg `fake`, with the Task 4–6 fakes. A second `describe` calls each named expectation's `run` directly against mutated subjects and expects rejection. A mutated subject is a hand-written wrapper `{ ...fake.provider, «override» }` that replaces one property or `invoke`, because a fake's permit check runs before its script.
3. Verify GREEN and commit.

**Done when:**
- [test] `llm.contract.test.ts` registers twelve passing default-tier cases, titled `llm contract [«adapter» fake] › «expectation»` for each of `claude`, `codex`, `pi` crossed with `declares the adapter capabilities`, `refuses a denied spawn permit before spawning`, `completes a minimal invocation` and `returns a native-schema terminal result`; across that run no supplied `onSpawn` observer is notified, and the `llm.contract.ts` source read from disk imports none of `execa`, `child_process` or `node:child_process` and constructs no `ClaudeProvider`, `CodexProvider` or `PiProvider`.
- [test] The `refuses a denied spawn permit before spawning` expectation rejects a wrapper over the Pi fake whose `invoke` resolves `{ success: false, output: 'denied', exitCode: 1 }` instead of rejecting for a denied permit, while resolving for the unmutated Claude and Codex fakes, so only that adapter's case fails; it also rejects a wrapper that notifies `onSpawn` before rejecting, and rejects a wrapper whose denial rejection message omits `revoked`, so the expectation requires the error to name the denial reason.
- [test] The `completes a minimal invocation` expectation passes for a subject whose `output` is any non-empty string, including `zzz-unrelated`, and rejects one whose `output` is empty, one returning `success: false` with non-empty output, and one returning `exitCode: 1` with non-empty output, proving it asserts success, exit code 0 and non-empty output but no output-text content.
- [test] Running `declares the adapter capabilities` against a Claude fake mutated to `supportsSessionResume: true` rejects, while the same expectation against the unmutated Codex and Pi fakes resolves, so only that adapter's case fails.
- [test] Run against a recording subject whose `invoke` calls the real `writeScratchSchema({ worktreeRoot: options.nativeSchemaScratchRoot, homeDir: options.nativeSchemaScratchHome, schema: options.nativeSchema })`, the `returns a native-schema terminal result` expectation resolves, so the supplied home exists beneath `«nativeSchemaScratchRoot»/.daemon/scratch/` at invocation, and the scratch root no longer exists after the case.

**Files likely touched:**
- `src/conductor/test/contracts/llm.contract.ts` — the four expectations.
- `src/conductor/test/contracts/llm.contract.test.ts` — the fake leg and the expectation-rejection cases.

**Dependencies:** Task 1, Task 4, Task 5, Task 6

### Task 8: llm real legs with token metering
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/contracts/llm-real-leg.test.ts` (default tier) for every Done-when check below. Inject the provider factory, so no real provider runs.
2. Implement `defineLlmRealLeg(adapter, { createProvider?, environment?, emit? })` in `src/conductor/test/contracts/llm-real-leg.ts`.
   - By default it builds the provider from `LIVE_E2E_PROVIDERS` for `adapter`.
   - It wraps `invoke` to sum `tokenUsage.input + tokenUsage.output`.
   - It runs `runBoundaryContract(llmContract, { adapter, leg: 'real', create })`.
   - In `afterAll` it emits `llm contract [«adapter» real] tokens: «total» (cap «cap»)` and calls `assertTokenCap(total, unmetered, resolveLiveE2ETokenCap(environment))`.
3. Add `llm-claude.contract.smoke.test.ts`, `llm-codex.contract.smoke.test.ts` and `llm-pi.contract.smoke.test.ts`. Each holds `const smokeCapability = 'credentialed:«adapter»';`, imports `./llm.contract.js` for the obligation check, and calls `defineLlmRealLeg('«adapter»')`.
4. Verify GREEN and commit.

**Done when:**
- [test] `llm-real-leg.test.ts` runs `defineLlmRealLeg('claude', { createProvider })` with a conforming injected provider and asserts four passing cases titled `llm contract [claude real] › «expectation»`, the same four expectation names as the fake leg, and the same for `codex` and `pi`.
- [test] With an injected provider that resolves `{ success: true, output: 'x', exitCode: 0 }` instead of rejecting for a denied permit, the case `llm contract [claude real] › refuses a denied spawn permit before spawning` fails and its title names the boundary, adapter, leg and expectation; the other three cases pass.
- [test] With an injected provider reporting `tokenUsage` totalling 900 and `DAEMON_E2E_LIVE_TOKEN_CAP=500`, the leg emits `llm contract [claude real] tokens: 900 (cap 500)` and fails with `Token cap 500 exceeded: observed 900`; with total 400 it emits the spend line and passes.
- [test] Across one full real-leg run against a counting injected provider, the denied-permit expectation contributes zero to the token total and never notifies `onSpawn`, so no subprocess start is observed for it.
- [test] Each of the three `llm-«adapter».contract.smoke.test.ts` sources contains `const smokeCapability = 'credentialed:«adapter»';` matching its adapter and imports `./llm.contract.js`, as asserted by reading the files, and `defineLlmRealLeg`'s default factory, called without invoking, returns a `ClaudeProvider`, `CodexProvider` or `PiProvider` instance for `claude`, `codex` or `pi` respectively; each smoke file calls exactly `defineLlmRealLeg('«adapter»')` with no options argument, so its four expectations run against that default real provider.

**Files likely touched:**
- `src/conductor/test/contracts/llm-real-leg.ts` — the shared real-leg body.
- `src/conductor/test/contracts/llm-real-leg.test.ts` — injected-provider tests.
- `src/conductor/test/contracts/llm-claude.contract.smoke.test.ts` — Claude real leg.
- `src/conductor/test/contracts/llm-codex.contract.smoke.test.ts` — Codex real leg.
- `src/conductor/test/contracts/llm-pi.contract.smoke.test.ts` — Pi real leg.

**Dependencies:** Task 7

### Task 9: Real legs through the smoke runner and default-suite exclusion
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. In `src/conductor/test/structural/smoke-entry-point.test.ts`, add the three real-leg paths to the known-file discovery list, and add failing cases for every Done-when check below. Those cases call `runSmokeCli` with injected `discover` (the real sources of the three new files), `runVitest`, `hasCommand`, `environment` and `emit`.
2. No production change is expected. If a case fails because of runner behavior, stop and report it; do not widen the runner.
3. Verify GREEN and commit.

**Done when:**
- [test] The smoke-config discovery case lists `test/contracts/llm-claude.contract.smoke.test.ts`, `test/contracts/llm-codex.contract.smoke.test.ts` and `test/contracts/llm-pi.contract.smoke.test.ts`, while default `createVitest('test')` discovery over `vitest.config.ts` (the config that `npm test` and the CI aggregate suite's `npm test -- --shard` job run) includes `test/contracts/llm.contract.test.ts` and none of the three smoke files.
- [test] In advisory mode with `CLAUDE_CODE_OAUTH_TOKEN` and the `claude` command present, `runSmokeCli` invokes `runVitest` for the Claude real leg and the emitted ledger records it `ran` under `credentialed:claude`; the same holds for Codex and Pi with their own credential variables, capabilities and binaries.
- [test] In advisory mode with `CODEX_API_KEY` absent, the ledger records the Codex real leg `skipped` naming `CODEX_API_KEY`; in a second advisory run with every credential present but `hasCommand('pi')` false, the ledger records the Pi real leg `skipped` naming `pi`; in both runs `runVitest` is still invoked for the other two legs whose capabilities are met.
- [test] In gate mode with only the Claude real leg selected and `CLAUDE_CODE_OAUTH_TOKEN` absent, the ledger records it `skipped` naming `CLAUDE_CODE_OAUTH_TOKEN` and `runSmokeCli` rejects with `Gate-mode smoke run executed no credentialed test files`; with the credential present and `hasCommand('claude')` false, the ledger records it `failed` naming `claude`.
- [test] When the injected `runVitest` reports a failed case titled `llm contract [codex real] › returns a native-schema terminal result`, `runSmokeCli` fails and the emitted output contains that full title.

**Files likely touched:**
- `src/conductor/test/structural/smoke-entry-point.test.ts` — the known-file list and the new runner cases.

**Dependencies:** Task 8

### Task 10: Obligation check over the real registry
**Story:** Story 2
**Type:** integration

**Steps:**
1. In `boundary-contract-obligation.test.ts`, add a case that loads `BOUNDARY_REGISTRY` and reads every path its contracts name from disk, relative to `src/conductor/`. For `adapter`, read relative to `src/conductor/src/`. Run `checkBoundaryContractObligations` over the result.
2. Verify GREEN and commit.

**Done when:**
- [test] The real-registry case asserts `checkBoundaryContractObligations(BOUNDARY_REGISTRY, filesFromDisk)` returns an empty list in the default tier, with the `llm` contract's three legs all resolved from disk.
- [test] The same case asserts that a copy of the real registry with `git` set to ported and `contract: null` returns exactly one `ported-without-contract` violation naming `git`, proving a migration that flips a boundary to ported fails until its contract lands.

**Files likely touched:**
- `src/conductor/test/structural/boundary-contract-obligation.test.ts` — the real-registry case.

**Dependencies:** Task 2, Task 3, Task 8

### Task 11: Live-provider timeout for real-leg cases
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/contracts/boundary-contract.test.ts` and `src/conductor/test/contracts/llm-real-leg.test.ts` for every Done-when check below.
2. Add an optional `timeoutMs` to `runBoundaryContract`'s options, passed as the third argument of each `it`. In `defineLlmRealLeg`, pass `LLM_REAL_LEG_TIMEOUT_MS = 1_200_000`. That matches the 20-minute allowance the existing live-provider smoke body gives model-running cases, while `vitest.smoke.config.ts` defaults to 20 seconds.
3. Verify GREEN and commit.

**Done when:**
- [test] `runBoundaryContract` called with `timeoutMs: 1_200_000` registers every expectation case with a 1,200,000 ms timeout, and called without `timeoutMs` registers cases with the config default, as asserted from the registered Vitest task options.
- [test] `defineLlmRealLeg('claude', { createProvider })` registers all four `llm contract [claude real] ›` cases with a 1,200,000 ms timeout, while the `llm contract [«adapter» fake]` cases in `llm.contract.test.ts` keep the default timeout.

**Files likely touched:**
- `src/conductor/test/contracts/boundary-contract.ts` — the `timeoutMs` option.
- `src/conductor/test/contracts/boundary-contract.test.ts` — timeout registration tests.
- `src/conductor/test/contracts/llm-real-leg.ts` — passes the live-provider timeout.
- `src/conductor/test/contracts/llm-real-leg.test.ts` — real-leg timeout test.

**Dependencies:** Task 1, Task 8

## Integration Points

- After Task 7, the default suite runs the llm contract against all three fakes.
- After Task 9, the opt-in `npm run smoke` path is proven for the three real legs.
- After Task 10, the registry obligation is in force for every future `ported` flip.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D1 | no-change | none | The eight boundary names are unchanged; Task 2 keeps the existing eight-name completeness assertion. |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D2 | no-change | none | No port, adapter, factory or composition root changes; all edits are under `src/conductor/test/`. |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D3 | task | task-2 | deep-equals `BOUNDARY_REGISTRY.llm.contract` to the module `test/contracts/llm.contract.ts` with exactly three legs |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D4 | no-change | none | The boundary ratchet scans `src/conductor/src/**/*.ts` only; every new file is under `src/conductor/test/`. |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D5 | no-change | none | The seeded allowlist is untouched; no source file gains or loses a boundary touch. |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D6 | no-change | none | Migrations stay separate features; D7 adds the contract they must ship, enforced by Task 10. |
| adr-2026-11-07-external-boundary-ports-registry-and-ratchet#D7 | task | task-3, task-7, task-8, task-10 | returns exactly one `ported-without-contract` violation naming `git` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-as-built-remediate-as-built-d7-missing-paths: In src/conductor/test/structural/boundary-contract-obligation.test.ts filesNamedByContracts, omit paths that do not exist on disk instead of reading them unconditionally, and add a case proving a registry naming a missing contract/fake/leg file yields the checker's typed missing-file violation (boundary + rule) instead of an ENOENT throw
**Gate:** as-built
**Rationale:** Verified: filesNamedByContracts in src/conductor/test/structural/boundary-contract-obligation.test.ts calls readFileSync unconditionally for every contract/adapter/fake/fakeLeg/realLeg path, so a missing file throws ENOENT before checkBoundaryContractObligations runs, losing the boundary+rule diagnostic ADR D7 requires and stopping collection of later violations. ADR D7 remains authoritative; this is conforming test-implementation drift admitted by plan Task 10 (obligation check over the real registry, same file). Repair: skip absent paths (existsSync guard) so they are omitted from the files map and the checker emits its missing-file violations; add a case asserting a registry naming a nonexistent path yields the typed missing-file violation rather than throwing. Existing real-registry and ported-git assertions (Task 10, Task 3 coverage) are preserved unchanged.
**Governing clause:** adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 7
**Done when:**
- adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 7 is satisfied by this task.
- The repair for task rem-as-built-remediate-as-built-d7-missing-paths is committed and its targeted tests pass.
