# PRD: Configurable harness log export

**Date:** 2026-09-30
**Status:** Approved
**Approved by:** Operator in composer chat, 2026-09-30
**Source:** [ai-conductor #1935](https://github.com/jstoup111/ai-conductor/issues/1935)

## Problem / Background

Operators can export harness traces and metrics, but cannot configure the harness to send its operational logs to an external log destination. The reported workaround requires a separate process to read project files and reconstruct structured fields from display text. That loses information such as complete feature identifiers and couples collection to human-readable formatting.

Verified during exploration: the current exporter supports traces and metrics only; daemon log formatting truncates displayed feature identifiers; daemon and interactive execution already share telemetry infrastructure, while some operational diagnostics take separate paths. These observations were checked against the isolated repository checkout, rather than assumed from the older intake report.

The operator wants both execution modes to use common logging behavior and explicitly requires a separate, default-off control for sending logs. Existing telemetry enablement is not consent to send logs.

## Goals & Non-Goals

**Goals**

- Allow operators to send harness operational logs to their chosen destination through configuration, without reading project files from a separate collection process.
- Give daemon and interactive execution equivalent export behavior and field meanings.
- Preserve complete, structured attribution so operators can distinguish projects and concurrent features.
- Make log delivery an explicit opt-in independent of existing trace and metric enablement.
- Keep local visibility and build execution reliable when remote delivery is unavailable.

**Non-Goals**

- Installing, operating, or replacing the external log service.
- Exporting arbitrary project files, application logs, or full provider conversation transcripts.
- Replaying historical local logs that predate enablement.
- Redesigning trace or metric behavior, or promising lossless delivery through unlimited outages.
- Turning unrelated one-shot administrative command output into a new logging product.

## Users / Personas

- **Harness operator:** runs daemon-managed and interactive work and wants to search operational logs alongside existing telemetry without managing file access to each checkout.
- **Observability administrator:** configures destination access and needs predictable fields, explicit enablement, actionable setup errors, and bounded failure behavior.
- **Harness maintainer:** needs shared behavior across execution modes and providers without making successful builds depend on external logging.

## Functional Requirements

### FR-1: Explicit, separate consent to send logs

Log sending has its own enablement control and defaults to off. When that control is absent or disabled, no log records are sent, even if trace and metric export is enabled and a destination is already configured. This applies to both daemon and interactive execution. A subsequent invocation with log sending disabled must not send previously retained log records either. Explicit enablement is required before log delivery can occur.

### FR-2: Equivalent operational coverage across execution modes

When log sending is enabled, daemon-managed and interactive runs can deliver their harness lifecycle messages and operational diagnostics, including warnings and errors. Equivalent occurrences have the same field meanings and severity in both modes. Daemon-wide activity is covered even when it does not belong to an active feature. Operators do not need a mode-specific export configuration for the same destination.

This coverage concerns harness operational output, including diagnostics the harness already reports while handling subprocess failures; it does not add collection of full provider conversations or unrelated application output.

### FR-3: Configuration-based destination interoperability

An operator can deliver logs to each of Loki, Elasticsearch, Sumo Logic, and Datadog using supported configuration, without modifying the harness for a particular vendor. A compatible intermediary is permitted, but it must receive logs from the harness without scraping files or gaining access to project checkouts. Each destination family has a documented setup that identifies any required intermediary or backend capability.

### FR-4: Structured, complete log fields

Every delivered record carries its occurrence timestamp, severity, message, and project identity as separately queryable information. Feature-owned records also carry their feature identity, including the complete untruncated slug. Operators can filter by these values without parsing the displayed message. Repository-wide records remain identifiable as repository-wide; they must not claim another feature's identity merely to populate a field.

### FR-5: Correct attribution during concurrent work

When multiple features produce operational logs concurrently, each record retains its originating feature's identity. A record must not inherit the most recently active feature's identity. The harness must not produce duplicate logical log records merely because an occurrence passes through both feature-level and daemon-level handling. Transport retries are a separate delivery concern and do not imply an exactly-once delivery guarantee.

### FR-6: Preserve local log visibility

Existing daemon log reading, following, local retention, and live terminal output continue to work when remote log sending is disabled, enabled, misconfigured, or failing. Enabling remote delivery must not truncate or suppress local output to satisfy a remote destination's constraints, and disabling remote delivery must not disable local logs.

### FR-7: Preserve existing trace and metric behavior

Changing the log-sending control alone does not enable, disable, or otherwise change existing trace and metric delivery. A failure confined to log delivery must not disable those other signals. Existing configurations that enable only traces and metrics remain valid and continue to send no logs until the operator opts in.

### FR-8: Isolate destination failure from execution

An unreachable, slow, rejecting, or failing log destination must not fail a build, change its outcome, or make progress wait for remote log delivery. Remote backlog growth must have a defined bound. Exhausting that bound must not cause unbounded memory or storage growth or turn logging into a build dependency.

### FR-9: Make delivery failures visible without flooding output

Delivery failure and any resulting discarded records produce a bounded, actionable local warning. Repeated failures in the same episode must not produce one warning per record, recursively generate further delivery failures, or obscure the build's own diagnostics. The warning identifies the affected log destination without exposing authentication material.

### FR-10: Diagnose invalid configuration before sending

When explicitly requested log delivery is malformed or names an unsupported destination kind or option, configuration validation identifies the invalid setting or destination and explains the supported correction. It must not silently ignore the mistake, switch to another destination, or treat malformed enablement as consent. An invalid log-only setting must not disable otherwise valid local logging or existing trace and metric configuration. Configuration errors and runtime delivery failures remain distinguishable.

### FR-11: Bound shutdown and preserve lifecycle ownership

Normal completion or shutdown makes a bounded attempt to preserve or deliver pending logs under the approved delivery policy. A stalled destination must not prevent shutdown. Completion of one daemon feature must not stop log delivery for the daemon or other active features. Starting a later run must not duplicate subscriptions or retain attribution from an earlier run.

## Non-Functional Requirements

- **Performance and resource bounds:** record production is isolated from destination latency. Architecture must specify testable limits for pending records, remote operations, shutdown, and repeated warnings before stories and implementation tasks are accepted. No unlimited queue or retry wait is permitted.
- **Security:** authentication material is configured through the harness's existing secret-reference conventions and is not copied into log records, diagnostic messages, or retained delivery metadata.
- **Compatibility:** the same capability and opt-in semantics apply to every supported execution provider. Existing local display conventions may differ between daemon and interactive modes without changing exported field meanings.
- **Reliability:** delivery must align with the harness's approved bounded-retention and failure-isolation policies. This feature does not guarantee that every record survives abrupt process death or arbitrarily long destination outages. Any selected retention and retry limits must be documented, including the disposition of pending records when log sending is disabled.

## Acceptance Criteria / Success Metrics

- In both execution modes, a representative run with existing telemetry enabled and no log opt-in produces no outgoing log records. Explicitly disabling logs has the same result, including after a prior enabled invocation retained records.
- With explicit opt-in and a healthy destination, representative lifecycle messages and a warning/error are received with queryable timestamp, severity, project, and correct full feature identity where applicable.
- Two concurrent daemon features with long, similar slugs remain distinguishable. Local display truncation does not affect exported identity, and feature forwarding does not create duplicate logical records.
- Repository-wide daemon diagnostics remain distinguishable from feature-owned records. An equivalent interactive occurrence uses the same field meanings.
- Documentation supplies a valid configuration path for each requested destination family, states backend prerequisites, and explains that log sending is independently disabled by default.
- Controlled destination failures prove that execution completes with the same outcome, local logs remain available, warning volume and resource use stay within the limits approved during architecture review, and shutdown completes within its bound.
- Invalid log-only configuration produces a named diagnostic without unintended sending or disruption of valid trace and metric export.
- Completed-feature validation maps every positive and negative requirement to behavioral evidence at the lowest sufficient layer; ordinary automated checks use controlled substitutes for external services.

## Scope

### In Scope

- Both daemon-managed and interactive harness execution, including lifecycle messages and operational diagnostics.
- A separate, explicit, default-off log-sending control.
- Configuration-based delivery to the four named destination families, with any intermediary requirements documented.
- Complete structured identity, concurrency correctness, preserved local output, bounded failure reporting, configuration diagnostics, and lifecycle cleanup.
- User documentation explaining enablement, configuration, fields, failure behavior, and applicable delivery limits alongside each delivered capability.

### Out of Scope

- External service deployment, dashboards, alerting rules, or new vendor account management.
- Historical log import, arbitrary filesystem collection, raw conversation capture, and unrelated administrative command output.
- New trace or metric features or rebuilding the separately specified reliability work as part of this feature.

The original issue used daemon logs as its concrete example. The operator expanded the intended behavior to a shared path for daemon and interactive execution, then approved that approach and the separate opt-in requirement. No additional operator-facing feature is proposed beyond those outcomes.

## Key Decisions & Rationale

- **Logs need separate consent.** The operator explicitly stated that existing telemetry enablement must not enable log sending by default.
- **Execution mode does not change export semantics.** The operator expects a common path, so equivalent operational records should behave consistently across daemon and interactive runs.
- **Keep local visibility.** External observability is an additional destination; operators must retain existing local diagnostics during setup problems and outages.
- **Choose destination through configuration.** The product must support the four requested destination families without a new harness implementation for each installation.
- **Execution takes priority over delivery.** Failure isolation and bounded resources are required; unlimited retention or exactly-once network delivery are not promised.

## Dependencies

- Operators supply access to a compatible external log destination and any required credentials. The harness does not provision the external service.
- Existing vendor capabilities were verified against primary documentation during exploration, not by sending data to live accounts: [Loki log ingestion](https://grafana.com/docs/enterprise-logs/latest/send-data/otel/), [Elasticsearch ingestion](https://www.elastic.co/docs/manage-data/ingest/otlp-endpoint), [Sumo Logic ingestion](https://www.sumologic.com/help/docs/send-data/hosted-collectors/http-source/otlp/), and [Datadog log intake](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/logs/). Backend versions, authentication, and supported deployment paths must be stated in the eventual configuration guidance.
- The harness has an approved, separately specified durable export capability whose checked-out implementation is not yet present. Architecture review must resolve its relationship and build ordering before finalizing this feature's implementation plan; the requirements do not assume that capability has already shipped.

## Open Questions

These are implementation trade-offs for architecture review, not additional product choices being silently assumed:

1. How should the approved shared OTel approach represent separate log enablement and destination configuration while preserving existing trace/metric behavior and reporting invalid log-only settings independently?
2. Which existing event coverage can be reused, and which diagnostic boundaries need structured emission so startup, shutdown, and warning/error coverage is complete without re-exporting rendered output or creating duplicates?
3. How should logs extend the approved durable export spool, and what dependency ordering prevents competing implementations? What happens to retained records when sending is later disabled or a destination changes?
4. What concrete queue, record-size, remote-operation, shutdown, and warning limits satisfy bounded delivery without obstructing execution? How are oversized records and exhausted retention reported?
5. Which destination paths use direct ingestion versus an intermediary, and what authentication, version, and field-mapping constraints must the configuration guidance state?

## Verify-Claims Ledger

- **Verified:** the log-export gap and current display truncation were observed in the repository during exploration; neither is inferred solely from the issue text.
- **Verified:** all four vendors document a logs ingestion capability; the primary sources are listed under Dependencies. No claim of successful live account validation is made.
- **Operator-confirmed:** target repository, both execution modes with shared behavior, product track, and separate default-off log sending. Confirmation occurred in this composer conversation on 2026-09-30. The selected implementation approach is carried into the architecture questions above.
- **Operator-approved:** the complete functional requirements and explicit scope exclusions above; approved in composer chat on 2026-09-30.
- **Unresolved technical choices:** listed under Open Questions; no assumption about their concrete implementation is used to prescribe an implementation task.

**Verdict:** CLEAR. Product-only audit passed and requirements were explicitly approved by the operator. Concrete architecture choices remain open as listed above; no stories or implementation plan have been authored.
