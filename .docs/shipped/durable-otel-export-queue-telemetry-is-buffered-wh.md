---
slug: durable-otel-export-queue-telemetry-is-buffered-wh
spec_hash: d58fedfe9224287900ea18567cb942c80ccbe1275864613dab0ca8c33888ae83
pr: https://github.com/jstoup111/ai-conductor/pull/2868
shipped: 2026-10-03
engine_version: 20261003T154506Z-bedb65cf8e47
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: S4.4
    summary: "src/conductor/src/engine/conductor.ts:7263 — a daemon-mode Conductor registers no process SIGHUP listener; its close-executions and persist-completions work is a sighup-persistence.ts hook that the unconditionally installed daemon handler (daemon-cli.ts:1258) awaits first at daemon-cli.ts:528, inside the 5 s stop bound, before flushing OTel, releasing the lease and re-raising SIGHUP"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/otel/wire.ts:40 — a module-lifetime Set de-duplicates every resolved OTel warning, attribute warnings included, emitting each as a separate renderer_error; wire.ts:173 sets resolvedWarningsHandled so the visualizer's per-dispatch joined attribute warning (otel-visualizer.ts:205) is skipped"
    accepted: true
    decision: accept
    rationale: "Accepted by operator 2026-09-30: small feature-serving visible change."
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/src/engine/config.ts:1487 — unknown-key normalization now walks the whole otel block, so any unrecognized otel.* key (not only otel.spool.*) produces a config warning"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.3
    summary: "src/conductor/src/engine/otel/wire.ts:181 — a throw from visualizer or metrics-listener construction/start is caught, reported as an otel renderer_error, releases the interactive spool lifecycle, and the wiring returns null"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.4
    summary: "src/conductor/src/daemon-cli.ts:1438 — per-dispatch stop moves deregistration, listener detach and persistence stop into a finally block after visualizer stop and OTel flush"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.5
    summary: "src/conductor/src/engine/park-marker.ts:40 — the strict main-root resolver, shared with the park CLI, now asks git for an absolute common dir"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-D3-REGISTRY-BYPASS
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 3"
    outcome: remediated
    summary: "99% verified: the default spooled branch at wire.ts:136 directly constructs and starts OtelVisualizer, bypassing D3’s registry selection and per-plugin start-isolation seam."
  - gate: architecture_review_as_built
    finding: AB-D15-GRPC-WARNING
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 15"
    outcome: remediated
    summary: "99% verified: resolveOtelConfig creates spoolWarnings at otel-config.ts:237, but no production path emits it; spool-wiring.ts:84 instead returns early when it exists."
  - gate: architecture_review_as_built
    finding: AB-D16-LEASE-HEARTBEAT
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "96% verified: refreshHeartbeat validates then rewrites lease.json in place at spool-lease.ts:202-211. A contender can observe a truncated record or publish between validation and rewrite, allowing takeover or clobbering a successor and violating the single-holder contract."
  - gate: architecture_review_as_built
    finding: AB-T1-INVALID-MAX-BYTES
    class: REMEDIABLE
    governing_clause: "Task 1"
    outcome: remediated
    summary: "99% verified: production validation removes a string max_bytes at config.ts:1493-1501, so \"big\" never reaches otel-config.ts:164-169 and OTel defaults enabled instead of being disabled with the required error."
  - gate: architecture_review_as_built
    finding: AB-T10-HEADER-REFRESH
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "90% verified: headers are read from the environment once by resolveOtelConfig; createSpoolRuntime supplies a per-send callback over that frozen map, so same-process credential changes between spooling and draining are not resolved at send time."
  - gate: architecture_review_as_built
    finding: AB-T15-DEAD-WIRING-HELPER
    class: REMEDIABLE
    governing_clause: "Task 15"
    outcome: remediated
    summary: "99% verified: exported buildSpoolExporters at spool-wiring.ts:111 has only test callers; production wire.ts calls buildExporters directly."
  - gate: architecture_review_as_built
    finding: AB-T10-DEAD-DRAIN-API
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "99% verified: public SpoolDrainer.drain() has no production caller; all production wiring uses drainUntilStopped(). Its claimed one-shot recovery caller does not exist."
  - gate: architecture_review_as_built
    finding: AB-D3-START-ISOLATION
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 3"
    outcome: remediated
    summary: "99% verified: wireOtelVisualizer retrieves the OTel factory but invokes the factory and visualizer.start() directly at wire.ts:148-163. Both production entry points therefore bypass D3's buildVisualizers factory/start isolation, so a throwing OTel start can escape instead of emitting renderer_error and dropping only that connector."
  - gate: architecture_review_as_built
    finding: AB-D16-ORPHAN-SUCCESSOR
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "99% verified: reclaim and heartbeat both reserve the fixed lease.json.next path with O_EXCL. If a holder dies after creating .next but before rename, later reclaimers receive EEXIST and return acquired:false without validating or recovering the orphan, permanently blocking stale-lease recovery."
  - gate: architecture_review_as_built
    finding: AB-D16-LEASE-LOSS-DRAINER
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "98% verified: heartbeat UUID mismatch clears SpoolLease ownership and stops heartbeats at spool-lease.ts:205-209, but no callback stops the already-running drainer started from wire.ts:212-217. A reclaimed live process can therefore keep sending beside its successor."
  - gate: architecture_review_as_built
    finding: AB-D17-DUPLICATE-BACKLOG
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "99% verified: drainPass starts a backlog reporter at spool-drainer.ts:89-95, while production runUntilStopped starts another at lines 191-193. During a retained delivery failure both remain active and emit duplicate per-signal backlog events each interval, violating Task 13's exactly-one contract."
  - gate: architecture_review_as_built
    finding: AB-T15-DEAD-RESET-API
    class: REMEDIABLE
    governing_clause: "Task 15"
    outcome: remediated
    summary: "99% verified: exported __resetSpoolRuntimeForTests() has no production caller, and the runtimes map it clears is never populated or read."
  - gate: architecture_review_as_built
    finding: AB-D16-SIGHUP-TRACE-FLUSH
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "99% verified: daemon SIGHUP stops only the shared daemon metric handle at daemon-cli.ts:522-525. Active dispatch trace providers flush only through visualizer.stop() at daemon-cli.ts:1414-1418, and OtelVisualizer registers only SIGINT/SIGTERM at otel-visualizer.ts:225-233. Pending spans can therefore be terminated unspooled."
  - gate: architecture_review_as_built
    finding: AB-D16-LEASE-RELEASE-RACE
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "99% source-verified: release verifies its UUID, but a stale contender can replace lease.json before release renames it. Release then moves the contender's lease aside; a third process can acquire the temporarily absent pathname, causing restoration to lose with EEXIST. The displaced contender remains marked owned with a running drainer until its next heartbeat, so two drainers can send concurrently, violating D16's single-holder invariant."
  - gate: architecture_review_as_built
    finding: AB-D16-ORPHAN-TMP-UNBOUNDED
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "97% verified: failed publication leaves fsynced .tmp files at spool-store.ts:89-101, while byte accounting and eviction include only .pb files at spool-store.ts:121-132. Repeated failures can exceed max_bytes, violating the sole local disk bound."
  - gate: architecture_review_as_built
    finding: AB-D17-METRIC-ITEM-COUNT
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 17"
    outcome: remediated
    summary: "99% verified: every metrics request is stored with items=1 at spooling-exporter.ts:98-101. Metric eviction, oversize, and whole-batch rejection events therefore report one item regardless of the request's actual data-point count."
  - gate: architecture_review_as_built
    finding: AB-D5-SILENT-SPOOL-RUNTIME-FAILURE
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 5"
    outcome: remediated
    summary: "98% verified: list/read/delete or lease-acquisition failures reject the drainer, and wire.ts:223/308 suppresses that rejection without a bounded renderer_error or restart. Transport-state failure can silently stop delivery for the process."
  - gate: architecture_review_as_built
    finding: AB-D16-HEARTBEAT-RELEASE-RACE
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "97% verified: overlapping interval callbacks overwrite the single heartbeatRefresh pointer at spool-lease.ts:257-266, while release awaits only that pointer at lines 113-117. An older refresh can subsequently rename its successor into lease.json, recreating a released lease or overwriting a successor."
  - gate: architecture_review_as_built
    finding: AB-D16-EVICTION-READ-RACE
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "99% verified: cap eviction can delete a batch after drainSignal() lists it but before read(). ENOENT escapes, permanently ends that signal loop, and production suppresses the rejection while retaining the lease, stranding later batches."
  - gate: architecture_review_as_built
    finding: AB-T5-METRIC-EQUALITY-PROOF
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "96% source-verified: the independent decoder now checks resource attributes, scope, counter values/attributes, and histogram buckets, but it does not compare timestamps, aggregation temporality, monotonicity, descriptor unit/description, or other exported fields. A serializer dropping those fields would still pass, so the planned equality proof remains incomplete."
  - gate: architecture_review_as_built
    finding: AB-T15-WORKTREE-SECRET-PROOFS
    class: REMEDIABLE
    governing_clause: "Task 15"
    outcome: remediated
    summary: "99% verified: the planned test suite does not remove the producing worktree and prove later delivery, nor scan every spool filename/content including lease.json for the resolved header value."
  - gate: architecture_review_as_built
    finding: AB-D16-LEASE-PUBLICATION-RACE
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "99% verified: SpoolLease.create opens the authoritative pathname with wx before writing its record (spool-lease.ts:189-195). A concurrent acquirer can read the empty or partial record as stale, take over through lease.json.next, while the first caller still unconditionally reports acquired=true at lines 149-151. Two drainers can therefore believe they hold the lease."
  - gate: architecture_review_as_built
    finding: AB-D3-INTERACTIVE-START-ISOLATION
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 3"
    outcome: remediated
    summary: "96% verified: after visualizer start failure, wire.ts:165-171 launches unawaited spool cleanup after checking metricsOpen only once. The production caller immediately constructs interactive metrics, which can reuse that lifecycle while cleanup stops its drainer, releases its lease, and deletes it from the lifecycle map. The failed connector can therefore disable the valid metrics spool instead of being isolated."
  - gate: architecture_review_as_built
    finding: AB-T5-CALLBACK-FILE-RACE
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "98% source-verified: SpoolStore publishes the final file and then awaits capped-spool cleanup/accounting at spool-store.ts:95-123. The concurrently running drainer can delete that file at spool-drainer.ts:101-139 before SpoolingSpanExporter or SpoolingMetricExporter invokes SUCCESS at spooling-exporter.ts:54-58 and 108-116. The production byte cap is always supplied, while the callback test uses an uncapped store with no drainer."
  - gate: architecture_review_as_built
    finding: AB-D16-RETRY-AFTER-COVERAGE
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 16"
    outcome: remediated
    summary: "99% source-verified: ADR D16 requires retained 408, 429, and 5xx responses to back off while honoring Retry-After. delivery-classifier.ts parses only numeric delay-seconds and only for 408/429; an HTTP-date is ignored, and a 503 ignores Retry-After entirely. RFC 9110 defines both HTTP-date and delay-seconds and explicitly permits Retry-After on 503 ([RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3))."
  - gate: architecture_review_as_built
    finding: AB-D5-LEASE-RELEASE-ISOLATION
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 5"
    outcome: remediated
    summary: "98% source-verified: SpoolLease.release can rethrow non-ENOENT filesystem errors, while wireDaemonOtel.stop and runDaemonMode await it without the bounded warning/isolation D5 requires. An unwritable spool can fail daemon shutdown."
---

## Cost
input: 7181101
output: 970511
cache_read: 141547431
cache_creation: 4473369
cost_usd: 133.137
dispatches: 135
retries: 11
halts: 21
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 7180157, output: 445221, cache_read: 111319808, cache_creation: 0, cost_usd: 62.2397, dispatches: 63, cost_unmetered: 0
  claude: input: 944, output: 525290, cache_read: 30227623, cache_creation: 4473369, cost_usd: 70.8973, dispatches: 72, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","abe474a7-619e-45eb-9865-beac44d22587","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 10
  security: failures: 0, judged: 10
  testQuality: failures: 1, judged: 10
skip_reasons:
