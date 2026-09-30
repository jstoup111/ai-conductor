# Track: Portable feature history across bounded trace segments

Track: technical

Scope boundary: Comprehensive for jstoup111/ai-conductor#2011 and the consolidated #2009.
Connect telemetry for one feature across dispatches, re-kicks, halts, restarts, and multi-day
execution; group repeated logical steps while preserving each execution, overlap, timing,
outcome, retry count, and dispatch inspection. The fix belongs in emitted OpenTelemetry
data and must support compatible tracing tools, explicitly including Datadog. It must not
require a Grafana dashboard or a separate harness viewer.

Operator-approved approach (2026-09-30): export bounded trace segments promptly, connect
them with standard span links, and retain a stable feature identity. Segment even a single
unusually long dispatch. The operator accepted connected navigation instead of a guaranteed
single cross-day waterfall in every tracing tool. Grouping is structural within each segment;
stable logical-step identity supports correlation across segment boundaries. Individual
executions remain distinct, including continuations of an execution across segments.

Technical track: changes to the existing exporter and event/identity lifecycle, without a
new UI or application workflow. This follows the technical-track treatment of existing OTel
identity and export-reliability features.

Excluded: a universal viewer layout guarantee; a custom dashboard/viewer; full-history
re-export with rewritten timestamps; backend retention administration; logs export;
changes to metric aggregation; and rebuilding an export reliability spool already owned
by the separate durable OTel export-queue feature.

## Exploration decision and rejected alternatives

- Selected: bounded linked traces. The operator approved the portability tradeoff after
  raising a feature taking three days to complete.
- Rejected: a single feature-lifetime trace with long-lived parent/group spans as the
  portable default. Datadog documents a past-timestamp ingestion limit; holding spans
  across days cannot be assumed safe. Short spans sharing a trace ID do not remove
  backend-specific reconstruction/search limitations.
- Rejected: Grafana-specific query/view composition. The operator explicitly requires
  tracing-tool independence and Datadog compatibility.
- Rejected: a harness-native timeline over the event ledger. It is a genuine alternative
  to the filer's tracing hypotheses, but a separate viewer does not satisfy the clarified
  outcome that relationships travel in the exported telemetry.

Scope and routing were confirmed in chat. The operator requested consolidation; #2009
is closed with a reference to #2011, its requirements are preserved in #2011 comments,
and its duplicate composer ledger entry was removed. #2011 remains the sourceRef.

## Repository authoring scope

A. Audience: consumer-facing — the OTel exporter and interactive/daemon entry points are
shipped to installed repositories. The scope-check daemon heuristic would classify daemon
wiring alone as repo-only; it is not authoritative here because this mechanism exists in
consumer projects. This change is not gated on self-host execution.

B. Catalog: n/a — no new skill.

C. Provider: agnostic — event/OTel contracts apply regardless of the selected LLM provider.

Registration: no skill registration or behavioral-rule changes. Implementation documentation
belongs in README and the existing OTel configuration/artifact references.
