# Implementation Plan: Codex steps resolve the newest catalog model per tier

**Date:** 2026-10-25
**Design:** [ADR](../decisions/adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog.md), [architecture](../architecture/codex-steps-resolve-the-newest-catalog-model-per-t.md)
**Stories:** .docs/stories/codex-steps-resolve-the-newest-catalog-model-per-t.md
**Conflict check:** Clean as of 2026-10-25 (2 blocking and 1 degrading conflicts resolved by operator decision)

## Summary

Codex's pinned model ids become per-tier floors that each provider-dispatching process upgrades
once, at boot, to the newest same-tier model `codex debug models` lists; astra becomes the top
Codex escalation rung; unpriced upgrades are warned; the Claude liveness probe uses `haiku`.
Eleven tasks, single-PR delivery.

## Technical Approach

- **Listing (Task 1).** `parseCodexModelListing` lives in `src/conductor/src/execution/codex-provider.ts`, beside
  how `parsePiModelListing` lives in `pi-provider.ts`, and returns the same
  `ProviderModelCatalogParseResult` shape: `parsed` ids keep only entries whose `visibility` is
  `list` and `supported_in_api` is true; anything else is `unparseable` with its first line. The
  descriptor base in `src/conductor/src/execution/provider-catalog.ts` gains an optional `modelTierCatalog`
  member with the same `{ argv, parse }` shape as `modelCatalog`. Codex declares it with argv
  `['debug', 'models']` and keeps `modelCatalog` undefined, so adr-2026-09-24 D13 configured-id
  validation and adr-2026-10-06 D5 monitor membership are not switched on.
- **Resolution (Task 2).** A new `src/conductor/src/engine/model-tier-resolution.ts` owns the floor grammar
  `gpt-«version»-«tier»` (version: dot-separated non-negative integers; tier: `luna`, `terra`,
  `sol`, `astra`), `resolveModelTierFloors(floors, listedIds)` (same tier, highest version compared
  numerically per segment with missing segments as 0, only when strictly greater than the floor),
  `materializeModelTierPolicy(policy, map)` (rewrites step models, tier-override models, escalation
  order and fallback ladder, then deep-freezes), and a per-process registry
  (`installResolvedModelTiers`, plus a test-only reset). `resolveProviderModelPolicy` in
  `src/conductor/src/engine/provider-model-policy.ts` starts from the installed materialized policy for a
  provider when present and then applies `llm_providers.<id>` overrides exactly as today, so every
  dispatch consumer — `DefaultStepRunner`, `resolveStepConfig`, `escalateAttempt`,
  `selectFallbackLadder`/`ModelAvailability`, conductor auxiliary paths — sees resolved ids without
  change. `BUILT_IN_PROVIDER_MODEL_POLICIES` and `providerDescriptor(...).modelPolicy` stay the
  static floors, so monitor defaults, `generate-model-table`, and `rateCardModelIds()` keep floors.
- **Policy (Task 3).** `CODEX_MODEL_POLICY.modelEscalationOrder` becomes
  `gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol → gpt-6-astra`; the fallback ladder is unchanged.
  Existing tests that assert the Sol cap move to the astra cap in the same task.
- **Probe (Tasks 5–6).** `resolveProviderModelTiers` in `src/conductor/src/engine/provider-model-probe.ts`
  reuses that module's `runWithTimeout`, `productionRunner` (`assertRealExecAllowed` guard) and
  5-second timeout. For each installed descriptor declaring `modelTierCatalog`, it runs the listing
  once per process (a module-level guard), resolves the descriptor policy's floor ids, installs the
  map, and then warns once per resolved id that differs from its floor and is absent from
  `loadRateCard(projectRoot)`. Failures warn once and install nothing; they never throw. Warnings
  go to `console.warn`, the same stderr → `daemon.log` path the downgrade warning uses.
