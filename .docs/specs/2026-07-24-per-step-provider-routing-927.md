# PRD: Per-Step LLM Provider Selection and Fallback

**Date:** 2026-07-24
**Status:** Approved
**Source:** GitHub issue #927
**Track:** Product
**Complexity:** Large

## Problem / Background

The conductor can use more than one installed LLM provider, but a configured run
currently chooses one provider for every step. Operators therefore cannot assign
different providers to the work where each is strongest. Provider-native model
defaults, recovery behavior, sessions, authentication, permissions, and usage
reporting are also tied to that run-wide choice.

This makes a multi-provider installation behave like a single-provider installation:
an operator may choose Claude or Codex for a run, but cannot use one for implementation
and another for judgment within the same run.

## Goals & Non-Goals

**Goals**

- Let one run use multiple registered providers across different named steps.
- Give unspecified steps a predictable inherited provider while allowing explicit
  specialization step by step.
- Preserve provider-native model behavior and execution boundaries for whichever
  provider actually runs a step.
- Recover visibly through another configured provider when the selected provider is
  genuinely unavailable.
- Preserve existing single-provider configurations and behavior.

**Non-Goals**

- Automatically deciding which provider is best for a step. Specialization remains an
  explicit operator choice.
- Selecting providers by phase or by inferred categories such as "judgment."
- Switching providers after ordinary step failures, authentication failures, rejected
  work, timeouts, or rate limits.
- Translating an explicit model choice from one provider's model vocabulary into
  another provider's vocabulary.
- Defining a new policy contract for custom provider plugins.

## Users / Personas

- **Harness operator:** configures a project to use different providers for selected
  steps while retaining one predictable default for the rest.
- **Harness maintainer:** needs mixed-provider execution to preserve isolation,
  compatibility, diagnostics, and provider-correct model behavior across every
  execution path.

## Functional Requirements

- **FR-1:** An operator can configure either one provider or an ordered set of
  registered providers for a run.
- **FR-2:** A single configured provider continues to behave as it did before this
  feature, without requiring configuration migration.
- **FR-3:** The first provider in the configured order is inherited by every executable
  step that has no explicit provider selection.
- **FR-4:** An operator can explicitly select a registered provider for an individual
  named step, allowing two named steps in one run to execute through different
  providers.
- **FR-5:** Provider specialization is explicit: the system does not automatically
  assign a later configured provider to any step or category of steps.
- **FR-6:** Each step resolves its default model and supported execution settings from
  the provider selected for that step; defaults or native settings from another
  provider do not leak into it.
- **FR-7:** An explicit model selection for a step is applied to that step's selected
  provider without translating the model identifier between providers.
- **FR-8:** Before executing a step, the system tries that step's explicitly selected or
  inherited provider first.
- **FR-9:** When the selected provider is genuinely unavailable, the system tries every
  other configured provider in declared order, excluding providers already attempted.
- **FR-10:** Exhausting all available models offered by the selected provider counts as
  provider unavailability and permits cross-provider fallback.
- **FR-11:** Authentication failures retain their existing retry, park, and recovery
  behavior and do not trigger cross-provider fallback.
- **FR-12:** Ordinary execution failures—including unsuccessful work, rejected
  requests, timeouts, and rate limits—retain their existing recovery behavior and do
  not trigger cross-provider fallback.
- **FR-13:** Every cross-provider fallback emits a visible warning identifying the
  affected step, the provider that could not be used, the reason, and the provider
  being tried next.
- **FR-14:** After cross-provider fallback, the step resolves the fallback provider's
  native default model and execution settings; it does not carry over the original
  provider's model selection or native settings.
- **FR-15:** Provider fallback is reconsidered independently for each later step.
  A provider that exhausted its models for one step remains eligible when another step
  selects it.
- **FR-16:** A deterministic run-wide availability failure may be remembered for the
  rest of that run so later steps do not repeat an attempt that cannot succeed.
- **FR-17:** Naming an unknown or unregistered provider anywhere in executable
  configuration fails validation before affected work dispatches, with an actionable
  diagnostic that identifies the provider and configuration scope.
- **FR-18:** If every configured provider is unavailable for a step, that step fails
  without dispatching through an unknown provider or using another provider's native
  settings, and the diagnostic reports the attempted providers and reasons.
