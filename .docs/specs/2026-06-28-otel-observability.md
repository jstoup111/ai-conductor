# PRD: OpenTelemetry Observability for the Harness

**Date:** 2026-06-28
**Status:** Approved

> **Delivery:** Each phase is its own feature — its own worktree, branch, and PR — run as a
> separate pass through the conduct loop. This PRD is the shared source; the current pass
> implements **Phase 1 only**. Phases 2 and 3 re-enter conduct later, reusing this PRD as
> context. Phase 3 is **gated by a feasibility spike** (see FR-14 / Open Questions) before its
> build effort is committed.

## Problem / Background

The harness can persist its own runtime events but cannot export them to standard
observability tooling. Wave C (`.docs/specs/2026-05-01-wave-c-second-visualizer-and-telemetry.md`,
**Approved**, shipped) delivered the foundation:

- A `ConductorEvent` bus (`src/conductor/src/ui/events.ts`) carrying `step_started`,
  `step_completed` (with `tokenUsage`), `step_failed`, `step_retry`, plus `gate_verdict`,
  `kickback`, `loop_*`, `build_stall`, `parallel_*`, and `rebase_*` events.
- `EventPersister` (`src/conductor/src/engine/event-persister.ts`) — a pure listener that
  subscribes to the bus and appends timestamped JSONL to `.pipeline/events.jsonl` **without
  modifying any emission site**.
- `report-renderer.ts` + `conduct --report` — derives per-step durations by pairing
  `step_started`/`step_completed`, plus retry hotspots and token spend.

What's missing: that data lives in a local JSONL file and a bespoke text report. There is no
way to ship it into the observability tools teams already run — no trace waterfall of a run,
no metric dashboards of "how long does each step take" or "which step retries most" over time.
The harness optimization targets (correctness, gating, minimal intervention) are measurable
per-run but not **observable** in standard tooling.

This feature adds an **OpenTelemetry exporter** that translates the existing event stream into
OTel traces (a span per SDLC step/task/subagent, nested under a run span) and metrics
(durations, retries, tokens), shipped over OTLP to a collector/backend **or** to a local file
for offline ingestion — so any OTel-compatible tool (Jaeger, Grafana Tempo, Prometheus,
Honeycomb, etc.) can ingest and visualize harness runs.

## Goals & Non-Goals

**Goals**
- Emit one OTel **trace per harness run**, with a **span per SDLC step** carrying accurate
  start/end timing (answers "how long does each step take").
- Emit OTel **metrics**: step-duration histogram, retry counter, token counters (answers
  "which step is slowest / retries most" aggregated across runs).
- Support **two transports, config-selected**: live OTLP push to an endpoint, or a local
  OTel file for a sidecar/tool to ingest later.
- Deliver depth in **risk order**: step-level (purely additive) first; build-task and
  subagent spans as later, instrumented phases.
- Be **opt-in and non-intrusive**: disabled by default, zero behavioral change when off, and
  a failed/unreachable exporter must never fail or slow a harness run.

**Non-Goals**
- Shipping or operating a collector/backend. The harness is a producer; the user runs the
  consumer (Jaeger/Tempo/Prometheus/Grafana/Otel-Collector).
- Cost calculation from token counts ($ per token) — raw counts only, consistent with Wave C.
- Replacing `events.jsonl` or `conduct --report` — those remain; OTel is an additional sink.
- Log signals (OTel logs) — traces + metrics only this iteration.
- Cross-run aggregation logic inside the harness — aggregation is the backend's job.

## Users / Personas

- **Harness operator (James)** — runs interactive `conduct` and autonomous daemon builds;
  wants a trace waterfall to see where a run spent its time and metric dashboards to spot
  slow/retry-heavy steps across many runs, in tools already running locally.
- **External observability tool** — any OTLP-compatible collector/backend that ingests the
  exported traces & metrics; or a sidecar tool that tails the exported OTel file.
- **Harness maintainer** — needs the exporter to be additive and isolated so it can't
  destabilize the conductor.

## Functional Requirements

Enumerated, testable. Grouped by delivery phase. **Phase 1 is purely additive** (bus
subscription only, mirrors `EventPersister`). **Phases 2–3 require new emission points** and
are separable units of work; each may ship in its own PR.