- **Wiring (Task 7).** The three provider-dispatching boot paths call it immediately after
  `validateConfiguredProviderModels`: `bootDispatchingCliProviders` in `src/conductor/src/index.ts`, daemon boot
  in `src/conductor/src/daemon-cli.ts`, and `runExecutorChildFeature` in `src/conductor/src/engine/executor-child-runtime.ts`
  (which gains an optional `providerModelProbeRunner` input, matching the other two).
- **No new channel.** No new event type, file, or sidecar. Existing `provider_attempt`,
  `step_completed`, and `feature_cost_snapshot` model fields carry the resolved id because the
  dispatch already records the model it ran.
- **Liveness (Task 11).** `LIVENESS_MODEL` in `src/conductor/src/engine/self-host/token-liveness.ts` becomes
  `haiku`.

## Prerequisites

- None. Provider discovery and the injected probe-runner seam already exist on all three boot
  paths' callers.

## Tasks

### Task 1: Codex tier-catalog listing parser and descriptor member
**Story:** Story 1, Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/codex-model-listing.test.ts` for `parseCodexModelListing` over a full-listing fixture shaped like real `codex debug models` output (`{ "models": [{ "slug", "visibility", "supported_in_api", ... }] }`), plus a `hide` `gpt-7-sol` and a non-API `gpt-7.1-sol`; over `not json`; and over JSON without `models`. Add a descriptor assertion to `src/conductor/test/execution/provider-catalog.test.ts`.
2. Verify RED.
3. Implement `parseCodexModelListing` in `src/conductor/src/execution/codex-provider.ts` returning `ProviderModelCatalogParseResult`, mirroring `parsePiModelListing`'s result shape. Add optional `modelTierCatalog?: ProviderModelCatalog` to the descriptor base in `src/conductor/src/execution/provider-catalog.ts`; Codex declares `{ argv: ['debug', 'models'], parse: parseCodexModelListing }` and keeps `modelCatalog: undefined`.
4. Verify GREEN and commit.

**Done when:**
- [test] `parseCodexModelListing` over the full-listing fixture returns `parsed` ids exactly `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, excluding `gpt-6-chat-thinking`, `gpt-reserve`, `codex-auto-review`, the `hide` `gpt-7-sol`, and the non-API `gpt-7.1-sol`.
- [test] `parseCodexModelListing('not json')` returns `unparseable` with first line `not json`, and JSON lacking a `models` array returns `unparseable`.
- [test] The Codex entry in `BUILT_IN_PROVIDERS` declares `modelTierCatalog.argv` equal to `['debug', 'models']` and leaves `modelCatalog` undefined, as asserted in `src/conductor/test/execution/provider-catalog.test.ts`.

**Files likely touched:**
- `src/conductor/src/execution/codex-provider.ts` — `parseCodexModelListing`
- `src/conductor/src/execution/provider-catalog.ts` — `modelTierCatalog` member; Codex declaration
- `src/conductor/test/execution/codex-model-listing.test.ts` — new
- `src/conductor/test/execution/provider-catalog.test.ts` — descriptor assertion

**Dependencies:** none

