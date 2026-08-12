# Architecture Review (lightweight, Tier M) — Halt events reach the persisted spine

**Stem:** `loop-halt-never-reaches-events-jsonl-so-a-halt-is-` · 2026-08-11 · **Verdict: APPROVED**

## Feasibility

- **Routing needs no new machinery.** `EVENT_SINKS` (`event-sinks.ts:9`) is the single routing
  declaration and `EventPersister.start()` subscribes from `persistedEventTypes()`. Flipping
  `persist` is the entire wiring for outcome 1.
- **The step input already exists.** `conductor.ts:3923` assigns
  `breadcrumb.lastAdvancedStep = step.name` every iteration, and `resolveLastStep(state,
  breadcrumb)` (`conductor.ts:9391`) is an exported pure helper with a safe degradation order.
  The central stamp composes these two; it invents neither.
- **The schema edit is additive.** `loop_halt` (`types/events.ts:497`) gains an optional
  `step`. `rebase_gate_invalidated` (`types/events.ts:555`) already carries `gate: StepName`,
  so the type is imported and in use in this file.
- **`EventPersister` tolerates the new field.** Its `'step' in event` branch
  (`event-persister.ts:80`) only opens/closes intervals for `step_started`,
  `step_completed`, `step_failed` and the `parallel_*` pair; a `loop_halt` carrying a step
  falls through the interval bookkeeping without effect. Verified by reading the whole
  `persist` body.
- **Durability is not a concern.** `appendFileSync` means a halt emitted immediately before
  process exit is on disk. No shutdown ordering work.
- **The dead consumers are two, not one.** `cost-rollup.ts:174` and `report-renderer.ts:202`
  both read `loop_halt` from the persisted ledger. Both revive from the same flag flip; both
  need regression coverage.
- **The emitter-less call sites are bounded.** Of the six `writeHaltMarker` callers,
  `conductor.ts`, `rebase.ts` and `daemon-runner.ts` already hold a `ConductorEventEmitter`;
  `task-progress.ts` (`writeStallHalt`), `self-host/gate-halt.ts` (`writeSelfHostHalt`),
  `provider-lifecycle.ts` (`createProviderLifecycleSupervisor`) and
  `self-host/build-auth-preflight.ts` (`preflightBuildAuthCheck`) do not. Each is a single
  exported function that can take an optional emitter — a bounded, mechanical thread-through.

## Alignment / risk

- **Event-spine compliance:** no new channel; the union is extended and the write location is
  unchanged. The change removes reliance on the audit trail and the daemon log as the only
  halt record. Verdict block recorded in the ADR and the track doc.
- **Design Principle (machinery over discipline):** the central stamp is the whole reason
  Option A was rejected. A reviewer must reject any implementation that reintroduces a
  per-site `step` argument on `loop_halt`.
- **Volume risk (explicit intake constraint):** discharged by scope. Only three sink
  declarations change, all halt-class. `loop_converged`, `build_review_base`,
  `pipeline_closeout` and the rebase-lifecycle events keep `persist: false`.
- **Regression risk — tests that encode the defect:** `test/engine/event-sinks.test.ts`,
  `test/engine/cost-rollup.test.ts` and the `report-renderer`/`rates` tests may assert today's
  zero counts or today's persisted-type set. Those assertions are the defect, not the
  contract; they change with an explanatory note rather than being worked around.
- **Attribution risk:** the stamp reports the loop's last-advanced step. For a halt raised
  between a settled step and the next dispatch, that is the settled step. This is correct for
  "where did the run stop", and unconditionally better than the current hardcoded `'build'`.
  The stories pin this as an explicit expected behavior, not an accident.
- **Fail-soft:** `writeHaltMarker` must still never throw. A failed marker write emits and
  returns; it does not crash the finish flow. A failed *emit* must not resurrect the swallow —
  the returned result is the floor.
- **No consumer-visible surface:** no `bin/conduct` CLI, hook wiring, skill symlink or
  `settings.json` schema change. No migration block is required.

## Wiring Surface

Every new production surface and where it is called from:

- `Conductor.emitLoopHalt` — called from every existing `loop_halt` emit site in
  `src/conductor/src/engine/conductor.ts` (the ~30 sites at `:2792`, `:3827`, `:3876`,
  `:4092`, `:4159`, `:4506`, `:4548`, `:4579`, `:4706`, `:4778`, `:4827`, `:5020`, `:5093`,
  `:5161`, `:5227`, `:5293`, `:5551`, `:5929` and their siblings). No `loop_halt` object
  literal remains outside it.
- `loop_halt.step` (schema field) — written by
  `src/conductor/src/engine/conductor.ts#emitLoopHalt`; read by
  `src/conductor/src/engine/audit-trail.ts#toAuditRecord`.
- `rebase_conflict_halt.step` (schema field) — written at
  `src/conductor/src/engine/rebase.ts:1306`.
- `halt_marker_write_failed` (event variant) — emitted from
  `src/conductor/src/engine/halt-marker.ts#writeHaltMarker`; declared in
  `src/conductor/src/engine/event-sinks.ts`; rendered by
  `src/conductor/src/ui/terminal-renderer.ts`.
- `HaltMarkerWriteResult` (return contract) — consumed by
  `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/rebase.ts`,
  `src/conductor/src/engine/daemon-runner.ts`,
  `src/conductor/src/engine/task-progress.ts#writeStallHalt`,
  `src/conductor/src/engine/self-host/gate-halt.ts#writeSelfHostHalt`,
  `src/conductor/src/engine/provider-lifecycle.ts#createProviderLifecycleSupervisor`,
  `src/conductor/src/engine/self-host/build-auth-preflight.ts#preflightBuildAuthCheck`.

## Conditions

- ADR `adr-2026-08-11-halt-events-ride-the-persisted-spine.md` is **APPROVED** (no DRAFT).
- The plan must not introduce a per-site `step` argument on `loop_halt` — the central stamp is
  the decision, and a per-site variant fails this review.
- A halt raised in a step other than `build` must be an explicit acceptance test in both the
  persisted ledger and the audit record — the hardcoded `'build'` is the specific defect.
- The revived halt counters (`cost-rollup`'s `rollup.halts` and `rates`' `haltRate`) each
  need a test asserting a non-zero count after a halt.
- A test must pin that no non-halt event's sink declaration changed, so the volume constraint
  is machine-enforced rather than asserted in prose.
- `docs/` upkeep: the event/sink reference documentation must be updated in the same PR.

**APPROVED for stories → conflict-check → plan.**
