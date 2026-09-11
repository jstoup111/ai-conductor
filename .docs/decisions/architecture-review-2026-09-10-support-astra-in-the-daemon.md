# Architecture Review: Support Astra in the daemon

**Date:** 2026-09-10
**Mode:** Lightweight, Medium tier — technical feasibility and architectural alignment
**Input reviewed:** Approved product requirements, track and complexity markers, approved feature component diagram, relevant decisions and production source.
**Stories reviewed:** None; this review precedes stories.
**Verdict:** APPROVED

## Feasibility

Verified: existing configuration and provider-native resolution preserve opaque model strings. `gpt-6-astra` can use existing Codex dispatch, effort escalation, model availability handling, and usage pricing. No package, provider interface, service, migration, credential change, or additional live probe is required.

The implementation is a bounded addition to existing TypeScript model metadata and its pricing consumer. Add an immutable provider-keyed collection of supported opt-in models beside the existing built-in model policies in `src/conductor/src/engine/provider-model-policy.ts`. Include Astra for Codex. Have `rateCardModelIds()` return the deduplicated union of this collection and its existing policy-derived models, retaining exclusion of cost-self-reporting providers. This collection is pricing/support metadata, never a configuration allowlist or account-entitlement claim.

This implements FR-5 without placing Astra into any default step model, tier override, automatic escalation order, or default fallback ladder. Adding Astra to those ladders would change behavior for operators who did not select it and violate FR-2.

FR-1 uses existing configuration precedence, including inherited defaults, phase and step selections, tier overrides, and separately resolved auxiliary policies where these already accept a model. BUILD must enumerate those distinct paths from current source and prove each at the lowest sufficient layer; the feature adds no new selection surface. Existing provider-switch isolation continues to prevent a Codex model from leaking into a Claude fallback candidate.

FR-3 and FR-4 reuse `ModelAvailability`: an unavailable configured model absent from the ladder falls to its first live entry; an explicit empty ladder disables model fallback; exhaustion returns the existing failure to normal provider-candidate and retry handling. Authentication, rate-limit, and expired-session signals are not model-unavailability signals. Explicit provider fallback remains valid under the existing policy and must not be described as an undeclared substitution.

Verified: `bumpModel` leaves a model outside its escalation order unchanged. Configured Astra therefore stays Astra during ordinary retry model escalation; effort still follows the existing bounded policy. This preserves the operator's selection without making Astra reachable from unrelated Sol retries.

## Alignment

The APPROVED `adr-2026-07-03-reactive-model-fallback-ladder` governs opaque model IDs, reactive availability detection, empty ladders, and exhaustion. The APPROVED `adr-2026-07-05-retry-as-escalation-ladder` governs attempt-indexed effort/model escalation. Current provider-native policy threading is documented in `architecture-review-2026-07-23-provider-model-policies` and implemented in the current policy/resolution modules. That historical review names a provider-policy ADR absent from this checkout; this report does not treat the missing document as verified authority.

The APPROVED `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` governs dispatch-time committed pricing, no historical repricing, and the retained metered/cost-unmetered/unmetered states. Astra extends this existing resource-cost convention. It does not introduce exact billing reconciliation: aggregate CLI usage and a flat rate card cannot establish request-size or processing-mode surcharges. Cost reporting retains its existing rate-card basis, without inventing rates or claiming an exact subscription bill.

The focused local precedent is `rateCardModelIds()` feeding `dispatchRateCard()` in `rate-card-cli.ts`: a deterministic model set selects upstream rates, refresh names missing entries, and `applyRateCard()` preserves provider-reported cost and missing-rate behavior. Preserve these semantic traits; implementation may choose private metadata names and collection representation within the existing module. An existing valid published Astra rate may be added to the committed card with provenance; absent upstream pricing must remain explicitly unmetered.

The generated per-step table continues deriving its rows from existing policies and retains the same values. Astra is not added as a default.

The event-spine verdict is reuse: actual model identity and priced usage already flow through provider attempt events and their existing persistence/consumers. No new reporting channel, event type, polling loop, or sidecar is required. The rate card remains existing durable state.

The approved component diagram reflects these boundaries. There is no new deployment, data store, input-validation policy, or security boundary. Configuration remains open to other provider-native model IDs.

## Wiring Surface

| Surface | Production caller and intended connection |
|---|---|
| Opt-in Codex model metadata in `src/conductor/src/engine/provider-model-policy.ts` | Consumed directly by existing `rateCardModelIds()`; no dispatch default consumer |
| Expanded pricing model union | Existing `dispatchRateCard()` in `src/conductor/src/engine/rate-card-cli.ts`, reached from the CLI and existing scheduled refresh workflow |
| Astra entry in `.ai-conductor/rate-card.json`, when published pricing is available | Existing `loadRateCard()` and Codex adapter `applyRateCard()` at dispatch time |

Existing configuration, resolver, availability, escalation, provider execution, and cost reporting are behavioral verification surfaces, not new machinery. Fix a proven Astra-specific gap only within the approved support scope; do not refactor those systems speculatively.

## Early Overlap Scan

The advisory scan over the model-policy module, rate-card refresh module, committed card, and model reference reported: “No overlap detected; no open blockers.” Its stated limitation is that renames or name-only diffs may not be detected. Recheck the plan's final candidate path union before locking tasks.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Upstream has no usable Astra rate | Integration | Medium | Medium | Existing missing-rate warning and cost-unmetered state; no invented price |
| Registration accidentally makes Astra automatic | Technical | Low | Medium | Keep opt-in metadata separate; behavioral regression checks for unchanged defaults and retry/fallback orders |
| Rate-card resource cost is mistaken for exact billing | Knowledge | Medium | Medium | Preserve existing flat-rate semantics and cost-source attribution |
| Account cannot access Astra | Integration | Medium | Medium | Existing reactive model-unavailability and declared fallback behavior |

## ADRs Created

None. The structural prerequisite was checked: this change adds metadata and extends an existing selector within the same component ownership, pricing integration, and persistence boundaries. The approved pricing, fallback, and escalation decisions already govern the relevant architecture. New model membership does not warrant a new ADR.

## Verify-Claims Ledger

- [verified] Opaque model resolution, fallback behavior, off-order retry behavior, and pricing-source selection — read `config.ts`, `resolved-config.ts`, `provider-execution.ts`, `model-availability.ts`, `escalation.ts`, `provider-model-policy.ts`, `rate-card-cli.ts`, and `execution/rate-card.ts`.
- [verified] Canonical external ID and supported effort levels — official model page fetched during exploration: https://developers.openai.com/api/docs/models/gpt-6-astra . This is not evidence of this operator's account entitlement.
- [approved input] Operator selected first-class configurable support, unchanged defaults, product track, Medium tier, PRD, and diagram.
- No assumption of current upstream Astra pricing or live account access is required; both have explicit existing failure behavior.
- Verdict: CLEAR.

## Blocking Issues

None. No new or superseded ADR and no high-impact risk requires an architecture-review marker.

## Post-plan conformance review

Verdict: APPROVED. The one-task plan implements the reviewed opt-in pricing metadata and connects it through `rateCardModelIds()` to the existing refresh entry point. Its unchanged configuration, retry, fallback and metering paths rely on existing behavioral evidence, consistent with the operator's explicit request to remove separate verification tasks. The task owns the changed integration proof, preserves default policies and pricing failure semantics, and introduces no new structural decision. The component diagram remains accurate.