### Task 2: Same-tier floor resolution materialized into the Codex policy lookup
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/model-tier-resolution.test.ts`: install `resolveModelTierFloors(<Codex floor ids>, <listed ids>)` for `codex`, then resolve steps with `resolveStepConfig(step, phase, resolveProviderModelPolicy('codex'), undefined)`. Use the full listing; a listing whose sol ids are only `gpt-5.4-sol`, `gpt-5.6-sol`; and one whose sol ids are `gpt-6.9-sol`, `gpt-6.10-sol`. Reset the registry in `afterEach`.
2. Verify RED.
3. Create `src/conductor/src/engine/model-tier-resolution.ts` with the floor grammar, `resolveModelTierFloors`, `materializeModelTierPolicy`, `installResolvedModelTiers`, and a test-only reset. In `resolveProviderModelPolicy`, use the installed materialized policy as the base for a built-in provider when one is installed, before applying `llm_providers.<id>` overrides.
4. Verify GREEN and commit.

**Done when:**
- [test] With the full-listing map installed, `resolveStepConfig` over `resolveProviderModelPolicy('codex')` returns `build_review` = `gpt-6.1-sol`, `memory` = `gpt-6-luna`, and `build` = `gpt-5.6-terra`, and that policy's escalation order is `gpt-6-luna, gpt-5.6-terra, gpt-6.1-sol, gpt-6-astra` and fallback ladder `gpt-6.1-sol, gpt-5.6-terra, gpt-6-luna`.
- [test] With a map installed from sol ids only `gpt-5.4-sol` and `gpt-5.6-sol`, `build_review` resolves to `gpt-5.6-sol`; with a map from sol ids `gpt-6.9-sol` and `gpt-6.10-sol`, `build_review` resolves to `gpt-6.10-sol`.
- [test] With the full-listing map installed, no step default or tier-override model of the resolved Codex policy equals `gpt-6-chat-thinking`, `gpt-reserve`, or `codex-auto-review`, and `resolveModelTierFloors` maps an id that does not parse as `gpt-«version»-«tier»` to itself.
- [test] With no map installed, `resolveProviderModelPolicy('codex')` returns `CODEX_MODEL_POLICY` unchanged, and `providerDescriptor('codex').modelPolicy` deep-equals `CODEX_MODEL_POLICY` after a map is installed.

**Files likely touched:**
- `src/conductor/src/engine/model-tier-resolution.ts` — new
- `src/conductor/src/engine/provider-model-policy.ts` — registry-backed base policy
- `src/conductor/test/engine/model-tier-resolution.test.ts` — new

**Dependencies:** none

### Task 3: Astra becomes the top Codex escalation rung
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Update `src/conductor/test/engine/provider-model-policy.test.ts` to expect the four-rung Codex escalation order, and add `escalateAttempt` cases in `src/conductor/test/engine/escalation.test.ts` for a Codex `gpt-5.6-sol` base and a Claude `haiku` base over attempts 1–5. Update the Codex-cap expectations in `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`, `src/conductor/test/execution/provider-catalog.test.ts`, and `src/conductor/test/engine/resolved-config.test.ts`.
2. Verify RED.
3. In `src/conductor/src/engine/provider-model-policy-defaults.ts`, append `gpt-6-astra` to `CODEX_MODEL_POLICY.modelEscalationOrder`; leave the fallback ladder unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `CODEX_MODEL_POLICY.modelEscalationOrder` equals `['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra']` and `modelFallbackLadder` equals `['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']`, as asserted in `src/conductor/test/engine/provider-model-policy.test.ts`.
- [test] `escalateAttempt` with the Claude policy, base `haiku`, escalation enabled and `max_retries` 5 returns models `haiku`, `haiku`, `sonnet`, `opus`, `fable` for attempts 1 through 5, and no returned model is a Codex id.
- [test] `escalateAttempt` with the static Codex policy and base `gpt-5.6-sol` returns `gpt-6-astra` at attempts 3 and 4.
- The Codex cap expectations in `src/conductor/test/engine/escalation.test.ts`, `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`, `src/conductor/test/execution/provider-catalog.test.ts`, and `src/conductor/test/engine/resolved-config.test.ts` name `gpt-6-astra`, and `npx vitest run` over those four files passes.

**Files likely touched:**
- `src/conductor/src/engine/provider-model-policy-defaults.ts` — escalation order
- `src/conductor/test/engine/provider-model-policy.test.ts`, `src/conductor/test/engine/escalation.test.ts`, `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`, `src/conductor/test/execution/provider-catalog.test.ts`, `src/conductor/test/engine/resolved-config.test.ts` — cap expectations

**Dependencies:** none

### Task 4: Operator-configured Codex ids override the resolved policy verbatim
**Story:** Story 1, Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/model-tier-resolution.test.ts` that install the full-listing map and resolve with operator config: `llm_providers.codex.model: gpt-5.6-sol`; a `build_review` step config `{ llm_provider: codex, model: gpt-5.6-terra }`; and `llm_providers.codex.model_escalation_order: [gpt-5.6-luna, gpt-5.6-sol]` with `model_fallback_ladder: [gpt-5.6-sol, gpt-5.6-luna]`.
2. Verify RED if Task 2 applied resolution after overrides; otherwise these pin the precedence.
3. Ensure `resolveProviderModelPolicy` applies `llm_providers.codex` overrides after the installed base and never resolves a configured id.
4. Verify GREEN and commit.

