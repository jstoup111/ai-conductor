# Intake origin: mechanically-enforce-otel-handler-coverage-for-ote

Source-Ref: jstoup111/ai-conductor#1490
Owner: jstoup111

## Desired outcome
- An event type that is declared in the sink table and is relevant to tracing cannot be silently absent from the OTel surface — the omission is caught mechanically rather than discovered by a reader.
- A run that halts is distinguishable in the exported trace from a run that is still in progress.
- No step span remains open in the exported trace after the run that opened it has terminated.
- A contributor adding a new `ConductorEvent` variant learns at authoring or test time whether the OTel surface needs to handle it.
- Events deliberately excluded from tracing stay excluded, and the exclusion is a recorded decision rather than an omission (negative path — this is not a request to export all seventy).
