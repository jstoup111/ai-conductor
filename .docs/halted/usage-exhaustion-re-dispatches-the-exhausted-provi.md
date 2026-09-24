# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-24T15:10:59.107Z
Slug: usage-exhaustion-re-dispatches-the-exhausted-provi
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-usage-exhaustion-re-dispatches-the-exhausted-provi
Head SHA: b3677064917e9cfe95aa33096e676e97670e4742
Halted at: 2026-09-24T15:08:14.524Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 negative: Given substitution is disallowed at the global scope and permitted for one step, when that step's candidate list is resolved, then the step's own setting governs that step and the global setting continues to govern every other step, with neither silently overriding the other.
Task ids: 3
Done when checks: resolveProviderCandidates returns only the step selection when the policy disallows substitution and the step declares a selection | resolveProviderCandidates returns the configured global list unchanged when the policy disallows substitution and the step declares no selection of its own | with the policy unset, resolveProviderCandidates returns the union of step selection and configured providers, byte-identical to the pre-change result for the same inputs | a policy set for one step narrows only that step, asserted by resolving two steps where one sets the policy and the other does not, with each scope governing its own step
Missing assertion: A check explicitly requires a step-level permitted setting to override a globally disallowed setting for that step while other steps remain governed by the global setting.

Criterion: Story 5 happy: Given a provider suppressed until a deadline, when candidates are resolved after that deadline, then the provider is admitted and invoked with no operator action.
Task ids: 13
Done when checks: advancing the injected clock past a suppression deadline admits the provider again with no operator action | advancing the injected clock past the bounded default interval admits a provider suppressed with no parsed deadline | a provider re-admitted after expiry and exhausted again receives a fresh window rather than an extension of the previous one | two admission evaluations at nearly the same moment just after a deadline both observe the provider admitted | a provider admitted after expiry and succeeding is treated as ordinarily available by subsequent steps
Missing assertion: The checks require re-admission without operator action after expiry, but do not require that the provider is invoked.

Criterion: Story 5 happy: Given a provider is suppressed, when the candidate list is resolved, then the order of candidates is unchanged and only admission differs.
Task ids: 5, 3
Done when checks: the store answers admission and records suppression against an injected clock, and the module performs no filesystem or ledger access | the later of two competing deadlines for one provider governs its window, asserted by recording an earlier deadline second | a deadline at or before the injected now leaves the provider admitted rather than suppressed | the store exposes no permanent-unavailability state and never reorders providers, asserted after repeated suppression and expiry cycles | resolveProviderCandidates returns only the step selection when the policy disallows substitution and the step declares a selection | resolveProviderCandidates returns the configured global list unchanged when the policy disallows substitution and the step declares no selection of its own | with the policy unset, resolveProviderCandidates returns the union of step selection and configured providers, byte-identical to the pre-change result for the same inputs | a policy set for one step narrows only that step, asserted by resolving two steps where one sets the policy and the other does not, with each scope governing its own step
Missing assertion: The checks require that the store never reorders providers and that candidate-resolution outputs remain unchanged for policy cases, but do not explicitly require that suppression changes only admission in the resolved candidate list.
```
