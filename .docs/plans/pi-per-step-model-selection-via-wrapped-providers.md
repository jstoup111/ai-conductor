# Implementation Plan: Pi per-step model selection via wrapped providers

**Date:** 2026-09-29
**Design:** .docs/decisions/architecture-review-2026-09-29-pi-per-step-model-selection-via-wrapped-providers.md
**Stories:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md
**Conflict check:** Clean as of 2026-09-29

## Summary

Every Pi-dispatched step runs on an operator-configured `provider/model` id at a `--thinking` level mapped from `effort`. Configuring pi requires `llm_providers.pi` model, escalation order and fallback ladder. A boot probe checks configured ids against `pi --list-models`, a Pi exit-0 error stop fails the step, and the model table widens to one column pair per catalog provider. 17 tasks.

## Technical Approach

- **Provider-neutral engine, Pi grammar in the adapter (catalog D1, D12).** `execution/pi-provider.ts` owns `parsePiModelId` (split at the first `/`), `parsePiModelListing`, the argv, and the error-stop check. The catalog descriptor exposes them as the optional `parseModelId` and `modelCatalog` fields. Engine code reads those fields and a new policy flag `requiresConfiguredModels`, so no production file outside the catalog and adapter names `pi`.
- **Effective policy (catalog D13, ladder item 7).** `resolveProviderModelPolicy(key, { config })` overlays `llm_providers.<key>`: `model` becomes every step default, and the two arrays replace the policy orders. Every existing policy consumer receives config: provider runtime, resolved config, conductor, step runners, attribution lane. Per-step resolution order is otherwise unchanged; for a Pi dispatch with no step-level Pi model, the policy default is `llm_providers.pi.model`, including pi as a fallback candidate (adr-2026-07-24 native defaults).
- **Ladder selection (ladder item 7).** `selectFallbackLadder` returns `llm_providers.<id>` ladder, else the top-level `model_fallback_ladder`, else the policy ladder. A `requiresConfiguredModels` policy never receives the top-level key. Claude and codex behavior is unchanged.
- **Validation (catalog D13).** `engine/provider-model-config.ts` `collectProviderModelSelections` is the single enumerator of where a provider is configured and which model values reach it (with config path and step). Config validation and the boot probe both use it.
- **Boot probe (catalog D8, D13).** `engine/provider-model-probe.ts` runs on the existing provider-dispatching boot paths (`index.ts` and `daemon-cli.ts`), after `validateProviderInstallation`, through an injected runner guarded by `assertRealExecAllowed`, following the provider-discovery version-probe shape. Search hints: `discoverInstalledProviders`, `ProviderVersionProbeRunner`.
- **Model table.** `tools/generate-model-table.ts` rows carry a per-provider cell map built from the catalog; sentinels `config-required` and `n/a` replace blanks.
- **Sequencing.** Policy flag and parser first (1, 2), then adapter (3, 4) and config (5 to 7) in parallel, then resolution (8 to 12), probe (13 to 15), and table (16, 17).

## Prerequisites

- None. No migration: `llm_providers` is an additive `.ai-conductor/config.yml` key, not a settings.json schema surface.

## Tasks

### Task 1: Model policy declares configured-model requirement; Pi policy ships no models
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: in `src/conductor/test/execution/provider-catalog.test.ts`, replace the #1884 assertion that the pi descriptor model policy "has exactly one rung and that rung carries no model id" with assertions that the pi policy has `requiresConfiguredModels: true`, an empty `modelEscalationOrder`, an empty `modelFallbackLadder`, and no non-empty `stepModels` value, while claude and codex policies declare `requiresConfiguredModels: false` and keep their current values.
2. Add a test asserting `rateCardModelIds` never contains an empty string.
3. Verify RED.
4. Implement: add the boolean `requiresConfiguredModels` to `ProviderModelPolicy` in `src/conductor/src/engine/provider-model-policy-defaults.ts`; set it false for claude and codex; rebuild `PI_MODEL_POLICY` in `src/conductor/src/execution/provider-catalog.ts` with the flag true and empty ladders; make `rateCardModelIds` skip empty ids.
5. Verify GREEN and commit.

**Done when:**
- The `PI_MODEL_POLICY` in provider-catalog.ts declares `requiresConfiguredModels: true` with empty `modelEscalationOrder` and `modelFallbackLadder` and no non-empty `stepModels` entry, as asserted in provider-catalog.test.ts, which no longer asserts a single empty rung.
- The claude and codex policies declare `requiresConfiguredModels: false` and their stepModels, efforts, escalation orders and ladders are unchanged, as asserted by the existing policy tests without edits to their expected values.
- `rateCardModelIds` returns no empty-string id, as asserted by a provider-model-policy test.

**Files:** `src/conductor/src/engine/provider-model-policy-defaults.ts`, `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/src/engine/provider-model-policy.ts`, `src/conductor/test/execution/provider-catalog.test.ts`

**Dependencies:** none

### Task 2: Pi model id parser declared on the catalog descriptor
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/execution/pi-provider.test.ts` for an exported `parsePiModelId` that splits a canonical id at the first `/` only: `anthropic/claude-opus-4-5` gives provider `anthropic` and model `claude-opus-4-5`; `cline/google/gemma-4-31b-it:free` gives provider `cline` and model `google/gemma-4-31b-it:free`; `claude-opus-4-5`, `anthropic/`, `/claude-opus-4-5`, and an id containing a space each return a typed rejection whose reason is `missing-separator`, `empty-provider`, `empty-model`, or `whitespace` respectively.
2. Add a catalog test asserting the pi descriptor exposes this parser as its `parseModelId` field and the claude and codex descriptors declare none (their model strings stay opaque).
3. Verify RED.
4. Implement `parsePiModelId` in `src/conductor/src/execution/pi-provider.ts` (the adapter module owns the Pi-specific grammar, keeping catalog D1) and add the optional `parseModelId` descriptor field in `src/conductor/src/execution/provider-catalog.ts`.
5. Verify GREEN and commit.

**Done when:**
- `parsePiModelId` splits at the first `/` only, returning provider `cline` and model `google/gemma-4-31b-it:free` unchanged for the nested fixture id, as asserted in pi-provider.test.ts.
- `parsePiModelId` rejects `claude-opus-4-5`, `anthropic/`, `/claude-opus-4-5`, and a whitespace-bearing id with the reasons `missing-separator`, `empty-provider`, `empty-model`, and `whitespace`, as asserted in pi-provider.test.ts.
- The pi catalog descriptor exposes `parseModelId` and the claude and codex descriptors declare none, as asserted in provider-catalog.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/execution/pi-provider.test.ts`, `src/conductor/test/execution/provider-catalog.test.ts`

**Dependencies:** none

### Task 3: Pi adapter passes --provider, --model and --thinking
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` against the fake subprocess spawner: replace the #1884 test asserting the adapter "passes no `--model` argument"; invoke with model `anthropic/claude-opus-4-5` and effort `xhigh`; invoke with `cline/google/gemma-4-31b-it:free`; invoke once per effort `low`, `medium`, `high`, `xhigh`, `max`.
2. Verify RED.
3. Implement in `src/conductor/src/execution/pi-provider.ts` `invoke`: parse `options.model` with `parsePiModelId` and append `--provider <provider> --model <model>`; append exactly one `--thinking <effort>` using the effort name unchanged. Never append a `:<thinking>` suffix to the model.
4. Verify GREEN; confirm the claude and codex adapter argv tests pass unedited. Commit.

**Done when:**
- For model `anthropic/claude-opus-4-5` and effort `xhigh`, the Pi adapter `invoke` spawns an argv containing `--provider anthropic --model claude-opus-4-5 --thinking xhigh`, as asserted in pi-provider.test.ts.
- For model `cline/google/gemma-4-31b-it:free`, the spawned argv contains `--provider cline --model google/gemma-4-31b-it:free` with the model part byte-identical, no `:`-suffixed thinking value appended to `--model`, and exactly one `--thinking` flag, as asserted in pi-provider.test.ts.
- For each effort `low`, `medium`, `high`, `xhigh`, and `max`, the spawned `--thinking` value equals the effort name, and no spawned argv ever contains `--thinking off` or `--thinking minimal`, as asserted in pi-provider.test.ts.
- The claude and codex adapter argv tests pass with unedited assertions, proving a claude or codex step in the same run as a Pi step spawns its pre-change argv exactly.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 2

### Task 4: Pi exit-0 error stop fails the invocation
**Story:** 7
**Type:** negative-path

**Steps:**
1. Capture as a fixture the 2026-09-29 pi 0.84.3 exit-0 stream whose terminal assistant message has `stopReason: "error"` and `errorMessage: "No API key for provider: cline"`; add a variant with no `errorMessage`, and a variant followed by a malformed JSON last line.
2. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for each fixture, plus the existing success-stream fixture.
3. Verify RED.
4. Implement in `src/conductor/src/execution/pi-provider.ts` JSONL parsing: when the terminal assistant message has `stopReason` equal to `error`, return a failed invocation whose error text is `errorMessage`, or `Pi reported an error stop with no message` when absent; set none of `authFailure`, `rateLimited`, `modelUnavailable`. Ignore malformed lines as today.
5. Verify GREEN and commit.

**Done when:**
- For the captured exit-0 fixture with `stopReason: "error"`, the Pi adapter returns a failed invocation whose error text contains `No API key for provider: cline` and whose `authFailure`, `rateLimited`, and `modelUnavailable` flags are all unset, so the step fails as an ordinary step failure, as asserted in pi-provider.test.ts.
- For an exit-0 error-stop stream with no `errorMessage`, the adapter returns a failed invocation whose error text is `Pi reported an error stop with no message`, as asserted in pi-provider.test.ts.
- For an error-stop message followed by a malformed JSON last line, the adapter still returns a failed invocation carrying the error message, as asserted in pi-provider.test.ts.
- The existing success-stream fixture with a normal stop reason still returns a successful invocation whose output is the terminal message text, with that test unchanged.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`, `src/conductor/test/fixtures/pi-error-stop-stream.jsonl`

