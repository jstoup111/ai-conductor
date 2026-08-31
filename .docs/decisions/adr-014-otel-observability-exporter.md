# ADR 014: OpenTelemetry Observability Exporter

**Date:** 2026-06-28
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

## Context

The harness emits a rich `ConductorEvent` stream and persists it (Wave C: `EventPersister` →
`.pipeline/events.jsonl`, `conduct --report`), but cannot export it to standard observability
tooling. PRD `2026-06-28-otel-observability.md` (Phase 1, FR-1…FR-10) adds an OpenTelemetry
exporter: one trace per run, a span per SDLC step, and metrics (duration/retries/tokens), shipped
over OTLP to a collector **or** to a local file for offline ingestion.

This is an **observability/tracing cross-cutting decision** (ADR-required category). Two structural
questions must be settled before implementation:

1. **What seam does the exporter register through** — a `ui_renderer` plugin (like `json-stdout`),
   or a hardcoded engine listener (like `EventPersister`)?
2. **How is the work kept off the bus hot path** — `ConductorEventEmitter.emit()` *awaits* async
   handlers (`ui/events.ts`), so a blocking OTLP push would stall the terminal UI and
   `EventPersister`.

Relevant existing facts (evidence):
- `PluginKind` (`src/conductor/src/types/plugin.ts:8`) is
  `'llm_provider' | 'ui_renderer' | 'step' | 'hook' | 'visualizer'`. **`visualizer` is declared and
  in `VALID_KINDS` but is currently unwired** — nothing selects or starts visualizer plugins (grep:
  1 hit, the type decl only). The Wave C spec named the deferred SSE dashboard a future
  "visualizer", so the kind was reserved for exactly this class of bus consumer.
- The bus is multicast (`Map<type, Set<EventHandler>>`); `emit()` awaits async handlers and swallows
  their errors.
- Plugins are config-selected from a registry (`index.ts:509`, `registry.get<UISubscriber>('ui_renderer', config.ui_renderer ?? 'terminal')`); `EventPersister` is wired explicitly with `start()/stop()` (`index.ts:516–518`, `:588`).
- No `@opentelemetry/*` dependency exists yet.

## Decision

**Implement the exporter as a bus *listener* (internals) installed as a `visualizer` *plugin*
(packaging), and add the minimal generic visualizer wiring Phase 1 needs.**

1. **Internals = listener.** The exporter subscribes to the existing `ConductorEventEmitter` via
   `.on(...)` for every event type and modifies **no** emission site (FR-1), exactly like
   `EventPersister`. It translates events into OTel spans/metrics.
2. **Packaging = `visualizer` plugin.** It registers under the reserved `visualizer` kind so it is
   config-discoverable through the existing plugin loader/registry — satisfying the "pluggable so
   another tool can ingest" goal — **without** abusing the `ui_renderer` contract (it renders
   nothing to a terminal). The deferred Wave C SSE dashboard can later register the same way.
3. **New generic wiring (Phase 1 scope).** Because `visualizer` is unwired, Phase 1 adds the
   selection/start/stop loop for visualizer plugins in `index.ts`, mirroring the `ui_renderer`
   selection and the `EventPersister` lifecycle. This is additive; it does not touch event-emission
   sites. (Note: "register a plugin with zero `index.ts` change" was never achievable — both
   `ui_renderer` selection and `EventPersister` are wired in `index.ts`; the exporter is no
   different.)
