# Implementation Plan: Per-Step LLM Provider Selection and Fallback

**Date:** 2026-07-24
**Design:** `.docs/specs/2026-07-24-per-step-provider-routing-927.md`
**Architecture:** `.docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md`
**Stories:** `.docs/stories/per-step-provider-routing-927.md`
**Conflict check:** Passed after resolution on 2026-07-24
**Complexity:** Large

## Summary

Build mixed Claude/Codex execution in 40 small TDD tasks. The implementation
normalizes provider configuration once, resolves provider order independently
per step, invokes through provider-local runtimes, and keeps sessions isolated
by step and provider. Every existing direct execution path is migrated to the
same routing seam before observability, compatibility, documentation, and
end-to-end verification close the feature.

## Technical Approach

Introduce four focused abstractions rather than expanding the existing
`DefaultStepRunner` into a multipurpose router:

1. `provider-selection.ts` owns the pure configuration domain:
   `string | string[]` normalization, two-stage validation, preferred-provider
   inheritance, and stable selected-first candidate ordering. Shape validation
   remains in `validateConfig`; registry-dependent name validation runs only
   after external discovery and built-in registration freeze the registry.
2. `provider-runtime.ts` constructs a per-conductor-run runtime for each
   registered provider. A runtime binds provider key, instance, native model
   policy, provider-local `ModelAvailability`, built-in capability metadata,
   and only deterministic run-wide unavailability. Runtime state is never
   shared between daemon feature runs.
3. `provider-session.ts` owns session identity separately from provider
   availability. It creates one native session per step execution and provider,
   resumes only retries in that same scope, resets only the expired provider
   session, and isolates concurrent branch scopes.
4. `provider-execution.ts` owns the candidate invocation loop. It resolves
   provider-native settings, performs the existing within-provider model walk,
   crosses providers only for explicit provider/model unavailability, emits
   transition diagnostics, and returns preferred/actual-provider attempt
   metadata.

Refactor `resolved-config.ts` so provider-neutral settings and provider-native
model/effort settings can be resolved independently. Primary attempts retain
the existing explicit precedence and opaque step-local model behavior. Fallback
attempts reuse provider-neutral step behavior but resolve the fallback
provider's policy defaults and ladder without carrying the primary provider's
model, effort, CLI override, escalation rung, or availability cache.

`DefaultStepRunner` becomes the principal consumer of `ProviderExecution`, but
the abstraction is also injected into prelude, attribution, judgment, recovery,
and daemon narrative paths. Interactive built-ins return classified completion
data while continuing to stream. Custom providers remain compatible with the
legacy interface; full mixed-provider fallback is asserted only for built-ins.

## Preconditions

- Approved PRD FR-1 through FR-20 exists.
- All eight accepted stories contain happy and negative paths.
- Conflict check reports zero blocking and zero degrading conflicts.
- The fresh-per-step contract from #325 is authoritative: new session per step,
  same-step same-provider retry resume only.
- Built-in Claude and Codex providers are already registered before
  `PluginRegistry.markInitialized()`.

## Tasks

### Task 1: Add provider-selection configuration types

**Story:** ST-927-1 HP-1/HP-2; ST-927-2 HP-1
**Type:** infrastructure

**Steps:**
1. Write failing type/runtime fixtures for scalar and ordered `llm_provider`
   plus step-level `llm_provider`.
2. Verify the fixtures fail because the current types accept only a scalar at
   run level and no provider on a step.
3. Add `ProviderSelection = string | string[]` and the optional step key.
4. Update config-facing comments to describe first-entry inheritance.
5. Run the focused type/config tests and commit with message
   `"feat(config): type ordered and per-step providers"`.

**Files:** `src/conductor/src/types/config.ts`, `src/conductor/test/config-validation.test.ts`
**Wired-into:** `src/conductor/src/engine/config.ts#validateConfig`
**Dependencies:** none

### Task 2: Normalize scalar and ordered provider selections

**Story:** ST-927-1 HP-1/HP-2; ST-927-2 HP-1
**Type:** happy-path

**Steps:**
1. Write failing table tests for absent, scalar, and array selections.
2. Verify RED, including absent-config compatibility resolving to `['claude']`.
3. Implement pure `normalizeProviderSelection`.
4. Assert declared array order is preserved byte-for-byte.
5. Run focused tests and commit with message
   `"feat(provider): normalize configured provider order"`.

**Files:** `src/conductor/src/engine/provider-selection.ts`, `src/conductor/test/engine/provider-selection.test.ts`
**Wired-into:** `src/conductor/src/index.ts#main, src/conductor/src/daemon-cli.ts#runDaemon`
**Dependencies:** Task 1

### Task 3: Reject malformed provider selection shapes

**Story:** ST-927-1 NP-1/NP-2
**Type:** negative-path

