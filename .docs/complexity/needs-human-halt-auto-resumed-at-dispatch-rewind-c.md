# Complexity: needs-human-halt-auto-resumed-at-dispatch-rewind-c

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — reuses the existing `halt_cleared` event and committed halt record |
| External integrations | None |
| Auth / permission surface | None new — an operator-run CLI verb |
| State machines | None — step topology unchanged; the clear reuses the daemon's existing HALT-absent resume |
| Story count | ~4 (clear verb happy path, refusal path, class preservation, attribution fix) |
| Files touched | One new small CLI verb + registration, `conductor.ts` build-stall path, `docs/reference/cli.md`, `docs/runbooks/stalled-or-stuck-feature.md`, `CLAUDE.md`, tests |
| New runtime code | A thin verb composing existing helpers (halt-marker clear, halt-record supersession, `halt_cleared` emission) plus two localized edits in the build-stall path |

## Rationale

Every piece reuses existing machinery: the verb composes the halt-marker clear, the committed
halt-record supersession, and the `halt_cleared` event that already exist; the daemon already
resumes when HALT is absent. The engine edits are two localized changes in one block of the
build-stall path (pass the remediation outcome's halt class through; stop attributing the
agent-marker clear to the operator). The rest is documentation reconciliation.
→ **Small** (operator-confirmed 2026-10-02). Architecture-diagram, architecture-review,
conflict-check, and coherence-check are skipped for this tier.