**Done when:**
- [test] With the full-listing map installed and config `llm_providers.codex.model: gpt-5.6-sol`, `resolveStepConfig` for `build_review` returns exactly `gpt-5.6-sol`.
- [test] With the full-listing map installed and step config `build_review: { llm_provider: codex, model: gpt-5.6-terra }`, `resolveStepConfig` for `build_review` returns exactly `gpt-5.6-terra`.
- [test] With the full-listing map installed, `resolveProviderModelPolicy('codex', { config })` returns the configured escalation order `gpt-5.6-luna, gpt-5.6-sol` and fallback ladder `gpt-5.6-sol, gpt-5.6-luna` verbatim.

**Files likely touched:**
- `src/conductor/src/engine/provider-model-policy.ts` — override ordering
- `src/conductor/test/engine/model-tier-resolution.test.ts` — precedence cases

**Dependencies:** Task 2

### Task 5: Tier probe runs once per process and degrades to floors on failure
**Story:** Story 2, Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-model-probe.test.ts` calling `resolveProviderModelTiers({ discovery, runner, timeoutMs, warn, projectRoot })` with fake runners: the full listing; the full listing plus a `hide` `gpt-7-sol` and a non-API `gpt-7.1-sol`; a never-settling runner under fake timers; exit 2; stdout `not json`; JSON without `models`; and discovery with Codex missing. Reset the registry and the once-per-process guard between tests.
2. Verify RED.
3. Implement `resolveProviderModelTiers` in `src/conductor/src/engine/provider-model-probe.ts`, reusing `runWithTimeout`, `executableFor`, `productionRunner`, and `PROVIDER_MODEL_PROBE_TIMEOUT_MS`. Warning text: `Codex tier catalog unavailable (<reason>); using floor model ids.` where reason is `timeout`, `exit code <n>`, or `unparseable: "<first line>"`.
4. Verify GREEN and commit.

**Done when:**
- [test] With Codex installed and a runner returning the full listing, `resolveProviderModelTiers` invokes the runner once with the Codex executable and `['debug', 'models']`, a second call in the same process does not invoke it again, and `resolveStepConfig` over `resolveProviderModelPolicy('codex')` then returns `build_review` = `gpt-6.1-sol` for three different Codex steps resolved after it.
- [test] With a runner returning the full listing plus a `hide` `gpt-7-sol` and a non-API `gpt-7.1-sol`, `build_review` then resolves to `gpt-6.1-sol`.
- [test] With a never-settling runner, the call resolves after the 5-second timeout without throwing, `build_review` resolves to `gpt-5.6-sol`, and `warn` receives exactly one line naming the Codex tier catalog unavailable with reason `timeout`.
- [test] A runner exiting 2, one printing `not json`, and one printing JSON without `models` each leave every Codex step on its floor id, do not throw, and produce exactly one warning naming respectively `exit code 2`, `unparseable` with `not json` quoted, and `unparseable`.
- [test] With discovery reporting Codex not installed, the runner is never invoked and `warn` is never called.

**Files likely touched:**
- `src/conductor/src/engine/provider-model-probe.ts` — `resolveProviderModelTiers`
- `src/conductor/test/engine/provider-model-probe.test.ts` — probe cases

**Dependencies:** Tasks 1, 2

### Task 6: Resolved ids missing from the rate card are warned once
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-model-probe.test.ts` with a temporary project root whose `.ai-conductor/rate-card.json` prices `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra` only, then one that also prices `gpt-6.1-sol` and `gpt-6-luna`, and a failing runner.
2. Verify RED.
3. After installing the map, read `loadRateCard(projectRoot)` and warn once per resolved id that differs from its floor and has no card entry: `Codex model <id> has no rate-card price; run ai-conductor rate-card refresh --model <id>`.
4. Verify GREEN and commit.

