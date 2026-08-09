# Intake origin: build-post-task-tail-telemetry

Source-Ref: jstoup111/ai-conductor#1176
Owner: jstoup111

## Desired outcome

- Post-task BUILD latency is measured separately from task execution latency.
- A completed task graph reaches BUILD completion without unconditional idle time.
- Equivalent verification or judgment evidence is produced once and reused by downstream gates while it remains current.
- Required simplify, architecture, documentation, memory, and quality contracts remain satisfied with explicit durable evidence.
- On representative no-rework builds, the p95 post-task tail is reduced by at least 50% from a baseline captured after #1101 lands.
- Negative path: missing, stale, or failed evidence still blocks progression and triggers only the necessary rework.
