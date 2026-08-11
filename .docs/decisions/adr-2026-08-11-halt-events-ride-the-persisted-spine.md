# ADR: Halt events ride the persisted spine, with a centrally stamped step

**Date:** 2026-08-11
**Status:** APPROVED
**Deciders:** Operator (jstoup111), architecture-review for #1477

## Context

`.pipeline/events.jsonl` is the documented single event spine, and the terminal halt event is
absent from it. Three questions had to be settled before implementation: **what routes to the
ledger**, **how the halt learns which step it happened in**, and **how a failed halt-marker
write stops being silent**.

Verified facts, all read directly in the worktree:

- `event-sinks.ts:58` declares `loop_halt: { render: true, persist: false, audit: true }`, and
  `event-sinks.ts:66` declares `rebase_conflict_halt: { render: false, persist: false,
  audit: false }` — no sink at all.
- `EventPersister.start()` subscribes from `persistedEventTypes()`, which is derived from
  `EVENT_SINKS`. The sink table is the whole routing decision; the persister needs no change.
- `cost-rollup.ts:95` reads `<worktree>/.pipeline/events.jsonl` and `cost-rollup.ts:174-177`
  increments `rollup.halts` on `loop_halt`. That branch has never executed in production.
- A second consumer the intake did not name is dead the same way: `report-renderer.ts:202`
  (`aggregateHalts`) filters `loop_halt` from the same parsed ledger, feeding
  `EngineerSignal.halts` and therefore `computeSignalRates`' `haltRate`
  (`engine/engineer/rates.ts:97`).
- `types/events.ts:497-508` gives `loop_halt` exactly two fields, `reason` and optional
  `prUrl`. **There is no `step`.** Persisting the event unchanged cannot satisfy the
  step-attribution outcome.
- `audit-trail.ts:145` returns `{ step: 'build', event: 'intervention', cause: event.reason }`
  for every halt, regardless of where it happened.
- `conductor.ts:3923` already assigns `breadcrumb.lastAdvancedStep = step.name` on every step
  loop iteration, and `conductor.ts:9391` already exports `resolveLastStep(state, breadcrumb)`
  with a preference order that degrades safely. The input for a step stamp already exists.
- `halt-marker.ts:45-67` — `writeHaltMarker` returns `Promise<void>` and swallows every
  mkdir/unlink/write/rename failure.
- `event-persister.ts` writes with `appendFileSync`, so a record emitted immediately before
  process exit is durable.

The filer's stated hypothesis — that `persist: false` might be a deliberate render/audit-only
choice predating the ledger's promotion to the spine — is not sustainable once
`cost-rollup.ts:174` is read. Code that counts halts *from the persisted stream* was written
against the assumption that halts persist. The declaration and its consumers contradict each
other; the consumers describe the intent.

## Decision

**1. Halt-class events persist.** `loop_halt` becomes `persist: true`.
`rebase_conflict_halt` becomes `render: true, persist: true` so a rebase halt is both visible
and recoverable. No other sink declaration changes, so non-halt event volume is unchanged.

**2. `loop_halt` gains an optional `step`, stamped centrally.** A single conductor-owned emit
path resolves the step via the existing `resolveLastStep(state, breadcrumb)` and stamps it;
every existing `loop_halt` emit site routes through that path. `rebase_conflict_halt` gains
the same optional field, stamped `rebase` at its one emit site (`rebase.ts:1306`).

**3. The audit translator reads the event's step.** `audit-trail.ts:145` uses `event.step`,
falling back to `'build'` only when the field is absent, so the two streams agree.

**4. A failed halt-marker write becomes an occurrence.** `writeHaltMarker` returns a result
instead of `void`, still never throws, and emits a new `halt_marker_write_failed` variant
(`render: true, persist: true, audit: true`) when an emitter is available to it.

## Options Considered

### Step attribution

**Option A — per-emit-site argument.** Add optional `step` and pass it at each of the ~30
`loop_halt` emit sites in `conductor.ts`.
- **Pros:** maximally precise; each site states its own step.
- **Cons:** thirty opportunities to omit the field, and the next emit site added omits it
  silently with no failing test. This is exactly the author-discipline pattern this
  repository's Design Principle names as the wrong fix.
- **Rejected.**

**Option B — central stamp (CHOSEN).** One conductor-owned emit path stamps the step from the
breadcrumb the loop already maintains.
- **Pros:** a new emit site cannot forget the field, because it does not supply it. Reuses
  `breadcrumb.lastAdvancedStep` and `resolveLastStep`, both of which already exist and are
  already tested. Machinery, not discipline.