**Steps:**
1. Write failing validation tests for empty arrays, blank names, duplicates,
   non-string entries, and malformed step values.
2. Verify every case currently passes or produces an unrelated diagnostic.
3. Extend `validateConfig` with path-specific provider-shape validation.
4. Keep valid scalar configs warning-free and migration-free.
5. Run validation tests and commit with message
   `"fix(config): fail closed on malformed provider selections"`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/config-validation.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 4: Validate provider names after registry initialization

**Story:** ST-927-1 HP-3/NP-3; ST-927-2 HP-4
**Type:** negative-path

**Steps:**
1. Write failing tests with a frozen registry for valid run/step names and
   unknown names at each scope.
2. Verify unknown providers are currently discovered only by late `get()`.
3. Implement `validateRegisteredProviderSelections`.
4. Include the bad name, run or step path, and available registered names in
   the error.
5. Run focused tests and commit with message
   `"feat(provider): validate configured names against registry"`.

**Files:** `src/conductor/src/engine/provider-selection.ts`, `src/conductor/test/engine/provider-selection.test.ts`, `src/conductor/src/engine/plugin-registry.ts`
**Wired-into:** `src/conductor/src/index.ts#main, src/conductor/src/daemon-cli.ts#runDaemon`
**Dependencies:** Tasks 2, 3

### Task 5: Preserve provider selections through layered config merge

**Story:** ST-927-1 HP-1/HP-2; ST-927-2 NP-2
**Type:** happy-path

**Steps:**
1. Write failing merge tests for scalar replacement, array replacement, and
   step-local provider preservation.
2. Verify the current generic merge does not accidentally object-merge arrays.
3. Add explicit provider-selection merge handling only where needed.
4. Assert unrelated model/effort/retry precedence remains unchanged.
5. Run config merge tests and commit with message
   `"test(config): preserve provider selections through merge"`.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`
**Wired-into:** `src/conductor/src/engine/config.ts#loadMergedConfig`
**Dependencies:** Tasks 1, 3

### Task 6: Resolve selected-first provider candidate order

**Story:** ST-927-2 HP-1/HP-2/HP-4; ST-927-4 HP-1/HP-2
**Type:** happy-path

**Steps:**
1. Write failing candidate-order tables for inherited first, explicit first,
   explicit later, and explicit registered provider outside the run list.
2. Verify RED.
3. Implement `resolveProviderCandidates`.
4. Preserve declared order for all remaining candidates.
5. Run focused tests and commit with message
   `"feat(provider): resolve deterministic step candidate order"`.

**Files:** `src/conductor/src/engine/provider-selection.ts`, `src/conductor/test/engine/provider-selection.test.ts`
**Wired-into:** `src/conductor/src/engine/provider-execution.ts#executeProviderCandidates`
**Dependencies:** Tasks 2, 4

### Task 7: Guard candidate de-duplication and explicit specialization

**Story:** ST-927-2 NP-1/NP-2/NP-3/NP-4; ST-927-4 NP-1/NP-2
**Type:** negative-path

**Steps:**
1. Add failing tests for duplicate preferred keys, role-based auto-selection,
   cross-step mutation, and arbitrary registered-provider consumption.
2. Verify the tests expose no existing candidate-order contract.
3. Harden the pure resolver with stable de-duplication and no role inference.
4. Assert fallback after an outside-list preferred provider uses only the
   declared run-level set.
5. Run focused tests and commit with message
   `"fix(provider): constrain fallback candidates to explicit order"`.

**Files:** `src/conductor/src/engine/provider-selection.ts`, `src/conductor/test/engine/provider-selection.test.ts`
**Wired-into:** same as Task 6
**Dependencies:** Task 6

### Task 8: Split provider-neutral and provider-native step resolution

**Story:** ST-927-3 HP-1; ST-927-8 HP-3
**Type:** refactor

**Steps:**
1. Write characterization tests for retry, review, skill, hooks, disable, model,
   effort, and escalation resolution.
2. Verify the tests pass against the monolithic resolver.
3. Extract `resolveProviderNeutralStepConfig` and
   `resolveProviderNativeStepConfig` while retaining `resolveStepConfig` as a
   compatibility composition.
4. Keep every existing precedence test green.
5. Run resolver suites and commit with message
   `"refactor(config): separate native and neutral step settings"`.

**Files:** `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/resolved-config.test.ts`, `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`
**Wired-into:** `src/conductor/src/engine/provider-execution.ts#resolveProviderAttempt`
**Dependencies:** Task 1

### Task 9: Apply preferred-provider native settings

**Story:** ST-927-3 HP-1/HP-2; ST-927-3 NP-1/NP-2
**Type:** happy-path