**Dependencies:** none

### Task 5: llm_providers config block schema and consumer registry
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: a top-level `llm_providers` map keyed by catalog provider id accepts `model` (non-empty string), `model_escalation_order` and `model_fallback_ladder` (arrays of non-empty strings); a key that is not a catalog id fails with the unknown-provider error listing the catalog ids; `llm_providers.pi.model_fallback_ladder` containing an empty string fails naming `llm_providers.pi.model_fallback_ladder` and the entry index; an unknown sub-key fails as an unknown key.
2. Extend `src/conductor/test/engine/config-consumer-registry.ts` coverage expectations so the new keys must declare consumers.
3. Verify RED.
4. Implement: add `llm_providers` to `HarnessConfig` in `src/conductor/src/types/config.ts`, to `CONFIG_CONSUMER_KEY_SETS` in `src/conductor/src/engine/config.ts` with its sub-key set, and shape validation in `validateConfig`. Declare consumers: provider-model-policy (model, escalation order, ladder) and provider-model-probe.
5. Verify GREEN and commit.

**Done when:**
- Config validation in config.ts rejects an `llm_providers` key that is not a catalog provider id with the unknown-provider error listing the catalog ids, as asserted in config.test.ts.
- Config validation rejects `llm_providers.pi.model_fallback_ladder` containing an empty string with an error naming `llm_providers.pi.model_fallback_ladder` and the offending entry, as asserted in config.test.ts.
- `llm_providers` and its sub-keys `model`, `model_escalation_order`, and `model_fallback_ladder` are declared in `CONFIG_CONSUMER_KEY_SETS` with consumers, and the config-consumer-registry coverage test passes.

**Files:** `src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`, `src/conductor/test/engine/config-consumer-registry.ts`

**Dependencies:** none

### Task 6: Configuring pi requires the three llm_providers.pi keys
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/config.test.ts` for a new `collectProviderModelSelections(config)` in `src/conductor/src/engine/provider-model-config.ts` that returns, per catalog provider, whether it is configured (run-level `llm_provider`, a step `llm_provider` or candidate list, `provider_substitution`, or a build-review rubric `llm_provider`) and every configured model value with its config path and step.
2. Write failing validation tests: pi configured with `llm_providers.pi.model` absent fails naming `llm_providers.pi.model` as required because pi is configured; `model_escalation_order` absent and `model_fallback_ladder` empty each fail naming that key; one config missing all three yields three errors; pi not configured and no `llm_providers.pi` block loads with no llm_providers error.
3. Verify RED.
4. Implement `collectProviderModelSelections` and, in `src/conductor/src/engine/config.ts`, require the three `llm_providers.<id>` keys for every configured provider whose catalog policy has `requiresConfiguredModels: true` (no provider id literal).
5. Verify GREEN and commit.

**Done when:**
- Config validation fails a configuration naming pi without `llm_providers.pi.model` with an error naming `llm_providers.pi.model` as required because pi is configured, as asserted in config.test.ts.
- Config validation fails a configuration naming pi whose `llm_providers.pi.model_escalation_order` or `llm_providers.pi.model_fallback_ladder` is absent or empty with one error naming each missing key, as asserted in config.test.ts.
- A configuration that names pi nowhere and has no `llm_providers.pi` block loads with no llm_providers error, as asserted in config.test.ts.
- `collectProviderModelSelections` reports pi as configured for run-level, step-level, candidate-list, provider_substitution, and build-review rubric selections, and lists each configured model value with its config path and step, as asserted in config.test.ts.

**Files:** `src/conductor/src/engine/provider-model-config.ts`, `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`

**Dependencies:** 1, 5

### Task 7: Pi model ids are syntax-checked at config load
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: a Pi step model `claude-opus-4-5`, `anthropic/`, `/claude-opus-4-5`, and one containing a space each fail with an error naming the config path, and the first names the expected `provider/model` form while the empty-segment ones name the empty segment; a malformed entry inside `llm_providers.pi.model_fallback_ladder` fails naming that key and entry; a claude step with alias `opus` and a claude step with the Pi-form model `anthropic/claude-opus-4-5` both load unchanged.
2. Verify RED.
3. Implement in `src/conductor/src/engine/config.ts`: for every model value `collectProviderModelSelections` attributes to a provider whose descriptor declares `parseModelId`, run the parser and map its rejection reason to a message naming the config path. Values attributed only to providers without a parser are not parsed.
4. Verify GREEN and commit.

**Done when:**
- Config validation fails a Pi step model `claude-opus-4-5` with an error naming the config path and the expected `provider/model` form, as asserted in config.test.ts.
- Config validation fails Pi step models `anthropic/` and `/claude-opus-4-5` with errors naming the config path and the empty segment, and fails a whitespace-bearing Pi step model with an error naming the config path, as asserted in config.test.ts.
- Config validation fails an empty-string entry and a malformed Pi id inside `llm_providers.pi.model_fallback_ladder`, each with an error naming `llm_providers.pi.model_fallback_ladder` and the offending entry, as asserted in config.test.ts.
- A claude step configured with alias `opus` and a claude step configured with the Pi-form model `anthropic/claude-opus-4-5` both load with no Pi model-id validation applied and resolve those model strings unchanged, as asserted in config.test.ts.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`

**Dependencies:** 2, 6

### Task 8: Effective provider model policy overlays llm_providers
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/resolved-config.test.ts`: `resolveProviderModelPolicy(key, { config })` in `src/conductor/src/engine/provider-model-policy.ts` overlays `llm_providers.<key>`: `model` becomes every step default in `stepModels`, `model_escalation_order` and `model_fallback_ladder` replace the policy orders; with no block the catalog policy is returned unchanged.
2. Write failing resolution tests: `steps.plan` on pi with `model: anthropic/claude-opus-4-5` and `effort: high` resolves exactly that model and effort; pi configured with `llm_providers.pi.model: google/gemini-2.5-flash` resolves that model for every Pi step without a step-level Pi model; `steps.plan.by_tier.L` Pi model resolves for a tier L feature; with all three keys set no Pi step resolves to `FALLBACK_MODEL` or any claude or codex policy alias.
3. Verify RED.
4. Implement the overlay and pass config into `resolveProviderModelPolicy` from `src/conductor/src/engine/resolved-config.ts`; guard `FALLBACK_MODEL` so it is never returned for a policy with `requiresConfiguredModels: true`.
5. Verify GREEN and commit.

**Done when:**
- Resolved config for `steps.plan` on pi with model `anthropic/claude-opus-4-5` returns exactly `anthropic/claude-opus-4-5` and the configured effort, as asserted in resolved-config.test.ts.
- With pi configured and `llm_providers.pi.model` set to `google/gemini-2.5-flash`, `resolveProviderModelPolicy` overlays it so every Pi step without a step-level Pi model resolves `google/gemini-2.5-flash`, as asserted in resolved-config.test.ts.
- A Pi model under `steps.plan.by_tier.L` is the resolved plan model for a tier L feature, as asserted in resolved-config.test.ts.
- With all three `llm_providers.pi` keys set, no Pi step resolves to `sonnet`, to `FALLBACK_MODEL`, or to any alias in the claude or codex policy, as asserted by a resolved-config.test.ts sweep over every step.

**Files:** `src/conductor/src/engine/provider-model-policy.ts`, `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/resolved-config.test.ts`

**Dependencies:** 1, 5

### Task 9: Dispatch uses the effective policy across mixed-provider runs and fallback
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` driving step dispatch through the provider runtime set with fake adapters: two Pi steps with different underlying providers; a claude run with only `steps.plan` on pi; tier L versus tier M for `steps.plan.by_tier.L`; a claude run with `defaults.model: opus` and `steps.plan` on pi with no model of its own; a claude step with candidate list claude then pi where claude returns run-scope unavailable.
2. Verify RED.
3. Implement: pass config into `createProviderRuntimeSet` in `src/conductor/src/engine/provider-runtime.ts`, the build-review policy resolution in `src/conductor/src/engine/resolved-config.ts`, the preferred-provider policy in `src/conductor/src/engine/conductor.ts`, and the step runner `modelPolicy` in `src/conductor/src/engine/step-runners.ts`, so each dispatched provider uses its effective policy.
4. Verify GREEN and commit.

**Done when:**
- With `steps.explore` on pi `google/gemini-2.5-flash` and `steps.plan` on pi `anthropic/claude-opus-4-5`, the two dispatched Pi invocations in one run carry provider `google` model `gemini-2.5-flash` and provider `anthropic` model `claude-opus-4-5` respectively, as asserted in provider-execution-pi-fallback.test.ts.
- A tier L feature dispatches plan on pi with the `steps.plan.by_tier.L` model and effort while a tier M feature dispatches the base `steps.plan` values, as asserted in provider-execution-pi-fallback.test.ts.
- In a claude run where only `steps.plan` selects pi with a Pi model, plan dispatches through pi with that model and every other step dispatches through claude with its Claude alias, as asserted in provider-execution-pi-fallback.test.ts.
- In a claude run with `defaults.model: opus` and `steps.plan` on pi with no model of its own, plan dispatches to pi with `llm_providers.pi.model` and the invocation never carries `opus`, as asserted in provider-execution-pi-fallback.test.ts.
- When a claude step with candidate list claude then pi falls back after claude is run-scope unavailable, pi is invoked with `llm_providers.pi.model` and the step effort and never with the claude step Claude alias, as asserted in provider-execution-pi-fallback.test.ts.

