# Complexity: update-check config single source of truth

Tier: M

## Rationale

**Not Small.** The change spans two languages and four writer/reader sites that must move
together: the bash accessors (`bin/lib/harness-common.sh`), both bash consumers (`bin/update`,
`bin/conduct`), a third writer that bypasses the accessors entirely (`bin/install:930,947`), and
the TypeScript CLI surface (`conduct-ts config write`, currently restricted to
`markdown_viewer|mermaid_renderer`, which must be extended to cover the `conductor` block). It
also carries a genuine **state migration** with an operator-decided divergence rule — seed the
YAML from the live legacy JSON once, then treat YAML as authoritative — where getting the rule
wrong silently reverts an operator's update channel and stops update checks
(`bin/update:133-138` treats an unverifiable `currentVersion` as a hard stop). A new integrity
check must fail closed if the update flow ever reads or writes a config surface the schema does
not own, and `readLegacyJson()` (dead code, zero production callers) must be removed without
breaking its tests. Reader-visible documentation in `docs/reference/configuration.md` and
`docs/reference/cli.md` is currently wrong and must move in the same PR.

**Not Large.** No new subsystem, no data model, no integration, no auth, no state machine. The
blast radius is bounded to the update-check path, which is advisory-only at runtime
(`auto-update-check.ts` swallows every failure). The target surface is already typed
(`ConductorConfig`) and already schema-validated (`validateConductorBlock`) — no schema design
work is required, only wiring real consumers to it.

## Signals

| Signal | Value |
| --- | --- |
| New models / schemas | 0 — `ConductorConfig` already exists and is validated |
| Integrations | 0 |
| Auth surfaces | 0 |
| State machines | 0 |
| State migration | 1 — legacy JSON → YAML `conductor:`, with a divergence rule |
| Languages touched | 2 (bash, TypeScript) |
| CLI surface change | 1 — `conduct-ts config write` extended to the `conductor` block (additive) |
| Estimated stories | 5–7 |

## Consequences

Medium tier requires `/architecture-diagram`, a lightweight `/architecture-review`,
`/conflict-check`, and `/coherence-check`. None are skipped.
