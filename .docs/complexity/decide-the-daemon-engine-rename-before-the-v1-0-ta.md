# Complexity: decide the daemon→engine rename before the v1.0 tag

Tier: L

> **Amended 2026-08-26 by operator review of #1921:** the original assessment was `Tier: M`
> because the feature delivered no runtime code. The confirmed comprehensive scope now crosses
> two CLI families, the shipped skill catalog, configuration compatibility, and durable state
> migration, with compatibility and failure behavior at each boundary; it is Large.

Rationale: the deliverable is decision + scoping artifacts (an ADR adopting the music
vocabulary, a rename-scope enumeration covering ~1,532 daemon / ~422 engineer occurrences,
CLI/config/`.daemon/`-path surfaces, alias/deprecation-warning posture, and migration-block
scoping bound to #226) — no runtime code, no integrations, no new state machines. Not Small
because the core artifact is an ADR that must survive architecture review, the rename scope
touches breaking surfaces (CLI, config schema, paths) that need conflict-checking against
in-flight work (#226, #885, #1918), and traceability to the decision outcomes matters. Not
Large: no implementation, single decision domain, small story count.

Current rationale: Large is required because the amended feature changes two public command trees,
two supported-host skill entrypoints, config normalization/event behavior, and dozens of durable
state consumers. It adds a guarded migration state machine with data-preservation, ambiguity,
partial-migration, and idempotence paths, plus compatibility behavior at each public boundary.