**Files:** `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/src/engine/resolved-config.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/provider-execution-pi-fallback.test.ts`

**Dependencies:** 8

### Task 10: Fallback ladder is selected per dispatched provider; Pi never inherits the top-level ladder
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/model-availability.test.ts` for `selectFallbackLadder(policy, providerKey, config)` in `src/conductor/src/engine/model-availability.ts`: `llm_providers.<id>.model_fallback_ladder` wins; else the top-level `model_fallback_ladder`; else the policy ladder; a policy with `requiresConfiguredModels: true` never receives the top-level ladder.
2. Write failing dispatch tests in `src/conductor/test/engine/provider-execution-pi-fallback.test.ts`: Pi ladder `anthropic/claude-opus-4-5` then `openai/gpt-5.6-sol` with the first reported model-unavailable; a claude run with a top-level Claude-alias ladder and `steps.plan` on pi; every Pi rung unavailable; a codex step in a claude run with a top-level ladder; a claude run with no `llm_providers` block.
3. Verify RED.
4. Implement `selectFallbackLadder` and use it at the step-runner availability construction in `src/conductor/src/engine/step-runners.ts`, at `src/conductor/src/engine/attribution-lane.ts`, and in `resolveFallbackProviderNativeStepConfig` in `src/conductor/src/engine/resolved-config.ts`.
5. Verify GREEN and commit.

**Done when:**
- When the first Pi ladder rung `anthropic/claude-opus-4-5` is model-unavailable, the Pi step re-invokes with `openai/gpt-5.6-sol` and the downgrade warning names the configured model, the actual model, and the reason, as asserted in provider-execution-pi-fallback.test.ts.
- In a claude run with a top-level Claude-alias `model_fallback_ladder` and `steps.plan` on pi, a model-unavailable plan step walks the Pi ladder and no invocation passed to pi ever carries a Claude alias, as asserted by `selectFallbackLadder` tests and provider-execution-pi-fallback.test.ts.
- When every Pi ladder rung is model-unavailable, the walk returns the last failure to the retry machinery and the step retry attempt count is unchanged by the downgrades, as asserted in provider-execution-pi-fallback.test.ts.
- A codex step in a claude run with a top-level `model_fallback_ladder`, and every step of a claude run with no `llm_providers` block, walk exactly the ladder they walked before this change, and every claude step of a claude run with no `llm_providers` block escalates to the same model and effort per attempt as before, as asserted by `selectFallbackLadder` tests and the unedited existing model-availability, fallback, and escalation tests.

**Files:** `src/conductor/src/engine/model-availability.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/attribution-lane.ts`, `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/model-availability.test.ts`, `src/conductor/test/engine/provider-execution-pi-fallback.test.ts`

**Dependencies:** 8

### Task 11: Retry escalation walks the configured Pi escalation order
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/escalation.test.ts` calling `escalateAttempt` with the effective Pi policy: `model_escalation_order` small, mid, large; a Pi step on the small model at attempt 3; a Pi step whose model is absent from the order at attempt 3.
2. Verify RED (the effective policy overlay must reach escalation call sites).
3. Implement: make the escalation call sites in `src/conductor/src/engine/conductor.ts` and `resolveFallbackProviderNativeStepConfig` pass the effective policy for the dispatched provider.
4. Verify GREEN and commit.

**Done when:**
- With `llm_providers.pi.model_escalation_order` of a small, mid, and large Pi model, `escalateAttempt` returns the mid model for a Pi step on the small model at attempt 3, as asserted in escalation.test.ts.
- For a Pi step whose model is absent from `llm_providers.pi.model_escalation_order`, `escalateAttempt` at attempt 3 returns the unchanged model with only the effort escalated, as asserted in escalation.test.ts.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/escalation.test.ts`

**Dependencies:** 8

### Task 12: Pi dispatch events carry the full provider/model id
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution-pi-fallback.test.ts` that record events from a successful Pi step and a failed Pi step dispatched through the provider execution seam, and that compare the spawned argv of claude and codex steps in a run that also dispatches a Pi step against fixture argv recorded from the pre-change code before implementation starts.
2. Verify RED if any event carries an empty or split model.
3. Implement in `src/conductor/src/engine/provider-execution.ts` only if needed so the invoked model recorded on `provider_attempt`, `step_completed`, and `step_retry` is the canonical `provider/model` id.
4. Verify GREEN and commit.

**Done when:**
- For a completed Pi step, the `provider_attempt` and `step_completed` events carry provider `pi`, model `anthropic/claude-opus-4-5` as the full id, and the effort, as asserted in provider-execution-pi-fallback.test.ts.
- For a failed Pi step, the `provider_attempt` event carries the full `provider/model` id and never an empty model string, and a Pi `step_retry` event carries the full id, as asserted in provider-execution-pi-fallback.test.ts.
- In one run that dispatches a Pi step, a claude step, and a codex step through fake spawners, the claude and codex steps spawn argv byte-identical to fixture argv recorded from the pre-change code for the same steps, as asserted in provider-execution-pi-fallback.test.ts.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/test/engine/provider-execution-pi-fallback.test.ts`

**Dependencies:** 3, 9

### Task 13: Pi model listing parser from a captured fixture
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Capture the pi 0.84.3 `--list-models` output as fixture `src/conductor/test/fixtures/pi-list-models-0.84.3.txt`.
2. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for `parsePiModelListing(stdout)`: parses rows by the header column names `provider` and `model` (not position) into canonical `provider/model` ids, including `cline/google/gemma-4-31b-it:free`; a listing with no header row carrying `provider` and `model` returns a typed unparseable result quoting the first line.
3. Verify RED.
4. Implement `parsePiModelListing` in `src/conductor/src/execution/pi-provider.ts` and declare on the pi descriptor in `src/conductor/src/execution/provider-catalog.ts` a `modelCatalog` field with argv `--list-models` and this parser.
5. Verify GREEN and commit.

**Done when:**
- `parsePiModelListing` turns the captured 0.84.3 fixture into canonical ids including `cline/google/gemma-4-31b-it:free`, locating columns by the `provider` and `model` header names, as asserted in pi-provider.test.ts.
- `parsePiModelListing` returns an unparseable result quoting the first line when no header row carries `provider` and `model` columns, as asserted in pi-provider.test.ts.
- The pi catalog descriptor declares `modelCatalog` with argv `--list-models` and `parsePiModelListing`, and the claude and codex descriptors declare none, as asserted in provider-catalog.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/execution/pi-provider.test.ts`, `src/conductor/test/execution/provider-catalog.test.ts`, `src/conductor/test/fixtures/pi-list-models-0.84.3.txt`

**Dependencies:** 2

### Task 14: Boot probe rejects configured Pi ids missing from the listing
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-model-probe.test.ts` for `validateConfiguredProviderModels({ config, discovery, runner, timeoutMs })` in `src/conductor/src/engine/provider-model-probe.ts` using an injected fake runner: all configured Pi ids (step models, `llm_providers.pi.model`, every escalation and ladder entry) listed; an id whose provider is absent; an id whose provider is listed but model is not; a runner that exceeds the timeout; a runner that exits non-zero; a runner whose output has no provider and model header.
2. Verify RED.
3. Implement the probe: for each installed provider whose descriptor declares `modelCatalog` and that `collectProviderModelSelections` reports configured, run its argv once through the injected runner guarded by `assertRealExecAllowed`, parse, and throw `ProviderModelUnknownError` variants naming id, config path, and step. Call it from the provider-dispatching boot path in `src/conductor/src/index.ts` and from the daemon boot in `src/conductor/src/daemon-cli.ts`, immediately after `validateProviderInstallation`.
4. Verify GREEN and commit.

**Done when:**
- When every configured Pi id, including `llm_providers.pi.model` and every escalation and ladder entry, appears in the listing, `validateConfiguredProviderModels` returns without error and boot continues, as asserted in provider-model-probe.test.ts.
- A configured Pi id whose provider segment is absent from the listing makes the boot probe throw the unknown-Pi-provider error naming the id, the config path, and the step, as asserted in provider-model-probe.test.ts.
- A configured Pi id whose provider is listed but whose model is not makes the boot probe throw the unknown-Pi-model error naming the id, the config path, and the step, with wording distinct from the unknown-provider error, as asserted in provider-model-probe.test.ts.
- A listing run that exceeds its timeout fails boot with a message stating the Pi model listing timed out, and a non-zero exit or a listing with no provider and model header fails boot with a message quoting the unparseable header and never accepts the configured ids, as asserted in provider-model-probe.test.ts.

**Files:** `src/conductor/src/engine/provider-model-probe.ts`, `src/conductor/src/index.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/provider-model-probe.test.ts`

**Dependencies:** 6, 13

### Task 15: Boot probe runs only where Pi is installed, configured, and dispatched
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/provider-model-probe.test.ts`, Pi installed but not configured anywhere; Pi configured but discovery reports it missing; in `src/conductor/test/engine/provider-selection.test.ts` or the existing CLI boot test, a non-dispatching subcommand such as `render-diagrams` with Pi configured; a spy on the process spawn boundary proving the default-suite probe paths reach only the injected fake.
2. Verify RED.
3. Implement the skip conditions in the probe and confirm the index.ts call sits inside the existing `CLI_PROVIDER_DISPATCHING_COMMANDS` guard and after `validateProviderInstallation`.
4. Verify GREEN and commit.

