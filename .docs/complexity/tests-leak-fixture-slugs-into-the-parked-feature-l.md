# Complexity: Tests leak fixture slugs into the parked-feature ledger

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / schemas | None |
| External integrations | None (git CLI already used by `park-marker.ts`) |
| Auth / permissions | None |
| State machines | None |
| New modules | One test-only guard module (`test/park-leak-guard.ts`), mirroring four existing siblings |
| Production behavior change | None — `park-marker.ts` is untouched |
| Story count | 3 |

The change is confined to the vitest harness (`vitest.config.ts`, `test/global-setup.ts`,
`test/tmpdir-leak-guard.ts`) and follows an already-established, four-times-repeated
snapshot/diff/fail guard pattern (`pipeline-leak-guard`, `tmux-leak-guard`,
`signals-leak-guard`, `tmpdir-leak-guard`). No architectural decision is open.

Small tier: `/architecture-diagram`, `/architecture-review`, `/conflict-check`, and
`/coherence-check` are skipped.
