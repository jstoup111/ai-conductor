# Intake origin: running-provider-is-invisible-per-step-and-absent-

Source-Ref: jstoup111/ai-conductor#1268
Owner: jstoup111

## Desired outcome

- While a step is running, the operator can see which provider is executing it — not only after it completes, and not only when a fallback fires.
- Every member of a parallel group shows its own provider concurrently, so two members running on different providers are distinguishable while both are in flight.
- The provider shown is the one that actually executed the work, and when a fallback changes it mid-step the displayed value reflects the change.
- Negative path: when provider routing is inactive or the provider cannot be determined, the display says so explicitly rather than showing a stale, blank, or guessed value.
- Negative path: a serial run with a single provider gains no extra noise per step beyond the provider identification itself.