**Steps:**
1. Write failing provider-key × step × tier tests for Claude and Codex.
2. Add explicit opaque step-local model and CLI override cases.
3. Implement preferred-attempt native resolution using the selected policy.
4. Prevent inherited first-provider defaults from entering a specialized
   provider while preserving explicit opaque strings.
5. Run resolver tests and commit with message
   `"feat(config): resolve preferred provider native settings"`.

**Files:** `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
**Wired-into:** same as Task 8
**Dependencies:** Task 8

### Task 10: Resolve fallback providers from native defaults

**Story:** ST-927-3 HP-3/NP-3; ST-927-4 NP-4
**Type:** negative-path

**Steps:**
1. Write failing tests where a Codex primary carries explicit model, effort,
   CLI override, escalation rung, and configured ladder before Claude fallback.
2. Verify the fallback currently has no independent resolution path.
3. Implement fallback-mode native resolution from the fallback policy defaults.
4. Reuse provider-neutral settings and current retry attempt only.
5. Run tests and commit with message
   `"feat(config): discard native settings on provider fallback"`.

**Files:** `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
**Wired-into:** same as Task 8
**Dependencies:** Tasks 8, 9

### Task 11: Construct per-run provider runtime sets

**Story:** ST-927-1 HP-3; ST-927-3 HP-1; ST-927-8 HP-3
**Type:** infrastructure

**Steps:**
1. Write failing tests that freeze a registry containing Claude, Codex, and a
   custom provider.
2. Verify no runtime aggregation exists.
3. Implement `ProviderRuntimeSet` with key, instance, policy, built-in
   capability, and per-runtime availability.
4. Ensure each conductor run receives new runtime state even when daemon
   provider instances are reused.
5. Run tests and commit with message
   `"feat(provider): construct isolated per-run runtimes"`.

**Files:** `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/test/engine/provider-runtime.test.ts`, `src/conductor/src/engine/provider-model-policy.ts`
**Wired-into:** `src/conductor/src/index.ts#main, src/conductor/src/daemon-cli.ts#runConductorInWorktree`
**Dependencies:** Tasks 4, 8

### Task 12: Isolate model availability by provider

**Story:** ST-927-5 HP-2; ST-927-5 NP-1/NP-2
**Type:** negative-path

**Steps:**
1. Write failing tests using identical opaque model strings in two runtimes.
2. Mark one provider's model unavailable and verify the other must remain live.
3. Bind one `ModelAvailability` instance and native ladder per runtime.
4. Assert partial ladder success never advances providers.
5. Run tests and commit with message
   `"fix(provider): isolate model availability caches"`.

**Files:** `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/src/engine/model-availability.ts`, `src/conductor/test/engine/provider-runtime.test.ts`
**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeRuntime`
**Dependencies:** Task 11

### Task 13: Cache only deterministic run-wide provider failures

**Story:** ST-927-5 HP-3; ST-927-5 NP-3
**Type:** negative-path

**Steps:**
1. Write failing tests for missing executable, model exhaustion, timeout, and
   ordinary failure cache behavior.
2. Verify no provider-level cache exists.
3. Add explicit run-wide-unavailable state to `ProviderRuntime`.
4. Cache only deterministic provider-unavailable classifications and emit the
   cached reason when skipped.
5. Run tests and commit with message
   `"feat(provider): cache deterministic runtime unavailability"`.

**Files:** `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/test/engine/provider-runtime.test.ts`
**Wired-into:** `src/conductor/src/engine/provider-execution.ts#executeProviderCandidates`
**Dependencies:** Tasks 11, 12

### Task 14: Create step-and-provider session scopes

**Story:** ST-927-7 HP-1/HP-2; ST-927-7 NP-1/NP-3
**Type:** infrastructure

**Steps:**
1. Write failing tests for two providers in one step and the same provider in
   consecutive steps.
2. Verify existing runner state cannot represent both cases safely.
3. Implement `ProviderSessionStore.beginStep`, provider-local create/mark, and
   step-boundary invalidation.
4. Preserve the scalar legacy marker only as compatibility metadata, never as
   authority for a different step/provider.
5. Run tests and commit with message
   `"feat(session): scope sessions by step and provider"`.

**Files:** `src/conductor/src/engine/provider-session.ts`, `src/conductor/test/engine/provider-session.test.ts`, `src/conductor/src/execution/session.ts`
**Wired-into:** `src/conductor/src/engine/step-runners.ts#resetSession, src/conductor/src/engine/step-runners.ts#run`
**Dependencies:** Task 11

### Task 15: Resume only matching retries and reset stale sessions

**Story:** ST-927-6 HP-2; ST-927-7 HP-3; ST-927-7 NP-4
**Type:** negative-path

**Steps:**
1. Write failing tests for same-step retry resume, provider-switch create,
   stale-session replacement, and next-step create.