### Phase 1 — Run + step traces, metrics, dual transport (additive)

- **FR-1:** The exporter subscribes to the `ConductorEvent` bus as a listener (the
  `EventPersister` pattern) and modifies **no** existing emission site. With the exporter
  disabled or absent, conductor behavior and event emission are byte-for-byte unchanged.
- **FR-2:** On the first event of a run, the exporter opens a root **run span**; on
  `feature_complete` (or process end) it closes the run span. All step spans for that run are
  children of the run span (one trace per run).
- **FR-3:** Each `step_started` opens a **step span** whose name is the step name; the
  matching `step_completed` / `step_failed` closes it. Span duration equals wall-clock between
  the two events. The span status is set OK on `step_completed` (`status: done`) and ERROR on
  `step_failed`.
- **FR-4:** Step spans carry attributes derived from the event stream: `conductor.step`,
  `conductor.step.index`, `conductor.step.status`, `conductor.complexity_tier` (when known),
  and `conductor.retry.count` (from `step_failed.retryCount` / `step_retry`). `gate_verdict`,
  `kickback`, and `step_retry` events for a step are recorded as **span events** on the open
  step span.
- **FR-5:** The exporter emits metrics: `conductor.step.duration` (histogram, milliseconds,
  attribute `step`), `conductor.step.retries` (counter, attribute `step`), and
  `conductor.step.tokens` (counter, attributes `step` and `kind` ∈ {input, output, cacheRead,
  cacheCreation}) populated from `step_completed.tokenUsage` when present and **skipped when
  absent** (token usage is optional per Wave C).
- **FR-6:** Every span and metric carries OTel **Resource** attributes identifying the run:
  `service.name` (e.g. `ai-conductor`), a generated/sourced `conductor.run.id`,
  `conductor.feature` (feature slug/desc when available), and `conductor.project`. Because bus
  events carry no run/feature id, the exporter establishes run correlation itself (e.g. from
  `.pipeline/conduct-session-id` / `feature_complete.featureDesc`, else a generated id at run
  start).
- **FR-7:** Transport is config-selected via `.ai-conductor/config.yml`:
  `otel: { exporter: otlp | file, endpoint: <url>, file: <path> }`. `otlp` pushes spans &
  metrics to `endpoint` (OTLP/HTTP default, gRPC supported); `file` writes OTLP-encoded output
  to `file` (default `.pipeline/otel.jsonl`) for offline ingestion. Absent/empty `otel` config
  ⇒ exporter disabled (default off).
- **FR-8 (negative/edge — resilience):** If the OTLP endpoint is unreachable, times out, or
  the file path is unwritable, the exporter logs one structured warning (surfaced as a
  `renderer_error`-class event, not a throw) and the harness run continues unaffected. A dead
  collector never blocks, slows beyond a bounded export timeout, or fails a build. (Contrast:
  `EventPersister` re-throws; the OTel exporter must isolate failures.)
- **FR-9 (negative/edge — incomplete spans):** If a run ends with a step span still open
  (process killed, `step_completed` never arrived), the exporter closes the open span(s) with
  status ERROR / `conductor.incomplete = true` on flush, so traces are never silently dropped
  or left dangling.
- **FR-10 (edge — flush):** On run end and on process exit (including SIGINT/SIGTERM), the
  exporter flushes pending spans/metrics within a bounded timeout before exit, so the last
  run's data is not lost.

### Phase 2 — Build-task child spans (requires new task lifecycle events)

- **FR-11:** The engine emits `task_started` / `task_completed` (and `task_failed`) events for
  build-phase tasks, derived from `.pipeline/task-status.json` transitions (today only
  aggregate `resolvedTasksBefore/After` deltas exist). These are additive new event types on
  the bus.
- **FR-12:** The exporter opens a **task span** per build task as a child of the `build` step
  span, named by task id/description, with `conductor.task.id` and `conductor.task.status`
  attributes, and emits a `conductor.task.duration` histogram metric.
- **FR-13 (negative/edge):** A task that is retried produces a single task span with
  `conductor.task.retries` incremented (not duplicate spans); a task abandoned at run end is
  closed ERROR per FR-9's rule.

