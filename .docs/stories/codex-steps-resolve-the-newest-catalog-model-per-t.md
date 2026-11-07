**Status:** Accepted

# Stories: Codex steps resolve the newest catalog model per tier

Technical track (no PRD). Acceptance criteria derive from the track scope boundary and
`adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog` D1–D8. "The full listing" below means
a `codex debug models` result listing `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`,
`gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`, each with `visibility` `list` and
`supported_in_api` true, plus `gpt-6-chat-thinking` (`hide`, not API-supported), `gpt-reserve`
(`hide`), and `codex-auto-review` (`hide`).

## Story 1: Codex floors upgrade to the newest listed model of the same tier

**Requirement:** ADR D1, D2, D3, D5

As a harness operator, I want each Codex step to run the newest model of its tier that my Codex CLI lists, so that daemon work does not lag the CLI behind a pinned version.

### Acceptance Criteria

#### Happy Path
- Given Codex is installed and the probe returns the full listing, when a provider-dispatching process boots and resolves the Codex `build_review` step with no operator Codex model configuration, then the resolved model is `gpt-6.1-sol`.
- Given the full listing, when the Codex `memory` step (floor `gpt-5.6-luna`) is resolved in that process, then the resolved model is `gpt-6-luna`.
- Given the full listing, when the Codex `build` step (floor `gpt-5.6-terra`) is resolved in that process, then the resolved model is `gpt-5.6-terra`, because no newer terra is listed and no other tier is substituted.

#### Negative Paths
- Given the full listing plus `gpt-7-sol` with `visibility` `hide`, and `gpt-7.1-sol` with `supported_in_api` false, when `build_review` is resolved, then the resolved model is `gpt-6.1-sol`.
- Given a listing whose only sol entries are `gpt-5.4-sol` and `gpt-5.6-sol`, when `build_review` is resolved, then the resolved model is `gpt-5.6-sol`, never a version below its floor.
- Given a listing whose sol entries are `gpt-6.9-sol` and `gpt-6.10-sol`, when `build_review` is resolved, then the resolved model is `gpt-6.10-sol`, because versions compare numerically per segment.
- Given the full listing, when every Codex step default and tier override is resolved, then none resolves to `gpt-6-chat-thinking`, `gpt-reserve`, or `codex-auto-review`.
- Given the full listing and an operator config setting `llm_providers.codex.model` to `gpt-5.6-sol`, when `build_review` is resolved, then the resolved model is exactly `gpt-5.6-sol`.
- Given the full listing and a step-level config `model: gpt-5.6-terra` with `llm_provider: codex` on `build_review`, when that step is resolved, then the resolved model is exactly `gpt-5.6-terra`.

### Done When
- [ ] A resolution test over the full listing asserts `build_review` → `gpt-6.1-sol`, `memory` → `gpt-6-luna`, and `build` → `gpt-5.6-terra`.
- [ ] Resolver tests cover hidden and non-API entries, below-floor versions, numeric segment ordering (`6.10` over `6.9`), and non-tiered slugs, each with its expected id.
- [ ] Config-precedence tests prove run-level and step-level operator Codex ids are dispatched verbatim when a listing would upgrade them.

## Story 2: A failed catalog probe keeps the floors and never fails boot

**Requirement:** ADR D2, D4

As a harness operator, I want boot to continue on today's Codex models when the CLI catalog cannot be read, so that a CLI change never takes the daemon down.

### Acceptance Criteria

#### Happy Path
- Given Codex is installed and the probe runner never answers within 5 seconds, when a provider-dispatching process boots, then boot completes, `build_review` resolves to `gpt-5.6-sol`, and exactly one warning line names the Codex tier catalog as unavailable with the reason `timeout`.
- Given Codex is installed, when a dispatching process resolves several Codex steps, then the probe runner is invoked exactly once in that process.

