# Intake origin: daemon-build-review-can-wedge-before-provider-laun

Source-Ref: jstoup111/ai-conductor#1141
Owner: jstoup111

## Desired outcome

- A BUILD or SHIP step that stops before launching its provider is detected and leaves the in-flight state within a bounded time without operator intervention.
- Automated recovery cannot leave an earlier attempt able to launch after a replacement attempt starts; no slug has duplicate provider workers for one logical step.
- A legitimately running provider is not terminated or duplicated merely because its output is temporarily quiet.
- Daemon status and logs distinguish provider preparation, provider running, and recovery, including the reason and attempt identity.
- Recovery is bounded: repeated failure becomes a durable, diagnosable halt instead of a restart or redispatch loop.
