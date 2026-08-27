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

Rationale: internal vocabulary decision and rename scoping — no user-facing product
requirements, acceptance criteria live in stories.
