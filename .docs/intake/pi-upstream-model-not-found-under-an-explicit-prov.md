# Intake origin: pi-upstream-model-not-found-under-an-explicit-prov

Source-Ref: jstoup111/ai-conductor#3505
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3505 digest=321761f186f6266cbb9faf887ae6ed6bfd196ac39779f0007ac6aad0f1a532fb >>>
## Desired outcome

- When a Pi dispatch under an explicit upstream provider fails because the upstream does not know the requested model, the result carries the model-unavailable signal, and the configured Pi fallback ladder moves to its next rung.
- The signature is proven against committed captures of real Pi output from at least one upstream, and the default test suite makes no real Pi call.
- A Pi failure that is not an unknown-model rejection, including an auth failure or a rate limit, never carries the model-unavailable signal.
<<< END INBOUND >>>
