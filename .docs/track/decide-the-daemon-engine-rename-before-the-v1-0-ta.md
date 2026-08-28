# Track: decide the daemon→engine rename before the v1.0 tag

Track: technical

Scope boundary: ADR adopts the music/orchestration naming system; the 1.0 major renames only
the two breaking concepts — daemon→Player, engineer→Composer — across CLI subcommands, config
keys, `.daemon/` paths, and docs, with a scoped `## Migration` block bound to cutover PR #226.
Compatibility aliases and/or deprecation warnings for the old `daemon`/`engineer` command names
are in scope as a transition aid (operator-requested). The repository keeps the `ai-conductor`
name (bare "conductor" is not usable). The former daemon→engine proposal is rejected (Rails
Engines collision; `src/engine/` already names the internals). The additive verdict/state
vocabulary (attacca/dissonance/dal segno/da capo/rest/fermata and the broader table) is
explicitly out of scope, deferred to #1918. This spec delivers the decision + scoping artifacts
(ADR, rename scope, migration scoping), not the rename implementation itself.

> **Amended 2026-08-26 by operator review of #1921:** the operator selected the comprehensive
> implementation approach. This spec now owns the functional 1.0 rename: canonical `player` and
> `composer` CLI/skill surfaces, temporary `daemon` and `engineer` compatibility aliases with
> deprecation warnings, canonical Player config keys with legacy-key normalization, and canonical
> `.player/` state with safe legacy-state resolution. Internal Conductor engine terminology,
> repository/entrypoint names, and the verdict vocabulary remain out of scope. Ordinary
> documentation upkeep is not a story or BUILD-plan task.

Rationale: internal vocabulary decision and rename scoping — no user-facing product
requirements, acceptance criteria live in stories.

> **Amended rationale:** this remains a technical track because the work changes developer/operator
> boundaries rather than introducing a new end-user product requirement. Acceptance criteria now
> cover executable CLI, skill, configuration, and state-migration behavior.
