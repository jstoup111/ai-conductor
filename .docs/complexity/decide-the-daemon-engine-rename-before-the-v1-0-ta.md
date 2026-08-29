# Complexity: revise the v1.0 rename — daemon stays, engineer→composer, ai-conductor CLI

Tier: M

> **Superseded 2026-08-28 by operator reversal:** the prior `Tier: L` assessment covered the
> comprehensive player/composer implementation (durable `.daemon/`→`.player/` state migration,
> config-key normalization, two full command-tree renames). That scope is dropped; this
> assessment replaces it.

Rationale: the surviving scope is boundary aliasing across known seams — a canonical `compose`
CLI verb with an `engineer` warning alias (one parser boundary, existing typed dispatch reused),
a canonical `skills/composer` with an `skills/engineer` compatibility delegate (both supported
host discovery mechanisms, model-table + skill-contract updates), an `ai-conductor` installer
symlink with an argv0-based deprecation warning for `conduct-ts`, and the in-place ADR/docs
amendments. No durable-state migration, no config schema change, no new state machine, no new
integration. Medium rather than Small because it changes two public boundaries (CLI naming and
the shipped skill catalog) plus installer behavior, which need conflict-checking against #226
and architecture artifacts; not Large because every change is an alias/symlink/delegate over an
unchanged implementation.
