# Complexity: Consolidate duplicate halt-marker and task-status declarations

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change deletes one duplicated constant, one dead type alias pair, and one duplicated reader interface, adds the import edges that replace them, derives one path string from its sibling, and registers two entries in the existing matched-pair registry. Five engine files change by a handful of lines each and no on-disk artifact, schema, event, metric, CLI flag, hook, or configuration key changes. The enforcement mechanism it relies on already exists and is fixture-tested, so nothing new is designed. Small-tier architecture, conflict-check, and coherence artifacts are not required, and no ADR is created or amended.
