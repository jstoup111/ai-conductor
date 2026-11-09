# Complexity: shared credential-reference resolver, first consumer otel.headers

Tier: M

Rationale: adds a new engine module (a source-extensible credential-reference resolver with `env` and
`command` sources), a new `otel.headers` reference form (config-schema change), subprocess execution
without a shell under a timeout, a TTL cache shared by concurrent exports with single-flight refresh,
and two consumers of it (the spool drainer's per-POST headers and the direct OTLP/HTTP exporters' async
headers factory). Credential values are security-sensitive and must stay out of configuration, errors,
events, and the spool. The resolver's interface must also be checked against the lifecycles of three
future adopters (`github_bot.token_file`, the daemon build OAuth token, `tracker.credentials`) without
migrating them. Expected 4–5 stories. Not Large: one existing subsystem changes, no new datastore,
no state machine, and no other consumer migrates. Per tier rules: architecture-diagram, lightweight
architecture-review, conflict-check, coherence-check, and plan-review apply; no PRD (technical track).
Operator-confirmed 2026-10-28.
