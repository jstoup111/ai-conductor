# Intake origin: harness-logs-have-no-export-path-daemon-log-is-a-f

Source-Ref: jstoup111/ai-conductor#1935
Owner: jstoup111

## Desired outcome

- Harness logs can be delivered to an external log destination by configuration alone, with no
- More than one destination family is reachable without an engine change per vendor — at minimum
- Delivered log records carry their fields as fields — at least timestamp, severity, project,
- The local `.daemon/daemon.log` and `conduct daemon logs` keep working unchanged when no
- A destination that is unreachable, slow, or failing degrades to a bounded warning and never
- Configuring a destination is validated at load: a malformed or unknown destination is reported