> **Amended 2026-08-26 by #1516:** Decision 3's selection loop was never delivered — only the
> `buildVisualizers`/`stopVisualizers` lifecycle helpers shipped, and the OTel exporter was
> hard-wired into `index.ts` past the registry, so an installed `kind: visualizer` plugin
> registers and is silently never started. The selection loop now lands as specified, with these
> refinements: (a) the run loop retrieves enabled visualizers from the registry — installed
> connectors are enabled by name via a new `visualizers: [names]` config key, while the built-in
> OTel exporter registers as `visualizer:otel` and stays enabled solely by the existing `otel:`
> gate (operator surface unchanged); a named-but-missing connector warns once and is skipped,
> mirroring `resolveMemoryProvider`. (b) The seam contract becomes `start(emitter, context)`,
> where `context` carries run identity (runId, project, branch, feature, engineVersion,
> pipelineDir) — the identity ADR-014 routed through the OTel-private constructor is now part of
> the seam, since most `ConductorEvent`s carry none. (c) `buildVisualizers` gains per-plugin
> error isolation (a throwing `start()` emits an error event and drops that connector; the run
> continues), extending decision 5's failure isolation from transport failures to the seam
> itself, matching ADR-003's renderer rule. (d) The loader shape-validates `visualizer`
> entrypoints at load, mirroring the existing `llm_provider` check, so a malformed plugin is
> refused with a message instead of failing silently later.

   > **Amended 2026-08-26 by #1934:** the visualizer wiring is now a shared helper called from
   > BOTH entry points — `index.ts` `main()` (interactive) and `daemon-cli.ts`
   > `beginFeatureRun` (one visualizer per daemon feature dispatch, on the feature-scoped bus,
   > flushed by that dispatch's `stop()`). The seam is the one #1516's amendment above
   > specifies (`start(emitter, context)` retrieved via the registry); only the wiring's
   > location generalized, because the daemon path had none and exported nothing (#1934). In
   > the daemon path `conductor.run.id` is resolved read-only/injected — the visualizer never
   > writes `.pipeline/conduct-session-id` (adr-2026-07-27-cold-start-within-step-retries
   > Decision 7 keeps the step runner its only writer).
4. **Off the hot path.** The bus handler does O(1) non-blocking work and hands off to an OTel
   `BatchSpanProcessor` + `PeriodicExportingMetricReader`. The handler returns immediately so
   `emit()`'s await does not stall the bus (satisfies FR-8). Export I/O happens asynchronously in
   the batch processor.
5. **Failure isolation.** Unlike `EventPersister` (which re-throws `EventPersistError`), all
   exporter/transport failures are caught and degrade to a single bounded warning; a dead collector
   or unwritable file never fails or wedges a run (FR-8). Export calls carry a bounded timeout.
> **Amended 2026-08-30 by #2095 (cost instruments are spine projections; the meter provider is shut
> down on stop):** two corrections to how Decisions 4 and 5 were realized. (a) `stop()` had called
> `forceFlush()` only, so each finished run's `PeriodicExportingMetricReader` kept its 60 s timer and
> re-exported frozen cumulatives for the daemon's lifetime; with all runs of a feature sharing one
> identity (2026-08-28 amendment) those dead readers interleaved on one series and made every
> aggregation of `conductor.step.cost` wrong (#2095, #2086). `stop()` now also calls
> `meterProvider.shutdown()`; the tracer side keeps flush-only so spans stay readable after stop.
> (b) A per-process cumulative counter cannot be made to aggregate to a feature total on a shared
> identity, on any backend. Cost is therefore exported as cumulative gauges projected from the
> per-feature `events.jsonl` rollup (adr-2026-07-22-per-feature-cost-rollup-in-shipped-record) at
> every step close — `conductor.feature.cost` (whole feature, `cost_complete`) and
> `conductor.feature.step.cost` (`step`, `model`, `source`), plus token counts as
> `conductor.feature.step.tokens` (`step`, `model`, `kind`) from the same snapshot — and the
> `conductor.step.cost` and `conductor.step.tokens` counters are removed. The rollup read happens in Conductor's step-close code, not in the bus handler, so
> Decision 4 holds. Decision 5's bounded warning is now rendered (`renderer_error` reaches
> `daemon.log`) so an export failure is visible instead of silently persisted.

6. **Dual transport, config-selected** under `otel:` in `.ai-conductor/config.yml`
   (`exporter: otlp|file`, `endpoint`, `file`). Absent `otel` ⇒ disabled (default off, FR-1/FR-7).

### Sub-decisions

- **OTLP default protocol:** **HTTP/protobuf (port 4318)** as the default (simplest, fewest deps,
  proxy-friendly); gRPC (4317) selectable via config.
- **`conductor.run.id` source:** prefer `.pipeline/conduct-session-id` (or
  `feature_complete.featureDesc` for the feature slug); **generate** a non-empty id when neither is
  available (FR-6). Bus events carry no run id, so the exporter owns correlation.
- **File-transport encoding:** OTLP-JSON, newline-delimited (decodable by an OTLP-aware tool;
  mirrors the `events.jsonl` ergonomics), written to `.pipeline/otel.jsonl` (distinct from
  `events.jsonl`).

> **Amended 2026-08-26 by #1938 (two-layer identity):** the run-id *source* above is unchanged,
> but its placement and the identity layering are revised because metric backends do not turn
> Resource attributes into series labels — Resource-only identity made all projects' metric
> series byte-identical (observed against a live OTLP collector + Prometheus, 2026-08-26).
> The identity contract is now:
> - `service.name` stays the constant `ai-conductor` (one product; the project is a dimension,
>   never folded into the service name).
> - `service.instance.id` = the resolved run id (same source chain as `conductor.run.id`, which
>   remains on the Resource unchanged). This makes `target_info` joinable per OTel convention.
>   Per adr-2026-07-27-cold-start-within-step-retries §7, this is the conduct feature-run id —
>   never a provider-session or per-attempt identifier (`attempt.id` of
>   adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity is a distinct, narrower id).
> - `project` and `feature` are additionally injected as **data-point attributes** on every
>   metric instrument, at a single seam in `MetricsRecorder`, so per-project/per-feature series
>   are distinguishable without collector rewriting and fleet totals remain a plain `sum()`.
>   The run id is deliberately **not** a data-point attribute (bounded series growth).
> - The data-point `project` value is the stable project name (basename of the project root),
>   not the absolute path; the full path stays on the Resource as `conductor.project`.
> - The Resource keeps `conductor.feature`/`conductor.project` for trace indexing — the
>   worktree-isolation claim below ("distinct `conductor.run.id` per run keeps two concurrent
>   worktrees' traces separate") continues to hold for traces, and now also holds for metrics
>   via the `feature` data-point attribute plus `service.instance.id`.

> **Amended 2026-08-27 by #1938 (configurable project name):** the amendment above fixed the
> data-point `project` value to `basename(projectRoot)`, which cannot distinguish two different
> project roots that share a directory name (`/srv/tenant-a/shared` and `/opt/tenant-b/shared`
> both export `project=shared`), so the stated outcome — two projects distinguishable from
> harness exports alone — did not hold in that case. The value is now resolved as:
> - `otel.project_name` from `.ai-conductor/config.yml` when present and non-blank, trimmed;
> - otherwise `basename(projectRoot)`, unchanged from the amendment above.
>
> The override is an existing-block config key, not a new block: it joins `exporter`/`endpoint`/
> `file`/`protocol` under `otel:` and flows to the visualizer through `ResolvedOtelConfig`, so
> there is no second resolution path and no new construction site. It is deliberately an
> operator-supplied name rather than an automatic disambiguator (a path hash): the value is a
> query dimension operators type, so a readable name beats a collision-free but opaque one, and
> the collision it repairs requires two same-named roots exporting to one backend. A blank,
> whitespace-only, or absent value is not an error — it falls back to the basename and the run
> proceeds, preserving the never-fails-a-run contract of Decision 5. The override changes only
> the data-point `project` attribute: `service.name` stays the constant `ai-conductor` and the
> Resource's `conductor.project` stays the absolute project root.

> **Amended 2026-08-28 by #1938 (run identity leaves the label path):** the 2026-08-26 amendment
> above placed the resolved run id on `service.instance.id` to make `target_info` joinable, and
> inferred that keeping the run id out of data-point attributes kept backend series bounded. That
> inference is false for the named Prometheus backend. Prometheus's OTLP receiver translates
> `service.instance.id` into the `instance` label on **every** metric data point — verified
> 2026-08-28 against the live collector and Prometheus: a probe export carrying
> `service.instance.id` came back as an `instance` label on both the metric series and its
> `target_info` row. A per-run value therefore mints a full set of series per run, which is
> precisely the growth the amendment claimed to avoid. The green test that "proved" boundedness
> inspected `InMemoryMetricExporter` data-point attributes, which sit before that translation and
> structurally cannot observe it.
>
> The identity contract is revised as follows. Every other clause of the two amendments above
> stands unchanged.
> - `service.name` stays the constant `ai-conductor`, so the derived Prometheus `job` label stays
>   `ai-conductor`.
> - `service.instance.id` = `<project>/<feature>`, where `<project>` is the same resolved project
>   name the data-point seam uses (`otel.project_name` when non-blank, else `basename(projectRoot)`)
>   and `<feature>` is the feature slug. Either side falls back to `unknown` when unavailable; the
>   value never fails a run, preserving Decision 5.
> - The run id is **not** on any metric label path — not a data-point attribute, not
>   `service.instance.id`, and not any other attribute of the metric Resource. `target_info`'s label
>   set is the whole resource attribute set, so a run-varying resource attribute mints a
>   `target_info` series per run just as surely as a data-point attribute would. The Resource is
>   therefore signal-scoped: the metric provider receives only attributes that are stable for a
>   feature's lifetime (`service.name`, `service.instance.id`, `conductor.project`,
>   `conductor.feature`, `conductor.branch`), while the trace provider additionally receives
>   `conductor.run.id` and `conductor.engine.version`. Traces are per-run by nature, so run
>   correlation is unchanged there and nothing on the trace side is unbounded.
> - Series growth is bounded by dimensions this design already pays for: the data-point
>   `project`/`feature` attributes of the 2026-08-26 amendment carry the same two values that now
>   compose the instance, so this placement adds no cardinality of its own.
> - `target_info` becomes joinable per feature on `(job, instance)` — the goal the 2026-08-26
>   amendment stated but did not reach, because a constant `job` with no `instance` collapses every
>   run's `target_info` onto one match group and Prometheus refuses the join as ambiguous (verified
>   2026-08-28 against the live backend). Because the metric Resource carries only feature-stable
>   attributes, that row is one series per feature and does not accumulate. It answers "what is this
>   feature", not "what happened on lap N" — run-level questions are a trace concern.
> - **Correction, 2026-08-28.** The first draft of this amendment asserted that run-varying resource
>   attributes were merely last-writer-wins on the `target_info` row. That is wrong, for the same
>   reason the 2026-08-26 amendment was wrong, one level over: every resource attribute is part of
>   `target_info`'s label set, so `conductor.run.id` on a shared Resource kept minting a series per
>   run even after `service.instance.id` was re-keyed. Observed directly: 22 `target_info` series
>   across 17 run ids on the live backend. The signal-scoped Resource above is the repair; the
>   as-built gate caught the gap before it shipped.
> - **Proof obligation.** A test asserts the exported Resource's `service.instance.id` directly. A
>   data-point-attribute assertion cannot observe this contract and does not discharge it.
>
> **Why not `service.namespace`.** Prometheus derives `job` as `<service.namespace>/<service.name>`
> when a namespace is set, so `service.namespace = <project>` with `service.instance.id = <feature>`
> is the more idiomatic shape, and it was verified to work against the live backend. It is rejected
> because the 2026-08-26 amendment holds that the project is a dimension and is never folded into
> service identity; namespacing folds it into the derived `job` label, which is that same fold one
> level down. The compound instance keeps service identity constant and confines this revision to a
> single clause. The accepted cost is that `<project>` appears both in the instance and as a
> data-point attribute, and that a compound instance key is unusual enough to invite a later
> "cleanup" — this paragraph is the standing reason not to.
>
> **Unchanged.** The `MetricsRecorder` constructor-injected identity seam and its `project` and
> `feature` data-point attributes are untouched, so concurrent features inheriting that seam need no
> rework. The worktree-isolation claim below continues to hold: traces separate by
> `conductor.run.id` on the trace Resource, and metrics separate by the `instance` label rather than
> depending on it.

