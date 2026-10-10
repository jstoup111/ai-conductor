# Track: Configurable harness log export

Track: product

Source-Ref: jstoup111/ai-conductor#1935

Scope boundary: Structured log delivery for both daemon-managed and interactive harness runs through shared logging/export behavior, including operational diagnostics. Preserve local daemon logs and terminal output. Support Loki, Elasticsearch, Sumo Logic, and Datadog through configuration; no file scraping or project-filesystem access by a collector. Export full feature identity and isolate delivery failures from builds. Log sending has its own explicit enablement and is off by default, including when existing OTel export is enabled.

Operator approved routing and original outcomes, requested a shared code path across execution modes, required separate default-off log sending, and approved the shared OTel approach plus product track in chat on 2026-09-30.

Rationale: This delivers an operator-facing configuration capability and externally observable behavior; a product requirements document is required.

Scope check: consumer-facing engine behavior, no new skill, provider-agnostic. The daemon heuristic suggests repo-only, but the engine runs in consumer repositories, so the repository's mechanism-exists-outside-this-repository rule determines the audience.
