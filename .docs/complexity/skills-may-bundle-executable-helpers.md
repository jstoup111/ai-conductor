# Complexity: Skills may bundle executable helpers

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None new (the migrated helper keeps its existing GitHub filing path) |
| Auth / permission surface | None |
| State machines | None |
| Architectural decision | Yes: a new convention for where shipped-skill executables live, amending the "pure Markdown skills" founding decision |
| Story count | ~5: helper resolves and files from a consumer repository, self-host resolution, lint and syntax coverage of skill scripts, dead-entry-point dereferencing (the directory deletion is a separate follow-up feature), documentation convention |
| Files touched | ~10 across `skills/intake/`, `bin/`, `test/lint_shell.sh` and its enumeration test, `test/test_harness_integrity.sh`, `src/conductor/src/engine/self-host/provider-home.ts` (comment/assumption), `docs/` |

## Rationale

The change crosses several subsystems (a shipped skill, the repository's validation gates, the
self-host provider-home materialization, and contributor documentation) and records an ADR that
amends a founding architectural statement. It adds no new runtime component, model, or integration,
and the migrated helper remains a thin wrapper over the existing TypeScript CLI, so it is not Large.
→ **Medium.** Architecture-diagram, lightweight architecture-review, conflict-check, and
coherence-check are required.