**Done when:**
- [test] With the full listing and the four-model rate card, `resolveProviderModelTiers` emits exactly one warning containing `gpt-6.1-sol` and `ai-conductor rate-card refresh --model gpt-6.1-sol`, exactly one containing `gpt-6-luna` and `ai-conductor rate-card refresh --model gpt-6-luna`, and no unpriced-model warning naming `gpt-5.6-terra` or `gpt-6-astra`.
- [test] With a rate card that also prices `gpt-6.1-sol` and `gpt-6-luna`, `resolveProviderModelTiers` over the full listing emits no unpriced-model warning, and with a runner exiting 2 it emits no unpriced-model warning.

**Files likely touched:**
- `src/conductor/src/engine/provider-model-probe.ts` — unpriced warning
- `src/conductor/test/engine/provider-model-probe.test.ts` — rate-card cases

**Dependencies:** Task 5

### Task 7: Every provider-dispatching boot path resolves Codex tiers
**Story:** Story 1, Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests: `bootDispatchingCliProviders` (`src/conductor/src/index.ts`) with an injected `providerModelProbeRunner` returning the full listing, in `src/conductor/test/engine/provider-model-probe.test.ts`; daemon boot in `src/conductor/src/daemon-cli.ts` with an injected runner whose tier listing never settles, in `src/conductor/test/engine/provider-selection.test.ts`; `runExecutorChildFeature` with an injected runner, in `src/conductor/test/engine/executor-child-runtime.test.ts`; and the production runner against a mocked `execa` boundary.
2. Verify RED.
3. Call `resolveProviderModelTiers({ discovery, projectRoot, runner })` right after `validateConfiguredProviderModels` in all three paths; add an optional `providerModelProbeRunner` to `runExecutorChildFeature`'s input and thread it through.
4. Verify GREEN and commit.

**Done when:**
- [test] `bootDispatchingCliProviders` with an injected runner returning the full listing completes, invokes the runner with `['debug', 'models']` exactly once, and afterwards `resolveStepConfig` over `resolveProviderModelPolicy('codex')` returns `build_review` = `gpt-6.1-sol`, `memory` = `gpt-6-luna`, and `build` = `gpt-5.6-terra`.
- [test] Daemon boot in `src/conductor/src/daemon-cli.ts` completes in each of three runs whose injected tier listing respectively never settles, exits 2, and prints `not json`, each run leaves every Codex step resolving to its floor id (`build_review` = `gpt-5.6-sol`), and each run writes exactly one tier-catalog warning naming respectively `timeout`, `exit code 2`, and `unparseable` with `not json` quoted.
- [test] `runExecutorChildFeature` with an injected runner returning the full listing invokes it with `['debug', 'models']` before the feature's first step dispatch.
- [test] With no injected runner, the tier probe reaches the mocked `execa` boundary only after `assertRealExecAllowed` accepts the Codex executable, and a refused executable never reaches `execa`.

**Files likely touched:**
- `src/conductor/src/index.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/executor-child-runtime.ts` — boot wiring
- `src/conductor/test/engine/provider-model-probe.test.ts`, `src/conductor/test/engine/provider-selection.test.ts`, `src/conductor/test/engine/executor-child-runtime.test.ts` — boot cases

**Dependencies:** Tasks 5, 6

