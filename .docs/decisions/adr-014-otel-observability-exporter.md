# ADR 014: OpenTelemetry Observability Exporter

> **Operator clarification — 2026-09-10:** Decision 7 remains authoritative:
> production metrics have exactly one event-fed `MetricsListener`; per-dispatch
> visualizers remain spans-only and must not duplicate metric recording.
> Decision 10's fallback reason is attempt-chain context: an unavailable
> preferred-provider reason survives subsequent candidate observations until
> the successful fallback span closes.

**Date:** 2026-06-28
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

## Context

The harness emits a rich `ConductorEvent` stream and persists it (Wave C: `EventPersister` →
`.pipeline/events.jsonl`, `conduct --report`), but cannot export it to standard observability
tooling. PRD `2026-06-28-otel-observability.md` (Phase 1, FR-1…FR-10) adds an OpenTelemetry
exporter: one trace per run, a span per SDLC step, and metrics (duration/retries/tokens), shipped
over OTLP to a collector **or** to a local file for offline ingestion.

> **Amended 2026-09-30 by #2011:** One feature now spans bounded, independently
> exported traces with standard links, logical-step groups, and execution slices.
> The operator approved D21–D26 below, including the consolidated #2009 scope.
> They supersede the one-trace-per-run and direct step-parenting model.

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

> **Amended 2026-09-30 by #2011:** D22 supersedes the read-only daemon-bootstrap
> and sole-step-runner-writer clauses above. Enabled OTel startup and StepRunner
> delegate to the shared atomic create-if-absent feature-identity helper; persisted
> identity is never overwritten by dispatch/provider session IDs.
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
> (c) Decision 4's "O(1)" bounds the *class* of work a bus handler may do, not its instruction
> count: no I/O, no awaiting, no iteration that scales with the run. Recording one snapshot's
> already-computed dimensions is bounded, in-memory, synchronous SDK work over the feature's
> distinct step x model x source and step x model x kind keys, and the projection those keys come
> from is computed before the event is emitted — which is the work Decision 4 exists to keep off
> the hot path. Read Decision 4 as **bounded, non-blocking, in-memory work with no I/O on the
> bus.** A handler that read the ledger, awaited, or iterated per dispatch would still violate it.

> **Amended 2026-09-08 by operator resolution of #1937's Story 8 plan gap:** the
> preceding tracer flush-only sentence is superseded. An interactive visualizer owns its
> `TracerProvider` for exactly one run and calls `tracerProvider.shutdown()` once on stop.
> OTel shutdown includes the final flush and processor/exporter cleanup; it is bounded and
> failure-isolated under Decision 5. Daemon dispatch boundaries remain flush-only because
> their daemon-owned provider survives dispatches; daemon process teardown still shuts that
> provider down. Tests capture exported spans before exporter shutdown side effects rather
> than requiring an in-memory exporter's buffer to remain readable after provider teardown.

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