#### Negative Paths
- Given the probe exits with code 2, when boot runs, then boot completes, every Codex step resolves to its floor id, and the warning names exit code 2.
- Given the probe exits 0 with stdout `not json`, when boot runs, then boot completes, every Codex step resolves to its floor id, and the warning names the listing as unparseable and quotes `not json`.
- Given the probe exits 0 with JSON lacking a `models` array, when boot runs, then every Codex step resolves to its floor id and the warning names the listing as unparseable.
- Given provider discovery reports Codex as not installed, when a dispatching process boots, then the probe runner is never invoked and no tier-catalog warning is written.

### Done When
- [ ] Boot tests with a fake runner cover timeout, non-zero exit, non-JSON stdout, and JSON without `models`, each asserting boot succeeds, floor ids resolve, and the exact warning text.
- [ ] A test asserts the fake runner's call count is 1 across multiple Codex resolutions in one process and 0 when Codex is not installed.
- [ ] The production runner reaches the injected process boundary through the `assertRealExecAllowed` guard, asserted with a mocked boundary.

## Story 3: Escalation and fallback walk resolved ids, with astra as the top escalation rung

**Requirement:** ADR D1, D5

As a harness operator, I want retries to escalate through the resolved Codex models up to astra, and model-unavailable fallback to step down through the resolved models, so that both ladders track the catalog.

### Acceptance Criteria

#### Happy Path
- Given the full listing and a Codex step whose base floor is `gpt-5.6-terra` with escalation enabled and `max_retries` 5, when attempts 3, 4, and 5 dispatch, then their models are `gpt-6.1-sol`, `gpt-6-astra`, and `gpt-6-astra`.
- Given a failed probe and a Codex step whose base floor is `gpt-5.6-sol` with escalation enabled, when attempt 3 dispatches, then its model is `gpt-6-astra`.
- Given the full listing and a Codex `build_review` dispatch on `gpt-6.1-sol` that reports `modelUnavailable`, when the fallback ladder walks, then the next model invoked is `gpt-5.6-terra` and the downgrade warning names `gpt-6.1-sol` and `gpt-5.6-terra`.

#### Negative Paths
- Given the full listing and every resolved fallback rung reporting `modelUnavailable`, when the ladder is exhausted, then the models invoked are `gpt-6.1-sol`, `gpt-5.6-terra`, and `gpt-6-luna` in that order, `gpt-6-astra` is never invoked, and the last failure returns to the normal retry path.
- Given Claude is selected with `max_retries` 5, when escalation runs attempts 1 through 5 from base `haiku`, then the models are `haiku`, `haiku`, `sonnet`, `opus`, `fable` and no Codex id appears.
- Given the full listing and `llm_providers.codex.model_escalation_order` configured as `gpt-5.6-luna, gpt-5.6-sol`, when a Codex step at base `gpt-5.6-luna` reaches attempt 3, then its model is exactly `gpt-5.6-sol`.
- Given the full listing and `llm_providers.codex.model_fallback_ladder` configured as `gpt-5.6-sol, gpt-5.6-luna`, when `gpt-5.6-sol` reports `modelUnavailable`, then the next model invoked is exactly `gpt-5.6-luna`.

### Done When
- [ ] Escalation tests assert attempt-indexed Codex models over the full listing and over a failed probe, including the astra cap.
- [ ] Fallback tests assert the resolved walk order, astra's absence from it, exhaustion handling, and the downgrade warning's two model names.
- [ ] Tests prove configured Codex escalation and fallback lists are walked verbatim and Claude escalation is unchanged.

## Story 4: Dispatch and cost events record the resolved model

**Requirement:** ADR D6

As a harness operator, I want existing dispatch and cost events to name the model that actually ran, so that telemetry shows which Codex release did the work.

### Acceptance Criteria

#### Happy Path
- Given the full listing, when `build_review` dispatches on Codex and completes, then the `provider_attempt` and `step_completed` events for that step carry model `gpt-6.1-sol`, and the `feature_cost_snapshot` `byDimension` entry for `build_review` carries model `gpt-6.1-sol`.

