# Complexity: staleness-decisions-invisible-in-daemon-log

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One — an event-sink registry type (`Record<ConductorEvent['type'], SinkDeclaration>`) replacing three hand-maintained list literals |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None |
| Story count | ~6 (outcome discrimination at every return site; renderer; persister; audit trail; compile-time exhaustiveness; deliberate-omission declaration) |
| Files touched | ~7 runtime (`types/events.ts`, `engine/artifacts.ts`, `engine/conductor.ts`, `engine/event-persister.ts`, `engine/audit-trail.ts`, `daemon-cli.ts`, new registry module) + tests + `docs/` |
| New runtime code | Yes — new registry module, a new discriminated payload field, one new renderer case |
| Blast radius | Wide-ish: exhaustiveness forces a sink decision for all 57 event types; enabling persistence for ~28 previously-dropped types changes `events.jsonl` content and volume |

## Rationale

Larger than Small on three independent counts.

**It changes a shared type consumed across the engine.** Replacing `verdictFreshness.fresh`
(boolean) with a discriminated outcome touches every producer in `artifacts.ts` — the pass,
stale and preserve return sites for `build_review`, `prd_audit`,
`architecture_review_as_built` and `manual_test` — plus the single consumer in
`conductor.ts:4104-4114` and the event type in `types/events.ts`. Two preserve paths
currently return a bare `{ done: true }` and must start populating the payload, which is a
behavioral change to what those steps emit, not just a rename.

**It introduces a cross-cutting compile-time contract.** The registry has to be authored so
that adding a `ConductorEvent` member fails the build until its sinks are declared, and so
that "emitted but deliberately not persisted" is an expressible, reviewable declaration
rather than an omission. That is a design decision with alternatives worth an ADR, not a
mechanical edit.

**It has a real blast radius.** `ALL_EVENT_TYPES` currently drops 28 of 57 types; making the
sink set explicit forces a deliberate decision for each one, and any type newly routed to
`events.jsonl` changes the size and shape of a file other tooling may parse. The migration
posture for existing consumers has to be settled before implementation.

Not Large: no new subsystem, no data migration, no external integration, no auth or
concurrency surface, and the whole change is confined to the telemetry path — the gating
logic that *decides* preserve-vs-invalidate is untouched, only its reporting.

→ **Medium.** `/architecture-diagram`, `/architecture-review` (lightweight), `/conflict-check`
and `/coherence-check` all run for this tier.
