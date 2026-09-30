# Architecture Review: Portable feature history across bounded trace segments

**Date:** 2026-09-30
**Source:** jstoup111/ai-conductor#2011, including consolidated #2009
**Input:** Operator-approved explore scope and architecture diagrams; no stories or plan yet.
**Mode:** Full (Large tier, technical track)
**Verdict:** APPROVED WITH CONDITIONS
**Operator architecture approval:** Pending. No ADR amendment is authoritative yet.

> **Amended 2026-09-30 by #2011:** The operator approved the complete amendment
> package in chat. Its exact D18–D23 text is now in
> [ADR-014](adr-014-otel-observability-exporter.md#d18--bounded-traces-are-the-feature-history-representation),
> with companion amendments in shared lifecycle D5 and cold-start D7. Condition 1
> is satisfied; subsequent references to pending approval describe the earlier review.
> Architecture approval and verify-claims are CLEAR for stories. Conditions 2–4
> remain downstream coverage, implementation, and verification obligations.


## Feasibility

The design is feasible with the existing TypeScript/Node/OpenTelemetry stack. It requires
no new backend, dependency, vendor SDK, or viewer. The contract is portable linked traces,
not a universal multi-day waterfall.

| Concern | Finding | Basis |
|---|---|---|
| Span structure and links | Standard parent/child spans plus creation-time links can express segments, groups and continuations. | Verified: OTel API specification; existing @opentelemetry/api and sdk-trace-base dependencies. |
| Current root lifecycle | SpanManager.ensureRunSpan creates a root; forceCloseAll marks unfinished work incomplete. Ordinary rotation must be distinct from that shutdown path. | Verified: engine/otel/span-manager.ts, ensureRunSpan and forceCloseAll. |
| Execution identity | Explicit execution IDs already distinguish concurrent members; policy retries retain identity, later re-runs create a new one. | Verified: execution-identity.ts and shared lifecycle ADR D2. |
| Delayed member verdict | onGroupMemberStep freezes settlementEndTimeMs and a later terminal ends the span at that time. Holding it through a multi-day wait violates the new bounded-span design. | Verified: SpanManager.onGroupMemberStep and endSpan. |
| Identity before startup | Daemon startup allocates a fresh dispatch/session ID and reads the persisted feature ID; StepRunner only creates the file later when absent. Centralized bootstrap identity is needed for reliable early-start recovery. | Verified: daemon-cli.ts beginFeatureRun; step-runners.ts ensurePipelineDir; index.ts sessionId bootstrap. |
| Event persistence | Feature events already use EventPersister and forward to the daemon; normal emit swallows handler errors, whereas emitOrThrow reports them. | Verified: event-persister.ts and ui/events.ts. |
| Existing parser | parseEvents is shared with report/signal consumers; extend/reuse it for typed correlation-record recovery. | Verified: report-renderer.ts parseEvents and engineer-store.ts. |
| Backend limits | Datadog documents past-timestamp ingestion bounds and indexed-span link visibility; Tempo documents long-trace search limitations. | Verified documentation, not live deployment proof; links below. |
| Export ownership | The SDK exporter abstraction is already shared by OTLP/file transports. Approved spool D15–D17 own delivery persistence independently. | Verified: otel-visualizer.ts, transport.ts, ADR-014; spool implementation is absent on this checkout. |

No test suite, backend smoke test, or implementation probe ran in this DECIDE review.
The earlier diagram syntax checks passed for all six blocks.

## Concrete proposed decisions

The complete reviewable amendment text is held in the worktree's
.pipeline/architecture-amendments-2011.md until operator approval.

> **Amended 2026-09-30 by #2011:** The authoritative complete text is now ADR-014
> D18–D23. The ignored review package is no longer a dependency of this specification. Its decisions are:

1. Rotate after one hour or 1,024 completed execution slices/outcome records. Close active
   slices without ending logical execution; link the next segment and its continuations.
2. Resolve the persisted feature identity through one atomic create-if-absent helper before
   enabled OTel starts. Keep provider/dispatch IDs separate and preserve existing values.
3. Publish segment lifecycle/context as typed ConductorEvents. Recover only validated,
   same-feature context from the existing ledger, with bounded memory and a five-second
   recovery budget; failures produce an explicit unlinked segment.
4. Emit logical-step grouping parents. Re-runs remain separate; policy retries remain
   in one logical execution. Count usage and terminal outcome once per execution.
5. End a member's work slice when it settles. If classification arrives later, emit a
   zero-duration outcome record linked to that work, instead of keeping an old span open.
6. Handle timer/terminal races, idle periods, clock gaps, exporter failures, and idempotent
   shutdown. No time-boundary event is an engine completion or a metric increment.
7. Preserve standard exporters, metrics ownership, and provider neutrality; document
   backend retention requirements and distinguish local protocol tests from live smoke proof.

Proposed constants and data ownership are review decisions, not inferred operator preferences.
No load-bearing unknown about live Datadog settings is used to declare the design verified.

## Complexity

Large remains appropriate. The coupled state machine has idle, active, rotating, stopping,
and stopped lifecycle states; each execution has running, awaiting-outcome, and terminal
states independent of its current slice. Durable correlation, synchronous event projection,
asynchronous publication, and SDK export are different lifetimes.

Splitting grouping from connectivity would give two features competing ownership of those
same lifetimes. The operator explicitly requested consolidation. Delivery spooling stays
separate and is reused through its existing exporter seam.

## Alignment

Reuse ADR-014 rather than create another OTel ADR: it already owns exporter decomposition,
asynchronous event projection, resource identity, and failure isolation. The new trace
lifecycle is an extension of those responsibilities, not a new persistence technology or
deployment boundary. The same-schema event ledger remains the durable correlation source.

Amend ADR-014 additively (proposed D18–D23), plus the shared lifecycle ADR D5 parent-placement
sentence and cold-start ADR D7 writer-ownership sentence. Preserve all original text and
place corrections beside it. Apply the amendments in DECIDE after approval, never as BUILD
tasks. No other accepted feature's behavior is absorbed.

The approved component diagram's sentence saying a retry is a distinct execution was
incorrect relative to shared lifecycle D2. An additive note corrects it: a policy retry
stays in the same execution; a re-run gets a new execution. The topology is unchanged.

**Local pattern basis:** use resolveExecutionIdentity's semantic subjects and
correlation namespaces; do not parse configured member display names back into identity.
Preserve the existing epoch-anchored monotonic clock for interval arithmetic.
The visualizer factory's renderer_error bridge is the precedent for reporting projection
observations through the canonical bus, with publication deferred outside ordinary event
handlers and deliberately excluded from recursive export. The main-root resolver is used
at bootstrap, not repeatedly in handlers. Exact private class names remain implementation
choices, while these ownership and lifecycle traits are mandatory.

**Worktree isolation:** all correlation reads/writes use the active feature's pipeline
directory and existing event ledger; no new shared root-checkout files, ports, databases,
or global mutable current-feature variable. Canonical repository identity is read-only.

**Event spine verdict:** channel=yes; concern=occurrence; bus covers segment lifecycle;
extend ConductorEvent and EVENT_SINKS; exception=none. No sidecar or second reader schema.

**Production durability:** the existing filesystem ledger remains the recovery source.
Transient in-memory span handles are expected; an in-memory-only recovery store is not
an acceptable production default. No fabricated recovery after missing persistence.

## Domain Integrity

- Feature run identity, dispatch identity, segment context and engine execution identity
  are different types. No provider session ID is reused as a mutable feature identity.
- Parse recovered data once into a valid context or a typed unavailable reason. Never pass
  loosely parsed JSON or guessed trace IDs into OTel.
- Use discriminated lifecycle/execution states and closed rotation/termination reasons.
  Exhaustive handlers must decide the new event types in every subscribed sink.
- Projection slices cannot complete gates or increment engine outcomes, attempts or costs.
- The group envelope is not active duration. A classification record is not a new work
  execution. Continuation markers are not failures.
- Separate actual execution duration from a capped observation slice and an unobserved
  clock gap; do not silently stretch or shorten work time to make a picture look complete.

## Wiring Surface

| New/changed surface | Production caller and consumer |
|---|---|
| Shared feature-identity helper | Enabled OTel bootstrap in index.ts and daemon-cli.ts; existing StepRunner persistence and legacy resource fallback delegate to it. |
| Prepared recovery context | Shared OTel startup preparation in engine/otel/wire.ts, before factory/start; injected into the built-in OTel factory only. |
| Segment lifecycle, timer and publication drain | OtelVisualizer's start/event/stop lifetime through wireOtelVisualizer; no separate process or polling loop. |
| Segment/group/slice/outcome projection | SpanManager handles existing engine events plus the explicit rotation event; SDK BatchSpanProcessor exports ended spans. |
| trace_segment_opened / ended / rotate | types/events.ts and EVENT_SINKS; EventPersister persists; trace projection handles rotate; MetricsListener explicitly ignores it. |
| Shared event decoding and bounded recovery reader | Startup preparation reads the feature ledger using the canonical parseEvents path plus typed new-record decoding. |
| Failure and unavailable-continuity diagnostics | Existing renderer_error bridge on the feature bus; bounded and never throws into engine work. |
| Shutdown draining | Interactive stopVisualizers and daemon beginFeatureRun.stop, while the feature persister is still attached. |
| Trace-only correlation attributes | Existing OTel trace Resource/SpanManager construction; MetricsListener/metric Resource stay free of new high-cardinality fields. |

Candidate implementation paths: src/conductor/src/engine/otel/{wire,resource,
create-otel-visualizer,otel-visualizer,span-manager}.ts, new private recovery/identity
helpers as needed, src/conductor/src/{index,daemon-cli}.ts,
src/conductor/src/engine/{step-runners,event-persister,event-sinks,report-renderer}.ts,
and src/conductor/src/types/events.ts. Third-party plugin interfaces should remain unchanged.

## Overlap

Advisory overlap-scan over the main wiring paths returned:
"No overlap detected; no open blockers. (Note: renames or name-only diffs may not be detected.)"

The approved durable-export-spool specification touches adjacent wiring and is known even
though the scan reports no open blockers. Compose at SpanExporter; do not build another
delivery queue or require the sibling implementation before local trace tests can work.
Run the complete wiring-surface scan again only if design changes add further paths before
planning; the current source bootstrap helper expansion is included in the final scan.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Cross-feature link joins unrelated work | Data | Low | High | Stable file identity plus repository/branch/worktree matching; invalid context never links. |
| Rotation appears as a completed/failed execution or doubles metrics | Data | Medium | High | Logical state separate from slices; terminal marker once; no engine events synthesized. |
| Late member classification holds stale spans open | Technical | Medium | High | Close at settlement, emit linked outcome at actual later classification time. |
| SIGKILL loses the open slice or an unpublished context | Data | Medium | Medium | Export finished slices promptly; one-hour maximum normal open window; explicit incomplete recovery. |
| Backend drops/indexes out a link target | Integration | Medium | Medium | Stable correlation attributes; documented retention and indexing; no claim that ledger persistence proves ingestion. |
| Suspension/outage makes old data stale despite rotation | Integration | Medium | Medium | Preserve timestamps and explicit gap; transport/spool owns delivery; no false zero-loss promise. |
| Recovery scan exceeds time/line bound | Performance | Low | Medium | Cancel reads, close handles, start isolated segment with visible unavailable reason; never block the build. |
| Timer or publication races survive stop | Technical | Medium | High | One expected-segment token, serialized transitions, bounded drain, idempotent stop. |
| Existing queries count every new conductor.run as a whole dispatch | Integration | Medium | Medium | Document segment role and dispatch ID; final run.outcome only on dispatch-ending segment. |

The one-hour bound is an engineering choice, not a Datadog requirement. An ungraceful kill
may lose up to the current open slice plus any SDK queue data not handed to a durable
exporter. The design does not claim the spool's short ended-span buffer is the only
possible loss window.

## ADRs Created

None. Governing ADRs are reused with the exact amendments proposed in
.pipeline/architecture-amendments-2011.md. They have not yet been applied to authoritative
ADRs, preventing an unapproved change from appearing under an existing APPROVED header.

> **Amended 2026-09-30 by #2011:** All three amendments have now been applied
> with operator approval; no new ADR is needed.

## Conditions

1. Operator approves the concrete amendment package before stories; then apply it beside
   the affected assertions in all three governing ADRs on this spec branch.
2. Stories and plan cover every D18–D23 behavior and negative boundary, especially early
   identity, 72-hour restart history, long executions, late classification, metrics parity,
   and typed-event persistence. Each boundary has one behavior-owning integration task.
3. Default checks use local fakes and controlled clocks, with actual SDK serialization and
   production entry-point wiring. Real backend smoke remains explicitly opt-in; document
   whether it was run and never substitute local schema proof for that observation.
4. Update README and the OTel guides/artifact references with trace-role query semantics,
   limits, indexing/retention, and no single-waterfall guarantee.

## Verify-Claims Ledger

**Verified:** source observations in Feasibility; governing ADR clauses; six diagram
render checks; advisory overlap output. External documentation:
[OTel trace API](https://opentelemetry.io/docs/specs/otel/trace/api/),
[Datadog span links](https://docs.datadoghq.com/tracing/trace_collection/span_links/),
[Datadog trace view](https://docs.datadoghq.com/tracing/trace_explorer/trace_view/),
[Datadog APM limits](https://docs.datadoghq.com/tracing/troubleshooting/),
[Tempo long traces](https://grafana.com/docs/tempo/latest/troubleshooting/querying/long-running-traces/).

**Inferred, 90%:** current SDK/factory seams can accommodate segmentation without a new
runtime dependency; based on existing Tracer.startSpan, links API and injected exporter
construction. No code has been built to prove the implementation.

**Confirmed inputs:** consolidated scope; cross-tool requirement including Datadog;
multi-day history; acceptance of bounded linked segments instead of a guaranteed global
waterfall; operator diagram approval.

**Not assumed:** live Datadog/Tempo versions, collector mapping, retention settings,
sampling, or successful ingestion. These remain deployment facts, not prerequisites to
authoring a protocol-level contract.

**Pending decisions:** the proposed constants, early identity ownership, recovery limits,
and late-outcome representation require operator architecture approval. This review
approves feasibility with conditions; it does not grant that approval.

Verdict: ASSUMPTIONS_PENDING for authoritative amendments; no stories or plan yet.

> **Amended 2026-09-30 by #2011:** The operator confirmed all listed pending
> decisions. Verdict: CLEAR for authoritative amendments and story authoring.
> No implementation or live-backend validation is claimed.