2. Add concurrent branch scopes completing in both orders.
3. Implement same-scope resume and provider-local stale reset.
4. Prove stale recovery remains retry-budget-neutral.
5. Run tests and commit with message
   `"fix(session): constrain resume to matching step provider"`.

**Files:** `src/conductor/src/engine/provider-session.ts`, `src/conductor/test/engine/provider-session.test.ts`
**Wired-into:** same as Task 14
**Dependencies:** Task 14

### Task 16: Add explicit provider-unavailable result metadata

**Story:** ST-927-4 HP-3/HP-4; ST-927-5 HP-3; ST-927-6 NP-3
**Type:** infrastructure

**Steps:**
1. Write failing contract tests distinguishing provider unavailability from
   model, auth, rate-limit, session, and ordinary failures.
2. Verify the result type has no provider-wide classification.
3. Add backward-compatible optional provider-unavailable metadata and reason.
4. Define deterministic run scope explicitly in the result.
5. Run type/provider tests and commit with message
   `"feat(provider): classify provider-wide unavailability"`.

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/test/execution/llm-provider-contract.test.ts`
**Wired-into:** `src/conductor/src/engine/provider-execution.ts#classifyProviderAttempt`
**Dependencies:** none

### Task 17: Classify missing Claude executable

**Story:** ST-927-4 HP-1; ST-927-5 HP-3; ST-927-6 NP-1/NP-3
**Type:** negative-path

**Steps:**
1. Write failing Claude provider tests for ENOENT/127 and misleading prose.
2. Verify the existing clear error lacks structured provider metadata.
3. Set deterministic provider-unavailable only on the anchored missing-binary
   branch.
4. Preserve auth/model/rate/session precedence and output text.
5. Run Claude tests and commit with message
   `"feat(claude): classify missing executable for fallback"`.

**Files:** `src/conductor/src/execution/claude-provider.ts`, `src/conductor/test/execution/claude-provider.test.ts`
**Wired-into:** same as Task 16
**Dependencies:** Task 16

### Task 18: Classify missing Codex executable

**Story:** ST-927-4 HP-1; ST-927-5 HP-3; ST-927-6 NP-1/NP-3
**Type:** negative-path

**Steps:**
1. Write failing Codex tests for ENOENT/127 and false-positive prose.
2. Verify the current result lacks structured provider metadata.
3. Set deterministic provider-unavailable on the missing-binary branch.
4. Preserve all existing Codex result classifications.
5. Run Codex tests and commit with message
   `"feat(codex): classify missing executable for fallback"`.

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** same as Task 16
**Dependencies:** Task 16

### Task 19: Return classified completion from built-in interactive calls

**Story:** ST-927-8 HP-1; ST-927-8 NP-1
**Type:** infrastructure

**Steps:**
1. Write failing interface and provider tests for streamed success,
   model-unavailable, missing executable, auth, and rate limit.
2. Verify interactive calls currently return only `void`.
3. Broaden the compatible return contract and make both built-ins return
   classified completion while preserving streaming.
4. Keep legacy custom providers returning `void` valid and non-fallback-capable.
5. Run interface/provider tests and commit with message
   `"feat(provider): classify interactive completion"`.

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/execution/claude-provider.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/claude-provider.test.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeRuntime`
**Dependencies:** Tasks 16, 17, 18

### Task 20: Execute a successful preferred provider

**Story:** ST-927-2 HP-2/HP-3; ST-927-3 HP-1/HP-2; ST-927-8 HP-1
**Type:** happy-path

**Steps:**
1. Write a failing executor test with provider spies and explicit step
   specialization.
2. Verify no candidate executor exists.
3. Implement `executeProviderCandidates` primary-success path.
4. Return preferred and actual provider plus resolved native model/effort.
5. Run tests and commit with message
   `"feat(provider): execute preferred step provider"`.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/test/engine/provider-execution.test.ts`
**Wired-into:** `src/conductor/src/engine/step-runners.ts#run`
**Dependencies:** Tasks 6, 9, 11, 14, 16

### Task 21: Fall back after provider unavailability

**Story:** ST-927-4 HP-1/HP-2/HP-3; ST-927-5 HP-3
**Type:** happy-path

**Steps:**
1. Write failing selected-first multi-provider transition tests.
2. Include cached missing-executable skip and earlier-list fallback.
3. Implement candidate advancement only for provider-unavailable results.
4. Emit a structured warning with step, failed provider, reason, and next
   provider.
