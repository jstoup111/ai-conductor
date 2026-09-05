# Complexity: a-halted-feature-only-re-runs-when-a-human-clears-

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None new: extends the existing kickback ledger gate entry (adr-2026-08-29 D1) with adjustment history + staged adjustment; a typed suite-infra fault counter modeled on the 08-18 mechanical-fault lane |
| External integrations | None |
| Auth / permission surface | Operator-only `kickback-budget` command family — pre-boot dispatch, interactive-terminal gate, machine-scoped identity, mandatory rationale (08-29 D3; adr-2026-08-09 reseal precedent) |
| State machines | Ledger adjustment lifecycle: staged → applied → consumed (08-29 D5/D6); halt clear moves from CLI to the daemon boundary |
| Story count | ~7 (group attempt budget; suite-infra bounded lane; budget-halt reclassification; raise; reset; daemon-side clear on authorization; inspection/exhaustion rendering + status visibility) |
| Files touched | ~10–14: `conductor.ts` (4 sites), `kickback-ledger.ts`, `cli.ts` + `index.ts`, `daemon-cli.ts`/`daemon.ts` halted-feature boundary, `types/events.ts` + sink registry, `daemon-observe-cli.ts`, docs (cli.md, running-the-daemon.md, stalled-or-stuck-feature.md) |
| New runtime code | Yes — engine + daemon + CLI |

## Rationale

Two halves on the daemon's most load-bearing loop, but every structural question is already decided
by APPROVED ADRs (08-18 lane shape; 08-29/08-31 budget recovery), so the review created no ADR. The
previous attempt at the grant half alone (PR #2106) hit 137% plan growth by diverging from those
ADRs; the plan here maps tasks to decisions by citation. Issue is `size: M`. → **Medium.**
Architecture-diagram and lightweight architecture-review done before stories; conflict-check and
coherence-check run after.