**Done when:**
- With Pi installed but configured nowhere, a provider-dispatching boot never invokes the `--list-models` runner, as asserted by the fake runner call count in provider-model-probe.test.ts.
- A non-dispatching subcommand such as `render-diagrams` with Pi configured never invokes the `--list-models` runner, as asserted through the CLI provider-dispatching guard test.
- With Pi configured but not installed, a provider-dispatching boot fails with the existing not-installed error and the `--list-models` runner is never invoked, as asserted in provider-model-probe.test.ts.
- Every default-suite boot path that exercises the probe runs it through the injected fake runner and no real `pi` process is spawned, as asserted by a spawn-boundary spy in provider-model-probe.test.ts.

**Files:** `src/conductor/src/engine/provider-model-probe.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/provider-model-probe.test.ts`, `src/conductor/test/engine/provider-selection.test.ts`

**Dependencies:** 14

### Task 16: Model table renders one column pair per catalog provider
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/generate-model-table.test.ts`: the rendered header has a model and an effort column for each catalog provider in catalog order between `Execution path` and `Why`; a test catalog with an added fourth provider renders its columns with no generator change; claude and codex cells equal the pre-change rendering for every row.
2. Verify RED.
3. Implement in `src/conductor/src/tools/generate-model-table.ts`: replace `claudeModel`/`codexModel` fields with a per-provider cell map, derive `TABLE_HEADER`, the separator and `buildEngineRows` from the catalog instead of two positional policies; update `src/conductor/src/engine/model-table-metadata.ts` rows to the map shape preserving every claude and codex value.
4. Verify GREEN and commit.

**Done when:**
- `renderModelTable` emits a header with a model column and an effort column for each of claude, codex, and pi in catalog order plus the skill, execution-path, and why columns, as asserted in generate-model-table.test.ts.
- Every claude and codex model and effort cell of the rendered table is identical to the pre-change rendering except that pre-change blank Claude effort cells on interactive rows read n/a, as asserted by a generate-model-table.test.ts comparison against the pre-change expected cells.
- `buildEngineRows` derives provider columns from the catalog, so a test catalog with an added provider renders its columns without any generator edit, as asserted in generate-model-table.test.ts.

**Files:** `src/conductor/src/tools/generate-model-table.ts`, `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/test/generate-model-table.test.ts`, `src/conductor/test/model-table-metadata.test.ts`

**Dependencies:** 1

### Task 17: Pi table sentinels, completeness gate, and regenerated ARCHITECTURE.md
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/generate-model-table.test.ts` and `src/conductor/test/model-table-metadata.test.ts`: engine rows for a policy with `requiresConfiguredModels: true` render the model cell `config-required` and the effort cell as the policy step effort; interactive-skill rows render Pi model and effort `n/a`; a row with a blank cell for any catalog provider fails naming the row while `config-required` and `n/a` pass; `--check` against a committed table lacking the Pi columns exits non-zero with a diff showing them.
2. Verify RED.
3. Implement the sentinels and gate change in `src/conductor/src/tools/generate-model-table.ts` and `src/conductor/src/engine/model-table-metadata.ts`, then run `bin/generate-model-table` to regenerate the ARCHITECTURE.md region.
4. Verify GREEN and commit.

**Done when:**
- Every engine-step Pi model cell renders `config-required` and every engine-step Pi effort cell renders the Pi policy step effort, as asserted in generate-model-table.test.ts.
- Every interactive-skill row renders Pi model and effort cells `n/a`, as asserted in generate-model-table.test.ts.
- The completeness check fails a generated row with a blank cell for any catalog provider naming the row, and accepts `config-required` and `n/a` as explicit sentinels, as asserted in model-table-metadata.test.ts.
- `bin/generate-model-table --check` exits 0 on the committed ARCHITECTURE.md with Pi columns, and exits non-zero with a diff showing the missing Pi columns against a table lacking them, as asserted in generate-model-table.test.ts.

**Files:** `src/conductor/src/tools/generate-model-table.ts`, `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/test/generate-model-table.test.ts`, `src/conductor/test/model-table-metadata.test.ts`, `ARCHITECTURE.md`

