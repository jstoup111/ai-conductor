# Complexity: Config keys that validate but have no consumer

Tier: M

Rationale: touches four engine surfaces (config validator, resolved-config, step registry, types)
plus two templates and reference docs, and adds a new key→consumer coverage test — but no models,
integrations, auth flows, or state machines. Multiple independent removals with one behavioral
unblock (custom-step gate/kickback_target) and one new guard (conductor block project-path
rejection). Matches the issue's declared size: M.
