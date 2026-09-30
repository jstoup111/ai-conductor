# Architecture Review: Configurable harness log export

**Date:** 2026-09-30
**Source:** [#1935](https://github.com/jstoup111/ai-conductor/issues/1935)
**Tier:** Large
**Input reviewed:** [Approved PRD](../specs/harness-logs-have-no-export-path-daemon-log-is-a-f.md), FR-1–FR-11; [approved diagram set](../architecture/harness-logs-have-no-export-path-daemon-log-is-a-f.md). Stories do not yet exist: this is the full pre-stories review.
**Technical verdict:** APPROVED WITH CONDITIONS
**Operator decision:** APPROVED in composer chat, 2026-09-30. D18–D21 are appended to ADR-014; stories may proceed.
**Implementation dependency:** [#2870](https://github.com/jstoup111/ai-conductor/issues/2870), recorded as a GitHub blocking dependency of #1935.

## Feasibility

The existing event bus, forwarding, telemetry wiring, and OTLP protobuf serializer provide the required seams. The missing parts are a shared log projection, structured capture of diagnostics that currently bypass events, independent log configuration, and lifecycle integration. No collector deployment, vendor SDK, incoming port, or new telemetry ledger is required.

| Requirement | Feasibility and integration |
| --- | --- |
| FR-1, FR-7, FR-10 | Resolve logs independently from existing trace/metric validation. Strict opt-in and a separate typed result prevent a log-only error from disabling other signals. Current configuration loading needs adjustment; merely adding a field to the global validator is insufficient. |
| FR-2, FR-4, FR-5 | Project existing events; add one typed diagnostic occurrence for output with no equivalent event. Preserve full feature ownership before local formatting. Root-only daemon consumption avoids forwarding duplicates. |
| FR-3 | OTLP/HTTP protobuf supports all four destination families, directly where supported or through a network collector. Backend-specific configuration and attribute mapping belong in recipes. |
| FR-6 | Leave local rendering and file retention in their existing owners. Capture raw diagnostic input, never tail or reparse the file. |
| FR-8, FR-9, FR-11 | Bounded asynchronous admission, batching, shared durable transport, cancellation, and non-exportable health events isolate delivery from builds. Existing startup/teardown ordering must change to include final lifecycle messages. |

Add direct dependencies on the installed-compatible OpenTelemetry log API and SDK release family (currently `@opentelemetry/api-logs` and `@opentelemetry/sdk-logs` 0.221.x). Reuse the existing transformer dependency and durable transport serializer/sender boundary. Do not rely on transitive log packages or silently upgrade the rest of OTel.

The durable spool is approved in ADR-014 D15–D17 but is not implemented on this checkout. Its specification PR #2848 merged; implementation PR #2868 was open, draft, and marked needs-remediation when inspected. #2870 tracks completion of that existing work; it is not another specification. BUILD must start from a baseline with the complete store, lease, drainer, delivery classifier, and shared runtime available. A partial exporter implementation does not satisfy this prerequisite.

No data migration or historical log import is needed. Configuration is additive and off by default. Implementation documentation must explain retention and consent without enabling logs in an upgrade script.

## Verified claims and remaining assumptions

Confidence describes the evidence, not a guarantee of future implementation behavior.

| Claim | Confidence / basis |
| --- | --- |
| Event emission awaits promise-returning subscribers; disk/network I/O inside the log callback would delay execution. | 100%, verified in `src/conductor/src/ui/events.ts`, `ConductorEventEmitter.emit` and `emitOrThrow`. |
| Daemon forwarding already carries feature identity outside truncated display text. | 100%, verified in `engine/event-persister.ts`, `ForwardingEventEmitter` and `forwardedFeatureOf`; and `engine/daemon-log.ts`, `createFeatureDaemonLogger`. |
| One shared root telemetry listener and separate per-feature providers are established local patterns. | 100%, verified in `engine/otel/wire.ts`, `wireDaemonOtel` and `wireInteractiveOtelMetrics`; ADR-014 D7/D9. |
| Some recovery provider buses do not currently forward to the daemon root bus; console diagnostics and final daemon output also bypass the current telemetry lifetime. | 100%, verified in `daemon-cli.ts`, `createSlugScopedProviderExecution`, console tee installation, and shutdown ordering. Coverage requires explicit wiring changes. |
| A read-only merged configuration reader exists; ordinary configuration loading can migrate/materialize files. | 100%, verified in `engine/config.ts`, `loadMergedConfigForRead`, `loadConfig`, and `loadProjectConfig`. Delivery must use a read-only path. |
| The installed SDK provides `LoggerProvider`, `LogRecordProcessor`, and `ReadableLogRecord`; the installed transformer exposes `ProtobufLogsSerializer`. | 100%, verified in installed 0.221.0 declarations/source under `src/conductor/node_modules/@opentelemetry/`. Rediscover exact APIs at BUILD HEAD. |
| The stock batch processor does not expose an admission/drop callback that meets counted overflow requirements. | 99%, verified in installed `sdk-logs/build/src/export/BatchLogRecordProcessorBase`; its full-queue branch increments internal metrics. Use explicit bounded admission, not private SDK introspection. |
| The four destinations have supported OTLP ingestion paths. | 99%, verified against the primary vendor documentation linked below. This establishes feasibility, not a claim that credentials/accounts have been exercised. |
| Complete durable transport will be available before log implementation starts. | Conditional dependency, not an assumed fact: #2870 must be resolved and its merged implementation inspected. |
| Project-wide consent and the concrete bounds below are acceptable product choices. | Approved by the operator in composer chat, 2026-09-30; no external performance claim is inferred from these chosen limits. |

Primary integration sources checked during DECIDE: [Loki OTLP ingestion](https://grafana.com/docs/enterprise-logs/latest/send-data/otel/), [Elasticsearch OTLP endpoint](https://www.elastic.co/docs/manage-data/ingest/otlp-endpoint), [Sumo Logic HTTP source OTLP](https://www.sumologic.com/help/docs/send-data/hosted-collectors/http-source/otlp/), and [Datadog OTLP logs ingestion](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/logs/). No live vendor account validation was performed.

## Complexity

Large remains appropriate: independent signal validation, concurrent attribution, multiple process lifetimes, durable replay consent, and four documented destination paths cross several modules. Keep this one additive log feature; the existing durable transport feature stays separate and blocking. A new transport implementation or vendor-specific adapter would broaden the accepted scope.

## Alignment

Reuse [ADR-014](adr-014-otel-observability-exporter.md) for event-derived export, failure isolation, ownership, and durable transport. Reuse [the total event sink registry decision](adr-2026-07-26-event-sink-registry-exhaustiveness.md) for explicit per-event subscriptions. The proposed amendment extends these decisions to logs; it does not replace the telemetry spine or duplicate an ADR.

**Focused local pattern basis:** `MetricsListener` supplies the single-listener start/stop and event-projection pattern. Preserve ownership, idempotent teardown, and attribution from the occurrence. Logs may use different sink selection and severity. `createFeatureDaemonLogger` and `withDaemonLogFeatureOwnership` supply immutable/async-scoped feature context; preserve that semantic ownership while capturing before display shortening. Never copy the current formatted-string parsing into export identity.

**Scope check:** A: consumer-facing shared runtime functionality; the daemon and interactive telemetry mechanisms exist in installed consumer repositories, and no self-host-only mechanism is added. B: no new skill. C: provider-agnostic. Implementation guidance belongs in the existing consumer configuration reference; these DECIDE artifacts stay in `.docs/`. No instruction-catalog or release-file changes are needed for this specification.

**Event-spine check:** occurrence concern; extend the union for currently absent diagnostics and extend the sink registry for logs. Existing root and feature persistence remain authoritative. Spool files are transport state under exception C and ADR-014 D15–D17, not an observable parallel log schema. First-emission timestamp metadata belongs to event dispatch/forwarding, not an auxiliary artifact.

No harness process or port is added. Concurrent worktrees deliberately share only the existing main-root durable transport runtime and its lease. Resources and records retain project/feature identity; an unrelated repository has a different runtime root.

## Domain Integrity

Parse raw log configuration once at each admission boundary into a discriminated result: disabled, invalid with named diagnostics, or enabled with a validated HTTP destination and credential references. Read-only policy refresh produces the same type. Invalid and disabled values cannot manufacture a sender.

Use typed severity, scope (project or feature), delivery failure class, and source event type. Feature scope requires a complete feature identifier; project scope contains none. No mutable global “current feature,” severity guessing from glyphs, or catch-all event serialization is allowed.

Use one exhaustive sink registry and typed projection table. Formatting is a pure projection of known event fields. Credential references are distinct from resolved header values; only the latter reach the HTTP boundary. Queue/drop state belongs to the delivery owner, not the domain event source.

## Approved amendment to ADR-014

**Approval state: APPROVED**, 2026-09-30. The following decisions have been appended to ADR-014, preserving earlier text. ADR-014 is the authoritative copy.

### D18 — Independent project-level log consent and configuration

Add `otel.logs` with the following supported fields:

| Setting | Contract |
| --- | --- |
| `enabled` | Strict boolean, default false. Only explicit true consents. |
| `endpoint` | Optional HTTP(S) OTLP base URL; append `/v1/logs` exactly once. Inherit `otel.endpoint` only for an otherwise valid HTTP OTLP parent destination. With a file/gRPC/no parent exporter, an explicit HTTP logs endpoint is required. |
| `headers` | Optional map using the existing environment-reference credential syntax. When present, replaces inherited headers; an empty map intentionally supplies none. Otherwise inherit the applicable HTTP parent headers. Never store resolved values. |
| `spool.enabled` | Strict boolean, default true for enabled logs; independent of other signals' spool control. |
| `spool.max_bytes` | Positive integer, default 67,108,864 bytes (64 MiB); applies only to log backlog. |

Logs always use OTLP/HTTP protobuf. No log-specific vendor selector, gRPC mode, local file exporter, or environment-only implicit enablement is added. Existing trace/metric transport and controls retain their meanings. Logs may be enabled alone with an explicit HTTP endpoint.

Both execution modes resolve the log block from the same read-only merge of user configuration and the canonical main-root project's configuration; project values override user values. A worktree-local log block cannot override that shared project's policy. Report an ignored differing worktree log policy once, naming the canonical configuration path. Existing trace/metric configuration resolution is unchanged.

At startup, unknown keys and malformed values under `otel.logs` yield a named, local, logs-only configuration error. Invalid log settings disable only logs. Never pass raw log-only validation errors into a fatal whole-run or whole-OTel validator. Missing `enabled` remains off even when other log fields are valid. Reject endpoint userinfo, query strings, and fragments; use credential headers for authentication. Diagnostics identify the setting and sanitized host, not raw configuration or URLs containing sensitive paths.

Resolve the canonical root once with the strict main-repository resolver. Failure to establish it disables logs with one warning rather than writing to a guessed root. Before each direct or retained batch send, asynchronously reread the canonical log policy through the read-only reader and resolve credentials in the sending process. Off, invalid, unreadable, or missing configuration forbids sending. Do not call migratory loaders or introduce a filesystem watcher. The read is part of the bounded delivery operation, never an event callback.

A policy change applies to the next send; an already issued request cannot be retracted. Restart is required to begin capturing after enabling a previously disabled owner. No disabled-time events or historical local files are replayed.

Example using an existing HTTP destination:

```yaml
otel:
  exporter: otlp
  endpoint: http://localhost:4318
  logs:
    enabled: true
```

### D19 — Shared event projection and diagnostic capture

One log owner is attached to the daemon root bus; one owner is attached to an interactive run's bus. Per-feature daemon buses forward existing occurrences with full feature identity and do not own exporters. Recovery/provider execution buses use the same forwarding mechanism.

Add a required `logs` field to the total event sink registry and an exhaustive projection table for selected event types. Export harness lifecycle and operational diagnostic occurrences. Provider transcript chunks, dashboard snapshots, raw application output, and export-health events are explicitly excluded. Do not serialize an arbitrary event object as a log body.

For operational messages lacking an equivalent typed event, emit a typed `operational_log` occurrence with severity, raw message, timestamp, and project/feature ownership. It persists through the existing spine and is not re-rendered when the original local logger already rendered it. Capture before ANSI/prefix/slug formatting; the local sink still receives its original arguments. Severity comes from the source API (info/warn/error); enrich warning/error callsites where a generic string logger currently loses that information.

Rendered events must not be recaptured as diagnostics. A shared async-scoped rendering/capture guard surrounds the terminal and daemon event-rendering paths and health rendering. For feature-pool lifecycle output that duplicates an existing event, select the existing typed occurrence as the exported owner and suppress recapture of its accompanying rendered line. Do not attempt deduplication by matching message strings.

Use immutable logger ownership and async execution context for deferred diagnostics. Never infer feature identity from a rendered prefix. Existing forwarding metadata must preserve a timestamp captured at first bus emission, alongside feature attribution; authoritative occurrence timestamps already present on known events take precedence. No per-subscriber restamping or sidecar timestamp file.

Export standard OTel timestamp, observed timestamp, severity and body, plus record attributes `project`, `worker`, `conductor.scope`, `conductor.event.name`, and `feature` for feature-owned occurrences. Include step/attempt only when supplied by that event. Use a worker-stable log Resource, inheriting validated static attributes, project name, worker name and release identity. No log resource construction creates or rewrites run/session identity files. Conductor-owned keys override custom attributes.

### D20 — Bounded shared delivery and replay authorization

Use the log SDK provider with one explicit bounded batch processor implementing its public processor interface. The processor owns the sole in-memory admission queue, counts rejected records, and schedules asynchronous serialization/export. Avoid stacking an additional SDK queue or inspecting private SDK fields. Both modes use this same implementation.

Chosen limits are design constants, not new configuration knobs:

| Bound | Value / disposition |
| --- | --- |
| Resident admitted payload | At most 1,024 records and 8 MiB of normalized payload, including in-flight records; object overhead remains additionally bounded by record/attribute limits. Drop newest on overflow and count it. |
| Record | At most 64 KiB encoded normalized payload and 64 bounded attributes; remote body at most 32 KiB UTF-8, with truncation marked. Required identity is never truncated; a record whose required fields cannot fit is dropped and counted. Local output is unchanged. |
| Batch | At most 128 records and 1 MiB serialized request body, flushed every 1 second or at the limit. Split by actual serialized size away from the event callback. |
| Delivery operation | 2 seconds total, including asynchronous policy/credential resolution and request; use abort/cancellation and unreferenced timers. |
| Shutdown | One 2-second total log flush/stop budget, not a new budget per queued batch. Stop admitting after final lifecycle output, then preserve/flush what fits. |
| Local warning rate | First failure promptly, then at most one failure/drop summary per 60 seconds per owner, aggregating counts across classes; at most one recovery notice per 60 seconds. |

All event callbacks perform bounded projection/admission only; no awaited disk/network work. Apply input bounds before expensive serialization. Queue overflow, oversize records, write failures, timeouts, and rejection have counted dispositions. No uncaught callback or exporter error may change the build result.

Extend the existing D15–D17 spool store, serializer, classifier, lease and runtime with the logs signal; do not create another drainer or lock. Log retention has its own 64 MiB default cap so log floods cannot evict spans/metrics. Eviction, partial rejection, retry/backoff, and credential resolution follow D15–D17. Logs with spool disabled use the same bounded sender directly. Disk failure uses the existing bounded direct fallback, still subject to consent.

Retained log batches carry a nonsecret destination identity derived from the normalized endpoint and header-reference names, never resolved header values. Only a batch matching the current enabled policy may be sent. A changed destination leaves old batches retained and counted toward the same log cap; restoring that destination permits delivery. Credential value rotation under the same references is allowed. Disabling logs leaves retained batches unsent, with one bounded local notice; it does not purge them or authorize a different process to drain them. A trace/metric owner with logs disabled cannot send the logs signal.

Direct batches also retain their originating destination identity: a policy change between admission and send must never reroute a queued record to the new destination. If no matching consent remains, retain it only when already safely spooled, otherwise discard/count it without sending. This is bounded retention, not unlimited or exactly-once delivery.

Extend existing typed spool/drop health events to cover logs and admission loss; use the same spine and local health renderer. Mark every log-export health event and its rendering `logs: false` so failures cannot feed themselves. Do not export credentials, request headers, raw backend response bodies, or unsanitized exception text in these warnings.

### D21 — Ownership, startup, shutdown, and interoperability

Install the shared diagnostic capture and log owner before the first configured-run lifecycle diagnostic, then keep them alive through the final completion/shutdown diagnostic. Entry paths before configuration can be resolved remain local-only. Use try/finally teardown on startup failure, ordinary completion and exceptional shutdown. Restore any scoped console warn/error bridge exactly once. Do not intercept arbitrary stdout or raw subprocess streams.

The daemon owns the root listener, console bridge and log provider for its lifetime. Completing a feature may request a bounded flush but cannot detach the root listener, stop other features' delivery, or release the shared transport lease. Interactive teardown releases only that invocation's references. Repeated starts/stops must not accumulate subscriptions. Existing shared spool-runtime ownership, not a new feature-owned lease, governs transport shutdown.

Document direct or collector-mediated recipes for all four destination families. Loki's OTLP base path and structured-metadata requirement, Elasticsearch's OTLP-capable deployment or collector exporter, Sumo's HTTP-source endpoint with header authentication, and Datadog's site-specific OTLP logs endpoint/key must be explicit. Keep complete feature slugs as structured metadata where a backend distinguishes metadata from indexed labels. Show actual required endpoint suffix behavior and secret-reference syntax; never include live credentials. A collector receives OTLP over the network and needs no checkout mounts.

## Wiring Surface

Candidate paths are rediscovery hints, not required coordinates on a future rebased BUILD checkout.

| Production surface / candidate path | Intended production caller or consumer |
| --- | --- |
| Log config types and independent resolver: `types/config.ts`, `engine/config.ts`, new `engine/otel/log-config.ts` | Daemon and interactive log wiring; shared sender refreshes only the canonical read-only log policy. |
| `operational_log`, first-emission metadata: `ui/events.ts` | Shared diagnostic logger emits; existing event persister records; log projection consumes. |
| Total log sink selection: `engine/event-sinks.ts` | Shared log listener registers selected typed handlers; every union member has an explicit decision. |
| Forwarding metadata and recovery bus wiring: `engine/event-persister.ts`, `daemon-cli.ts` | Feature execution and recovery/provider buses forward to the root log owner with original timestamp and feature identity. |
| Diagnostic/capture guard: new `engine/operational-log.ts`, `engine/daemon-log.ts`, `ui/subscriber.ts` | Existing daemon log factories, warn/error bridge, and event render paths; interactive run installs the same capture semantics. |
| Log projection/resource/processor: new `engine/otel/log-listener.ts`, new `engine/otel/log-processor.ts`, `engine/otel/resource.ts` | Shared `engine/otel/wire.ts` log-owner factory used by both entry points. |
| Log serialization, consent and durable delivery: `engine/otel/transport.ts`, prerequisite spool modules | Log processor calls existing shared spool runtime or direct sender; runtime's logs loop checks fresh policy before sending. |
| Owner lifecycle: `daemon-cli.ts`, `index.ts`, `engine/otel/wire.ts` | Daemon startup/finally and interactive run startup/finally, not per-feature visualizer construction. |
| Log dependencies: `src/conductor/package.json` and lockfile | Production SDK provider/processor and existing transformer import paths. |
| Configuration reference and destination recipes: `docs/reference/` | Operator setup and troubleshooting; additive defaults remain off. |

> **Amended 2026-09-30 by #1935:** Source hints refined during plan preparation: the event union is declared in `src/conductor/src/types/events.ts`; `ui/events.ts` owns emission metadata. The sink registry and terminal subscriber are `engine/event-sinks.ts` and `ui/subscriber.ts`. This corrects source coordinates without changing the approved behavior or boundaries.

## Coverage inventory for stories and implementation

| Existing output boundary | Required treatment |
| --- | --- |
| Typed feature lifecycle, step outcomes and harness warnings/errors | Project their existing event once; full feature identity on forwarded and interactive paths. |
| Daemon-wide startup, scheduler/recovery diagnostics, shutdown | Capture raw structured diagnostics on root bus, with project scope unless a feature source supplies ownership. |
| Feature logger / asynchronous executor warn/error | Capture before formatting using immutable/async-scoped feature context; concurrent interleaving must preserve ownership. |
| Recovery provider execution bus | Reuse forwarding so these occurrences reach the daemon owner; no second local log provider. |
| Terminal/daemon renderer output, including feature-pool lifecycle text | Suppress recapture around event-derived rendering; keep local bytes and retention behavior. |
| Interactive configured-run diagnostics and exception paths | Same diagnostic source and projector as daemon; bounded teardown even after startup failure. |
| Export-health diagnostics and raw provider/application output | Health stays local/persisted and excluded from log export; raw transcripts/application streams stay outside scope. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| Retained logs sent after consent is revoked or to a changed destination | Security | Medium | High | Canonical read-only policy checked at every send; destination identity binding; concurrent-owner and retained-batch proof. |
| Missing or duplicate operational coverage | Integration | Medium | High | Coverage inventory, root-only projection, rendering capture guard, production-entry-point tests in both modes. |
| Existing config validator disables all telemetry for a log-only error | Integration | Medium | High | Independent typed validation and explicit matrix covering otherwise valid traces/metrics. |
| Pending spool code changes module APIs | Integration | High | Medium | #2870 is a real GitHub blocker; reuse the merged implementation and adapt names without copying its runtime. |
| Slow or recursive delivery exhausts resources | Performance | Medium | High | Defined admission/byte/request/stop limits; non-exportable health; cancellation and warning aggregation. |
| Backends map resource/record attributes differently | Knowledge | Medium | Medium | Explicit vendor recipes, fixture-decoded OTLP field assertions, and clearly identified live-validation limits. |

## Overlap report

Read-only `ai-conductor overlap-scan` refreshed on 2026-09-30 over the candidate paths with source reference #1935:

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/types/config.ts
Open blocker: jstoup111/ai-conductor#2870
Note: renames or name-only diffs may not be detected by this scan.
```

This is advisory and reflects the refs available to the scanner. Manual review additionally identified the active durable-export implementation PR #2868 touching config/transport; spec-branch scanning alone does not establish that those changes are available. Reconcile the merged dependency at BUILD start.

## ADRs Created

None. Structural reuse check found ADR-014 already governs the integration, persistence and owner boundaries. D18–D21 above are an operator-approved additive amendment to that governing ADR; no competing authority is introduced. No prior decision is silently rewritten.

## Conditions

1. Satisfied: operator approved D18–D21 and they were appended to ADR-014 before stories, 2026-09-30.
2. Carry #2870 into the plan prerequisites; do not build a parallel spool to work around it.
3. Stories must cover the inventory and all PRD outcomes, including disabled retained delivery, concurrent ownership, log-only validation failures, destination changes, bounded shutdown, and local output preservation.
4. Test behavior through production wiring with isolated filesystem/HTTP boundaries; no live credentials or operator processes. Detailed tests are BUILD work, not executed by this specification review.
5. Document all four destination recipes and the chosen limits. Clearly distinguish protocol-level evidence from unperformed live-account checks.

## Validation

Five approved Mermaid diagrams passed rendering before this review. Source inspection and primary vendor documentation establish feasibility. No production code, behavioral tests, aggregate suite, or live log sending was run or changed during this review.


## Verify-Claims Verdict

CLEAR for specification: source-backed claims are recorded above; the operator approved the project-wide policy and concrete limits. Durable transport availability remains a mechanically tracked implementation prerequisite, not an assumed completed capability.

> **Amended 2026-09-30 by #1935:** The full plan-file overlap scan used the CLI's comma-separated file argument and additionally reported `origin/spec/daemon-self-host-guardrails` touching `engine/config.ts` and `types/config.ts`, plus `origin/spec/self-host-phase6-wiring` touching `daemon-cli.ts`. #2870 remains open. This replaces the narrower source-file scan for overlap coverage; it adds no behavioral condition.