## Consequences

**Positive**
- Activates the reserved `visualizer` seam with a real second consumer (the abstraction is proven,
  as Wave C intended), reusable by the future SSE dashboard.
- Purely additive to event flow; FR-1 guarantees byte-identical behavior when disabled.
- Standard OTLP output ingests into any OTel backend (Jaeger/Tempo/Prometheus/Grafana/Honeycomb).

**Negative / costs**
- Adds `@opentelemetry/*` dependencies to `src/conductor`.
- Phase 1 must build the generic visualizer wiring (select/start/stop) before the exporter can plug
  in — slightly more than "just a listener", but it is the correct, reusable seam.
- Async batching means a few final spans rely on flush-on-exit (FR-10) to not be lost.

**Worktree isolation:** file transport writes the per-worktree `.pipeline/otel.jsonl` (no cross-worktree
path collision); the OTLP endpoint is shared config, but distinct `conductor.run.id` per run keeps two
concurrent worktrees' traces separate. No new ports/DBs are introduced by the harness.

## Alternatives Considered

- **A — `ui_renderer` plugin (like `json-stdout`).** Config-selectable today, but semantically wrong:
  a renderer that emits nothing to the terminal, and only one `ui_renderer` is selected at a time
  (`index.ts:509`), so choosing the OTel renderer would *displace* the terminal UI. Rejected.
- **B — hardcoded engine listener only (like `EventPersister`), no plugin kind.** Clean lifecycle,
  but not config-discoverable as a plugin (weakens the "pluggable" ask) and wastes the reserved
  `visualizer` kind. Rejected in favor of the listener-internals + visualizer-packaging synthesis.
- **In-band synchronous export.** Simplest, but `emit()` awaits handlers → would stall the bus and
  couple run latency to collector latency. Rejected (violates FR-8).
