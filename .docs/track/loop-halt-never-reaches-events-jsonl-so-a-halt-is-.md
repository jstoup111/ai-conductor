# Track: loop_halt never reaches events.jsonl, so a halt is unreconstructable

Track: technical

Observability correctness inside the engine's own telemetry spine. The terminal halt
event is declared `persist: false`, so `.pipeline/events.jsonl` — the documented single
spine every consumer is told to read — never records why a build stopped, and two live
consumers that count halts from that stream are permanently dead code. No user-facing
product capability is added; acceptance criteria live directly in the stories.

## Scope verdict

Repo-only. The `ConductorEvent` union, `EVENT_SINKS`, `EventPersister` and
`.pipeline/events.jsonl` exist only in this repository — no consumer project carries the
mechanism this change describes — so nothing lands in `HARNESS.md` or the shipped
`skills/` catalog. No new skill is created; no provider-specific behavior is touched.

## Event-spine verdict

```
Event spine
  Channel?    no                       — no watcher, sidecar, bespoke log, or stamped artifact
  Concern:    occurrence               — "the loop stopped, at this step, for this reason"
  Verdict:    extend the union         — flip halt sink flags; add optional `step` to loop_halt;
                                         add one variant for a failed halt-marker write
  Exception:  none                     — the write location does not move
```

The change moves in the direction the spine principle prescribes: it *removes* reliance on
`.pipeline/audit-trail/events.jsonl` (a differently-shaped `AuditRecord` stream) and on
`.daemon/daemon.log` free text as the only recoverable record of a halt.

## Discovery findings (verified against source in this worktree)

- `event-sinks.ts:58` — `loop_halt: { render: true, persist: false, audit: true }`. Confirmed
  verbatim as filed.
- `event-sinks.ts:66` — `rebase_conflict_halt: { render: false, persist: false, audit: false }`
  reaches no sink at all.
- `cost-rollup.ts:174-177` counts `loop_halt`, and `cost-rollup.ts:95` reads
  `<worktree>/.pipeline/events.jsonl`. The filer's *inferred* claim is now **verified**: the
  branch cannot execute and `rollup.halts` is permanently 0.
- A second dead consumer the intake did not name: `report-renderer.ts:202` `aggregateHalts`
  filters `loop_halt` out of the same parsed `events.jsonl`, feeding `EngineerSignal.halts` →
  `computeSignalRates`' `haltRate` (`engine/engineer/rates.ts:97`). `haltRate` is therefore
  also permanently 0.
- `types/events.ts:497-508` — `loop_halt` carries **only** `reason` and an optional `prUrl`.
  It has no `step` field, so persisting it as-is would still not satisfy the desired outcome
  that the halt name the step that actually halted.
- `audit-trail.ts:145` — `case 'loop_halt': return { step: 'build', ... }`. The hardcoded step
  is confirmed.
- `halt-marker.ts:45-67` — `writeHaltMarker` swallows every mkdir/write/rename failure and
  returns `void`; no caller can tell a written marker from a failed one.
- `event-persister.ts` appends synchronously via `appendFileSync`, so a halt recorded
  immediately before process exit is durable — no flush/ordering work is required.
- `EventPersister.start()` subscribes from `persistedEventTypes()`, which is derived from
  `EVENT_SINKS` — flipping the flag is sufficient to wire the halt into the ledger.

## Approaches considered

1. **Flip the sink flags only.** Smallest possible diff, and it revives both dead halt
   counters. Rejected as the whole answer: it cannot satisfy the step-attribution outcome,
   because the event has no step to record.
2. **Flip the flags and stamp the step per emit site.** Correct per site, but there are ~30
   `loop_halt` emit sites in `conductor.ts` and the next one added silently omits the field.
   Rejected against this repository's Design Principle — machinery over author discipline.
3. **Flip the flags, stamp the step centrally, and give a failed marker write its own
   variant.** Chosen. A conductor-owned halt emit path stamps the current step so no emit
   site can forget it, and the halt marker's write outcome becomes an occurrence on the same
   bus rather than a swallowed exception.

## Operator decisions (confirmed 2026-08-11)

- Step attribution: **central stamp**, not per-site arguments and not downstream derivation.
- Halt-marker write failure: **a new spine event**, not a stderr warning.

## Non-goals

- `loop_converged`, `build_review_base`, `pipeline_closeout` and the other `persist: false`
  declarations are out of scope. Only halt-class events change sink, so non-halt event
  volume is unchanged.
- The `.pipeline/HALT` marker itself stays durable state read by name (event-spine
  exception C). It is not replaced by an event; only its *write outcome* becomes one.
- The audit trail is not removed. Its `loop_halt` step attribution is corrected in place.
