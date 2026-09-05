# Track: Closeout tail corruption recovery

Track: technical

Source-Ref: jstoup111/ai-conductor#2173

Scope boundary: Fulfil all three issue outcomes: skip malformed complete JSONL lines with one diagnostic, serialize tail polling without offset drift or duplicate delivery, and contain background poll rejections. Preserve partial-line buffering, absent-file behavior, and actual ledger-truncation handling. No unrelated schema validation, change to offline rollup semantics, durable cursor, new ledger, or implementation in this spec PR. Operator authorized complete unambiguous S specifications in the 2026-09-05 batch request.

This is a bounded repair to an existing internal event consumer. Approach: per-line recovery and one shared in-flight poll operation, using the existing event bus for diagnostics. A self-scheduling timer was considered (S, similar effort) but would change the established one-second scheduling cadence; rebuilding ingestion around a stream/queue would add lifecycle machinery (M) without improving this outcome. The selected approach retains the public start/poll/stop contract and existing reader.

Scope check: A — harness-repo-only authoring, concerning the engine's existing telemetry spine; no shared behavioral rule changes. B — n/a, no skill. C — provider agnostic, no provider-specific surface. Registration: diagnostic member in the existing event union and sink table, using existing rendering paths; no skill registration.

Event spine: Channel? no new channel; the diagnostic is an occurrence carried by the existing bus. Verdict: extend the union, persist through EventPersister into events.jsonl, and render through existing consumers. Exception: none for the diagnostic; the pre-existing pipeline-owned sibling ledger remains governed by its approved separate-process/single-writer architecture.

Verified: closeout-tail.ts parses complete lines with an all-or-nothing map(JSON.parse), advances its byte cursor afterward, and starts unguarded interval poll promises. ConductorEventEmitter.emit already contains subscriber failures. The approved pipeline-owned-closeout-timestamps decision sanctions the sibling-ledger tail. No unresolved load-bearing assumption is required for this bounded repair.