### Phase 3 — Subagent child spans (requires dispatch-boundary instrumentation)

- **FR-14:** Subagent dispatches within a build task (TDD `red` / `green` / domain review,
  evaluator/code-review, simplify) emit start/end signals from the dispatch boundary (these are
  Claude-orchestrated, inside the `claude -p` build subprocess, and invisible to the TS engine
  today). **Feasibility: confirmed, two candidate mechanisms, both with caveats — decided in
  architecture-review and validated by a spike (below) before build:**
  - **(A) Claude Code lifecycle hooks** — `PreToolUse` (matcher `Task`) = start, `SubagentStop`
    = end. Proven integration point (the harness already registers `hooks/claude/*.sh` via
    `bin/install`). **Caveat:** the two hooks are separate out-of-process invocations; pairing
    start↔end needs shared keyed state and is **ambiguous under parallel/nested subagents**
    (which the harness does).
  - **(B) `--output-format stream-json` parsing** — switch the build dispatch off
    `--output-format text` and parse `Task` `tool_use`/`tool_result` events into spans. Single
    ordered correlated stream → clean pairing and explicit nesting; the provider already parses
    stream-json for token usage. **Caveat:** changes the build provider output path; more
    invasive and schema-coupled.
  - Either mechanism depends on dispatch prompts/labels being **structured/parseable** (harness
    controls them) and on a `conductor.run.id` written where the boundary can read it (FR-6).
- **FR-14a (spike gate):** Before Phase 3 implementation, a throwaway spike MUST demonstrate
  start↔end correlation for at least one real concurrent build dispatch via the chosen
  mechanism. If correlation proves too brittle, Phase 3 is **deferred** and the harness ships at
  Phase 2 granularity (FR-16) — Phases 1–2 do not depend on this.
- **FR-15:** The exporter renders each subagent dispatch as a child span of its task span,
  named by phase (e.g. `tdd:red`), with `conductor.subagent.kind` and outcome attributes.
- **FR-16 (negative/edge):** If subagent signals are missing or malformed for a task, the task
  span is still emitted complete (Phase 3 degrades to Phase 2 granularity, never breaks the
  trace).

## Non-Functional Requirements

- **Additive & isolated:** Phase 1 touches no emission site (FR-1). Exporter failures are
  contained (FR-8) — observability must never reduce harness reliability.
- **Opt-in, zero-cost-when-off:** Disabled by default; no measurable overhead and no new
  network/file activity when `otel` config is absent.
- **Bounded overhead when on:** Export is batched/async (OTel BatchSpanProcessor /
  PeriodicExportingMetricReader); per-event work on the bus hot path is O(1) and non-blocking.
- **Standards-compliant:** Uses official `@opentelemetry/*` SDK and OTLP exporters; attribute
  naming follows OTel semantic conventions where applicable, harness-specific keys namespaced
  under `conductor.*`.
- **Daemon parity:** Works identically for interactive `conduct` and autonomous daemon runs
  (both drive the same event bus).
- **Testable without a network:** The `file` transport and a fixture/in-memory exporter allow
  asserting span trees & metrics deterministically in CI, with no live collector.

## Acceptance Criteria / Success Metrics

- With `otel.exporter: file` configured, a full `conduct` run produces an OTLP file whose
  decoded contents contain exactly one run span with one child span per executed step, each
  with a positive duration, correct status, and the FR-4 attributes.
- With `otel.exporter: otlp` pointed at a local collector (or in-memory test collector), the
  same spans and the FR-5 metrics arrive at the collector.
- Killing a collector mid-run leaves the harness run unaffected and surfaces exactly one
  warning (FR-8).
- A run interrupted mid-step yields a closed, ERROR-marked incomplete span (FR-9).
- With `otel` config absent, `events.jsonl`, `conduct --report`, and all existing tests behave
  identically (FR-1).
- All FRs in the shipped phase(s) covered by passing tests; `test/test_harness_integrity.sh`
  green; `npm run build` clean.

## Scope

### In Scope
- **Phase 1 (this PR):** OTel exporter (run + step spans, metrics, OTLP + file transports,
  config, resilience, flush) as an additive bus listener / plugin.
