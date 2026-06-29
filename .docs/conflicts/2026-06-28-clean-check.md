# Conflict Check: Clean Pass

**Date:** 2026-06-28
**Stories checked:** `otel-observability.md` (10 stories, FR-1…FR-10)
**Comparison set:** shipped telemetry layer (`EventPersister`, `events.jsonl`, `conduct --report`
/ `report-renderer.ts`), wave-c story files (empty placeholders), all other stories in
`.docs/stories/`.

**Result:** No blocking or degrading conflicts found.

## Why coexistence holds (evidence)

- **Bus is multicast.** `ConductorEventEmitter` stores handlers as
  `Map<ConductorEvent['type'], Set<EventHandler>>` and `emit()` fans out to every handler,
  swallowing async handler errors. The OTel exporter attaches as an additional listener exactly
  like `EventPersister` — no exclusive access, no contention.
- **Distinct sinks.** `EventPersister` writes `.pipeline/events.jsonl`; the OTel `file` transport
  writes `.pipeline/otel.jsonl` (FR-7). Different files — no resource contention. OTLP transport
  writes to a network endpoint, not the filesystem.
- **No emission-site edits.** FR-1 + PRD Key Decision #6: OTel is purely additive and does not
  modify `events.jsonl` or `conduct --report`. The two observability paths are parallel, not
  competing.
- **Order-independent wiring.** Both `EventPersister` and the OTel exporter are pure listeners
  registered at startup; neither depends on the other → no sequencing/circular conflict.

## Non-blocking alignment note (for plan / architecture-review)

`ConductorEventEmitter.emit()` **awaits** async handlers before returning. The OTel handler MUST
hand off to an async batch processor and return immediately; an in-band blocking OTLP push would
stall the bus for the terminal UI and `EventPersister`. FR-8 already requires export to run off
the emit hot path — carry this constraint into the design.

## Housekeeping observation (not a conflict)

`wave-c-telemetry-event-log.md` and `wave-c-json-stdout-subscriber.md` are 0-byte placeholder
files (the wave-c work shipped as code, not stories). No textual story conflict is possible with
empty files; noted for repo hygiene only.
