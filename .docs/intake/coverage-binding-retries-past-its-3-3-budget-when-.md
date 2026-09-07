# Intake origin: coverage-binding-retries-past-its-3-3-budget-when-

Source-Ref: jstoup111/ai-conductor#2371
Owner: jstoup111

## Desired outcome
- A step that returns a terminal `needs-human` refusal halts on its first attempt instead of
  spending its remaining retry budget on laps that cannot change the judgement.
- The recorded retry and halt reason is the refusal's own text, so an operator reading
  `.daemon/daemon.log` is never told a subprocess died when a judge actually returned a verdict.
- The routing decision is visible on the event spine as a typed `retry_decision` signal, so the
  next investigation of a spin starts from a machine-readable record rather than log prose.
- A `seal` refusal keeps the retry behavior `adr-2026-08-24` D4 deliberately gave it.
- The existing `retry_routing.enabled` switch reverts the new behavior with no code change.