**Dependencies:** 16

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- none
Task 3 <- 2
Task 4 <- none
Task 5 <- none
Task 6 <- 1, 5
Task 7 <- 2, 6
Task 8 <- 1, 5
Task 9 <- 8
Task 10 <- 8
Task 11 <- 8
Task 12 <- 3, 9
Task 13 <- 2
Task 14 <- 6, 13
Task 15 <- 14
Task 16 <- 1
Task 17 <- 16
```

## Integration Points

- After Task 3: a fake-spawner Pi step carries the configured `--provider/--model/--thinking` argv.
- After Task 9: mixed claude and pi runs, and pi as a fallback candidate, dispatch on effective policies end to end through the provider runtime.
- After Task 14: `conduct run` and daemon boot refuse unknown configured Pi ids.
- After Task 17: `bin/generate-model-table --check` passes with Pi columns.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `steps.plan` sets `llm_provider: pi`, `model: anthropic/claude-opus-4-5`, and `effort: xhigh`, when the plan step dispatches, then the spawned argv contains `--provider anthropic --model claude-opus-4-5 --thinking xhigh`. | 3 | "For model `anthropic/claude-opus-4-5` and effort `xhigh`, the Pi adapter `invoke` spawns an argv containing `--provider anthropic --model claude-opus-4-5 --thinking xhigh`, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 happy: Given a Pi step resolves the model `cline/google/gemma-4-31b-it:free`, when it dispatches, then the argv contains `--provider cline --model google/gemma-4-31b-it:free` with the model part unchanged. | 3 | "For model `cline/google/gemma-4-31b-it:free`, the spawned argv contains `--provider cline --model google/gemma-4-31b-it:free` with the model part byte-identical, no `:`-suffixed thinking value appended to `--model`, and exactly one `--thinking` flag, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 happy: Given a Pi step resolves each harness effort level `low`, `medium`, `high`, `xhigh`, and `max`, when it dispatches, then `--thinking` carries the same level name. | 3 | "For each effort `low`, `medium`, `high`, `xhigh`, and `max`, the spawned `--thinking` value equals the effort name, and no spawned argv ever contains `--thinking off` or `--thinking minimal`, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 happy: Given a Pi step completes, when the event log is read, then its `provider_attempt` and `step_completed` events carry provider `pi`, the full `provider/model` id, and the effort. | 12 | "For a completed Pi step, the `provider_attempt` and `step_completed` events carry provider `pi`, model `anthropic/claude-opus-4-5` as the full id, and the effort, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 1 negative: Given a Pi step resolves the model `cline/google/gemma-4-31b-it:free`, when it dispatches, then the argv contains no `:`-suffixed thinking value on `--model` beyond the model id itself, and exactly one `--thinking` flag. | 3 | "For model `cline/google/gemma-4-31b-it:free`, the spawned argv contains `--provider cline --model google/gemma-4-31b-it:free` with the model part byte-identical, no `:`-suffixed thinking value appended to `--model`, and exactly one `--thinking` flag, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 negative: Given a Pi step resolves an effort, when it dispatches, then the argv never contains `--thinking off` or `--thinking minimal`, because harness effort has no such levels. | 3 | "For each effort `low`, `medium`, `high`, `xhigh`, and `max`, the spawned `--thinking` value equals the effort name, and no spawned argv ever contains `--thinking off` or `--thinking minimal`, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 negative: Given a Pi step fails, when the event log is read, then its `provider_attempt` event carries the full `provider/model` id rather than an empty model string. | 12 | "For a failed Pi step, the `provider_attempt` event carries the full `provider/model` id and never an empty model string, and a Pi `step_retry` event carries the full id, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 1 negative: Given a claude or codex step dispatches in the same run as a Pi step, when its argv is inspected, then it matches the pre-change argv for that provider exactly. | 12 | "In one run that dispatches a Pi step, a claude step, and a codex step through fake spawners, the claude and codex steps spawn argv byte-identical to fixture argv recorded from the pre-change code for the same steps, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 2 happy: Given `steps.plan` selects pi with `model: anthropic/claude-opus-4-5`, when config loads and resolves, then the resolved model for plan is exactly `anthropic/claude-opus-4-5` and its effort is the configured effort. | 8 | "Resolved config for `steps.plan` on pi with model `anthropic/claude-opus-4-5` returns exactly `anthropic/claude-opus-4-5` and the configured effort, as asserted in resolved-config.test.ts." | diff-local |
| Story 2 happy: Given pi is configured and `llm_providers.pi.model` is `google/gemini-2.5-flash`, when config resolves, then every Pi step without a step-level Pi model resolves to `google/gemini-2.5-flash`. | 8 | "With pi configured and `llm_providers.pi.model` set to `google/gemini-2.5-flash`, `resolveProviderModelPolicy` overlays it so every Pi step without a step-level Pi model resolves `google/gemini-2.5-flash`, as asserted in resolved-config.test.ts." | diff-local |
| Story 2 happy: Given a Pi step has a model configured under `steps.plan.by_tier.L`, when config resolves for a tier L feature, then the plan step resolves that tier model. | 8 | "A Pi model under `steps.plan.by_tier.L` is the resolved plan model for a tier L feature, as asserted in resolved-config.test.ts." | diff-local |
| Story 2 negative: Given pi is configured and `llm_providers.pi.model` is absent, when config loads, then validation fails with an error naming `llm_providers.pi.model` as required because pi is configured. | 6 | "Config validation fails a configuration naming pi without `llm_providers.pi.model` with an error naming `llm_providers.pi.model` as required because pi is configured, as asserted in config.test.ts." | diff-local |
| Story 2 negative: Given pi is configured and `llm_providers.pi.model_escalation_order` or `llm_providers.pi.model_fallback_ladder` is absent or empty, when config loads, then validation fails naming each missing key. | 6 | "Config validation fails a configuration naming pi whose `llm_providers.pi.model_escalation_order` or `llm_providers.pi.model_fallback_ladder` is absent or empty with one error naming each missing key, as asserted in config.test.ts." | diff-local |
| Story 2 negative: Given pi is configured with all three `llm_providers.pi` keys, when every Pi step resolves, then none resolves to `sonnet` or any other built-in Claude or Codex alias. | 8 | "With all three `llm_providers.pi` keys set, no Pi step resolves to `sonnet`, to `FALLBACK_MODEL`, or to any alias in the claude or codex policy, as asserted by a resolved-config.test.ts sweep over every step." | diff-local |
| Story 2 negative: Given pi is not configured anywhere and no `llm_providers.pi` block exists, when config loads, then no `llm_providers.pi` key is required. | 6 | "A configuration that names pi nowhere and has no `llm_providers.pi` block loads with no llm_providers error, as asserted in config.test.ts." | diff-local |
| Story 2 negative: Given a Pi step model `claude-opus-4-5` with no `/`, when config loads, then validation fails with an error naming the config path and the expected `provider/model` form. | 7 | "Config validation fails a Pi step model `claude-opus-4-5` with an error naming the config path and the expected `provider/model` form, as asserted in config.test.ts." | diff-local |
| Story 2 negative: Given a Pi step model `anthropic/` or `/claude-opus-4-5`, when config loads, then validation fails naming the config path and the empty segment. | 7 | "Config validation fails Pi step models `anthropic/` and `/claude-opus-4-5` with errors naming the config path and the empty segment, and fails a whitespace-bearing Pi step model with an error naming the config path, as asserted in config.test.ts." | diff-local |
| Story 2 negative: Given a Pi step model containing whitespace, when config loads, then validation fails naming the config path. | 7 | "Config validation fails Pi step models `anthropic/` and `/claude-opus-4-5` with errors naming the config path and the empty segment, and fails a whitespace-bearing Pi step model with an error naming the config path, as asserted in config.test.ts." | diff-local |
| Story 2 negative: Given a claude step configured with the alias `opus`, when config loads, then no Pi model-id validation applies to it and it loads as before. | 7 | "A claude step configured with alias `opus` and a claude step configured with the Pi-form model `anthropic/claude-opus-4-5` both load with no Pi model-id validation applied and resolve those model strings unchanged, as asserted in config.test.ts." | diff-local |
| Story 3 happy: Given every configured Pi model id, including `llm_providers.pi.model` and every ladder and escalation entry, appears in the `pi --list-models` listing, when a provider-dispatching command boots, then boot continues. | 14 | "When every configured Pi id, including `llm_providers.pi.model` and every escalation and ladder entry, appears in the listing, `validateConfiguredProviderModels` returns without error and boot continues, as asserted in provider-model-probe.test.ts." | diff-local |
| Story 3 happy: Given Pi is installed but pi is not configured anywhere, when a provider-dispatching command boots, then `pi --list-models` is not invoked. | 15 | "With Pi installed but configured nowhere, a provider-dispatching boot never invokes the `--list-models` runner, as asserted by the fake runner call count in provider-model-probe.test.ts." | diff-local |
| Story 3 happy: Given a non-dispatching subcommand such as `render-diagrams` runs with Pi configured, when it starts, then `pi --list-models` is not invoked. | 15 | "A non-dispatching subcommand such as `render-diagrams` with Pi configured never invokes the `--list-models` runner, as asserted through the CLI provider-dispatching guard test." | diff-local |
| Story 3 negative: Given a configured Pi model id whose provider segment is absent from the listing, when a provider-dispatching command boots, then startup fails with an unknown-Pi-provider error naming the id, the config path, and the step. | 14 | "A configured Pi id whose provider segment is absent from the listing makes the boot probe throw the unknown-Pi-provider error naming the id, the config path, and the step, as asserted in provider-model-probe.test.ts." | diff-local |
| Story 3 negative: Given a configured Pi model id whose provider is listed but whose model is not, when a provider-dispatching command boots, then startup fails with an unknown-Pi-model error naming the id, the config path, and the step, worded distinctly from the unknown-provider error. | 14 | "A configured Pi id whose provider is listed but whose model is not makes the boot probe throw the unknown-Pi-model error naming the id, the config path, and the step, with wording distinct from the unknown-provider error, as asserted in provider-model-probe.test.ts." | diff-local |
| Story 3 negative: Given the `pi --list-models` run exceeds its timeout, when boot probes, then startup fails with a message stating that the Pi model listing timed out. | 14 | "A listing run that exceeds its timeout fails boot with a message stating the Pi model listing timed out, and a non-zero exit or a listing with no provider and model header fails boot with a message quoting the unparseable header and never accepts the configured ids, as asserted in provider-model-probe.test.ts." | diff-local |
| Story 3 negative: Given `pi --list-models` exits non-zero or prints no header row with `provider` and `model` columns, when boot probes, then startup fails with a message quoting the unparseable header and never passes the configured ids. | 14 | "A listing run that exceeds its timeout fails boot with a message stating the Pi model listing timed out, and a non-zero exit or a listing with no provider and model header fails boot with a message quoting the unparseable header and never accepts the configured ids, as asserted in provider-model-probe.test.ts." | diff-local |
| Story 3 negative: Given Pi is configured but not installed, when a provider-dispatching command boots, then the existing not-installed error fires and the model probe never runs. | 15 | "With Pi configured but not installed, a provider-dispatching boot fails with the existing not-installed error and the `--list-models` runner is never invoked, as asserted in provider-model-probe.test.ts." | diff-local |
| Story 3 negative: Given the default test suite runs, when any Pi boot path is exercised, then the probe runs through an injected fake runner and no real `pi` process is spawned. | 15 | "Every default-suite boot path that exercises the probe runs it through the injected fake runner and no real `pi` process is spawned, as asserted by a spawn-boundary spy in provider-model-probe.test.ts." | diff-local |
| Story 4 happy: Given `steps.explore` selects pi with `google/gemini-2.5-flash` and `steps.plan` selects pi with `anthropic/claude-opus-4-5`, when both steps dispatch in one run, then each argv carries its own provider and model. | 9 | "With `steps.explore` on pi `google/gemini-2.5-flash` and `steps.plan` on pi `anthropic/claude-opus-4-5`, the two dispatched Pi invocations in one run carry provider `google` model `gemini-2.5-flash` and provider `anthropic` model `claude-opus-4-5` respectively, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 4 happy: Given `steps.plan.by_tier.L` sets a Pi model and effort that differ from `steps.plan`, when a tier L feature runs plan on pi, then the tier L model and effort are used, and a tier M feature uses the base step values. | 9 | "A tier L feature dispatches plan on pi with the `steps.plan.by_tier.L` model and effort while a tier M feature dispatches the base `steps.plan` values, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 4 happy: Given the run-level provider is claude and only `steps.plan` selects pi with a Pi model, when the run executes, then plan dispatches through pi with that model and every other step dispatches through claude with its Claude alias. | 9 | "In a claude run where only `steps.plan` selects pi with a Pi model, plan dispatches through pi with that model and every other step dispatches through claude with its Claude alias, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 4 happy: Given a claude step whose candidate ladder is claude then pi and claude is run-scope unavailable, when the step falls back to pi, then pi dispatches with `llm_providers.pi.model` and the step's effort. | 9 | "When a claude step with candidate list claude then pi falls back after claude is run-scope unavailable, pi is invoked with `llm_providers.pi.model` and the step effort and never with the claude step Claude alias, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 4 negative: Given the run-level provider is claude with a Claude alias in `defaults.model` and `steps.plan` selects pi with no model of its own, when plan dispatches, then pi receives `llm_providers.pi.model` and never the Claude alias. | 9 | "In a claude run with `defaults.model: opus` and `steps.plan` on pi with no model of its own, plan dispatches to pi with `llm_providers.pi.model` and the invocation never carries `opus`, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 4 negative: Given a claude step falls back to pi, when pi dispatches, then pi never receives the claude step's Claude model alias. | 9 | "When a claude step with candidate list claude then pi falls back after claude is run-scope unavailable, pi is invoked with `llm_providers.pi.model` and the step effort and never with the claude step Claude alias, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 4 negative: Given `steps.plan` selects claude but sets a Pi-form model `anthropic/claude-opus-4-5`, when config loads, then it loads unchanged, because non-Pi providers keep their existing opaque model-string handling. | 7 | "A claude step configured with alias `opus` and a claude step configured with the Pi-form model `anthropic/claude-opus-4-5` both load with no Pi model-id validation applied and resolve those model strings unchanged, as asserted in config.test.ts." | diff-local |
| Story 5 happy: Given `llm_providers.pi.model_fallback_ladder` lists `anthropic/claude-opus-4-5` then `openai/gpt-5.6-sol` and the first is reported model-unavailable, when a Pi step invokes, then it re-invokes with `openai/gpt-5.6-sol` and emits a downgrade warning naming the configured model, the actual model, and the reason. | 10 | "When the first Pi ladder rung `anthropic/claude-opus-4-5` is model-unavailable, the Pi step re-invokes with `openai/gpt-5.6-sol` and the downgrade warning names the configured model, the actual model, and the reason, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 5 happy: Given `llm_providers.pi.model_escalation_order` lists a small, a mid, and a large Pi model and a Pi step on the small model fails twice, when attempt 3 dispatches, then it uses the mid model. | 11 | "With `llm_providers.pi.model_escalation_order` of a small, mid, and large Pi model, `escalateAttempt` returns the mid model for a Pi step on the small model at attempt 3, as asserted in escalation.test.ts." | diff-local |
| Story 5 happy: Given the run-level provider is claude with a top-level `model_fallback_ladder` of Claude aliases and `steps.plan` selects pi with a configured Pi ladder, when plan hits model-unavailable, then it walks the Pi ladder and never a Claude alias. | 10 | "In a claude run with a top-level Claude-alias `model_fallback_ladder` and `steps.plan` on pi, a model-unavailable plan step walks the Pi ladder and no invocation passed to pi ever carries a Claude alias, as asserted by `selectFallbackLadder` tests and provider-execution-pi-fallback.test.ts." | diff-local |
| Story 5 negative: Given a Pi step's model is absent from `llm_providers.pi.model_escalation_order` and the step fails twice, when attempt 3 dispatches, then the model is unchanged and only the effort escalates. | 11 | "For a Pi step whose model is absent from `llm_providers.pi.model_escalation_order`, `escalateAttempt` at attempt 3 returns the unchanged model with only the effort escalated, as asserted in escalation.test.ts." | diff-local |
| Story 5 negative: Given the top-level `model_fallback_ladder` lists Claude aliases and a Pi rung is model-unavailable, when the Pi ladder is consulted, then no Claude alias is ever passed to pi. | 10 | "In a claude run with a top-level Claude-alias `model_fallback_ladder` and `steps.plan` on pi, a model-unavailable plan step walks the Pi ladder and no invocation passed to pi ever carries a Claude alias, as asserted by `selectFallbackLadder` tests and provider-execution-pi-fallback.test.ts." | diff-local |
| Story 5 negative: Given a claude run with a codex step and a top-level `model_fallback_ladder`, when the codex step hits model-unavailable, then it walks the top-level ladder exactly as before this change. | 10 | "A codex step in a claude run with a top-level `model_fallback_ladder`, and every step of a claude run with no `llm_providers` block, walk exactly the ladder they walked before this change, and every claude step of a claude run with no `llm_providers` block escalates to the same model and effort per attempt as before, as asserted by `selectFallbackLadder` tests and the unedited existing model-availability, fallback, and escalation tests." | diff-local |
| Story 5 negative: Given `llm_providers.pi.model_fallback_ladder` contains an empty string or a malformed Pi model id, when config loads, then validation fails naming `llm_providers.pi.model_fallback_ladder` and the offending entry. | 7 | "Config validation fails an empty-string entry and a malformed Pi id inside `llm_providers.pi.model_fallback_ladder`, each with an error naming `llm_providers.pi.model_fallback_ladder` and the offending entry, as asserted in config.test.ts." | diff-local |
| Story 5 negative: Given `llm_providers` names a key that is not a catalog provider id, when config loads, then validation fails with the unknown-provider error listing catalog ids. | 5 | "Config validation in config.ts rejects an `llm_providers` key that is not a catalog provider id with the unknown-provider error listing the catalog ids, as asserted in config.test.ts." | diff-local |
| Story 5 negative: Given every rung of the Pi ladder is model-unavailable, when the walk exhausts it, then the last failure returns to the normal retry machinery and the retry budget is not consumed by the downgrades. | 10 | "When every Pi ladder rung is model-unavailable, the walk returns the last failure to the retry machinery and the step retry attempt count is unchanged by the downgrades, as asserted in provider-execution-pi-fallback.test.ts." | diff-local |
| Story 5 negative: Given a claude run with no `llm_providers` block, when steps dispatch and fall back, then the claude ladder and escalation behavior equal the pre-change behavior. | 10 | "A codex step in a claude run with a top-level `model_fallback_ladder`, and every step of a claude run with no `llm_providers` block, walk exactly the ladder they walked before this change, and every claude step of a claude run with no `llm_providers` block escalates to the same model and effort per attempt as before, as asserted by `selectFallbackLadder` tests and the unedited existing model-availability, fallback, and escalation tests." | diff-local |
| Story 6 happy: Given the catalog declares claude, codex, and pi, when `bin/generate-model-table` runs, then the table header has a model column and an effort column for each of the three providers, in catalog order, plus the existing skill, execution-path, and why columns. | 16 | "`renderModelTable` emits a header with a model column and an effort column for each of claude, codex, and pi in catalog order plus the skill, execution-path, and why columns, as asserted in generate-model-table.test.ts." | diff-local |
| Story 6 happy: Given the Pi policy ships no model ids, when the table renders, then every engine-step Pi model cell reads `config-required` and every engine-step Pi effort cell shows the policy's step effort. | 17 | "Every engine-step Pi model cell renders `config-required` and every engine-step Pi effort cell renders the Pi policy step effort, as asserted in generate-model-table.test.ts." | diff-local |
| Story 6 happy: Given an interactive-skill row, when the table renders, then its Pi model and effort cells read `n/a`. | 17 | "Every interactive-skill row renders Pi model and effort cells `n/a`, as asserted in generate-model-table.test.ts." | diff-local |
| Story 6 happy: Given the regenerated table is committed, when `bin/generate-model-table --check` runs, then it exits 0. | 17 | "`bin/generate-model-table --check` exits 0 on the committed ARCHITECTURE.md with Pi columns, and exits non-zero with a diff showing the missing Pi columns against a table lacking them, as asserted in generate-model-table.test.ts." | diff-local |
| Story 6 negative: Given the regenerated table, when the claude and codex model and effort cells are compared with the pre-change table, then every value is identical except that a pre-change blank Claude effort cell on an interactive row now reads `n/a`. | 16 | "Every claude and codex model and effort cell of the rendered table is identical to the pre-change rendering except that pre-change blank Claude effort cells on interactive rows read n/a, as asserted by a generate-model-table.test.ts comparison against the pre-change expected cells." | diff-local |
| Story 6 negative: Given the committed table lacks the Pi columns, when `bin/generate-model-table --check` runs, then it exits non-zero with a diff showing the missing columns. | 17 | "`bin/generate-model-table --check` exits 0 on the committed ARCHITECTURE.md with Pi columns, and exits non-zero with a diff showing the missing Pi columns against a table lacking them, as asserted in generate-model-table.test.ts." | diff-local |
| Story 6 negative: Given a catalog provider whose policy is added to the catalog, when the table renders, then its columns appear without any edit to the generator. | 16 | "`buildEngineRows` derives provider columns from the catalog, so a test catalog with an added provider renders its columns without any generator edit, as asserted in generate-model-table.test.ts." | diff-local |
| Story 6 negative: Given a generated row with a blank cell for any catalog provider, when the completeness checks run, then they fail naming the row, while `config-required` and `n/a` pass as explicit sentinels. | 17 | "The completeness check fails a generated row with a blank cell for any catalog provider naming the row, and accepts `config-required` and `n/a` as explicit sentinels, as asserted in model-table-metadata.test.ts." | diff-local |
| Story 7 happy: Given Pi exits 0 and its terminal assistant message has `stopReason: "error"` and `errorMessage: "No API key for provider: cline"`, when the adapter parses the stream, then the invocation result is a failure whose error text contains `No API key for provider: cline`. | 4 | "For the captured exit-0 fixture with `stopReason: "error"`, the Pi adapter returns a failed invocation whose error text contains `No API key for provider: cline` and whose `authFailure`, `rateLimited`, and `modelUnavailable` flags are all unset, so the step fails as an ordinary step failure, as asserted in pi-provider.test.ts." | diff-local |
| Story 7 happy: Given Pi exits 0 and its terminal assistant message has a normal stop reason with text content, when the adapter parses the stream, then the invocation succeeds with that text as output, as before. | 4 | "The existing success-stream fixture with a normal stop reason still returns a successful invocation whose output is the terminal message text, with that test unchanged." | diff-local |
| Story 7 negative: Given Pi exits 0 with `stopReason: "error"`, when the result is classified, then it sets none of `authFailure`, `rateLimited`, or `modelUnavailable`, and the step fails as an ordinary step failure. | 4 | "For the captured exit-0 fixture with `stopReason: "error"`, the Pi adapter returns a failed invocation whose error text contains `No API key for provider: cline` and whose `authFailure`, `rateLimited`, and `modelUnavailable` flags are all unset, so the step fails as an ordinary step failure, as asserted in pi-provider.test.ts." | diff-local |
| Story 7 negative: Given Pi exits 0 with `stopReason: "error"` and no `errorMessage`, when the adapter parses the stream, then the invocation fails with a message stating that Pi reported an error stop with no message. | 4 | "For an exit-0 error-stop stream with no `errorMessage`, the adapter returns a failed invocation whose error text is `Pi reported an error stop with no message`, as asserted in pi-provider.test.ts." | diff-local |
| Story 7 negative: Given a Pi stream whose last line is malformed JSON after an error-stop message, when the adapter parses it, then the error-stop message still determines a failed result. | 4 | "For an error-stop message followed by a malformed JSON last line, the adapter still returns a failed invocation carrying the error message, as asserted in pi-provider.test.ts." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D1 | task | task-2 | The pi catalog descriptor exposes `parseModelId` and the claude and codex descriptors declare none, as asserted in provider-catalog.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D2 | existing | none | Capability flags in execution/provider-catalog.ts are unchanged; this feature adds no capability flag (D12). |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D3 | existing | none | engine/provider-discovery.ts discoverInstalledProviders already runs in both boot paths; the model probe consumes its installed set unchanged. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D4 | task | task-15 | With Pi configured but not installed, a provider-dispatching boot fails with the existing not-installed error and the `--list-models` runner is never invoked, as asserted in provider-model-probe.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D5 | existing | none | The Pi adapter one-shot dispatch, JSONL parsing and failure precedence in execution/pi-provider.ts are unchanged except the D12 argv and D14 error stop. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D6 | task | task-1 | The `PI_MODEL_POLICY` in provider-catalog.ts declares `requiresConfiguredModels: true` with empty `modelEscalationOrder` and `modelFallbackLadder` and no non-empty `stepModels` entry, as asserted in provider-catalog.test.ts, which no longer asserts a single empty rung. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D7 | existing | none | engine/live-e2e-providers.ts keeps its catalog-keyed Pi entry; this feature adds no live leg. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D8 | task | task-15 | A non-dispatching subcommand such as `render-diagrams` with Pi configured never invokes the `--list-models` runner, as asserted through the CLI provider-dispatching guard test. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D9 | existing | none | The #1007 interactiveLaunch capability and compose launcher argv are untouched; no task edits the launcher. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D10 | existing | none | Launcher host selection for compose is untouched; Pi still does not declare interactiveLaunch. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D11 | existing | none | The compose launcher keeps its non-probing rule; the Pi boot probe runs only on provider-dispatching entry points. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D12 | task | task-3 | For model `cline/google/gemma-4-31b-it:free`, the spawned argv contains `--provider cline --model google/gemma-4-31b-it:free` with the model part byte-identical, no `:`-suffixed thinking value appended to `--model`, and exactly one `--thinking` flag, as asserted in pi-provider.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D13 | task | task-6, task-14 | A configured Pi id whose provider is listed but whose model is not makes the boot probe throw the unknown-Pi-model error naming the id, the config path, and the step, with wording distinct from the unknown-provider error, as asserted in provider-model-probe.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D14 | task | task-4 | For the captured exit-0 fixture with `stopReason: "error"`, the Pi adapter returns a failed invocation whose error text contains `No API key for provider: cline` and whose `authFailure`, `rateLimited`, and `modelUnavailable` flags are all unset, so the step fails as an ordinary step failure, as asserted in pi-provider.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D15 | no-change | none | Out of scope here: the Pi extension engine asset is owned by the Pi containment feature (spec #2858); this feature does not touch it. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D16 | no-change | none | Out of scope here: Pi nativeSchema support is owned by the Pi containment feature (spec #2858); this feature does not touch it. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D17 | no-change | none | Out of scope here: Pi readOnlyReview support is owned by the Pi containment feature (spec #2858); this feature does not touch it. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D18 | no-change | none | Out of scope here: the unattended Pi `-na` flag is owned by the Pi containment feature (spec #2858); this feature does not touch it. |
| adr-2026-07-03-reactive-model-fallback-ladder#D1 | existing | none | InvokeResult.modelUnavailable detection is unchanged; the Pi adapter keeps its anchored model-unavailable signature. |
| adr-2026-07-03-reactive-model-fallback-ladder#D2 | task | task-10 | A codex step in a claude run with a top-level `model_fallback_ladder`, and every step of a claude run with no `llm_providers` block, walk exactly the ladder they walked before this change, and every claude step of a claude run with no `llm_providers` block escalates to the same model and effort per attempt as before, as asserted by `selectFallbackLadder` tests and the unedited existing model-availability, fallback, and escalation tests. |
| adr-2026-07-03-reactive-model-fallback-ladder#D3 | task | task-10 | When every Pi ladder rung is model-unavailable, the walk returns the last failure to the retry machinery and the step retry attempt count is unchanged by the downgrades, as asserted in provider-execution-pi-fallback.test.ts. |
| adr-2026-07-03-reactive-model-fallback-ladder#D4 | existing | none | The single pre-invoke cache consult in engine/model-availability.ts invokeWithLadderResolved is unchanged. |
| adr-2026-07-03-reactive-model-fallback-ladder#D5 | task | task-10 | When the first Pi ladder rung `anthropic/claude-opus-4-5` is model-unavailable, the Pi step re-invokes with `openai/gpt-5.6-sol` and the downgrade warning names the configured model, the actual model, and the reason, as asserted in provider-execution-pi-fallback.test.ts. |
| adr-2026-07-03-reactive-model-fallback-ladder#D6 | existing | none | The ModelAvailability dead-model cache keeps process lifetime. |
| adr-2026-07-03-reactive-model-fallback-ladder#D7 | task | task-10, task-11 | In a claude run with a top-level Claude-alias `model_fallback_ladder` and `steps.plan` on pi, a model-unavailable plan step walks the Pi ladder and no invocation passed to pi ever carries a Claude alias, as asserted by `selectFallbackLadder` tests and provider-execution-pi-fallback.test.ts. |
| adr-2026-07-03-reactive-model-fallback-ladder#D8 | task | task-12 | For a completed Pi step, the `provider_attempt` and `step_completed` events carry provider `pi`, model `anthropic/claude-opus-4-5` as the full id, and the effort, as asserted in provider-execution-pi-fallback.test.ts. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-ab4-1: src/conductor/src/engine/conductor.ts:7928 — resolve the serial step's model/effort with resolvePreferredProviderNativeStepConfig (resolved-config.ts:315) for the step's preferred provider (normalizeProviderSelection of steps.<s>.llm_provider, inheritedProvider = first run-level llm_provider) instead of resolveStepConfig, keeping resolveStepConfig for the provider-neutral knobs (disable, max_retries, escalate, review), so a Pi step that does not inherit the run provider never receives defaults.model and esc/escNext (:10208, :11275, :12106) derive from that one value; add a provider-execution-pi-fallback.test.ts case driving Conductor serial dispatch with defaults.model: opus and steps.plan on pi with no model, asserting the Pi invocation carries llm_providers.pi.model and never opus, and keep Task 9's existing claude-run assertions unchanged
**Gate:** as-built
**Rationale:** conductor.ts:7928-7937 resolves the serial step with resolveStepConfig(step, phase, stepModelPolicy, this.config) so defaults.model (opus) leaks into a non-inherited Pi step, and conductor.ts:10208 escalates it and forwards esc.model as modelOverride (:10423/:10460), which resolveProviderCandidateNativeConfig (provider-execution.ts:520) treats as a CLI override; plan Task 9 (Files conductor.ts, Done-when bullet 4) admits the fix, the approved architecture (catalog ADR D13) stays authoritative, so this is conforming implementation drift routed build. Siblings swept: escNext at conductor.ts:11275 and :12106 read the same `resolved`, so one source fixes all three.
**Parent task:** 9
**Governing clause:** Task 9
**Done when:**
- Task 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab4-1 is complete.

### Task rem-as-built-rem-ab5-1: src/conductor/src/engine/step-runners.ts:4655 — compute the coverage_binding auxiliary provider selection first, then derive model/effort from resolvePreferredProviderNativeStepConfig using that provider's runtime policy (this.providerRuntimes.get(provider).policy, else resolveProviderModelPolicy(provider, { config })) and model_fallback_ladder from selectFallbackLadder(policy, provider, config), replacing resolvedConfigFor('coverage_binding').model/effort and this.modelPolicy.modelFallbackLadder; keep max_retries/escalate from the resolved step config; add a step-runner test where steps.coverage_binding.llm_provider is pi in a claude run with defaults.model opus asserting the auxiliary dispatch carries llm_providers.pi.model and llm_providers.pi.model_fallback_ladder, and an unchanged-behaviour case for a claude coverage_binding
**Gate:** as-built
**Rationale:** step-runners.ts:4655-4663 builds the coverage_binding auxiliaryPolicy from this.resolvedConfigFor('coverage_binding') (run-level runner policy) and this.modelPolicy.modelFallbackLadder while selecting llm_provider independently, so a Pi judge gets a Claude model and ladder; plan Tasks 9/10 (Files step-runners.ts) admit it and catalog ADR D13 is unchanged, so build. Siblings checked: the build_review rubric aux callers (step-runners.ts:3188, :3940) take their policy from the resolved-config rubric resolver already fixed by rem-rb-1; no other this.modelPolicy.modelFallbackLadder use remains.
**Governing clause:** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13
**Done when:**
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab5-1 is complete.

### Task rem-as-built-rem-ab6-1: src/conductor/src/engine/model-availability.ts invokeWithLadderResolved — consult this.effectiveModel(requested) before the first invoke so a model already marked dead is substituted with the next live rung (with its downgrade warning), mirroring the step-runners.ts:1400 exhaustion semantics when no live rung remains; and src/conductor/src/engine/provider-execution.ts:614 — stop constructing a cache-less ModelAvailability per invocation: share the runtime's process dead set (e.g. a ModelAvailability constructor parameter accepting runtime.availability.dead) so explicit-ladder and runtime-ladder invocations read and mark one cache; add model-availability.test.ts and provider-execution-pi-fallback.test.ts cases where a Pi rung marked dead by an earlier invocation is never invoked again on the next dispatch, keeping the existing Task 10 walk/exhaustion tests unedited
**Gate:** as-built
**Rationale:** ModelAvailability.invokeWithLadderResolved (model-availability.ts:~125) invokes options.model before calling effectiveModel(), and invokeProviderCandidate (provider-execution.ts:614) builds a fresh ModelAvailability per invocation when a ladder is supplied, so the process dead-model cache is never consulted pre-invoke on the provider-aware path, contrary to fallback-ladder ADR D4; the legacy path already consults it (step-runners.ts:1400), so the approved design is clear and plan Task 10 (Files model-availability.ts) admits it — build. Task 10 Done-when (rung-1 downgrade warning, all-rungs-unavailable returns last failure with unchanged retry count, claude/codex ladders unchanged) must survive.
**Governing clause:** adr-2026-07-03-reactive-model-fallback-ladder decision 4
**Done when:**
- adr-2026-07-03-reactive-model-fallback-ladder decision 4 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab6-1 is complete.

### Task rem-as-built-rem-ab7-1: src/conductor/src/engine/resolved-config.ts:315 resolvePreferredProviderNativeStepConfig — accept attempt and escalate and, when options carry no modelCliOverride/effortCliOverride, return escalateAttempt(base.model, base.effort, attempt, escalate, policy) (the same rule resolveFallbackProviderNativeStepConfig applies at :357); src/conductor/src/engine/provider-execution.ts:520 — pass attempt and escalate into the preferred branch of resolveProviderCandidateNativeConfig; serial dispatch keeps passing its already-escalated esc.model/esc.effort overrides so it is not escalated twice; add escalation.test.ts / provider-execution-pi-fallback.test.ts cases where a preferred Pi group member with llm_providers.pi.model_escalation_order small, mid, large dispatches the mid model at attempt 3 and a model absent from the order escalates effort only, and keep the existing claude escalation tests unedited (Task 10 Done-when bullet 4)
**Gate:** as-built
**Rationale:** group-core.ts:674/713 passes attempt and escalate to stepRunner.run without a modelOverride, and resolveProviderCandidateNativeConfig (provider-execution.ts:520-529) sends candidate 0 to resolvePreferredProviderNativeStepConfig (resolved-config.ts:315), which takes no attempt/escalate, so a preferred Pi validation-group member never escalates while the fallback resolver (resolved-config.ts:357-370) does; plan Task 11 (Files resolved-config.ts, Done-when mid model at attempt 3) admits it and Task 12 lists provider-execution.ts — build. The serial path already passes escalated overrides, so escalation must apply only when no override is supplied to avoid double escalation.
**Parent task:** 11
**Governing clause:** Task 11
**Done when:**
- Task 11 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab7-1 is complete.

### Task rem-as-built-rem-ab8-1: src/conductor/src/engine/provider-execution.ts:915 — pass the candidate's own ladder into invokeProviderCandidate: the caller-supplied modelFallbackLadder for the preferred candidate (index 0) and resolved.modelFallbackLadder from resolveFallbackProviderNativeStepConfig for every fallback candidate, so ResolvedFallbackProviderNativeConfig.modelFallbackLadder has a production consumer and a fallback Pi candidate never walks an auxiliary member's Claude ladder; widen resolveProviderCandidateNativeConfig's return so the ladder reaches that call; add a provider-execution-pi-fallback.test.ts case where an auxiliary member with a Claude-alias model_fallback_ladder falls back from claude to pi and every Pi rung invoked comes from llm_providers.pi.model_fallback_ladder
**Gate:** as-built
**Rationale:** ResolvedFallbackProviderNativeConfig.modelFallbackLadder (resolved-config.ts:200, set at :372) has no production consumer: invokeProviderCandidate (provider-execution.ts:915) receives only the caller's step-level modelFallbackLadder, so an auxiliary member's explicit ladder (executeAuxiliaryProviderCandidates, provider-execution.ts:1242) is applied to a fallback Pi candidate as well; consuming the field (not removing it) fixes that and is admitted by plan Task 10 (Files resolved-config.ts, Done-when Pi never walks a Claude ladder) — build. Diagram drift notes are non-blocking and their refresh is a DECIDE-owned architecture artifact edit, so they are excluded here.
**Parent task:** 10
**Governing clause:** Task 10
**Done when:**
- Task 10 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab8-1 is complete.

### Task rem-prd-audit-rem-s44-1: src/conductor/src/engine/resolved-config.ts:359 resolveFallbackProviderNativeStepConfig — when policy.requiresConfiguredModels, seed the base effort from the step's authored effort (steps.<step>.by_tier.<tier>.effort, then steps.<step>.effort) before escalateAttempt, keeping model resolution on config undefined so no Claude alias crosses; leave claude/codex fallback candidates unchanged; strengthen src/conductor/test/engine/provider-execution-pi-fallback.test.ts:292 to author steps.plan.effort max (differing from the plan policy effort) and assert the Pi fallback invocation carries llm_providers.pi.model with effort max and never opus, keeping the existing Task 9 assertions
**Gate:** prd-audit
**Rationale:** resolved-config.ts:368-374 resolveFallbackProviderNativeStepConfig passes config undefined, so a claude->pi fallback gets PI_MODEL_POLICY.stepEfforts instead of the authored steps.<step>.effort, and provider-execution-pi-fallback.test.ts:292 uses effort high (equal to the policy default) so it cannot tell the sources apart; plan Task 9 Done-when bullet 5 ('pi is invoked with llm_providers.pi.model and the step effort') admits the repair. Model isolation (adr-2026-07-24 section 3) is preserved because only the provider-neutral effort crosses. Sibling excluded: claude->codex fallback effort also ignores the step effort, but no plan task admits changing codex fallback behavior and Task 12 requires codex argv byte-identical, so the fix is scoped to requiresConfiguredModels policies.
**Criterion:** S4.4
**Parent task:** 9
**Done when:**
- S4.4 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s44-1 is complete.

### Task rem-as-built-rem-ar11-1: src/conductor/src/engine/attribution-lane.ts dispatchAttributionVerifier — remove the legacy scalar-provider branch (the ModelAvailability ladder walk used when providerDispatch is absent) and make providerDispatch required, since every production DefaultStepRunner root supplies it (step-runners.ts:2471); drop the now-unused modelPolicy/providerKey/attemptedModels plumbing; migrate attribution-lane.test.ts and the other suites that exercise the scalar path to a recording providerDispatch, keeping their behavioral assertions
**Gate:** architecture_review_as_built
**Rationale:** Operator decision 2026-10-01 on AR-ASBUILT-11 (DESIGN): Task 10 changed the scalar attribution ladder at attribution-lane.ts:357, but that branch has no production caller. The operator chose removing the legacy branch and its Task 10 obligation over establishing a sanctioned production root.
**Parent task:** 10
**Done when:**
- dispatchAttributionVerifier has no code path that invokes a provider without providerDispatch, and its options type marks providerDispatch required.
- Re-run architecture_review_as_built and confirm AR-ASBUILT-11 is resolved.

### Task rem-as-built-rem-as-built-rem-ar12-1: src/conductor/src/engine/provider-execution.ts:1201-1225 executeProviderCandidates — in the all-candidates-exhausted failure return, add actualProvider, resolvedModel (invokedModel ?? resolved.model) and resolvedEffort from the last candidate that was actually invoked (track them alongside anyCandidateInvoked; omit when no candidate invoked), mirroring the success return at :1164-1170 so step-runners.ts:1880 stamps the full Pi provider/model id on step_retry; add a provider-execution-pi-fallback.test.ts case where every llm_providers.pi.model_fallback_ladder rung is unavailable and assert the returned result and the resulting step_retry event carry provider pi, the full provider/model id of the last invoked rung and its effort, keeping Task 12's existing success-path and claude/codex argv assertions unedited
**Gate:** as-built
**Rationale:** provider-execution.ts:1201-1225 (the !nextProvider exhausted return in executeProviderCandidates) omits actualProvider/resolvedModel/resolvedEffort, while the success return at :1164-1170 carries them and step-runners.ts:1880 derives the step_retry model from result.resolvedModel, so an exhausted Pi ladder emits step_retry without the full provider/model id; this is conforming implementation drift against adr-2026-07-03-reactive-model-fallback-ladder D8 that Task 12 (Files provider-execution.ts, provider-execution-pi-fallback.test.ts; Done-when bullet 2: a Pi step_retry carries the full id) already admits, so no architecture decision is needed. Sibling swept: the spawnPermit-denied early return at :1190-1196 is setup-unavailable (no process, no model invoked) and is deliberately excluded; the change is additive and keeps Task 12's existing success-path and claude/codex argv assertions unchanged.
**Governing clause:** adr-2026-07-03-reactive-model-fallback-ladder decision 8
**Done when:**
- adr-2026-07-03-reactive-model-fallback-ladder decision 8 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-as-built-rem-ar12-1 is complete.

### Task rem-as-built-rem-as-built-rem-ar13-1: src/conductor/src/engine/provider-selection.ts:60-130 — introduce one shared enumerator of (selection, configPath) pairs covering llm_provider, steps.<s>.llm_provider, build_review.rubrics.<id>.llm_provider and build_review.custom_rubrics.<id>.llm_provider (the same rubric paths provider-model-config.ts:76-90 marks configured), and drive both validateProviderInstallation and validateRegisteredProviderSelections from it so neither list can drift; add provider-selection.test.ts cases where Pi is selected only by a build_review rubric and by a custom rubric with discovery reporting Pi missing (throws ProviderNotInstalledError naming the rubric configPath) and with Pi unregistered (registered-provider error), plus a provider-model-probe.test.ts case that this rubric-only Pi-missing boot fails before the --list-models fake runner is invoked; keep Task 15's existing run-level/steps assertions unedited
**Gate:** as-built
**Rationale:** provider-model-config.ts:76-90 marks Pi configured from build_review.rubrics.<id>.llm_provider and build_review.custom_rubrics.<id>.llm_provider, but validateProviderInstallation and validateRegisteredProviderSelections (provider-selection.ts:60-130) walk only llm_provider and steps.*.llm_provider, so a rubric-only Pi selection with Pi missing skips the not-installed error required by adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D13; Task 15 Done-when bullet 3 (Pi configured but not installed fails with the existing not-installed error, never invoking --list-models) admits the repair and the approved architecture stays authoritative, so this is build, not architecture_review. The two validators are a matched pair with the collector's enumeration, so the fix derives both from one shared (selection, configPath) enumerator; both production callers (index.ts:536/542 and daemon-cli.ts:1206/1215) consume the shared validators and are covered without edits.
**Governing clause:** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13
**Done when:**
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-as-built-rem-ar13-1 is complete.