### Task 8: Dispatch and cost events carry the resolved model
**Story:** Story 4, Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/codex-tier-model-resolution.acceptance.test.ts` that drive a Codex `build_review` dispatch through `DefaultStepRunner` with a fake Codex adapter and an `EventPersister` writing a temporary `.pipeline/events.jsonl`: once with the full-listing map installed, once with none installed, and once with two Codex steps dispatching on unpriced `gpt-6.1-sol` after `resolveProviderModelTiers` ran against the four-model rate card.
2. Verify RED.
3. Fix any dispatch path that records the floor instead of the model it dispatched; no event schema changes.
4. Verify GREEN and commit.

**Done when:**
- [test] With the full-listing map installed, the fake Codex adapter receives model `gpt-6.1-sol`, and the persisted `provider_attempt` and `step_completed` events for `build_review` and the `feature_cost_snapshot` `byDimension` entry for `build_review` each carry model `gpt-6.1-sol`.
- [test] With no map installed, the same three persisted fields carry `gpt-5.6-sol`.
- [test] With the full-listing map installed, every persisted event `type` belongs to a fixed list of the `ConductorEvent` union's types captured from main before this change, and the temporary `.pipeline/` and `.ai-conductor/` directories contain no file created by tier resolution.
- [test] With two Codex steps dispatched on unpriced `gpt-6.1-sol`, the unpriced warning for `gpt-6.1-sol` appears exactly once in captured stderr, and the feature cost rollup's `costUnmeteredDispatches` equals 2 with neither dispatch priced at 0.

**Files likely touched:**
- `src/conductor/test/acceptance/codex-tier-model-resolution.acceptance.test.ts` — new
- `src/conductor/src/engine/step-runners.ts` — only if a path records the floor

**Dependencies:** Tasks 2, 6

### Task 9: Escalation and fallback dispatch on resolved ids, with astra only as the escalation cap
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/codex-tier-model-resolution.acceptance.test.ts` driving Codex step retries and model-unavailable walks through `DefaultStepRunner` with a fake adapter that records invoked models and can report `modelUnavailable` per model.
2. Verify RED.
3. Fix any retry or fallback path that reads the static policy instead of `resolveProviderModelPolicy`.
4. Verify GREEN and commit.

**Done when:**
- [test] With the full-listing map installed, a Codex step at base floor `gpt-5.6-terra` with escalation enabled and `max_retries` 5 dispatches attempts 3, 4, and 5 on `gpt-6.1-sol`, `gpt-6-astra`, and `gpt-6-astra`; with no map installed, a step at base floor `gpt-5.6-sol` dispatches attempt 3 on `gpt-6-astra`.
- [test] With the full-listing map installed and `gpt-6.1-sol` reporting `modelUnavailable` on `build_review`, the next invoked model is `gpt-5.6-terra` and the downgrade warning names both `gpt-6.1-sol` and `gpt-5.6-terra`.
- [test] With the full-listing map installed and every resolved rung reporting `modelUnavailable`, the invoked models are exactly `gpt-6.1-sol`, `gpt-5.6-terra`, `gpt-6-luna` in that order, `gpt-6-astra` is never invoked, and the last failure is returned to the step's retry path.
- [test] With the full-listing map installed and `llm_providers.codex.model_escalation_order: [gpt-5.6-luna, gpt-5.6-sol]`, a Codex step at base `gpt-5.6-luna` dispatches attempt 3 on exactly `gpt-5.6-sol`.
- [test] With the full-listing map installed and `llm_providers.codex.model_fallback_ladder: [gpt-5.6-sol, gpt-5.6-luna]`, a `gpt-5.6-sol` dispatch reporting `modelUnavailable` is followed by an invocation of exactly `gpt-5.6-luna`.

**Files likely touched:**
- `src/conductor/test/acceptance/codex-tier-model-resolution.acceptance.test.ts` — retry and fallback cases
- `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/model-availability.ts` — only if a path reads the static policy

**Dependencies:** Tasks 2, 3, 4