5. Run tests and commit with message
   `"feat(provider): fall back through configured runtimes"`.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/test/engine/provider-execution.test.ts`
**Wired-into:** same as Task 20
**Dependencies:** Tasks 7, 10, 13, 17, 18, 20

### Task 22: Fall back after complete native model exhaustion

**Story:** ST-927-5 HP-1/HP-2; ST-927-5 NP-1/NP-2
**Type:** happy-path

**Steps:**
1. Write failing tests for partial ladder success and complete ladder
   exhaustion.
2. Assert partial success stays on the provider and full exhaustion advances
   without consuming a retry.
3. Integrate final `modelUnavailable` into the provider candidate classifier.
4. Keep provider eligibility for later steps.
5. Run tests and commit with message
   `"feat(provider): route exhausted model ladders across providers"`.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/model-availability.ts`, `src/conductor/test/engine/provider-execution.test.ts`
**Wired-into:** same as Task 20
**Dependencies:** Tasks 12, 20, 21

### Task 23: Preserve auth and ordinary failure routing

**Story:** ST-927-6 HP-1/HP-2; ST-927-6 NP-1/NP-2/NP-3
**Type:** negative-path

**Steps:**
1. Write failing classification-precedence tables for auth, rate limit,
   session expiry, timeout, rejection, ordinary exit, and ambiguous prose.
2. Verify candidate advancement would be unsafe without an explicit guard.
3. Return those results immediately to existing recovery machinery.
4. Assert no provider warning, candidate advance, or availability-cache
   mutation occurs.
5. Run tests and commit with message
   `"fix(provider): restrict fallback to availability failures"`.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/test/engine/provider-execution.test.ts`
**Wired-into:** same as Task 20
**Dependencies:** Tasks 20, 21, 22

### Task 24: Report complete provider exhaustion

**Story:** ST-927-4 HP-4; ST-927-4 NP-3/NP-4
**Type:** negative-path

**Steps:**
1. Write a failing all-candidates-unavailable test.
2. Assert the diagnostic names each provider exactly once with its reason.
3. Implement terminal exhaustion metadata and human-readable output.
4. Ensure no unknown provider, stale settings, or false success is returned.
5. Run tests and commit with message
   `"feat(provider): diagnose complete candidate exhaustion"`.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/test/engine/provider-execution.test.ts`
**Wired-into:** same as Task 20
**Dependencies:** Tasks 21, 22

### Task 25: Carry provider attempt and usage metadata

**Story:** ST-927-7 HP-4; ST-927-7 NP-2
**Type:** infrastructure

**Steps:**
1. Write failing tests for a failed Codex attempt followed by Claude success
   with distinct token usage.
2. Verify current results expose only one unlabelled usage object.
3. Add preferred provider, actual provider, and per-attempt metadata to
   `StepRunResult`.
4. Attribute model, usage, outcome, and fallback reason to the provider that
   produced each attempt.
5. Run tests and commit with message
   `"feat(provider): attribute results and usage by attempt"`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/test/engine/provider-execution.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Tasks 20, 21

### Task 26: Refactor DefaultStepRunner onto provider execution

**Story:** ST-927-2 HP-3; ST-927-8 HP-1/NP-3
**Type:** refactor

**Steps:**
1. Add failing runner tests for mixed preferred providers across consecutive
   steps.
2. Replace the runner's captured provider/policy/cache with injected runtime
   set, selection, session store, and executor.
3. Route autonomous and interactive normal steps through the executor.
4. Retain the legacy constructor adapter temporarily for scalar test fixtures.
5. Run runner tests and commit with message
   `"refactor(runner): dispatch normal steps through provider executor"`.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Tasks 15, 19, 23, 24, 25

### Task 27: Resolve retry escalation from the preferred provider

**Story:** ST-927-3 NP-3; ST-927-5 HP-1; ST-927-7 HP-3
**Type:** happy-path

**Steps:**
1. Write failing retry tests where Claude and Codex are preferred on different
   steps and fallback occurs after an escalated primary.
2. Verify `Conductor` still owns one captured model policy.
3. Replace run-global policy use with preferred-provider resolution per step.
4. Keep attempt indexing and same-step/provider session resume unchanged.
5. Run retry suites and commit with message
   `"feat(conductor): escalate with preferred provider policy"`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/escalation.ts`, `src/conductor/test/acceptance/retry-as-escalation.acceptance.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Tasks 9, 26

### Task 28: Reset all provider sessions at each serial step boundary

**Story:** ST-927-7 HP-1/HP-3; ST-927-7 NP-1
**Type:** negative-path

**Steps:**
1. Write a failing two-step serial integration test with retries in step one.
2. Assert retry resume, next-step create, and provider-switch create.
3. Replace generic `resetSession` boundary behavior with `beginStep` over the
   provider session store.
4. Preserve stale-session non-budget-consuming reset.
5. Run conductor/session tests and commit with message
   `"fix(conductor): reset provider sessions at step boundaries"`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/conductor.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Tasks 15, 26

### Task 29: Route complexity and recovery runner methods

**Story:** ST-927-8 HP-2/NP-2
**Type:** happy-path

