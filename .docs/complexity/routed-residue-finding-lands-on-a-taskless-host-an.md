# Complexity: Routed residue finding lands on a taskless host and halts the stack (#3590)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None new. The route record may carry a per-host no-op marker so round close can tell whether any host did work |
| External integrations | None |
| Auth / permission surface | None |
| State machines | Route-record host transitions gain a settled no-op exit for an admitted audit host (to the existing `done` state), followed by the existing `advanceRound` |
| Story count | ~3–4: task-bound ADR-citing findings route mechanically, a no-op audit host settles and the round advances, an all-no-op round still halts, and `halt clear` recovers an already-stuck round |
| Files touched | ~6–8 production: `routing/round-router.ts`, `routing/host-region-entry.ts`, `routing/route-types.ts`, `routing/route-record-store.ts`, `routing/routed-exit.ts`, `conductor.ts`, and possibly `types/events.ts`, plus their tests |
| ADR work | Amend `adr-2026-10-12-routed-whole-feature-repair` decisions 3 and 7, and `adr-2026-07-13-kickback-build-no-op-escalation` D1. No new ADR expected |

## Rationale

Medium. The change is confined to the routing subsystem and reuses the existing host states, the
round-advance path and the event spine. It does change a deliberate halt (kickback-no-op D1, as
amended by #3211) and a durable route-record lifecycle. A wrong settle could close a round with a
real repair undone, or let a round spin, so a lightweight architecture review and a conflict check
are warranted. It is not Large: no new subsystem, no new CLI, and no change to the cursor or
restack contracts.
