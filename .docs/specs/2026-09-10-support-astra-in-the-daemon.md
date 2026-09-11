# PRD: Support Astra in the daemon

**Date:** 2026-09-10
**Status:** Approved

## Problem / Background

Operators can choose Codex models for daemon work, but Astra is not represented as a first-class supported choice. Although an arbitrary model identifier can reach a dispatch today, operators lack an end-to-end support contract covering selection, availability failure, cost accounting. Automatic pricing maintenance currently omits Astra.

## Goals & Non-Goals

**Goals**

- Let operators opt into Astra anywhere the daemon supports a Codex model choice.
- Preserve existing availability and fallback behavior when Astra cannot be used.
- Include Astra dispatches in normal cost accounting when published pricing is available.

**Non-Goals**

- Making Astra the default for any daemon step.
- Changing Claude model selection or behavior.
- Generalizing support to every future unregistered model.
- Changing account eligibility, provider rate limits, or model availability.

## Users / Personas

- Harness operators who want the strongest Codex model for selected high-complexity daemon steps without increasing the cost of every step.
- Maintainers who need configured Astra runs to preserve the daemon's existing fallback, observability, and cost-accounting guarantees.

## Functional Requirements

- **FR-1:** An operator can select Astra through every existing daemon configuration surface that accepts a Codex model choice, and the eligible work is dispatched using Astra.
- **FR-2:** Selecting Astra does not alter the model chosen for any step without an explicit Astra selection.
- **FR-3:** When Astra is unavailable, the daemon applies the same configured availability and fallback behavior used for other Codex models and reports the resulting model choice.
- **FR-4:** When Astra is unavailable and no usable fallback remains, the daemon reports the existing model-unavailable failure rather than silently substituting an undeclared model.
- **FR-5:** Astra token usage receives cost accounting from the maintained published-price source when a usable rate is available; an absent or malformed rate continues to fail closed as unmetered rather than inventing a cost.

## Non-Functional Requirements

- Existing Claude and non-Astra Codex dispatch behavior must remain unchanged.
- Automated tests must use provider fakes and must not call OpenAI or any third-party pricing service.
- Astra cost calculations must use the same precision and fail-closed guarantees as existing Codex cost accounting.

## Acceptance Criteria / Success Metrics

- Behavioral coverage proves Astra selection reaches Codex dispatches for each distinct configuration path.
- Behavioral coverage proves both successful fallback and exhausted-fallback outcomes.
- Cost-accounting coverage proves published Astra rates are applied and missing rates remain unmetered.
- Existing defaults remain unchanged unless Astra is explicitly selected.
- The repository validation suite passes.

## Scope

### In Scope

- First-class opt-in Astra selection across existing daemon model configuration.
- Availability, fallback, execution reporting, and cost accounting for Astra.
- Regression and acceptance coverage at existing provider boundaries.

### Out of Scope

- Documentation authoring, owned by the configured custom step.
- Default-model policy changes.
- Claude policy changes.
- New provider integrations.
- Automatic discovery or registration of arbitrary future models.
- Live third-party tests.

## Key Decisions & Rationale

- Astra is opt-in because the operator requested configurability rather than a default-policy migration.
- Support includes cost accounting and failure behavior because dispatch forwarding alone would leave an incomplete and potentially misleading operator experience.
- Existing defaults remain stable to avoid changing cost and capability choices for operators who do not opt in.

## Dependencies

- OpenAI's externally defined model identifier is `gpt-6-astra`.
- Astra access remains subject to the operator's OpenAI account eligibility and provider availability.
- Cost accounting depends on the existing public pricing source publishing a usable Astra rate.

## Open Questions

None. The approved architecture uses opt-in metadata beside provider model policies, consumed only by rateCardModelIds().
