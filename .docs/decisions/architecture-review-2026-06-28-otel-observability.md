# Architecture Review: OTel Observability — Phase 1

**Date:** 2026-06-28
**Mode:** Lightweight (Medium tier — Feasibility + Alignment)
**Stories reviewed:** `otel-observability.md` (FR-1…FR-10, 10 stories)
**Verdict:** APPROVED (conditional on ADR-014 reaching APPROVED before `/writing-system-tests`)

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Adds `@opentelemetry/*` (api, sdk-trace, sdk-metrics, OTLP exporters) to `src/conductor`. Standard, well-supported in Node/TS. No infra changes shipped (collector is operator-run). ✅ |
| **Prerequisites** | None blocking. `visualizer` plugin kind already exists (`types/plugin.ts:8`) but is unwired → Phase 1 adds generic select/start/stop wiring in `index.ts` (mirrors `ui_renderer` at `:509` + `EventPersister` at `:516`). ✅ |
| **Integration surface** | One: subscribe to `ConductorEventEmitter`. No emission-site edits (FR-1). Distinct sink from `events.jsonl`. ✅ |
| **Data implications** | None — no schema, no DB. File transport writes `.pipeline/otel.jsonl`. ✅ |
| **Performance risk** | Real but mitigated: `emit()` awaits async handlers, so the handler MUST hand off to `BatchSpanProcessor` and return immediately. Export I/O is async + bounded-timeout (FR-8). See Risk R1. |
| **Worktree isolation** | File path is per-worktree `.pipeline/otel.jsonl` (no collision). OTLP endpoint shared but `conductor.run.id` disambiguates concurrent runs (FR-6). No new ports/DBs. ✅ |

**Constraint sign-off:** the async-handoff requirement (R1) is feasible — the OTel SDK's
`BatchSpanProcessor`/`PeriodicExportingMetricReader` are designed for exactly this; the bus handler
only invokes non-blocking span/metric APIs.

## Alignment

- **Pattern consistency:** Listener-internals match `EventPersister` precedent exactly. Packaging as
  a `visualizer` plugin activates a reserved-but-unused kind for its intended purpose (Wave C named
  the SSE dashboard a future visualizer). No undocumented new pattern — ADR-014 records the choice.
- **Domain boundaries:** Exporter is strictly downstream of the bus; introduces no coupling back
  into the engine. Respects FR-1 (additive, no emission-site edits).
- **State management:** Exporter is effectively stateless across runs (per-run span map only);
  config is parsed once at construction. Invalid config self-disables with a named error (FR-7) —
  no invalid runtime state.
- **Diagram accuracy:** `.docs/architecture/2026-06-28-otel-observability.md` matches this decision
  (listener on bus → batch → dual transport). The decision-surface diagram's A-vs-B question is now
  resolved by ADR-014 (synthesis: listener internals + visualizer packaging). Diagram remains
  accurate; no update required.
- **Security boundaries:** No new endpoints/inputs exposed by the harness. Outbound OTLP to an
  operator-configured endpoint only. No sensitive-field exposure (events carry step names, timings,
  token counts — not secrets).
- **Coexistence:** Confirmed by conflict-check clean pass — `events.jsonl`/`--report` unaffected.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1: blocking export stalls the bus (emit awaits handlers) | Performance | Low | High | Mandatory async `BatchSpanProcessor` + bounded export timeout; handler returns immediately (FR-8). Asserted in tests ("export never on hot path"). |
| R2: dead collector / unwritable file disrupts run | Integration | Medium | Medium | Catch + single bounded warning; never throw (FR-8). |
| R3: final spans lost if process exits before flush | Data | Medium | Low | Flush-on-exit incl. SIGINT/SIGTERM, bounded (FR-10); incomplete spans force-closed (FR-9). |
| R4: new `@opentelemetry/*` deps enlarge surface/build | Technical | Low | Low | Pin versions; deps confined to `src/conductor`; tree-shakeable. |

## ADRs Created

- **ADR-014: OpenTelemetry Observability Exporter** — `Status: DRAFT`. Decides: listener internals +
  `visualizer`-plugin packaging + Phase-1 generic visualizer wiring; off-hot-path async batch;
  failure isolation; dual transport; sub-decisions (OTLP default HTTP/4318, run-id source, OTLP-JSON
  file encoding). **Must reach APPROVED before `/writing-system-tests` (hard gate §7b).**

## Conditions

1. ADR-014 approved by the operator (DRAFT → APPROVED) before BUILD.
2. Implementation MUST keep export off the bus hot path (R1) — this is an evaluator/`finish` check.
