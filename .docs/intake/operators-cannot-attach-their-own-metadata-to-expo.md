# Intake origin: operators-cannot-attach-their-own-metadata-to-expo

Source-Ref: jstoup111/ai-conductor#2056
Owner: jstoup111

## Desired outcome

- An operator can attach a bounded set of custom metadata to ai-conductor telemetry without changing engine code.
- Custom metadata is available to backend queries for both traces and metrics, for OTLP and file export, in interactive and daemon-dispatched runs.
- Existing telemetry is unchanged when no custom metadata is supplied.
- Invalid custom metadata is reported with the offending key and does not fail or slow a conductor run.
- Custom metadata cannot silently replace conductor-owned identity or outcome attributes.
- Unbounded or run-varying custom values do not silently create unbounded metric-series growth; the observable behavior and any refusal or warning are documented.