**Steps:**
1. Add failing provider-spy tests for complexity, rebase resolution,
   remediation/setup-fix, and CI-fix dispatches.
2. Verify each method directly uses the captured provider.
3. Route each named step through the shared executor with fresh one-shot scope.
4. Assert actual-provider metadata and native settings for each path.
5. Run focused runner tests and commit with message
   `"feat(runner): route complexity and recovery providers"`.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#runComplexityStep, src/conductor/src/engine/conductor.ts#runRebaseStep, src/conductor/src/engine/step-runners.ts#resolveSetupFailure, src/conductor/src/engine/step-runners.ts#resolveCiFailure`
**Dependencies:** Task 26

### Task 30: Route build review and attribution verifier judgment

**Story:** ST-927-2 HP-3; ST-927-8 HP-2/NP-2
**Type:** happy-path

**Steps:**
1. Write failing tests assigning Codex to `build_review` and
   `attribution_verify` while build inherits Claude.
2. Verify both paths capture the run-global provider/policy.
3. Route their fresh one-shot dispatches through provider execution.
4. Preserve isolated input assembly, verdict parsing, memoization, and
   fail-closed behavior.
5. Run judgment/attribution suites and commit with message
   `"feat(judgment): honor per-step provider routing"`.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/attribution-lane.ts`, `src/conductor/test/engine/attribution-conductor-wiring.test.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview, src/conductor/src/engine/step-runners.ts#dispatchVerifier`
**Dependencies:** Tasks 25, 26

### Task 31: Route project prelude steps

**Story:** ST-927-8 HP-2/NP-2
**Type:** happy-path

**Steps:**
1. Write failing tests assigning different providers to bootstrap and assess.
2. Verify `runProjectPrelude` currently receives one provider and session ID.
3. Inject provider execution and dispatch each prelude step by its own name.
4. Preserve marker and stale-assessment decisions.
5. Run prelude tests and commit with message
   `"feat(prelude): route bootstrap and assess per step"`.

**Files:** `src/conductor/src/engine/project-prelude.ts`, `src/conductor/test/engine/project-prelude.test.ts`, `src/conductor/src/index.ts`
**Wired-into:** `src/conductor/src/index.ts#main`
**Dependencies:** Task 26

### Task 32: Route concurrent validation branches

**Story:** ST-927-7 HP-5/NP-4; ST-927-8 HP-2
**Type:** happy-path

**Steps:**
1. Write failing concurrent branch tests with different explicit providers and
   reversed completion order.
2. Verify one branch session ID cannot safely serve multiple providers.
3. Give each branch a session scope and route its member step through the
   executor.
4. Preserve same-branch retries, rate-limit coordination, and result events.
5. Run group tests and commit with message
   `"feat(group): isolate provider routing per validation branch"`.

**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/test/engine/group-core.test.ts`, `src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#runValidationGroup`
**Dependencies:** Tasks 15, 26

### Task 33: Route daemon narrative and auxiliary fix runners

**Story:** ST-927-8 HP-2/NP-2
**Type:** happy-path

**Steps:**
1. Write failing daemon tests assigning providers to retro and auxiliary fix
   steps.
2. Verify narrative and temporary runner construction capture the daemon-global
   provider.
3. Pass per-feature runtime/execution context into narrative and fix paths.
4. Ensure each feature run has independent availability/session state.
5. Run daemon-focused tests and commit with message
   `"feat(daemon): route narrative and auxiliary providers"`.

**Files:** `src/conductor/src/engine/engineer-store.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/engineer-store.test.ts`, `src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts`
**Wired-into:** `src/conductor/src/engine/engineer-store.ts#produceNarrative, src/conductor/src/daemon-cli.ts#runDaemon`
**Dependencies:** Tasks 11, 26, 29

### Task 34: Construct provider routing in the interactive root

**Story:** ST-927-1 HP-3/NP-3; ST-927-8 HP-1/HP-3
**Type:** infrastructure

**Steps:**
1. Add a failing composition test proving all providers remain registered and
   scalar/array configs reach the runner.
2. Remove early `selectedProviderKey` provider/policy narrowing.
3. Validate names after registry freeze and construct a per-run runtime set,
   session store, and executor.
4. Inject the same context into prelude, runner, and conductor.
5. Run composition tests and commit with message
   `"feat(cli): compose provider-aware interactive runs"`.

**Files:** `src/conductor/src/index.ts`, `src/conductor/test/integration/plugin-defaults.test.ts`, `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`
**Wired-into:** `src/conductor/src/index.ts#main`
**Dependencies:** Tasks 4, 11, 26, 31

### Task 35: Construct isolated provider routing per daemon feature

**Story:** ST-927-1 HP-3/NP-3; ST-927-5 HP-2/HP-3; ST-927-8 HP-2/HP-3
**Type:** infrastructure

