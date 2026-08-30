# Track: Daemon runs export branch and engine version as unknown

Track: technical

Scope boundary: Populate `conductor.branch` and `conductor.engine.version` for daemon-dispatched runs and make the shared OTel wiring contract distinguish a caller omission from an attempted-but-unresolved value. Limit the safeguard to these two attributes; exclude a broader audit of OTel identity fields or a redesign of the event spine.

This is a daemon and OpenTelemetry infrastructure repair with no product-facing requirements; acceptance criteria belong directly in stories.