> **Amended 2026-09-06 by #1937 (daemon-owned meter, worker identity, daemon-level signals):** the
> per-dispatch `MeterProvider` of Decision 3 / the #1934 amendment made every counter restart at zero
> on each re-dispatch (`conductor.run.outcomes` reads a constant `1` for every feature that ever
> halted; `conductor.step.retries` walks backwards across dispatches; verified on the live backend
> 2026-09-06), and a daemon with no dispatch in flight exported nothing at all. Three decisions
> revise how metrics are owned and identified. Decisions 1, 2, 4, 5 and 6 stand; traces are
> unaffected.
>
> 7. **The dispatcher-side process owns the one metric provider, and every metric is derived
>    from events by one listener.** `daemon-cli.ts` constructs a single long-lived `MeterProvider`
>    + `MetricsRecorder` at daemon start (when `otel:` is enabled) and shuts it down only at daemon
>    stop. A `MetricsListener` subscribed to the daemon root bus records **all** instruments —
>    the existing per-feature ones (`step.duration`, `step.retries`, `step.dispatches`,
>    `feature.cost`, `feature.step.cost`, `feature.step.tokens`, `pipeline.closeout.duration`,
>    `run.outcomes`) and the new daemon-level ones — from the typed events that already reach that
>    bus (`step_started`/`step_completed`/`step_failed`/`step_retry`, `feature_cost_snapshot`,
>    `feature_usage_total`, `pipeline_closeout`, `feature_complete`, `loop_halt`, plus the new
>    `feature_dispatch_ended`). Per-dispatch `OtelVisualizer` instances become **spans only**: they
>    keep their `TracerProvider` (spans are per-run by nature) and construct no `MeterProvider`
>    under the daemon. Because the recorder is fed by events rather than by the process that ran
>    the step, counters stay monotonic for the daemon's life whether the dispatch ran in-process,
>    in a child process, or — the intended end state — in a remote worker that exits after one
>    dispatch and ships its event stream back. The interactive `index.ts` path (single run, single
>    process) constructs its own provider and attaches the same `MetricsListener` to its run bus, so
>    there is exactly one metric-recording code path and the interactive instrument set is
>    byte-identical to today. Rationale: one long-lived meter fed by events is the only shape where
>    "fix the resetting counters", "emit daemon-level signals", and "workers may be remote and
>    ephemeral" are the same mechanism rather than three.
> 8. **Metric identity is `service.instance.id = <project>/<worker>`; `feature` is a data-point
>    attribute only.** `<project>` is the resolved project name of the 2026-08-27 amendment;
>    `<worker>` is `otel.worker_name` from `.ai-conductor/config.yml` when non-blank (trimmed), else
>    `os.hostname()`. `project` and `worker` are injected as data-point attributes on every
>    instrument at the `MetricsRecorder` seam; `feature` is injected on per-feature instruments
>    only (anything that happens *to* a feature), never on daemon-level ones (anything that
>    describes the daemon), so daemon-level series are bounded by workers × states. The metric
>    Resource is therefore worker-stable: `service.name`, `service.instance.id`,
>    `conductor.project`, `conductor.worker`, and `host.name` (the raw hostname, so Datadog's host
>    mapping lines up — data-point attributes are what every backend turns into tags without
>    collector configuration; resource attributes are backend-dependent) — `conductor.feature` and
>    `conductor.branch` leave the
>    metric Resource (one provider now serves many features) and remain on the trace Resource.
>    `target_info` becomes joinable per worker on `(job, instance)`; per-feature questions join on
>    the `feature` data-point attribute instead. The 2026-08-28 boundedness reasoning holds: the
>    instance value varies only with the set of workers, which is small and stable, not with runs.
>    Proof obligation carried forward: a test asserts the exported metric Resource's
>    `service.instance.id` and the absence of `conductor.feature` on it directly — a data-point
>    assertion cannot observe this. Two workers of one project report the same backlog; consumers
>    read backlog gauges with `max by (project)` and per-worker gauges (slots, in-flight) with
>    `sum` — documented per instrument in `docs/reference/configuration.md`.
> 9. **Daemon-level signals ride the spine as typed events, persisted to a daemon-scoped sibling
>    ledger, with per-feature events forwarded — not re-persisted — onto the daemon bus.** The
>    daemon loop emits `daemon_backlog_snapshot` once per discovery tick (counts per backlog
>    state sourced from the existing eligible/waiting/blocked/gated channels and the park
>    claims, oldest age per state, slots busy/free, in-flight slugs, the dispatch-blocking flags,
>    and the tick's discovery duration), `feature_dispatch_started` (`kind: initial | resume |
>    rekick`) at dispatch, `feature_dispatch_ended` (`outcome: complete | halted | terminated`) when
>    the dispatch's process or worker returns, and `feature_shipped` (with `run_started_at` and the timing rollup's
>    active total and its `exact | partial | unavailable` state) at the ship point. Each is a
>    `ConductorEvent` union member with an `EVENT_SINKS` row and a visualizer `handleEvent` case.
>    Because the daemon root bus has no persister today, the daemon attaches an `EventPersister`
>    writing `<mainRoot>/.daemon/events.jsonl` — same schema, same reader, a sibling ledger under
>    event-spine exception B (one writer per file), not a new channel. Every per-feature event is already re-emitted onto the daemon bus by the existing
>    `ForwardingEventEmitter`; the forwarded copy is additionally tagged with its feature slug
>    (a `WeakMap` beside the existing `forwardedFromFeature` `WeakSet`, read through
>    `forwardedFeatureOf(event)`) so the listener can attribute it, and tagged as forwarded so
>    the daemon persister skips it — the per-feature `.pipeline/events.jsonl` remains their ledger and their
>    `EVENT_SINKS` rows are untouched. The `MetricsListener` records, beside the existing per-feature instruments,
>    `daemon.backlog`, `daemon.backlog.oldest_age`, `daemon.slots`, `daemon.inflight`,
>    `daemon.up`, `daemon.blocked_reason`, `daemon.poll.duration`, `daemon.stalls`,
>    `feature.dispatches`, `feature.halts` (attribute `haltClass` carries the existing
>    sidecar classification verbatim — the `HaltDisposition` values `needs-human | mechanical |
>    protected-artifact | plan-gap | legacy | unclassified` plus the two operator-owned classes the
>    conductor already writes past that union, `kickback-cap | over-scope`; a closed set of eight,
>    never a new label), `feature.shipped`,
>    `feature.duration.wall`, `feature.duration.active` (omitted, never fabricated, when the
>    rollup state is `partial` or `unavailable`), `gate.verdicts` and `gate.kickbacks`. Handlers
>    stay within Decision 4: bounded in-memory work, no I/O; the snapshot's counts are computed by
>    the discovery pass that already ran, before the event is emitted.

> **Amended 2026-09-09 by #2395 (as-built AB-1, shared-listener integration):** Decision 9's
> requirement for a visualizer `handleEvent` case is superseded for `daemon_backlog_snapshot`,
> `feature_dispatch_started`, `feature_dispatch_ended`, and `feature_shipped`: each requires an
> `EVENT_SINKS` row and a `MetricsListener` handler, not a visualizer handler or subscription.
> These four events are metrics-only on the OTel surface; their typed-event and persistence
> obligations above remain unchanged. This corrects the stale clause to match Decision 7 and
> condition C3 of the approved
> `architecture-review-2026-09-06-no-daemon-level-metrics-queue-depth-halts-and-gate.md`, which
> already requires listener cases and limits the visualizer to span cases. The operator's
> shared-listener integration direction is retained: metrics coverage includes these four
> events, while the visualizer's exhaustively checked traced set excludes them. No no-op
> visualizer handlers or duplicate metric recording are required to satisfy this decision.

> **Amended 2026-09-08 by #1937 (as-built decisions AB-6, AB-7, AB-10):** “traces are
> unaffected” in Decision 7 is literal: the trace Resource, including its existing
> `service.instance.id`, remains byte-identical to the pre-feature trace Resource. Decision 8's
> prohibition on `feature` for daemon-level instruments does not apply to
> `conductor.daemon.inflight`: despite its daemon namespace, each point describes one in-flight
> feature and is therefore feature-scoped, as Decision 9 and Story 3 require. All other
> `conductor.daemon.*` instruments remain feature-free. Backlog age measures residence in the
> reported state, not time since first-ever discovery: durable per-slug state records the current
> state and the time that state was entered, preserves that timestamp while the state is unchanged,
> and replaces it on a state transition. This keeps oldest eligible/waiting/blocked/gated/parked age
> truthful when a feature moves between states.

> **Amended 2026-09-09 by #1940 (dispatch dimensions: label placement contract):** the label
> sets enumerated by the #1938 and #1937 amendments name `project`, `worker`, `feature`, `step`,
> `kind`, `model`, `source`, `metering`, `obligation`, `outcome`, `haltClass`, `state`, `reason`
> and nothing else, so `conductor.step.duration` and `conductor.step.retries` carry `step` alone,
> `provider_attempt` reaches the `MetricsListener` as a no-op, and reasoning effort and complexity
> tier ride no step event at all. Two decisions extend the contract; Decisions 1–9 stand.
>
> 10. **Bounded dispatch dimensions are data-point labels; unbounded or numeric detail is
>     trace-only.** `model`, `effort` (`low|medium|high|xhigh|max`), `provider`, and `tier`
>     (`S|M|L`) join `step` as data-point attributes on `conductor.step.duration`,
>     `conductor.step.retries`, and `conductor.step.dispatches`; `conductor.step.dispatches`
>     additionally carries `fallback` (`true` when the preferred provider is not the provider that
>     produced the result, else `false`). Every one of these value sets is closed and small, so the
>     growth bound of the #1938 amendment holds: series multiply only by combinations that actually
>     dispatched. The same values are set as span attributes on the step span
>     (`conductor.model`, `conductor.effort`, `conductor.provider`, `conductor.provider.preferred`,
>     `conductor.complexity_tier`, `conductor.fallback`). `fallbackReason` (free text) and the `TokenUsage`
>     detail — `reasoningOutput`, `numTurns`, `durationMs`, `costSource` — are **span attributes
>     only** (`conductor.fallback.reason`, `conductor.usage.reasoning_output`,
>     `conductor.usage.turns`, `conductor.usage.duration_ms`, `conductor.cost.source`) and are never
>     data-point labels. An absent value is omitted, never filled with a placeholder, and
>     `durationMs`/`costSource` stay absent where the provider reports none
>     (adr-2026-07-27-cost-unmetered-is-a-first-class-state). Spec owner and any other operator
>     identity are excluded from both signals; exporting "who" is a separate decision (privacy).
>
> 11. **Dimensions travel on the events that already describe the dispatch; no new event type and
>     no parallel channel.** `step_completed` and `step_failed` gain optional `effort` and `tier`
>     fields, populated from the resolved invocation policy and the run's `complexity_tier` at the
>     existing emit site, the same additive-field path `model`, `preferredProvider`, and
>     `actualProvider` already ride (precedent: adr-2026-07-05-retry-as-escalation-ladder §6).
>     `provider`, `fallbackReason`, `model` and `tokenUsage` are read from the existing
>     `provider_attempt` event through the existing `DispatchMeteringTracker` (which already
>     selects each invoked dispatch exactly once and drops lifecycle-only rows), so the
>     `MetricsListener` `provider_attempt` handler becomes a real projection and the interactive
>     `OtelVisualizer` switch records the same attributes. Both projections stay within Decision 4:
>     bounded, in-memory, no I/O.
> **Amended 2026-09-09 by #2056 (operator-supplied static attributes):** the `otel:` block
> carries transport settings plus the two identity overrides (`project_name`, `worker_name`) and
> nothing an operator can use to tag exports with local concepts — environment, team, tenant. The
> SDK's `OTEL_RESOURCE_ATTRIBUTES` detector is not wired (`buildResource` builds each Resource from a
> fixed literal), so those values are dropped even when the SDK detects them. Two decisions extend
> the contract; every earlier decision stands. Where #1940's amendment closes the data-point label
> set, D12 is the single sanctioned extension of that set, and D12's key rule keeps the two disjoint.
>
> 12. **Operator metadata is one static, validated `otel.attributes` map.** `otel.attributes` is a
>     mapping from attribute key to string value under the existing `otel:` block — an
>     existing-block key like `project_name`, not a new block, resolved once in `resolveOtelConfig`
>     and carried on `ResolvedOtelConfig`. Values are configuration literals: no environment-variable
>     reference, no template expansion, no per-feature or per-step override, so every value is
>     constant for a worker process's lifetime. A key MUST be namespaced (contain at least one `.`,
>     the OTel attribute-naming convention) and MUST NOT begin with `service.`, `conductor.`, or
>     `host.`; because every conductor data-point label (`project`, `worker`, `feature`, `step`, and
>     the rest of the closed set) is bare, the dot rule alone makes collision with any present or
>     future data-point label impossible without maintaining a denylist. A value MUST be a non-empty
>     string. The map is bounded at 16 entries. An entry that breaks any rule is dropped and
>     reported by key on the exporter's existing warning path (`renderer_error`, rendererName
>     `otel`) and the exporter stays enabled with the remaining valid entries — unlike `headers`,
>     whose failure disables the exporter, because a mislabeled dimension is not a credential
>     failure and telemetry should keep flowing. A run is never failed or delayed by this map.
>     `OTEL_RESOURCE_ATTRIBUTES` remains unread: an environment source cannot be validated at
>     configuration time, does not propagate uniformly across the daemon dispatch boundary, and
>     would land on the Resource only, which D13 shows is not queryable on every backend.
>
> 13. **Static attributes ride every signal: both Resources and every metric data point.** The
>     resolved map is placed on the trace Resource, on the worker-stable metric Resource, and — via
>     the `MetricsRecorder` identity seam — on every metric data point, at the three existing
>     construction sites (`wireDaemonOtel`, `wireInteractiveOtelMetrics`, the per-dispatch
>     `OtelVisualizer`), with no new construction site and no per-event injection. Resource placement
>     preserves unified-service-tagging correlation across signals; data-point placement is required
>     because backends turn data-point attributes into tags without collector configuration while
>     Resource attributes are backend-dependent (Datadog maps only semantic-convention Resource keys
>     unless `resource_attributes_as_tags` is enabled, which dumps every Resource attribute). The
>     boundedness reasoning of the 2026-08-28 and #1937 amendments holds unchanged: a static value has
>     exactly one value per worker, so it adds labels to existing series and mints none — `target_info`
>     stays one row per worker and cardinality-priced backends bill no new series. Merge order is a
>     contract: in `buildResource` and in `withIdentity`, conductor-owned attributes are written
>     after the custom map, so a custom key can never replace an identity or outcome attribute even
>     if it escaped D12's validation. Proof obligations: a test asserts the exported metric Resource
>     carries the custom keys and still exactly the conductor keys of Decision 8; a test asserts a
>     data point carries the custom keys and that a colliding custom key does not replace `project`;
>     a test asserts that with no `attributes` block every exported Resource and data point is
>     byte-identical to today's.
> **Amended 2026-09-14 by #2528 (feature-scoped complexity tier):** Decision 10 admits `tier`
> as a data-point label on the three **step** instruments only, and the #1940 amendment's closure
> of the label set plus Decision 12's "single sanctioned extension" clause together leave every
> **feature-scoped** instrument without it. Operators therefore cannot group feature cost,
> shipments, halts, run outcomes, or feature duration by S/M/L without joining step series or
> inferring tier from step-duration counts on the dashboard. One decision extends the contract;
> every earlier decision stands, and Decision 12's disjointness rule is unaffected because `tier`
> is a conductor-owned key that `otel.attributes` can never supply.
>
> 14. **The complexity tier is a data-point label on every feature-scoped instrument, carried
>     by the feature events that already describe the feature.** `tier` (`S|M|L`) joins the
>     existing attribute set on `conductor.feature.dispatches`, `conductor.feature.halts`,
>     `conductor.run.outcomes`, `conductor.feature.shipped`, `conductor.feature.duration.wall`,
>     `conductor.feature.duration.active`, `conductor.feature.cost`, `conductor.feature.step.cost`,
>     and `conductor.feature.step.tokens`. It travels as an optional `tier` field on the five
>     events that already describe the feature — `feature_dispatch_started`,
>     `feature_dispatch_ended`, `feature_shipped`, `feature_usage_total`, and
>     `feature_cost_snapshot` — by the same additive-field path Decision 11 sanctioned for
>     `step_completed`/`step_failed`; no new event type, no new instrument, no parallel channel,
>     and no listener-side inference from step series. Each event has exactly one production emit
>     site, so the per-emit-site objection recorded in
>     adr-2026-08-11-halt-events-ride-the-persisted-spine (thirty `loop_halt` sites) does not
>     apply: `feature_dispatch_started`, `feature_dispatch_ended`, and `feature_shipped` read
>     `BacklogItem.tier` in `daemon-runner.ts`, which `daemon-backlog.ts` already parses from the
>     committed `.docs/complexity/<stem>.md` marker; `feature_usage_total` reads
>     `state.complexity_tier` at its `finish`-close site; and `feature_cost_snapshot` reuses the
>     `tier` already stamped on the `step_completed`/`step_failed` whose terminal delivery
>     triggers it. Every source descends from that one committed marker, so feature and step
>     series for the same dispatch never disagree. **Unresolved is absent:** the raw `undefined`
>     is carried through and the attribute is omitted — never the `?? 'L'` (or `?? 'M'`) policy
>     defaults the conductor uses for step skipping — and a test proves the data point carries no
>     `tier` key rather than `tier="L"`. `MetricsRecorder` threads `tier` per feature method
>     rather than through the identity seam, so instruments outside this list (`memory.setup`,
>     `gate.verdicts`, `gate.kickbacks`, `pipeline.closeout.duration`, the `daemon.*` gauges) are
>     unchanged. Growth bound: `tier` is a closed three-value set that varies within a worker
>     process, so it is a genuine ×3 multiplier on the instruments above; because each is already
>     keyed by `feature` and a feature holds one tier per dispatch, the label partitions existing
>     series and mints none for a feature whose tier is resolved before its first feature event.
>     A feature re-tiered between dispatches (only possible through a DECIDE amendment, since
>     `.docs/` is sealed during BUILD) legitimately appears once per tier it has held; the
>     cumulative `feature.cost` gauge's earlier-tier series stops updating and retains its last
>     value, which the configuration reference documents as the honest record of a real re-tier.

> **Amended 2026-09-15 by #2528:** James Stoup approved the AB-1 correction: D14 now also admits optional `tier?: ComplexityTier` on the existing `feature_complete` and `loop_halt` events. This supersedes the five-event-only scope above. `completeRun` stamps raw `state.complexity_tier`; the centralized `emitLoopHalt` stamps raw `haltState.complexity_tier`, omitting the key when unresolved (including early halts). These existing helpers are the production terminal emit seams; the earlier thirty-site objection does not describe the current implementation.
>
> Existing terminal ownership remains: `feature_complete` or `loop_halt` records `conductor.run.outcomes` with its own event tier through `closeFeature`; the later `feature_dispatch_ended` retains its current duplicate suppression and records its own halt metric. Dispatch-end still records an outcome when no preceding terminal event did. Interactive runs retain terminal outcome reporting without a daemon dispatch-end. No listener cache, inference, new event type, or policy-default tier is introduced. A production-order regression must prove exactly one tier-bearing outcome for completion and halt, plus tierless and interactive cases; an isolated dispatch-end fixture alone is insufficient. The nine-instrument boundary and documented re-tier series split remain mandatory, including a `max by (feature, tier)` last-value query and its historical-tier double-count caveat in the configuration reference.

> **Amended 2026-09-28 by operator hotfix (released harness version on the metric Resource):** the
> metric Resource now also carries `service.version`, the released harness version, resolved once
> when the daemon-lifetime meter and the interactive meter start. This supersedes the "unchanged
> metric Resource identity" scope of the 2026-09-06 release-stamping slice (#2235 Story 3), whose
> goal was to keep run-varying values off the metric label path. The release is not run-varying:
> it changes only when the daemon restarts onto a new release, so it adds one `target_info` series
> per worker per release — bounded by release count, not by run or dispatch count. The 2026-08-28
> rule stands for every run- and dispatch-varying value: `conductor.run.id` and
> `conductor.engine.version` remain trace-only. Omitted and unresolved versions use the same
> `not-supplied` / `unresolved` markers as the trace Resource.

> **Amended 2026-09-29 by operator DECIDE (durable OTLP export spool):** Decisions 4 and 5 left
> every exported batch in SDK memory: the `BatchSpanProcessor` queue (2048 spans, dropped when full),
> the HTTP exporter's in-memory retry (5 attempts bounded by the export timeout; the JS gRPC exporter
> does not retry at all), and the `PeriodicExportingMetricReader`, which does not re-send a failed
> export — so under `LOWMEMORY` temporality a failed interval's delta counters and histograms are lost
> permanently. A backend outage, a local collector/agent outage, a daemon restart or crash, or a
> network partition therefore lost telemetry. Decision 5's failure isolation is unchanged; three
> decisions make delivery durable.
>
> 15. **Write-first spool: a batch is durable on disk before any network send.** For
>     `exporter: otlp` over OTLP/HTTP, the span and metric exporters handed to the SDK are spooling
>     exporters: each batch is serialized with `@opentelemetry/otlp-transformer`'s protobuf
>     serializers to the exact OTLP/HTTP request body, written as one immutable file under
>     `<mainRoot>/.daemon/otel-spool/<signal>/` (main root resolved from any checkout), fsynced and
>     renamed into place, and only then acknowledged to the SDK. Header values are never written.
>     The metric wrapper delegates `selectAggregationTemporality` and `selectAggregation` unchanged,
>     so `LOWMEMORY` temporality is preserved. The write is async exporter I/O inside the SDK's
>     processor, never on the bus, so Decision 4 holds; a failed spool write passes the batch to a
>     direct send with Decision 5's bounded warning. The spool is on by default for
>     `exporter: otlp` (`otel.spool.enabled`, default true; `otel.spool.max_bytes`, default 512 MiB);
>     `exporter: file` is not spooled. The spool sends OTLP/HTTP only. `protocol: grpc` with the
>     spool at its default exports unspooled over gRPC exactly as before and emits one bounded
>     warning that the spool is inactive; only an explicit `otel.spool.enabled: true` with
>     `protocol: grpc` is a config validation error naming `protocol: http/protobuf` as the remedy.
>     Datadog Agent/DDOT and Grafana otel-lgtm/Alloy both accept OTLP/HTTP on 4318.
> 16. **One lease-holding drainer per main root delivers oldest-first; the backend decides
>     staleness.** Any process that owns an OTel provider (daemon or interactive run) may take the
>     spool lease and drain; the drainer lives for its owning process, and a per-dispatch or
>     per-run provider shutdown never stops it or releases the lease. The lease follows
>     adr-010-pidfile-lock-daemon-liveness: a lockfile created with `O_EXCL` holding pid, a random
>     uuid, and a heartbeat; a lease whose pid is dead, or whose heartbeat has expired and whose
>     uuid does not match a live holder's (pid reuse), is stale and is reclaimed by `O_EXCL`
>     succession, never delete-then-create. The drainer reads and sends one file at a time,
>     oldest-first per signal and independently per signal, POSTing to the configured endpoint with
>     the drainer process's own resolved headers under Decision 5's bounded export timeout; stop
>     never waits on an in-flight POST beyond that bound. It classifies the response: a full 2xx
>     accept deletes the file; `400`, `413`, or an OTLP partial-success response that rejects items
>     deletes the file (a partial rejection is deleted whole, never re-sent in part) and counts a
>     drop; `401`, `403`, `404`, `408`, `429`, `5xx`, and network errors keep the file and back off
>     (honouring `Retry-After`), because an auth or endpoint misconfiguration must never delete
>     spooled data. There is no client-side age cap: a backend's own acceptance window (Datadog
>     metrics 1 h and spans 18 h; Prometheus/Mimir out-of-order window) is authoritative and surfaces
>     as a counted rejection. `max_bytes` is the only local bound; exceeding it evicts the oldest
>     files and counts them as drops. Delivery is at-least-once. Zero loss is best-effort at process
>     exit: the daemon flushes its providers into the spool and releases the lease on SIGTERM and
>     on SIGHUP (the tmux respawn path), and an ungraceful kill loses at most the SDK's un-exported
>     in-memory window while its lease is recovered by staleness.
> 17. **Spool health rides the spine as typed events; outages stay visible.** The drainer emits
>     `otel_spool_drop` (`signal`, `reason: rejected | evicted`, batch and item counts, HTTP status)
>     and a periodic `otel_spool_backlog` (`signal`, file count, bytes, oldest batch age, last
>     failure class) as `ConductorEvent` union members with `EVENT_SINKS` rows that persist but do
>     not feed OTel (`otel: false`, so spool telemetry never spools itself) and are excluded from
>     cost and timing rollups. Backlog events are persisted, not rendered. Decision 5's visibility
>     is preserved by transition, not by interval: the drainer emits one bounded `renderer_error`
>     when a signal's delivery state changes from healthy to a failure class (network, auth,
>     endpoint, throttled, server) and one notice when it recovers. Events go on the owning
>     process's bus — the daemon bus persisted to `<mainRoot>/.daemon/events.jsonl` under
>     Decision 9, or the interactive run's bus. A process with the spool disabled that finds a
>     non-empty spool leaves it untouched and emits one bounded warning naming its size and path.
>     The spool directory is transport state, not a telemetry channel: it carries no fact the spine
>     lacks, and nothing reads it but the drainer. Known limit: a backend that accepts a payload and
>     silently discards stale points (suspected, not verified, for Datadog metric intake) is
>     invisible to the drop count.

> **Amended 2026-10-02 by #2000 (run provenance on traces):** an exported trace names the feature,
> branch, and run, but not the commit it built, the base it was built against, the pull request it
> opened, or the tracker issue that asked for it, although the engine holds all four while the run
> executes. Decision 10 already places every unbounded value on traces only; Decision 11 already
> requires dimensions to travel on the events that describe them. Three decisions extend the
> contract; every earlier decision stands, and no metric data-point or `target_info` label changes.
>
> 18. **Provenance rides existing events and is resolved at the emit site.** `feature_complete` and
>     `loop_halt` gain optional `headSha`, `baseSha`, and `prDisposition` fields, stamped by the
>     existing terminal seams (`completeRun` and the centralized `emitLoopHalt`, the D14 precedent);
>     `headSha` is the worktree `HEAD` at emit time. Every rebase outcome event (`rebase_noop`,
>     `rebase_changed`, `rebase_mergeable_skip`) carries the `baseSha` the rebase resolved, or `null`
>     when unresolvable. The originating tracker reference is resolved once at run start from the
>     feature's intake marker `Source-Ref:` and passed in the visualizer start context. No new event
>     type is added, and no projection reads git, `conduct-state.json`, or the intake marker
>     (Decision 4).
> 19. **Placement: issue on the trace resource, commit and PR on the root span, base also on the
>     rebase step span.** The trace Resource gains `conductor.source.ref`, so every exported span —
>     including the closed step spans of a run that later crashes — carries it. HEAD moves with every
>     task commit and rebase, so the built commit is a close-time value: the `conductor.run` root span
>     is stamped at close with `vcs.head.sha`, `vcs.base.sha`, `conductor.pr.url`, and
>     `conductor.pr.disposition`. `vcs.base.sha` is also set on the rebase step span when its outcome
>     event arrives, and the SpanManager holds the latest base value in memory so a later halt
>     without one still stamps it. `conductor.pr.disposition` is a closed enum: `opened` (a PR URL is
>     present), `none` (the finish choice was `keep`, so no PR is expected), and `unrecorded` (the run
>     closed with neither, including the force-close default). An absent value is omitted; the
>     disposition alone distinguishes "no PR" from "PR not recorded". All four values are trace-only.
> 20. **`otel.provenance` toggles each provenance group; every toggle defaults on.**
>     `otel.provenance` is a mapping under the existing `otel:` block with boolean keys `commit`
>     (`vcs.head.sha`, `vcs.base.sha`), `pr` (`conductor.pr.url`, `conductor.pr.disposition`),
>     `issue` (`conductor.source.ref`), and `feature` (`conductor.feature`), each defaulting to
>     `true`, resolved once in `resolveOtelConfig` and carried on `ResolvedOtelConfig`. A non-boolean
>     value or an unknown key is a config validation error. A disabled toggle omits its attributes
>     entirely, never a placeholder. `feature: false` also changes the trace Resource's
>     `service.instance.id` from `«project»/«feature»` to `«project»/«run-id»`; it does not touch the
>     metric Resource or any metric data-point label, whose `feature` label Decisions 10 and 14 keep
>     for bounded series. Events persisted to the spine are unaffected by every toggle: the toggles
>     govern export only.
> **Amended 2026-09-30 by #2011:** The operator approved the following D21–D26
> lifecycle and correlation extension. Earlier decisions remain in force except
> where these explicit amendments change trace structure or identity ownership.

### D21 — Bounded traces are the feature-history representation

One feature instance exports a sequence of independent traces connected by standard OTel
links. Each root is still named conductor.run for continuity with existing inspection,
but represents one bounded segment. Set conductor.trace.role=segment on it. Every trace
uses a fresh SDK-generated trace ID from explicit ROOT_CONTEXT, not a deterministic ID
reused for the feature and not an ambient parent from another feature.

On normal lifecycle operation, rotate after 3,600,000 ms (one hour) OR after 1,024 completed
execution slices/outcome records, whichever occurs first. These are internal constants,
injectable for tests, not new user configuration. Count completion-driven records toward
the count threshold; closing carry-over slices during rotation must not recursively trigger
another rotation. Closing outstanding children can make a segment contain the threshold
plus the number of active executions and logical-step groups at the boundary. This is an
explicit bound relative to active engine concurrency, not an arbitrary cap on supported work.

Every span is inside a segment: its root, step groups, execution slices, and late-outcome
records. No feature-lifetime parent remains open across days. Ended spans keep the existing
SDK batching/export path. Rotation schedules a bounded forceFlush outside event handling;
it does not await network delivery before running the next engine event or new segment.
An exporter failure cannot fail the feature.

Each segment starts with at most one predecessor-root link. Each continuing execution slice
also links to its immediately preceding slice. Links are attached at span creation.
Feature, dispatch, logical-step, and execution identity provide query correlation without
a growing ancestry list.

Preserve the existing trace Resource identity, including conductor.run.id as the feature
run identity, and add dispatch/segment/execution identifiers only to spans and spine records.
Do not put them on metric resources or data points. Root/group names stay bounded; do not
embed UUIDs or segment numbers into operation names or invent a service per step.

### D22 — Resolve stable identity before the first trace; preserve provider isolation

Make one shared create-if-absent identity helper own .pipeline/conduct-session-id. Invoke it
at enabled OTel startup before resource creation, and have the step runner and the legacy
resource fallback delegate their existing persistence behavior to that same helper.
Use atomic exclusive creation; on a creation race read the winning value. Never overwrite
an existing nonempty identity, and never write a provider invocation/session ID as a later
rotation or restart side effect.

The helper is bootstrap machinery outside event handlers. The daemon continues to create
fresh dispatch/provider session IDs as today. It does NOT replace those identifiers with
the persisted feature ID. Step-runner failure handling remains its existing contract;
telemetry bootstrap catches identity failures and degrades independently.

Represent resolution as stable or unavailable. An empty, unreadable, or invalid existing
identity is not repaired by overwriting it. Telemetry may export an isolated transient
dispatch identity and a bounded diagnostic, but must not recover links under an uncertain
feature identity. Existing nonempty legacy identities remain valid opaque values, not
newly restricted to UUID syntax. Bound candidate record fields before accepting them.

For link recovery require equality of the persisted feature run ID AND canonical main
repository identity, feature label, branch, and worktree scope. Resolve the canonical main
root via the existing main-root resolver before startup, not a repeated Git command from
a span handler. A missing scope component makes recovery unavailable. New worktrees with
fresh run IDs never link merely because names match. Copied history with a different
project/branch/worktree or generation is refused. Deliberately copying every identity and
its ledger is indistinguishable from restoring the same feature and is outside fresh-instance
detection; normal feature creation must start with a fresh pipeline identity.

Each OTel lifecycle start has a fresh conductor.dispatch.id independent of provider attempt
IDs. Segment indices begin at zero within that dispatch. Preserve the feature identity
over rotation and ordinary restart; do not relabel old history after a branch/worktree move.
Such mismatches create an explicit continuity gap.

### D23 — Correlation recovery uses the event spine, not a context sidecar

Add typed ConductorEvent variants with a versioned, bounded payload:

- trace_segment_opened: scope, dispatch ID, segment index, trace ID, root span ID,
  trace flags, startedAt; an optional predecessor context; and a discriminated continuity
  result (first, linked, or unavailable with a reason).
- trace_segment_ended: the same segment identity, endedAt, and a closed reason union:
  rotated-time, rotated-count, clock-gap, complete, halted, or terminated.
- trace_segment_rotate: scope/dispatch/expected-segment identity, cutoff, and trigger
  time/count/clock-gap. This is the timer/count boundary request, not an engine step event.

The exact TypeScript type names may follow local conventions; these event names and their
semantic distinctions are the contract. No arbitrary metadata maps or secret/credential
fields are accepted. Use standard span-context validation for nonzero 32-hex trace IDs,
nonzero 16-hex span IDs, and valid trace flags; optional tracestate, if carried, uses the
SDK parser rather than a second custom parser.

Declare opened/ended as persist=true, render=false, audit=false, otel=false. They must
never re-enter the projection or metric recorder. Declare rotate as persist=true,
render=false, audit=false, otel=true; the trace projection handles it explicitly and the
exhaustive metrics handler table explicitly ignores it. All subscription sets continue
to derive from EVENT_SINKS. Existing feature_dispatch_* metric semantics are untouched.

The visualizer factory injects canonical event-publication callbacks, following its current
renderer_error bridge. The projection itself performs only bounded in-memory SDK/state
work. Queue publication out of ordinary engine-event handlers so it never does ledger
reads or waits for durability/network there. The owning lifecycle serializes opened/ended
publication and uses emitOrThrow with a catch at its own failure-isolation boundary.
This distinguishes persistence rejection from export acceptance. A failed publication
warns once and permits telemetry/execution to continue; it never claims the context is
durable. No new handler needs to recursively publish a rotation request while handling one.

A newly opened segment creates its root context and queues the opened record before any
child context can be advertised as recoverable. Initial bootstrap and graceful stop drain
their pending publications before detaching the existing persister, subject to bounded
shutdown. An abrupt crash between SDK creation and persistence can lose that link; this
is reported as missing continuity on the next start, never fabricated recovery.

At startup take a size snapshot of the feature's existing events.jsonl and read that
bounded snapshot outside the bus. Reuse the shared parseEvents line-decoding path, with
a typed parser for the new records; do not introduce a competing event-log format.
Use incremental chunks and a bounded line buffer (256 KiB); oversized/invalid relevant
history produces unavailable continuity rather than unbounded allocation. Keep only the
latest matching segment candidate and its observed terminal record, not all historical
spans. Allow at most five seconds for recovery; timeout, I/O failure, truncated relevant
tail, or invalid/mismatched context degrades to an unlinked segment with a reason and
bounded warning. A timeout must cancel further reads and close its file handle.

A valid opened record can be a predecessor even if no ended record was persisted. Mark its
end state unknown; do not infer a clean stop or backend retention. No history means first
segment. A history failure means unavailable, never first. Do not re-export old spans or
silently change their timestamps. In-process rotation uses the already-known predecessor
context and does not reread the ledger.

### D24 — Groups collect executions; retries and slices do not change engine identity

Within each segment emit one logical-step grouping span per subject produced by the existing
execution-identity resolver. Lifecycle steps and configured parent/member subjects retain
that resolver's distinction and escaping; two configured members with the same name under
different parents remain separate groups.

Use conductor.trace.role=step-group on groups, execution-slice on work slices, and
execution-outcome on a late classification record. All have stable conductor.step; only
execution-bearing spans carry conductor.execution.id and conductor.execution.slice.
Groups are real bounded parent spans and stay open until the segment closes so repeated
executions collect under the same group. Their duration is an envelope, not active work.

For explicit executionContext, retain its execution ID for the whole logical execution.
For legacy context-free events, synthesize a per-start execution ID scoped to this dispatch,
while preserving current legacy pairing and ambiguous-attribution refusal. A later re-run
gets another ID. A policy retry stays in its original execution and retains cumulative
retry count and observed retry events. Rotation changes the slice index, not execution ID.

Separate logical execution state from the current span handle. Rotation ends each active
slice with conductor.slice.end_reason=continued and status UNSET; it never emits a fake
step_completed, sets execution-terminal=true, or invokes onStepClose/onRunClose as though
engine work ended. Preserve provider/fallback facts, retry state, actual original start,
and settlement state in the logical execution record. Open a new slice under the same
subject's group in the new segment, linked to the previous slice.

The first real terminal closes the current running slice with the existing execution
status semantics and conductor.execution.terminal=true. Exactly one span per execution
carries that terminal marker and terminal usage facts. Nonterminal slices may carry
cumulative retry context, clearly documented as non-additive; usage totals are never copied
onto every slice. Engine metric counters and rollups still use the original lifecycle and
provider-attempt events, not span counts or segmentation events.

Early member settlement needs its own state: at group_member_step phase=result, freeze
the actual work end and end the active work slice with awaiting-outcome. Do not continue
work slices while the member is waiting for join/classification. At a later real terminal,
create a zero-duration execution-outcome span at the observed classification time, under
that segment's step group and linked to the last work slice. It carries terminal outcome,
retry/usage facts, and the measured original work interval as attributes; its zero duration
does not claim zero work. Do not mutate an already-exported span or backdate a multi-day
span. The same rule handles delayed classification across multiple rotations.

Retain only the pending logical state required for active or awaiting-outcome executions;
delete it at the authoritative terminal and preserve late-terminal suppression. Group
bookkeeping is dropped when the segment closes. Completed history stays in the exporter
and ledger, not an unbounded in-memory span list.

### D25 — Truthful clocks, terminal boundaries, and failure isolation

Use the existing epoch-anchored monotonic-clock pattern for interval arithmetic with an
injected wall-clock observation for discontinuity detection. A live segment has a fixed
deadline; no event extends it. The lifecycle owns one unref'd deadline timer, cancels it
on rotation/stop, and ignores callbacks for an already-closed expected segment.

Check the deadline before projecting each event as well as in the timer. Serialize
rotation and terminal mutation; a same-instant event either closes the current execution
before rotation or completes its continuation afterward, never both. Reset the timer
without creating a second SDK provider or changing exporter lifetime.

On ordinary timely rotation, end current slices/groups/root at the boundary and open
continuations at that boundary. When the process resumes after a long scheduling gap,
do not synthesize every missed hour and do not shift timestamps forward to evade a backend
age rule. End the old segment at its established projection cutoff, mark clock-gap and the
unobserved interval, then start one new segment at the actual resumed observation time.
This cutoff is a telemetry slice boundary, not a fabricated engine completion. Preserve
actual engine duration evidence separately. Negative elapsed intervals are never emitted;
clock rollback produces an explicit diagnostic/discontinuity rather than invented ordering.

A blocked event loop, suspended machine, collector outage, or network outage prevents a
hard real-time delivery guarantee. Old data still goes through the existing transport or
spool with original timestamps; rejection/retention remain backend decisions. The design
bounds span observation windows during a responsive process, not ingestion latency.

Only the final dispatch-ending segment carries conductor.run.outcome under its existing
complete/halted/terminated taxonomy; earlier rotated roots have a segment boundary reason
and no fake run outcome. On halt, close remaining work truthfully as interrupted/incomplete;
never leave children open after a parent was exported. Graceful stop is idempotent, closes
remaining segment state once, drains publication, cancels timers, detaches handlers, and
uses the existing bounded provider shutdown. Completion/late-halt races preserve the first
authoritative terminal. SIGKILL/host loss cannot guarantee open-slice delivery.

A segment is opened lazily for actual trace-bearing activity, retaining existing no-work
behavior. After a previously active but currently idle segment closes, remain idle until
the next trace-bearing event; no stream of empty hourly traces is emitted. Pending
classification counts as logical bookkeeping, not running work, and does not require an
open span while idle.

### D26 — Integration, compatibility, and bounded promises

The shared OTel wiring owns enabling, recovery preparation, and lifecycle cleanup for both
index.ts interactive startup and daemon-cli.ts beginFeatureRun. Startup preparation may
be async at those composition roots; keep third-party VisualizerPlugin.start synchronous
and its existing contract unchanged. OTel-private prepared context/dependencies carry the
new metadata; do not require other visualizer plugins to implement trace segmentation.

Keep existing trace Resource keys and supported OTLP/file transports. The trace structure
changes for every enabled OTel caller, including direct factory callers through a safe
isolated fallback when no recoverable scope is supplied. Disabled OTel must not create
trace identity, segment timers, correlation reads/writes, or exporter activity.

The separate spool feature remains the delivery owner: use the current exporter abstraction,
do not add another queue, retry loop, age filter, or filesystem spool. Its approved
D15–D17 govern composition when present; this feature does not depend on its implementation
to establish correct trace structure.

No new CLI or configuration key is required. README plus the OTel configuration/artifact
references must explain role/identity fields, continued versus terminal slices, one-hour
rotation, step grouping, the late-outcome record, query/filter guidance, and backend
indexing/retention requirements. Existing per-dispatch inspection is a dispatch-ID query
over one or more linked segments, not a promise that each dispatch always has one trace.

Portability means standards-based OTLP spans, parents, links, timestamps, and attributes
with no mandatory vendor-specific component. Datadog is a required documented compatibility
target. Exact grouping layout, cross-trace navigation affordances, and retention vary by
viewer. No finite tracing retention can guarantee arbitrary future access to a feature's
entire history. Do not claim live Datadog acceptance from local exporter tests.

Verification must prove the normal 72-hour feature with several restarts, a dispatch and
execution longer than one hour, overlapping executions, delayed member classification,
feature isolation, missing/corrupt history, duplicate/late boundaries, stopped timers,
and exporter failure. Use controlled clocks, actual entry-point wiring, the real SDK/
serializers where relevant, and fake third-party transport. Default tests must never call
Datadog or Tempo. An explicitly named opt-in smoke may confirm the operator's real collector
mapping/indexing behavior; record it separately from local protocol proof.

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