**Steps:**
1. Add failing daemon composition tests for two feature runs with independent
   runtime caches and provider sessions.
2. Remove daemon-global selected provider/policy narrowing.
3. Validate once after registry freeze but construct runtime/session/execution
   state per feature run.
4. Inject it through runner, conductor, narrative, and recovery paths.
5. Run daemon tests and commit with message
   `"feat(daemon): compose provider-aware feature runs"`.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`, `src/conductor/test/integration/daemon-ship.integration.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemon, src/conductor/src/daemon-cli.ts#runConductorInWorktree`
**Dependencies:** Tasks 4, 11, 26, 33

### Task 36: Emit provider-attributed warnings and events

**Story:** ST-927-4 HP-3; ST-927-7 HP-4/NP-2
**Type:** infrastructure

**Steps:**
1. Write failing event tests for provider attempt, provider fallback, and
   completed-step actual provider.
2. Add backward-compatible optional provider fields and new transition events.
3. Persist and render the warning with every required diagnostic field.
4. Ensure failed and successful attempts retain their own provider identity.
5. Run event/persister/renderer tests and commit with message
   `"feat(events): expose preferred and actual providers"`.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/event-persister.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/test/engine/event-persister.test.ts`, `src/conductor/test/ui/terminal-renderer.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run, src/conductor/src/engine/event-persister.ts#EventPersister`
**Dependencies:** Task 25

### Task 37: Attribute reporting and cost rollups by provider

**Story:** ST-927-7 HP-4/NP-2
**Type:** happy-path

**Steps:**
1. Write failing report fixtures with multiple provider attempts for one step.
2. Verify current aggregation loses provider identity.
3. Render preferred/actual provider and group usage by actual provider without
   double-counting step totals.
4. Preserve backward compatibility for older event logs with no provider field.
5. Run report/cost tests and commit with message
   `"feat(report): roll up usage by actual provider"`.

**Files:** `src/conductor/src/engine/report-renderer.ts`, `src/conductor/src/engine/cost-rollup.ts`, `src/conductor/test/engine/report-renderer.test.ts`, `src/conductor/test/engine/cost-rollup.test.ts`
**Wired-into:** `src/conductor/src/engine/report-renderer.ts#renderReport, src/conductor/src/engine/cost-rollup.ts#computeCostRollup`
**Dependencies:** Task 36

### Task 38: Prove scalar and custom-provider compatibility

**Story:** ST-927-1 HP-1/NP-2; ST-927-8 HP-3
**Type:** negative-path

**Steps:**
1. Write failing compatibility tests for scalar Claude, scalar Codex, and a
   registered legacy custom provider returning `void` interactively.
2. Assert scalar built-in invocation order, model/effort, retry, session, and
   diagnostics match pre-feature fixtures.
3. Keep custom providers on the warned Claude-compatible policy without
   asserting built-in cross-provider fallback.
4. Assert unknown providers still fail before dispatch.
5. Run compatibility suites and commit with message
   `"test(provider): preserve scalar and custom compatibility"`.

**Files:** `src/conductor/test/integration/plugin-defaults.test.ts`, `src/conductor/test/integration/plugin-end-to-end.test.ts`, `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 19, 34, 35

### Task 39: Document provider arrays, per-step selection, and fallback

**Story:** ST-927-1, ST-927-2, ST-927-3, ST-927-4, ST-927-5, ST-927-6, ST-927-7, ST-927-8
**Type:** infrastructure

**Steps:**
1. Add doc-check expectations for scalar/array syntax, first-provider default,
   explicit step selection, fallback order, warnings, native defaults, failure
   exclusions, and fresh step/provider sessions.
2. Verify RED against current docs.
3. Update user and conductor documentation plus configuration examples.
4. Add an Unreleased changelog entry and regenerate provider-labelled model
   documentation if the generator output changes.
5. Run doc/integrity checks and commit with message
   `"docs(provider): explain per-step routing and fallback"`.

**Files:** `README.md`, `HARNESS.md`, `src/conductor/README.md`, `CHANGELOG.md`, `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 34, 35, 36, 38

### Task 40: Run mixed-provider end-to-end and wiring gates

**Story:** ST-927-1, ST-927-2, ST-927-3, ST-927-4, ST-927-5, ST-927-6, ST-927-7, ST-927-8
**Type:** verify-only
**Verify-only:** yes

**Steps:**
1. Run the mixed-run acceptance matrix: inherited Claude build, explicit Codex
   judgment, selected-first fallback, native-default reset, auth/no-fallback,
   model exhaustion, later-step reconsideration, and full exhaustion.
2. Run static invoke-site coverage and fail if any production path retains a
   run-global provider/policy or omits actual-provider metadata.
3. Run all provider, config, runner, conductor, group, daemon, report, and
   compatibility suites.
