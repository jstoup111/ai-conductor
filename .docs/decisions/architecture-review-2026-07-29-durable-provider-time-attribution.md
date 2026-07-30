# Architecture Review: Durable Provider-Time Attribution

**Date:** 2026-07-29
**Tier:** Medium (lightweight review)
**Input reviewed:** Approved PRD `2026-07-29-durable-provider-time-attribution.md` (FR-1 through FR-10); stories do not exist yet by design
**Verdict:** APPROVED

## Technical Feasibility

| Check | Finding | Verdict |
|---|---|---|
| Stack compatibility | Existing TypeScript, provider adapters, event persistence, Markdown records, and report parser are sufficient; no package or service is needed. | Feasible |
| Prerequisites | Provider subprocess seams, candidate-attempt events, step lifecycle events, shipped-record rendering, and KPI parsing already exist. | Satisfied |
| Integration surface | Crosses provider capture, model fallback, result conversion, event types, rollup, durable record, and reporting. The path is broad but already connected. | Feasible with propagation tests |
| Data implications | Additive transient event fields and additive committed Markdown fields only; no database, migration, or backfill. | Low risk |
| Performance | Constant-time capture per process plus bounded interval sorting at shipment; no new hot-path I/O or provider call. | Low risk |
| Worktree isolation | All transient evidence remains in the feature-local event ledger; committed timing follows the existing per-feature shipped record. | Preserved |

## Architectural Alignment

- **Provider duration semantics:** aligned with `adr-2026-07-27-cost-unmetered-is-a-first-class-state` by keeping engine-observed intervals outside provider-reported token usage.
- **Durability and honesty:** aligned with the two approved per-feature cost ADRs by appending a separate tolerant section and making partial/unavailable evidence explicit.
- **Concurrency:** aligned with `adr-2026-07-10-concurrent-group-core`; interval union consumes attributable interleaved events without serializing execution.
- **OTel boundary:** aligned with `adr-014-otel-observability-exporter`; #1101 produces durable source evidence and does not require, configure, or rewire the exporter.
- **Diagram accuracy:** the approved component diagram matches the proposed capture → event → union → shipment → report flow and marks future local categories as out of scope.
- **Provider parity:** both built-in adapters implement the same outcome; provider-specific process mechanics remain explicitly scoped inside each adapter.
- **State and security:** no new external input, authorization decision, secret, persistent service, or invalid business state is introduced.

## Wiring Surface

| Production surface | Produced by | Wired into / consumed by |
|---|---|---|
| Plural engine-observed provider intervals on invocation results | Claude and Codex provider subprocess completion paths | Model-availability fallback, then provider execution and scalar step-result conversion |
| Provider-attempt interval evidence | Provider execution's existing attempt-metadata boundary | Existing `onAttempt` callback and feature-scoped event bus persistence |
| Active-step interval evidence | Conductor step lifecycle timing around every executed step | Terminal step events in the same feature-scoped event ledger |
| Dedicated timing rollup | New engine timing-rollup module reading feature events | Shipped-record CLI alongside the existing cost rollup |
| Additive shipment timing section | Shipped-record renderer | Committed per-feature shipped record |
| Tolerant timing parser/report view | KPI report module | Existing `conduct kpi` command dispatch |
| Timing documentation | Artifact and CLI reference pages | Operator documentation index and generated site/navigation conventions already in place |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A result adapter drops earlier model or provider intervals | Integration | Medium | High | Explicit propagation matrix across adapters, model ladder, candidate events, scalar results, grouped branches, and auxiliary callers |
| Concurrent intervals are summed or paired incorrectly | Technical | Medium | High | Pure interval-union helper with overlap, nesting, adjacency, retry, and multi-step fixtures |
| Missing or malformed evidence appears as zero | Data | Medium | High | Three-state evidence model with historical and partial-record acceptance coverage |
| Timing telemetry changes provider or step outcomes | Technical | Low | High | Observational-only fields; failures to observe/classify timing never authorize retry, fallback, or completion |
| Shared provider/conductor files collide with other v1 work | Integration | High | Medium | Re-run overlap scan at plan/build boundaries; land in dependency order and use the sanctioned finish-time rebase |

## Advisory Overlap Scan

`conduct-ts overlap-scan` reported broad overlap across active `spec/*` branches for the provider,
event, conductor, shipped-record, KPI, and documentation paths. This is advisory and does not prove
those branches have implementation diffs, but it identifies these files as v1 integration hotspots.
The plan must keep tasks narrow, declare likely touched files, and require a fresh scan before build.

## ADRs Created

- `adr-2026-07-29-engine-observed-provider-time-partition.md` — **APPROVED** by the operator on 2026-07-29.

## Conditions

None. Stories and the plan must conform to the approved provider-interval propagation and
measured/partial/unavailable compatibility contracts.

## Blocking Issues

None.