- **Cons:** the stamp is the loop's last-advanced step rather than a site-specific claim, so a
  halt raised after a step has settled but before the next begins attributes to the settled
  step. Accepted: that is the correct attribution for "where did the run stop", and it is
  strictly better than today's unconditional `'build'`.

**Option C — derive downstream.** Leave the schema alone; let each reader infer the step from
the preceding `step_started`.
- **Pros:** no schema change at all.
- **Cons:** the record is not self-describing, positional inference is ambiguous under
  parallel groups (`parallel_started` / `group_member_step`), and the work is duplicated into
  every consumer — including the audit translator, which is the one that is wrong today.
- **Rejected.**

### Halt-marker write failure

**Option D — return a status and warn on stderr.**
- **Pros:** no schema change; touches only the writer.
- **Cons:** routes the failure into `.daemon/daemon.log` free text, which is precisely the
  fallback diagnosis path this feature exists to eliminate. Invisible to the ledger, the
  dashboard, and the cost rollup. (Not a point of difference for the OTel exporter — see
  "OTel is out of scope" below; neither option reaches it.)
- **Rejected.**

**Option E — a new spine variant (CHOSEN).** `halt_marker_write_failed` on the same bus.
- **Pros:** consistent with every other decision here; one schema, one reader path; the
  operator finds it in the same file as the halt it belongs to.
- **Cons:** the four halt-marker call sites without a live emitter (`task-progress.ts`,
  `self-host/gate-halt.ts`, `provider-lifecycle.ts`, `self-host/build-auth-preflight.ts`) need
  an optional emitter threaded from their callers. Accepted; the writer still returns a
  non-silent result when no emitter is available, so no site regresses to today's silence.

### Sink routing

**Option F — persist every `persist: false` event.** Rejected: the intake explicitly requires
that non-halt event volume not measurably grow, and `loop_converged`, `build_review_base`,
`pipeline_closeout` and the rebase-lifecycle events are out of scope for this feature.

## OTel is out of scope, and why that is worth stating

`EVENT_SINKS` is not the only routing table. `OtelVisualizer.start`
(`engine/otel/otel-visualizer.ts:298-311`) subscribes from its **own hardcoded list** of
twelve event types and dispatches through a matching `switch`
(`otel-visualizer.ts:394-441`). It does not read `EVENT_SINKS`, `persistedEventTypes()`, or
any other sink helper.

`loop_halt` appears in neither the list nor the switch. Consequently:

- Nothing in this ADR makes a halt visible to the OTel exporter. A halted run still exports a
  trace with no terminal signal — and, because `step_started` opens a span that only
  `step_completed`/`step_failed` close, a halt mid-step leaves that span unclosed.
- `halt_marker_write_failed` will likewise not reach OTel.

This is deliberately **not** fixed here: #1477's desired outcomes are all stated against
`.pipeline/events.jsonl`, and widening this spec to a second subscriber would change the
feature's shape without operator intent. It is recorded because a reader of this ADR would
otherwise reasonably assume that "extend the union and declare a sink" reaches every consumer.
It does not.

The duplicate routing table is the deeper issue — a second, silently-diverging declaration of
"which events matter" — and is filed separately rather than absorbed into this feature.

## Event-spine compliance

```
Event spine
  Channel?    no                 — nothing new observes, polls, or stamps an artifact
  Concern:    occurrence         — "the loop stopped, at this step, for this reason"
  Verdict:    extend the union   — sink flags + two additive optional fields + one variant
  Exception:  none               — the write location does not move
```

This change *reduces* parallel-channel reliance: the halt stops being recoverable only from
the differently-shaped `AuditRecord` stream and the daemon log. `.pipeline/HALT` remains
durable state read by name (exception C) and is not replaced by an event.

## Consequences

- `rollup.halts` and `haltRate` report real counts for the first time. Any test asserting
  they are zero after a halt is asserting the defect and must be updated.
- Consumers that snapshot `persistedEventTypes()` will see three new members.
- Halt records gain one small field; the added ledger volume is one record per halt, plus one
  per failed marker write.
- `writeHaltMarker`'s signature changes from `Promise<void>` to a result-returning call at six
  call sites. It is internal to the engine — no consumer-visible CLI, hook, or
  `settings.json` surface changes, so this is not a breaking release surface.