- **FR-19:** Sessions, authentication context, permissions, retries, and usage are
  attributed to the provider that actually executes each attempt; state from one
  provider is never resumed or reported as another provider's state.
- **FR-20:** Provider selection and fallback behavior apply consistently to all
  executable conductor paths, including interactive runs, daemon runs, validation
  work, recovery work, and auxiliary judgment steps.

## Non-Functional Requirements

- **Backward compatibility:** Existing single-provider projects retain their current
  behavior and require no configuration changes.
- **Isolation:** Provider-native model identifiers, sessions, credentials, permissions,
  and usage data never cross provider boundaries.
- **Observability:** A mixed-provider run makes the selected and actual provider visible
  for each dispatched step, including every fallback.
- **Determinism:** Given the same configured order and availability outcomes, provider
  attempt order is stable and reproducible.
- **Fail-closed validation:** Unknown provider names never degrade silently to a default.

## Acceptance Criteria / Success Metrics

- Automated end-to-end coverage proves that one run can execute one named step with
  Claude and another named step with Codex.
- Automated coverage proves that unspecified steps inherit the first configured
  provider and that explicit step selections do not affect other steps.
- Automated coverage proves that each provider receives only its native model defaults
  and settings.
- Automated coverage proves selected-provider-first fallback, ordered remaining-provider
  fallback, visible warnings, and failure after all configured providers are exhausted.
- Automated coverage proves that provider model exhaustion can fall back across
  providers while authentication and ordinary execution failures do not.
- Automated coverage proves that step-specific model exhaustion does not globally
  disable a provider, while deterministic run-wide unavailability avoids repeated
  attempts.
- Automated coverage proves scalar configuration compatibility and actionable
  pre-dispatch failure for unknown provider names.
- Existing Claude-only and Codex-only test suites remain green without configuration
  migration.

## Scope

### In Scope

- Ordered run-level provider configuration with scalar backward compatibility.
- Explicit provider selection for individual named steps.
- Provider-native per-step model and execution-setting resolution.
- Selected-provider-first fallback through the remaining configured providers.
- Clear validation, warnings, exhaustion diagnostics, and actual-provider observability.
- Correct provider boundaries for sessions, authentication, permissions, retries, and
  usage accounting.
- Consistent behavior across every conductor execution path.

### Out of Scope

- Automatic provider selection based on step role or model judgment.
- Phase-level provider selection.
- Provider fallback for authentication or ordinary execution failures.
- Provider-neutral model-name translation.
- New custom-provider policy APIs or automatic policy generation.
- Changes to the quality, retry, or acceptance semantics of individual SDLC steps.

## Key Decisions & Rationale

- **Provider order expresses inheritance and fallback, not automatic specialization.**
  The first configured provider is the predictable default; operators explicitly select
  exceptions because order alone cannot express which provider is strongest for a role.
- **A selected provider is always attempted first.** Explicit step intent takes
  precedence even when that provider appears later in the run's configured order.
- **Fallback uses the remaining configured order.** After the selected provider fails
  availability, every other configured provider remains a candidate, including entries
  that appeared earlier in the list.
- **Fallback changes provider-native defaults.** Carrying a model or setting from the
  unavailable provider could be invalid or unsafe for the provider that actually runs.
- **Authentication and ordinary failures do not change providers.** They retain their
  established recovery flows so a failing task or credential episode cannot silently
  change providers and sessions.
- **Availability caching is narrow.** Only deterministic run-wide failures suppress
  later attempts; a step-specific model shortage must not disable a provider for
  unrelated work.

## Dependencies

- The existing installed Claude and Codex provider integrations.
- Existing provider-native model selection and within-provider model fallback behavior.
- Existing authentication recovery, retry, session, permission, and usage-accounting
  behavior, which this feature must preserve per provider.

## Open Questions

- Which provider failures are sufficiently deterministic and provider-wide to cache for
  the remainder of a run, and which must remain scoped to one step or attempt?
- At what boundary should availability validation and provider fallback occur so every
  interactive, daemon, recovery, validation, and auxiliary path behaves consistently?
- How should actual-provider attempts and fallback reasons be represented in existing
  run observability and usage reporting without merging provider-native sessions?