### Task 10: Readers that never probe keep the floor ids
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write tests: `rate-card refresh` with a fake fetch in `src/conductor/test/engine/rate-card-cli.test.ts`; monitor selection with build selection `codex` and no monitor settings in `src/conductor/test/engine/monitor/selection.test.ts`; and model-table generation in `src/conductor/test/generate-model-table.test.ts`. In each, inject a spy runner into the tier-probe seam and mock the `execa` boundary.
2. Verify the tests pass against the Task 2 design (static descriptor policy) and fail if any of these readers is pointed at the registry.
3. Commit.

**Done when:**
- [test] During `rate-card refresh` with a fake fetch, neither a spy runner injected into the tier-probe seam nor the mocked `execa` boundary receives a `['debug', 'models']` invocation, and its wanted model list contains `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra`.
- [test] Monitor selection with no monitor settings and build selection `codex` launches Codex with `--model gpt-5.6-sol`, and neither a spy runner injected into the tier-probe seam nor the mocked `execa` boundary receives a `['debug', 'models']` invocation.
- [test] `generate-model-table` renders every Codex model cell as a `gpt-5.6-*` id, and neither a spy runner injected into the tier-probe seam nor the mocked `execa` boundary receives a `['debug', 'models']` invocation.

**Files likely touched:**
- `src/conductor/test/engine/rate-card-cli.test.ts`, `src/conductor/test/engine/monitor/selection.test.ts`, `src/conductor/test/generate-model-table.test.ts` — floor cases

**Dependencies:** Task 5

### Task 11: The self-host liveness probe uses the haiku alias
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/self-host/token-liveness.test.ts` that captures the argv `verifyTokenLiveness` passes to an injected spawner.
2. Verify RED.
3. Set `LIVENESS_MODEL` in `src/conductor/src/engine/self-host/token-liveness.ts` to `haiku`.
4. Verify GREEN and commit.

**Done when:**
- [test] The argv `verifyTokenLiveness` hands to the injected spawner contains `--model` immediately followed by `haiku`.
- [test] That argv contains no `claude-haiku-4-5-20251001` and no element matching `/^claude-[a-z]+-\d/`.

**Files likely touched:**
- `src/conductor/src/engine/self-host/token-liveness.ts` — model alias
- `src/conductor/test/engine/self-host/token-liveness.test.ts` — argv assertions

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──┐
Task 2 ──┼─▶ Task 5 ─▶ Task 6 ─▶ Task 7
   │     │              │
   ├─▶ Task 4 ─────┐    └──▶ Task 8 (also Task 2)
   │               ▼
Task 3 ─────────▶ Task 9 (also Task 2)
Task 5 ─▶ Task 10
Task 11 (independent)
```

## Integration Points

- After Task 5: the probe resolves and installs tiers from a fake listing.
- After Task 7: every dispatching boot path runs the probe; a real `conduct` run dispatches Codex on resolved ids.
- After Tasks 8–9: events, retries, and fallback observed through `DefaultStepRunner` carry resolved ids.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D1 | task | task-2, task-3 | `CODEX_MODEL_POLICY.modelEscalationOrder` equals `['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra']` |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D2 | task | task-1 | declares `modelTierCatalog.argv` equal to `['debug', 'models']` and leaves `modelCatalog` undefined |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D3 | task | task-2 | with a map from sol ids `gpt-6.9-sol` and `gpt-6.10-sol`, `build_review` resolves to `gpt-6.10-sol` |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D4 | task | task-5, task-7 | Daemon boot in `src/conductor/src/daemon-cli.ts` completes in each of three runs |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D5 | task | task-2, task-4 | `providerDescriptor('codex').modelPolicy` deep-equals `CODEX_MODEL_POLICY` after a map is installed |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D6 | task | task-8 | every persisted event `type` belongs to a fixed list of the `ConductorEvent` union's types captured from main before this change |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D7 | task | task-6 | emits exactly one warning containing `gpt-6.1-sol` and `ai-conductor rate-card refresh --model gpt-6.1-sol` |
| adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog#D8 | task | task-11 | contains `--model` immediately followed by `haiku` |

## Verification

- [ ] All happy path criteria covered by at least one task (criterion rows live in the coherence artifact)
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
