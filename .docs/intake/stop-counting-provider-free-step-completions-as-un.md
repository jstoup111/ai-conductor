# Intake origin: stop-counting-provider-free-step-completions-as-un

Source-Ref: jstoup111/ai-conductor#1906
Owner: jstoup111

## Desired outcome
- Every invoked provider call that reports usage contributes exactly once to feature dispatch, token, and cost totals.
- Completing a step that invoked no provider does not increase either the provider-dispatch count or the unmetered-dispatch count.
- A provider call that was actually invoked without usable usage remains explicitly unmetered.
- Provider-backed `finish`, `build_review`, and conflict-resolution `rebase` executions retain all reported usage without adding a second unmetered completion for the enclosing step.
- Replaying PR #1893's events through `finish` reports 14 dispatches, 14 metered, and 0 unmetered while preserving the existing token and cost totals.
