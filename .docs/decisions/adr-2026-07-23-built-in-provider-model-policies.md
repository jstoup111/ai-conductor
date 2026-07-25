# ADR: Built-in provider model policies

**Date:** 2026-07-23
**Status:** SUPERSEDED
**Superseded by:** adr-2026-07-23-provider-policies-with-deeper-discovery-effort
**Deciders:** James Stoup (operator, approved 2026-07-23), architecture review for issue #902

## Context

The conductor selects an `LLMProvider` by the configured `llm_provider` registry
key, but then discards that key. Model and effort resolution, retry escalation,
model-unavailability fallback, and generated documentation all read global
Claude-native tables:

- `resolved-config.ts` defaults steps to `haiku`, `sonnet`, `opus`, or `fable`.
- `escalation.ts` climbs the same Claude alias order.
- `model-availability.ts` falls back through Claude aliases.
- `generate-model-table.ts` renders those tables as if they were provider-neutral.

That makes the built-in Codex provider structurally capable of receiving invalid
Claude aliases unless every step is manually overridden.

The public model string is already opaque, and the current public effort vocabulary
is `low | medium | high | xhigh | max`. Current GPT-5.6 models support those effort
levels. OpenAI describes:

- [`gpt-5.6-sol`](https://developers.openai.com/api/docs/models/gpt-5.6-sol) as
  the frontier model for complex professional work.
- [`gpt-5.6-terra`](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
  as the balance of intelligence and cost.
- [`gpt-5.6-luna`](https://developers.openai.com/api/docs/models) as the
  cost-sensitive, high-volume model.

The scope is deliberately limited to the built-in Claude and Codex providers.
Plugin-defined policy contracts, logical provider-neutral capability tiers, public
configuration-schema changes, and migration of explicit user overrides are deferred.

## Options Considered

### Option A: Internal built-in provider policy registry

Create an internal `ProviderModelPolicy` registry keyed by the selected provider
name. Each policy owns explicit per-step model and effort defaults, provider-native
tier overrides, escalation ordering, and the default unavailability ladder.

- **Pros:** One provider boundary serves all four consumers; provider behavior is
  deterministic and testable; Claude compatibility can be asserted against the
  current tables; a later plugin-policy contract has a clear insertion seam.
- **Cons:** The selected policy must be threaded through all resolver and invocation
  paths; per-provider tables add intentional duplication.

### Option B: Provider-indexed constants at each current call site

Add `claude` and `codex` branches independently in resolution, escalation, fallback,
and documentation.

- **Pros:** Small local edits; no new abstraction.
- **Cons:** Provider knowledge remains scattered; adding or changing a provider
  requires coordinated edits across unrelated modules and recreates the existing
  drift problem.

### Option C: Provider-neutral logical capability tiers

Resolve every step to logical tiers such as `mechanical`, `standard`, and `deep`,
then translate those tiers to provider models.

- **Pros:** Compact conceptual model; adding a provider could require only a tier map.
- **Cons:** Publishes an abstraction before its semantics are proven; loses independent
  per-step tuning; requires migration rules for existing provider-native overrides.

### Option D: Add policy capabilities to `LLMProvider`

Extend every provider plugin with identity, defaults, escalation, and fallback
metadata.

- **Pros:** Provider implementation and policy travel together; naturally extensible.
- **Cons:** Breaks the current plugin interface and forces third-party providers into a
  policy contract that is explicitly outside this issue's scope.

## Decision

Choose **Option A**, an internal built-in provider policy registry.

### 1. Policy contract and lookup

Add an internal policy contract containing:

- `stepModels: Record<StepName, string>`
- `stepEfforts: Record<StepName, EffortLevel>`
- provider-native complexity-tier overrides
- `effortOrder`
- `modelEscalationOrder`
- `modelFallbackLadder`

The composition roots in `index.ts` and `daemon-cli.ts` already know the selected
`llm_provider` key. They resolve both the existing `LLMProvider` instance and its
policy, then pass the two separately. `LLMProvider` remains unchanged.

Every production call to `resolveStepConfig` must receive an explicit policy. There
is no implicit global-Claude default on production resolver paths; this prevents a
missed call site from silently reintroducing the bug for Codex.

An installed provider with an unknown policy key uses the legacy Claude policy and
emits a compatibility warning once per process. This preserves existing plugin
behavior while making the limitation visible. Plugin-defined policy registration is
deferred.

### 2. Claude policy

The Claude policy contains the current values without behavioral change:

- Per-step models and efforts match the existing `DEFAULT_STEP_MODELS` and
  `DEFAULT_STEP_EFFORT`.
- Complexity-tier overrides remain identical.
- Model escalation remains `haiku → sonnet → opus → fable`.
- Default unavailability fallback remains `fable → opus → sonnet`.

Existing Claude resolution-precedence and retry tests become compatibility tests
against this policy.

### 3. Codex policy

Codex receives an independent explicit per-step table. Its initial assignments
mirror the current workload intent, but no runtime Claude-alias translation exists:

| Codex model | Initial steps |
|-------------|---------------|
| `gpt-5.6-luna` | `memory`, `worktree`, `finish` |
| `gpt-5.6-terra` | `bootstrap`, `assess`, `complexity`, `stories`, `conflict_check`, `plan`, `architecture_diagram`, `acceptance_specs`, `build`, `wiring_check`, `manual_test`, `architecture_review_as_built`, `retro` |
| `gpt-5.6-sol` | `explore`, `prd`, `architecture_review`, `build_review`, `prd_audit`, `rebase`, `remediate`, `attribution_verify` |

The Large-tier promotions for `plan` and `conflict_check` select Sol directly.
Codex per-step efforts initially mirror the current effort intent, including `max`
for `rebase`.

Codex model escalation is:

`gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol`

Codex default unavailability fallback is:

`gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna`

The two tables are independent and may diverge per step as evidence accumulates.

### 4. Resolution and explicit overrides

Resolution precedence remains unchanged. CLI, step, phase, defaults, and explicit
fallback-ladder configuration stay ahead of built-in policy values. Their strings
remain opaque and provider-native; the engine does not translate an explicit Claude
alias into a Codex model or vice versa.

`ModelAvailability` uses an explicit `model_fallback_ladder` when configured.
Otherwise it receives the selected policy's default ladder.

`escalateAttempt` remains a pure, attempt-indexed transform, but receives the selected
policy's effort and model orders rather than importing global Claude orders.

### 5. Generated documentation

The model-table generator reads the built-in policies rather than importing global
Claude defaults. Engine-step rows clearly label Claude and Codex model/effort values,
including complexity-tier variations.

SKILL.md `model:` pins and non-engine extra rows remain the interactive Claude Code
path. Pin validation continues against the Claude policy and the generated document
labels those rows accordingly; #902 does not invent Codex mappings for standalone
interactive agents.

## Consequences

### Positive

- Codex steps resolve to valid Codex-native model IDs without manual configuration.
- Resolution, escalation, fallback, and documentation share one provider boundary.
- Claude behavior is protected by exact compatibility tests.
- Provider selection stays out of the invocation plugin interface.
- Per-step policies support independent tuning without a public logical-tier schema.

### Negative

- Built-in step tables are intentionally duplicated across providers.
- Every resolver/invocation composition path must carry the selected policy.
- Unknown plugin providers retain Claude defaults until a plugin policy contract exists.
- Generated documentation and its integrity tests require a wider provider-labelled
  table.

### Follow-up Actions

- [ ] Add policy contract, Claude/Codex tables, and unknown-key warning tests.
- [ ] Thread the policy through inline, daemon, step-runner, conductor, group, and
      attribution resolution paths.
- [ ] Make escalation and availability consume policy ordering.
- [ ] Regenerate provider-labelled model documentation and retain Claude pin checks.
- [ ] Add acceptance coverage for Codex defaults, tier promotions, explicit overrides,
      unavailable-model walking, ladder exhaustion, and unchanged Claude behavior.
