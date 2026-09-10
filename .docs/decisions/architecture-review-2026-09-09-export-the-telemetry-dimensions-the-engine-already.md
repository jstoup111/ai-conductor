# Architecture Review: export-the-telemetry-dimensions-the-engine-already
**Date:** 2026-09-09
**Mode:** lightweight (Tier M, technical track) — Sections 2 and 4 only
**Input reviewed:** `.docs/track/export-the-telemetry-dimensions-the-engine-already.md`, `.docs/architecture/export-the-telemetry-dimensions-the-engine-already.md`, issue jstoup111/ai-conductor#1940
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding)

Only the dimensions still absent from exported telemetry on main as of 2026-09-09: provider and fallback, reasoning effort, complexity tier, model on step duration and retries, and the `TokenUsage` detail (`reasoningOutput`, `numTurns`, `durationMs`, `costSource`). Feature-as-label (#1938) and metering classification (#1972) are shipped and excluded. Spec owner is excluded by operator decision (privacy of "who" needs its own intake). Approach A: direct plumbing, no dimension table (approach B deferred to its own intake).

## Feasibility

| Check | Finding | Confidence |
|---|---|---|
| Stack | No new dependency; `@opentelemetry/api` attribute APIs already in use in `metrics.ts` and `span-manager.ts`. | 98% verified |
| `effort` reachability | Resolved per invocation in `step-runners.ts` (`resolved.effort`, `opts.effortOverride ?? baseResolved.effort`) but not returned on `StepRunResult` (`conductor.ts` `interface StepRunResult`). `model` already takes the runner → `StepRunResult` → `step_completed` path, so `effort` follows it with one added field at each hop. | 95% verified |
| `tier` reachability | `state.complexity_tier` is in scope at the `step_completed` emit site (`conductor.ts`, `emitTracked({ type: 'step_completed', … })`); the same expression already feeds `tier_skip`. | 95% verified |
| `provider` / `fallback` reachability | `provider_attempt` carries `provider`, `model`, `tokenUsage`, `fallbackReason`; `step_completed` carries `preferredProvider`/`actualProvider`. `DispatchMeteringTracker.observe` already selects each invoked dispatch once and drops lifecycle-only rows (`invoked !== true`), returning `{ step, provider, model, tokenUsage }`. Both projections can read provider from that observation. | 95% verified |
| Two projections | Metrics are recorded from two sites that must change together: `MetricsListener.METRICS_HANDLERS` (daemon; `provider_attempt` is an explicit no-op) and the `OtelVisualizer` event switch (interactive; calls `onDispatch(step, tokenUsage, model)` where `MetricsRecorder.onDispatch` discards `_model`). Spans come from `SpanManager` only. | 95% verified |
| Integration surface | `types/events.ts` (two additive optional fields), `conductor.ts` emit site, `step-runners.ts` result, `engine/otel/{metrics,metrics-listener,otel-visualizer,span-manager}.ts`. Four module boundaries, all internal. | verified |
| Data / schema | Additive optional fields on persisted events; every `events.jsonl` reader uses positive type filters (adr-2026-08-13 assumptions). No migration. | 90% inferred |
| Performance | Attribute merges are bounded in-memory work; series growth bounded by closed value sets (5 × 3 × 3 × 2 on top of today's `step × model`). | verified |
| Worktree isolation | No new ports, files, or services. | verified |

## Alignment

- **adr-014 Decision 4** (bounded, no-I/O bus handler): complies — every new attribute is read from the event payload already in hand.
- **adr-014 #1938 / #1937 amendments** (enumerated label sets, growth bound): the enumerated set did not include the new labels. **Amended 2026-09-09** with Decisions 10 (placement contract: bounded → label, unbounded/numeric → trace-only) and 11 (dimensions travel on existing events via the existing tracker; no new event type).
- **adr-2026-07-26-event-sink-registry-exhaustiveness**: complies — no new `ConductorEvent` member.
- **adr-2026-07-27-cost-unmetered-is-a-first-class-state**: complies by construction — `durationMs`/`costSource` are omitted when absent, never zero-filled (Decision 10).
- **adr-2026-07-05-retry-as-escalation-ladder §6**, **adr-2026-08-09 D4**, **adr-2026-08-12 D5**: additive-optional-field precedent for `effort`/`tier` on `step_completed`/`step_failed`.
- **adr-2026-07-29-engine-observed-provider-time-partition D8**: complies — the two elapsed-time fields are untouched; `usage.duration_ms` is the provider-reported `TokenUsage.durationMs`, a different value.
- **adr-2026-08-11-halt-events-ride-the-persisted-spine**: notes the interactive exporter subscribes from its own switch, not `EVENT_SINKS`; that is why both projections must change (condition C1). Not a conflict.
- **Domain boundaries**: otel module stays a consumer of the spine; the engine gains no dependency on otel.
- **Diagram accuracy**: `.docs/architecture/export-the-telemetry-dimensions-the-engine-already.md` reflects this design (owner removed).

**Focused local pattern basis.** The `model` field is the precedent for `effort`: resolved in `step-runners.ts` from the tier/step policy, surfaced on `StepRunResult`, emitted on `step_completed` in `conductor.ts`, read by `MetricsListener.onStepClose`. Traits to preserve: optional at every hop, omitted (not defaulted) when unresolved, never read from config inside the otel module. BUILD rediscovers via `stepResult?.model` at the emit site and `resolved.effort` in the runner.

## Wiring Surface

| New/changed surface | Called from in production |
|---|---|
| `step_completed.effort`, `step_completed.tier` (and `step_failed`) | populated at the existing `emitTracked({ type: 'step_completed' … })` site in `conductor.ts`; `effort` sourced from the new `StepRunResult.effort` returned by `step-runners.ts` |
| `StepRunResult.effort` | set where each runner already sets `model` from `resolved` policy |
| `MetricsRecorder.onStepClose` / `onDispatch` attribute extension | invoked by `MetricsListener.METRICS_HANDLERS.step_completed/step_failed/provider_attempt` (daemon root bus, `wire.ts`) and by the `OtelVisualizer` switch (interactive `index.ts` path) |
| `MetricsListener.METRICS_HANDLERS.provider_attempt` (no-op → real) | subscribed by `MetricsListener.start` for every `otelEventTypes()` row |
| `SpanManager` new step-span attributes | set in `onStepCompleted`/`onStepFailed` and a new `onProviderAttempt` called from the `OtelVisualizer` `provider_attempt` case |

Early overlap scan: run `ai-conductor overlap-scan --files src/conductor/src/types/events.ts src/conductor/src/engine/conductor.ts src/conductor/src/engine/step-runners.ts src/conductor/src/engine/otel/metrics.ts src/conductor/src/engine/otel/metrics-listener.ts src/conductor/src/engine/otel/otel-visualizer.ts src/conductor/src/engine/otel/span-manager.ts` before `/plan` (advisory; result recorded below).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Daemon and interactive projections drift (one gets the new labels, the other does not) | Integration | Medium | Medium | C1: one recorder method signature carries the dimensions; both callers pass the same observation; a test asserts identical attribute sets from both paths |
| `provider_attempt` lifecycle rows (`provider: 'provider-lifecycle'`, `invoked: false`) become a metric label value | Data | Low | Medium | read provider only through `DispatchMeteringTracker.observe`, which drops them |
| `fallback` computed from a missing `preferredProvider` reads as `false` when routing was inactive | Data | Medium | Low | omit `fallback` when `preferredProvider` is absent, per Decision 10's absent-means-omitted rule |
| Label growth on `step.duration` | Performance | Low | Low | closed value sets; bound recorded in Decision 10 |

## ADRs Created

None new. `adr-014-otel-observability-exporter` amended (Decisions 10–11), status stays APPROVED pending operator approval of the amendment text.

## Conditions

- **C1** — Both metric projections (`MetricsListener` and the `OtelVisualizer` switch) record the identical dimension set for a dispatch; a test proves it.
- **C2** — `fallback`, `effort`, `tier`, `provider`, `model` are omitted from attributes when unresolved; no `unknown` placeholder is ever emitted for them.
- **C3** — ADR-014 Decisions 10 and 11 are the placement contract; a plan task that adds any attribute outside that list re-opens the amendment rather than landing it silently.

Overlap scan (2026-09-09): no overlap detected; no open blockers.
