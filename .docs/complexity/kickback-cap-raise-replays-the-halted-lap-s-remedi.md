# Complexity: kickback-cap-raise-replays-the-halted-lap-s-remedi

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. It reuses the version-1 kickback ledger, which may gain a pending-dispatch field |
| External integrations | None |
| Auth / permission surface | Operator resume authorization (`kickback-budget raise`) semantics change: a raise now authorizes the build dispatch |
| State machines | Yes. The remediation→build transition gains a cap halt, and three existing halt exits in `planRemediation` move there |
| Story count | ~4–5 (lap cap, growth cap, as-built cap, rebase ordering, over-scope guard, and no-append fallback) |
| Files touched | `engine/conductor.ts`, the kickback ledger and budget modules, the daemon resume path, and tests |
| ADR impact | Additive amendment to adr-2026-08-25 D4 and adr-2026-08-22 D5/D6: laps and growth are charged at dispatch, not append |

## Rationale

This is a behavior change in the engine's SHIP-tail halt/resume path. It amends budget accounting
decided in two approved ADRs and must preserve over-scope ordering and rebase re-open semantics.
There are no new integrations and no new halt class. The change is bounded to one seam
(`planRemediation` → build dispatch), which is well above Small. → **Medium.** A lightweight
architecture review is required.