#### Negative Paths
- Given a failed probe, when `build_review` dispatches on Codex and completes, then the same three event fields carry `gpt-5.6-sol`.
- Given the full listing, when a dispatching process boots and runs one Codex step, then every event `type` written to `.pipeline/events.jsonl` is one that existed in the `ConductorEvent` union before this change, and resolution writes no file under `.pipeline/` or `.ai-conductor/`.

### Done When
- [ ] An event-level test asserts the persisted `provider_attempt`, `step_completed`, and `feature_cost_snapshot` model fields equal the resolved id, and equal the floor after a failed probe.
- [ ] A test asserts the persisted event types for a resolving run are a subset of the pre-change union and that resolution creates no file.

## Story 5: Resolved models missing from the rate card are warned once

**Requirement:** ADR D7

As a harness operator, I want to be told once which newly resolved Codex models the rate card cannot price, with the command that fixes it, so that unmetered cost is visible and fixable.

### Acceptance Criteria

#### Happy Path
- Given the full listing and a committed rate card that prices `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra` only, when a dispatching process boots, then exactly one warning names `gpt-6.1-sol` with `ai-conductor rate-card refresh --model gpt-6.1-sol` and exactly one names `gpt-6-luna` with `ai-conductor rate-card refresh --model gpt-6-luna`.

#### Negative Paths
- Given the same boot, when the warnings are read, then none names `gpt-5.6-terra` or `gpt-6-astra`, whose resolved ids equal their priced floors.
- Given a committed rate card that also prices `gpt-6.1-sol` and `gpt-6-luna`, when a dispatching process boots with the full listing, then no unpriced-model warning is written.
- Given a failed probe, when a dispatching process boots, then no unpriced-model warning is written.
- Given the full listing and an unpriced `gpt-6.1-sol`, when two Codex steps dispatch on it and complete, then the unpriced warning for it still appears exactly once, and the feature cost rollup's `costUnmeteredDispatches` counts both dispatches.

### Done When
- [ ] A boot test asserts the exact warning lines for unpriced resolved ids and their absence for priced and unchanged ids.
- [ ] A cost-rollup test asserts dispatches on an unpriced resolved id increment `costUnmeteredDispatches` and are not priced at zero.

## Story 6: Readers that never probe keep the floor ids

**Requirement:** ADR D4, D5

As a harness operator, I want commands that do not dispatch providers to stay on the pinned floors without running Codex, so that they stay fast, offline-safe, and unchanged.

### Acceptance Criteria

#### Happy Path
- Given `ai-conductor rate-card refresh` runs with a fake fetch, when it builds its wanted model list, then the Codex probe runner is never invoked and the list contains `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra`.

#### Negative Paths
- Given no monitor settings and build selection `codex`, when the monitor opens a guided session, then Codex is launched with `--model gpt-5.6-sol` and the probe runner is never invoked.
- Given the model-table generator runs, when its Codex cells are rendered, then every Codex model value is a `gpt-5.6-*` floor and the probe runner is never invoked.

### Done When
- [ ] Tests assert the probe runner's call count is 0 for `rate-card refresh`, monitor launch, and model-table generation, with the floor ids each produces.

## Story 7: The self-host liveness probe uses the version-free haiku alias

**Requirement:** ADR D8

As a harness operator, I want the self-host token-liveness probe to name a model alias rather than a dated model id, so that it keeps working after that model is retired.

### Acceptance Criteria

#### Happy Path
- Given a self-host token-liveness check runs, when its Claude argv is built, then it contains `--model` followed by `haiku`.

#### Negative Paths
- Given the same check, when its argv is inspected, then it contains no `claude-haiku-4-5-20251001` and no other element matching `claude-` followed by a dated model id.

### Done When
- [ ] A test with a mocked process boundary asserts the liveness argv's `--model` value is `haiku` and that no argv element matches a dated `claude-` model id.
