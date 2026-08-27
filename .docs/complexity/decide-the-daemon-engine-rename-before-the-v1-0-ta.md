# Complexity: decide the daemon→engine rename before the v1.0 tag

Tier: M

Rationale: the deliverable is decision + scoping artifacts (an ADR adopting the music
vocabulary, a rename-scope enumeration covering ~1,532 daemon / ~422 engineer occurrences,
CLI/config/`.daemon/`-path surfaces, alias/deprecation-warning posture, and migration-block
scoping bound to #226) — no runtime code, no integrations, no new state machines. Not Small
because the core artifact is an ADR that must survive architecture review, the rename scope
touches breaking surfaces (CLI, config schema, paths) that need conflict-checking against
in-flight work (#226, #885, #1918), and traceability to the decision outcomes matters. Not
Large: no implementation, single decision domain, small story count.
