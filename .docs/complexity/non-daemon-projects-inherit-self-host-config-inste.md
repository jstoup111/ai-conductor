# Complexity: Non-daemon projects inherit self-host config instead of sane defaults (#683)

Tier: M

## Rationale

Assessed against the standard conduct signals:

| Signal | Reading |
|---|---|
| New data models | None — one new template file and one existing config schema, unchanged |
| Integrations | None — no new third-party or network boundary |
| Auth | None |
| State machines | None |
| Story count | ~5 (scaffolder, template, loader message, docs reconciliation, ADR correction) |

Not **S**: the change spans more than one seam — a new project-scoped template asset, a write
path in `conduct create` (`src/conductor/src/engine/registry-cli.ts`), a stale loader error
message (`src/conductor/src/engine/config.ts:144`), and four separate documentation surfaces
(`docs/reference/configuration.md`, `docs/quickstart.md`, `docs/guides/multiprovider.md`, and the
false claim in `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md:93`).
It also changes the observable behavior of a shipped CLI subcommand, which carries a
consumer-visible contract and an integration test that asserts the exact scaffold set
(`src/conductor/test/integration/registry-cli.test.ts:313`).

Not **L**: no architectural restructuring, no new subsystem, no migration of existing data, and
no cross-cutting redesign. The scaffolder is a single deterministic file write reusing the
established `runCreate` pattern; every other task is a localized edit or a doc correction.

Confirmed by the issue's own triage label (`size: M`).
