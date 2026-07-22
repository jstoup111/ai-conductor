# Complexity: Global dispatch circuit-breaker

Tier: M

## Signals

| Signal | Assessment |
| --- | --- |
| New models / schemas | None. Reuses the existing `.daemon/parked/<slug>` marker (`park-marker.ts`). |
| Integrations | None external. Internal wiring only (daemon core ↔ daemon-cli). |
| State machines | Adds one small in-memory per-slug counter to the existing `runDaemon` loop. No new persistent state machine (park marker already exists). |
| Config surface | One new config block `circuit_breaker` (`enabled`, `consecutive_failure_ceiling`), mirroring `build_progress_halt` exactly — validate + resolve + default. |
| Story count | ~7 stories (happy trip, no-false-trip, reset-on-progress, cross-restart durability, config, dashboard surfacing, disabled). |
| Blast radius | The dispatch loop is load-bearing for every daemon. Change is additive and gated behind a default-on but bounded knob; the counting is pure and unit-testable. |
| Test surface | Pure-core unit tests on `runDaemon` (counter increments/resets/trips) + a wiring test that the trip writes an auto-park marker + a config validation test. |

## Rationale for Medium (not Small)

- Touches a **load-bearing, concurrency-sensitive** core (`runDaemon`) and must
  **compose** correctly with three existing bounds (escalation ladder #188,
  `build_progress_halt`, progress-gated re-kick ceiling) without duplicating or
  fighting them.
- Introduces a **new persistent-state decision** (in-memory counter vs durable
  counter) that is genuinely ADR-worthy — the #286 "lastRekickSha resets on
  restart" precedent makes the persistence choice load-bearing.
- Adds a **new config key** with validation and documentation obligations
  (README + CHANGELOG + settings schema).

Not Large: no new subsystem, no multi-service coordination, no schema/data
migration, single seam, small diff footprint concentrated in `daemon.ts` +
`daemon-cli.ts` + `config.ts`.

## Tier consequences

- Non-Small ⇒ `/architecture-review`, `/conflict-check`, and an architecture
  artifact are REQUIRED (all produced).
- Medium ⇒ architecture-review is **lightweight** (feasibility + alignment), and
  because a new persistent-state/config decision is introduced, an **APPROVED
  ADR** is produced.