- Config schema additions under `otel:` in `.ai-conductor/config.yml`.
- `@opentelemetry/*` SDK + OTLP exporter dependencies.
- Tests: span-tree/metric assertions via file transport + in-memory exporter; resilience and
  incomplete-span cases; a config-absent no-op regression test.
- CHANGELOG `[Unreleased]` entry; docs updates (README + `src/conductor/README.md`).

### Out of Scope
- **Phase 2 & 3** are specified here for design coherence but are **separate, optional PRs**;
  Phase 1 ships standalone and is independently valuable.
- Operating/shipping a collector or dashboards; example collector config may be docs-only.
- OTel **logs** signal; cost-in-dollars; cross-run aggregation inside the harness; log
  rotation for the OTLP file (relies on per-feature `.pipeline/` lifecycle, as `events.jsonl`).

## Key Decisions & Rationale

1. **Additive exporter, not new emission sites (Phase 1).** Mirrors `EventPersister`: subscribe
   to the existing bus and translate. Keeps the high-value step-timing/metrics deliverable
   purely additive and low-risk; the run can't be destabilized by the exporter.
2. **Depth delivered in risk order.** Step spans are free (bus already emits them). Build-task
   spans need new `task_*` events (Phase 2). Subagent spans need dispatch-boundary
   instrumentation the TS engine can't currently see (Phase 3). Phasing avoids coupling the
   easy 80% to the hard 20% and lets Phase 1 ship now.
3. **Dual transport, config-selected.** `otlp` serves live dashboards; `file` enables offline
   replay and network-free CI testing. One plugin, two exporters, selected by config — covers
   "another tool can ingest" whether or not a collector is live.
4. **Failures are isolated, not fatal.** Unlike `EventPersister` (which re-throws), a dead
   collector or bad path must never fail a build. Observability is strictly best-effort.
5. **Exporter establishes run correlation.** Bus events carry no run/feature id (confirmed by a
   comment in `daemon-cli.ts`); the exporter derives a `conductor.run.id` and feature slug for
   OTel Resource attributes so spans group into one trace per run.
6. **Coexists with Wave C, doesn't replace it.** `events.jsonl` and `conduct --report` stay;
   OTel is an additional sink for teams with existing observability stacks.
7. **One PR per phase, each a separate conduct pass.** Phase 1, 2, and 3 each get their own
   worktree/branch/PR and run through conduct independently, reusing this PRD as context. This
   keeps the additive, high-value Phase 1 shippable now and isolates the riskier phases. Phase 3
   is additionally **spike-gated** (FR-14a) so a brittle-correlation finding defers it without
   blocking the rest.

## Dependencies
- Wave C foundation (shipped): `ConductorEvent` bus, `EventPersister` pattern, `tokenUsage` on
  `step_completed`, plugin loader / config (`.ai-conductor/config.yml`).
- `@opentelemetry/api`, `@opentelemetry/sdk-trace-*`, `@opentelemetry/sdk-metrics`,
  `@opentelemetry/exporter-trace-otlp-*`, `@opentelemetry/exporter-metrics-otlp-*`.
- For Phases 2–3: a decision (in architecture-review) on task lifecycle events and the
  subagent dispatch-boundary instrumentation mechanism (hook vs orchestrator-emitted events).

## Open Questions
- **Exporter as a `ui_renderer` plugin (like `json-stdout`, config-selectable, no `index.ts`
  edit) vs. an engine listener (like `EventPersister`)?** Leaning plugin for installability,
  but a renderer that exports nothing to the terminal is a slight semantic stretch — resolve in
  architecture-review.
- **Phase 3 mechanism:** lifecycle hooks (`PreToolUse[Task]` + `SubagentStop`) vs.
  `--output-format stream-json` parsing of `Task` events (FR-14, A vs B). Feasibility is
  confirmed for both; the choice and the FR-14a spike are owned by Phase 3's architecture-review
  and do not block Phases 1–2.
- **OTLP default protocol:** HTTP/protobuf (port 4318) as the simpler default vs. gRPC
  (4317)? Both supported; pick the default in plan.