4. Run TypeScript typecheck and full harness-integrity validation.
5. Record evidence with a verify-only task trailer; fix any failure through
   the owning earlier task before declaring green.

**Files:** `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`, `src/conductor/test/integration/per-step-provider-routing-wiring.integration.test.ts`, `test/test_harness_integrity.sh`
**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39

## Task Dependency Graph

```text
1 ──┬─> 2 ──> 4 ──┬─> 6 ──> 7
    ├─> 3 ─────────┘
    └─> 5

1 ──> 8 ──> 9 ──> 10
4 + 8 ──> 11 ──┬─> 12 ──> 13
               └─> 14 ──> 15

16 ──┬─> 17 ──┐
     └─> 18 ──┼─> 19
              ┘

6 + 9 + 11 + 14 + 16 ──> 20
7 + 10 + 13 + 17 + 18 + 20 ──> 21
12 + 20 + 21 ──> 22
20 + 21 + 22 ──> 23 ──> 26
21 + 22 ──> 24 ─────────> 26
20 + 21 ──> 25 ─────────> 26
15 + 19 ─────────────────> 26

9 + 26 ──> 27
15 + 26 ──> 28
26 ──┬─> 29 ──> 33
     ├─> 30
     ├─> 31
     └─> 32

4 + 11 + 26 + 31 ──> 34
4 + 11 + 26 + 33 ──> 35
25 ──> 36 ──> 37
19 + 34 + 35 ──> 38
34 + 35 + 36 + 38 ──> 39
27..39 ──> 40
```

The graph is acyclic. Tasks 17 and 18 may run in parallel; Tasks 29 through 32
may run in parallel after Task 26; Tasks 34, 35, and 36 may run in parallel
once their listed prerequisites are green.

## Integration Points

- After Task 7: configuration can deterministically resolve each step's
  provider candidates without invoking a provider.
- After Task 15: runtime, model availability, and session state are isolated
  independently by provider and step.
- After Task 24: the executor supports the full preferred/model/provider
  fallback state machine in isolation.
- After Task 28: normal serial conductor execution is mixed-provider capable
  with correct retry/session semantics.
- After Task 35: interactive and daemon composition roots plus every named
  auxiliary path share the provider-routing seam.
- After Task 37: operator-visible events, reports, and cost accounting identify
  the provider that actually executed each attempt.
- After Task 40: acceptance, reachability, type, and harness-integrity gates are
  all green.

## Advisory Overlap Scan

`conduct-ts overlap-scan` completed on 2026-07-24 over the union of all task
file paths with source `jstoup111/ai-conductor#927`. It reported broad overlap
with numerous active spec branches across the central conductor, runner,
configuration, provider contracts, provider tests, and documentation.

The result is advisory and does not block this plan. Merge-conflict likelihood
is high, so implementation should preserve the abstraction-first sequence:
land selection/runtime/session/execution seams in narrow commits, migrate
production paths in separate commits, and rebase at the sanctioned finish
boundary.

## Acceptance-Criteria Coverage

| Story | Happy paths | Negative paths | Tasks |
|---|---|---|---|
| ST-927-1 | HP-1..HP-3 | NP-1..NP-3 | 1–5, 34, 35, 38, 40 |
| ST-927-2 | HP-1..HP-4 | NP-1..NP-4 | 2, 6, 7, 20, 26, 30, 40 |
| ST-927-3 | HP-1..HP-3 | NP-1..NP-3 | 8–10, 20, 27, 40 |
| ST-927-4 | HP-1..HP-4 | NP-1..NP-4 | 6, 7, 16–18, 21, 24, 36, 40 |
| ST-927-5 | HP-1..HP-3 | NP-1..NP-3 | 12, 13, 17, 18, 21, 22, 27, 35, 40 |
| ST-927-6 | HP-1..HP-2 | NP-1..NP-3 | 15–19, 23, 40 |
| ST-927-7 | HP-1..HP-5 | NP-1..NP-4 | 14, 15, 25, 28, 32, 36, 37, 40 |
| ST-927-8 | HP-1..HP-3 | NP-1..NP-3 | 19, 26, 29–35, 38–40 |

## Verification

- [x] Preconditions validated.
- [x] Every happy and negative acceptance criterion maps to at least one task.
- [x] Negative paths have explicit failure-focused tasks.
- [x] Tasks are bounded to one small RED/GREEN/commit unit.
- [x] Every task declares dependencies; the graph is acyclic.
- [x] Every new production surface declares a concrete wiring target.
- [x] Provider-routing responsibilities are separated into four independently
      testable abstractions.
- [x] Advisory overlap scan completed against the union of planned files.
- [x] Architecture diagram updated in plan-update mode and all Mermaid blocks
      render successfully.
- [ ] Plan-level architecture review passed.
