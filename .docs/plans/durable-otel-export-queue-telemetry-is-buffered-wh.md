# Implementation Plan: Durable OTel export spool

**Date:** 2026-09-29
**Stories:** .docs/stories/durable-otel-export-queue-telemetry-is-buffered-wh.md
**Conflict check:** Clean as of 2026-09-29

## Summary

Adds a write-first, disk-backed OTLP spool between the OTel SDK processors and the OTLP/HTTP
transport, with a lease-holding drainer that delivers after any outage. It delivers to Datadog
(Agent/DDOT) and Grafana LGTM alike, in 19 tasks.

## Technical Approach

Per adr-014-otel-observability-exporter D15-D17 (amended 2026-09-29) and the approved components
and sequence diagrams:

- **Config first.** `resolveOtelConfig` (`src/conductor/src/engine/otel/otel-config.ts`) gains
  `spool: { enabled, maxBytes }` on the enabled `otlp` variant. The default is enabled with a
  512 MiB cap. gRPC with the default falls back to unspooled export plus one warning; an explicit
  `enabled: true` on gRPC is an error. `src/conductor/src/engine/config.ts` learns the `spool` keys.
  Follow the `project_name`/`attributes` pattern in the same function: parse once, carry on the
  resolved object, warnings as strings.
- **Four new pure-ish units under `src/conductor/src/engine/otel/`, each unit-tested in isolation:**
  - `spool-store.ts` (fsync-then-rename batch files, oldest-first listing, byte cap);
  - `spooling-exporter.ts` (SDK-facing `SpanExporter` / `PushMetricExporter` that serializes with
    `ProtobufTraceSerializer` / `ProtobufMetricsSerializer` and acknowledges only after the store
    write);
  - `delivery-classifier.ts` (the D16 response table as a pure function);
  - `spool-lease.ts` (adr-010-style `O_EXCL` lease with pid, uuid and heartbeat; reclaim by
    `O_EXCL` succession).
- **The drainer.** `spool-drainer.ts` runs one sequential loop per signal and reads one file at a
  time; it never loads the whole spool, which respects the daemon heap cap. It POSTs with `fetch`
  under the bounded export timeout, applies the classifier, emits the two spine events, and keeps a
  per-signal health state so a failure-class transition renders one `renderer_error`.
- **Wiring.** `spool-wiring.ts` resolves `<mainRoot>/.daemon/otel-spool` through
  `resolveMainRepoRoot` (`src/conductor/src/engine/park-marker.ts`) and holds a process-level
  `SpoolRuntime` per spool dir: one store, one lease, at most one drainer. `buildExporters`
  (`transport.ts`) receives spooling exporters from it. `wireDaemonOtel`, the per-dispatch
  visualizer, and the interactive wiring (`wire.ts`, `otel-visualizer.ts`) all go through the
  runtime. Only the owning daemon or interactive handle stops the drainer; a per-dispatch provider
  shutdown never does.
- **Signals.** `daemon-cli.ts` adds one SIGHUP listener beside the existing SIGTERM handler. It
  stops the daemon OTel handle (flush into the spool, release the lease), bounded by the export
  timeout, then re-raises SIGHUP.
- **Events.** `otel_spool_drop` and `otel_spool_backlog` join the `ConductorEvent` union with
  `EVENT_SINKS` rows that persist but do not render or feed OTel.
- **Sequencing.** Config (Tasks 1-2), the store, classifier, events and lease (Tasks 3, 7, 8, 9)
  are independent roots. The exporters build on the store. The drainer builds on the store and the
  classifier. Wiring comes last, so every production boundary is integrated once, by Tasks 15-19.

**Local pattern context.**
- **Metric wrapper:** `warnOnceMetricExporter` in `wire.ts` shows how to wrap a
  `PushMetricExporter` while delegating the temporality selectors. Preserve that delegation
  exactly; the variation is that we wrap `export`.
- **Lease:** adr-010-pidfile-lock-daemon-liveness shows `O_EXCL` creation plus a uuid against pid
  reuse. Search the daemon pidfile lock module for `O_EXCL` / `uuid`.
- **Signal handling:** process-signal tests follow the repository's process-isolation rule. Mock
  the process adapter, and prove the production adapter reaches the mock before exercising the
  handler.

## Prerequisites

- None. `@opentelemetry/otlp-transformer` 0.221.0 is already a dependency and exports both protobuf serializers.

## Tasks

### Task 1: Resolve the otel.spool block with defaults and bounded max_bytes
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in the otel-config test file: an `otel:` block with `exporter: otlp` and no `spool` key resolves enabled with `spool: { enabled: true, maxBytes: 536870912 }`; `spool.enabled: false` resolves enabled with `spool.enabled` false; `exporter: file` resolves with no `spool` field; `max_bytes` of `0`, `-1`, and `"big"` each resolve `enabled: false` with an error naming `otel.spool.max_bytes` and the accepted range (a positive integer number of bytes); an unknown key `otel.spool.flush` yields one warning naming `flush` while `max_bytes: 1048576` in the same block is still applied.
2. Verify tests fail (RED).
3. Implement: add `spool?: { enabled?: boolean; max_bytes?: number }` to `OtelConfig` (`src/conductor/src/types/config.ts`); in `resolveOtelConfig` carry `spool: { enabled, maxBytes }` on the enabled `otlp` variant only, following the `project_name`/`attributes` pattern in the same function (parse once, carry on the resolved object, warnings as strings). Add `spool` to the `otel` known-key list and `otel.spool: ['enabled', 'max_bytes']` to the nested known-key table in `src/conductor/src/engine/config.ts` so a valid block produces no unknown-key warning and an unknown nested key produces the existing generic warning.
4. Verify tests pass (GREEN); pre-existing otel-config tests pass unmodified.
5. Commit: "Resolve otel.spool with a 512 MiB default cap".

**Done when:**
- The otel-config test asserts `resolveOtelConfig` returns `enabled: true` with `spool.enabled` true and `spool.maxBytes` 536870912 when the `otel:` block has `exporter: otlp` and no `spool` key.
- The otel-config test asserts `spool.enabled: false` resolves enabled with `spool.enabled` false, and `exporter: file` resolves with no `spool` field.
- The otel-config test asserts `max_bytes` values 0, -1 and "big" each resolve `enabled: false` with an error naming `otel.spool.max_bytes` and the positive-integer accepted range.
- The config-validation test asserts a valid `otel.spool` block yields no unknown-key warning, and an unknown `otel.spool.flush` key yields one warning naming `flush` while `max_bytes` from the same block is applied.

**Files:**
- src/conductor/src/types/config.ts — optional `spool` on `OtelConfig`
- src/conductor/src/engine/otel/otel-config.ts — resolve `spool` on the otlp variant
- src/conductor/src/engine/config.ts — known keys for `otel.spool`
- src/conductor/test/engine/otel/otel-config.test.ts — resolution tests
- src/conductor/test/engine/config.test.ts — known-key tests

**Dependencies:** none

### Task 2: gRPC falls back to unspooled export unless the spool is explicitly enabled
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests: `exporter: otlp`, `protocol: grpc`, no `otel.spool` key resolves `enabled: true`, `protocol: grpc`, `spool.enabled` false and exactly one warning string stating the spool is inactive for gRPC; `protocol: grpc` with explicit `otel.spool.enabled: true` resolves `enabled: false` with an error naming `protocol: http/protobuf` as the remedy; `protocol: grpc` with `otel.spool.enabled: false` resolves with no spool warning and `buildExporters` returns the gRPC trace and metric exporter classes exactly as before.
2. Verify tests fail (RED).
3. Implement in `resolveOtelConfig`: distinguish an absent `spool.enabled` from an explicit `true`; on gRPC with the default, force `spool.enabled` false and push the one warning; on explicit `true`, return the disabled error.
4. Verify tests pass (GREEN).
5. Commit: "Keep gRPC export unspooled by default; refuse an explicit spool on gRPC".

**Done when:**
- The otel-config test asserts `protocol: grpc` with no `otel.spool` key resolves `enabled: true` with protocol `grpc`, `spool.enabled` false, and exactly one warning stating the spool is inactive for gRPC.
- The otel-config test asserts `protocol: grpc` with explicit `otel.spool.enabled: true` resolves `enabled: false` with an error naming `protocol: http/protobuf` as the remedy.
- The transport test asserts `protocol: grpc` with `otel.spool.enabled: false` makes `buildExporters` return the unwrapped gRPC trace and metric exporters with no spool warning.
- The transport test asserts `protocol: grpc` with no `otel.spool` key makes `buildExporters` return the unwrapped gRPC trace and metric exporters, so batches export unspooled.

**Files:**
- src/conductor/src/engine/otel/otel-config.ts — gRPC default fallback and explicit-enable error
- src/conductor/test/engine/otel/otel-config.test.ts — gRPC tests
- src/conductor/test/engine/otel/transport.test.ts — gRPC unchanged exporter test

**Dependencies:** 1

### Task 3: SpoolStore writes one durable immutable file per batch
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/otel/spool-store.test.ts` using a temp directory: `write(signal, bytes)` creates `<dir>/<signal>/<name>.pb` whose bytes equal the input; the write goes to a temp name, is fsynced, and is renamed, so a test that stubs `rename` to throw leaves no file under a final `.pb` name and the temp file is ignored by `list`; two writes issued in the same millisecond from two `SpoolStore` instances over one directory produce two distinct files with both payloads intact; `list(signal)` returns files oldest-first by the monotonic name (timestamp, pid, random suffix); `delete` removes one file.
2. Verify tests fail (RED).
3. Implement `src/conductor/src/engine/otel/spool-store.ts`: `SpoolStore` with `write`, `list`, `read`, `delete`, `totalBytes`; name = zero-padded epoch millis + pid + 8 random hex; temp files use a `.tmp` suffix that `list` skips; directories created mode 0700. All I/O is async `fs/promises`.
4. Verify tests pass (GREEN).
5. Commit: "Add SpoolStore with fsync-then-rename batch files".

**Done when:**
- `spool-store.test.ts` asserts `SpoolStore.write` produces a `.pb` file under `<dir>/<signal>/` whose bytes equal the written body and that a throwing rename leaves no file under a final `.pb` name.
- `spool-store.test.ts` asserts `SpoolStore.write` fsyncs the temp file before renaming it, so after a simulated process death following the rename and before any send the complete batch file is present under its final `.pb` name and no partially written file is visible under that name.
- `spool-store.test.ts` asserts two same-millisecond writes from two `SpoolStore` instances produce two distinct files with both payloads intact and neither overwritten.
- `spool-store.test.ts` asserts `list` returns files oldest-first and skips `.tmp` files, and `delete` removes exactly the named file.

**Files:**
- src/conductor/src/engine/otel/spool-store.ts — new SpoolStore
- src/conductor/test/engine/otel/spool-store.test.ts — store tests

**Dependencies:** none

### Task 4: SpoolStore enforces max_bytes by oldest-first eviction
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: with `maxBytes` 1 MiB and 1 MiB already spooled, writing a 100 KiB batch evicts oldest files until the total is at or under 1 MiB and `write` returns an eviction result `{ evictedBatches, evictedItems }` with the counts; a single 2 MiB batch with `maxBytes` 1 MiB is not written, existing files are untouched, and `write` returns `{ rejectedOversize: true }`.
2. Verify tests fail (RED).
3. Implement cap enforcement in `SpoolStore.write`: item counts are carried in the file name suffix so eviction can report them without decoding.
4. Verify tests pass (GREEN).
5. Commit: "Bound the spool at max_bytes with oldest-first eviction".

**Done when:**
- `spool-store.test.ts` asserts that at a 1 MiB cap holding 1 MiB, a new write evicts oldest files until `totalBytes` is at or under 1 MiB and returns the evicted batch and item counts.
- `spool-store.test.ts` asserts a single batch larger than `maxBytes` is not written, returns `rejectedOversize` with its item count, and leaves every pre-existing file in place.

**Files:**
- src/conductor/src/engine/otel/spool-store.ts — cap and eviction
- src/conductor/test/engine/otel/spool-store.test.ts — eviction tests

**Dependencies:** 3

### Task 5: Spooling exporters acknowledge the SDK only after the batch is durable
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `spooling-exporter.test.ts`: `SpoolingSpanExporter.export(spans, cb)` has written the `traces` file before `cb` is called with SUCCESS (assert inside the callback that `store.list('traces')` has one entry); `SpoolingMetricExporter.export` writes a `metrics` file whose body, decoded with the OTLP `ExportMetricsServiceRequest` protobuf decoder, equals `ProtobufMetricsSerializer.serializeRequest` input resource metrics; `selectAggregationTemporality` and `selectAggregation` return exactly what the wrapped OTLP HTTP metric exporter built with `LOWMEMORY` returns for counter, histogram, gauge and up-down-counter instrument types; with configured `headers: { 'DD-API-KEY': { env: 'X' } }` and `X=secret-value`, no file in the spool directory contains `secret-value`.
2. Verify tests fail (RED).
3. Implement `src/conductor/src/engine/otel/spooling-exporter.ts`: serialize with `ProtobufTraceSerializer` / `ProtobufMetricsSerializer` from `@opentelemetry/otlp-transformer`, call `SpoolStore.write`, then call the SDK callback; the metric wrapper delegates the two select methods to the inner exporter (pattern: `warnOnceMetricExporter` in `wire.ts` delegates the same selectors; allowed variation: it wraps export, not warnings). Headers are never passed to the store.
4. Verify tests pass (GREEN).
5. Commit: "Add write-first spooling span and metric exporters".

**Done when:**
- `spooling-exporter.test.ts` asserts the `traces` spool file exists at the moment `SpoolingSpanExporter` invokes its SUCCESS callback, and likewise for the `metrics` file and `SpoolingMetricExporter`.
- `spooling-exporter.test.ts` decodes a spooled metrics file as an OTLP `/v1/metrics` protobuf request body and asserts it equals the exported resource metrics.
- `spooling-exporter.test.ts` asserts `selectAggregationTemporality` and `selectAggregation` equal the unspooled `LOWMEMORY` exporter's results for counter, histogram, gauge and up-down-counter.
- `spooling-exporter.test.ts` asserts no spool file contains the resolved value of an env-referenced header.

**Files:**
- src/conductor/src/engine/otel/spooling-exporter.ts — new spooling exporters
- src/conductor/test/engine/otel/spooling-exporter.test.ts — exporter tests

**Dependencies:** 3

### Task 6: A failed spool write degrades to a direct send with one bounded warning
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: with a store whose `write` rejects with `ENOSPC` (and separately `EACCES`), `SpoolingSpanExporter.export` forwards the same spans to the inner direct OTLP exporter, calls the SDK callback with the inner result, and invokes the warning sink exactly once across three failing exports; `export` never throws.
2. Verify tests fail (RED).
3. Implement the fallback path in `spooling-exporter.ts` with a once-per-exporter warning flag, routed to the `renderer_error` emitter the wiring passes in (same bounded-warning path Decision 5 uses in `wire.ts`).
4. Verify tests pass (GREEN).
5. Commit: "Fall back to direct export when the spool cannot be written".

**Done when:**
- `spooling-exporter.test.ts` asserts that when `SpoolStore.write` rejects with ENOSPC or EACCES the spans reach the inner direct exporter and the SDK callback receives the inner result.
- `spooling-exporter.test.ts` asserts three consecutive failing writes emit exactly one `renderer_error` warning and no call throws.

**Files:**
- src/conductor/src/engine/otel/spooling-exporter.ts — direct-send fallback
- src/conductor/test/engine/otel/spooling-exporter.test.ts — fallback tests

**Dependencies:** 5

### Task 7: Classify every OTLP response into keep, delete, or drop
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing table-driven tests in a new `delivery-classifier.test.ts` for `classifyResponse(status, body, headers)`: 200/202 with empty partial success → `delete`; 400 and 413 → `drop` with reason `rejected` and the status; 200 with an `ExportTraceServiceResponse` / `ExportMetricsServiceResponse` protobuf body whose `partial_success.rejected_spans` or `rejected_data_points` is 3 → `drop` with rejected item count 3; 401 and 403 → `keep` with failure class `auth`; 404 → `keep` with class `endpoint`; 408 and 429 → `keep` with class `throttled` and the parsed `Retry-After` seconds; 500/502/503/504 → `keep` class `server`; a thrown connection error → `keep` class `network`.
2. Verify tests fail (RED).
3. Implement `src/conductor/src/engine/otel/delivery-classifier.ts` as a pure function returning a discriminated union on `action` with three variants: `delete`; `drop` carrying `status` and `rejectedItems`; `keep` carrying `failureClass` and optional `retryAfterMs`. Decode partial success with the otlp-transformer response decoders.
4. Verify tests pass (GREEN).
5. Commit: "Classify OTLP delivery responses".

**Done when:**
- `delivery-classifier.test.ts` asserts `classifyResponse` returns `drop` with reason rejected and the status for 400 and for 413.
- `delivery-classifier.test.ts` asserts a 200 whose partial-success body rejects 3 items returns `drop` with rejected item count 3, and a 2xx with no rejection returns `delete`.
- `delivery-classifier.test.ts` asserts 401 and 403 return `keep` with class auth, 404 returns `keep` with class endpoint, 408 and 429 return `keep` with class throttled and the parsed Retry-After, 5xx returns `keep` with class server, and a connection error returns `keep` with class network.

**Files:**
- src/conductor/src/engine/otel/delivery-classifier.ts — new classifier
- src/conductor/test/engine/otel/delivery-classifier.test.ts — classifier tests

**Dependencies:** none

### Task 8: Register the spool events on the spine, persisted but not rendered or exported
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests: the `ConductorEvent` union accepts `otel_spool_drop` (`signal`, `reason` of rejected or evicted, `batches`, `items`, optional `status`) and `otel_spool_backlog` (`signal`, `files`, `bytes`, `oldestAgeMs`, `lastFailureClass`); `EVENT_SINKS` rows for both are `{ render: false, persist: true, audit: false, otel: false, otelTrace: false }`; an `EventPersister` fed both events writes them to its `events.jsonl`; the render path writes neither to a captured `daemon.log` stream; `MetricsListener` records no instrument for either; the per-feature cost rollup and timing rollup computed over an `events.jsonl` with and without interleaved spool events are deep-equal.
2. Verify tests fail (RED).
3. Implement the two union members in `src/conductor/src/types/events.ts` and the two rows in `src/conductor/src/engine/event-sinks.ts` (exhaustiveness is enforced by the existing registry type).
4. Verify tests pass (GREEN).
5. Commit: "Add otel_spool_drop and otel_spool_backlog events".

**Done when:**
- The event-sinks test asserts the `EVENT_SINKS` rows for `otel_spool_drop` and `otel_spool_backlog` have render false, persist true and otel false.
- A test asserts an `EventPersister` writes both spool events to `events.jsonl` while the renderer writes neither to `daemon.log` and `MetricsListener` records no instrument for either.
- A test asserts the cost rollup and the timing rollup over an `events.jsonl` with interleaved spool events deep-equal the rollups without them.

**Files:**
- src/conductor/src/types/events.ts — two union members
- src/conductor/src/engine/event-sinks.ts — two sink rows
- src/conductor/test/engine/event-sinks.test.ts — sink row tests
- src/conductor/test/engine/otel/spool-events.test.ts — persist, render, metrics and rollup tests

**Dependencies:** none

### Task 9: SpoolLease: O_EXCL acquisition with pid, uuid and heartbeat
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in a new `spool-lease.test.ts` over a temp directory: `acquire()` creates `lease.json` with `O_EXCL` holding pid, a random uuid and `heartbeatAt`; a second `SpoolLease` over the same directory whose holder pid is live and heartbeat fresh gets `acquired: false`; `release()` removes the lease only if its uuid matches, so the next `acquire()` succeeds immediately; a lease whose pid is dead (`process.kill(pid, 0)` throws ESRCH, injected) and heartbeat expired is reclaimed; a lease whose pid is alive but belongs to another process (injected liveness true) with an expired heartbeat is reclaimed because its uuid is not heartbeating; twenty concurrent `acquire()` calls against one stale lease yield exactly one `acquired: true`.
2. Verify tests fail (RED).
3. Implement `src/conductor/src/engine/otel/spool-lease.ts` following adr-010-pidfile-lock-daemon-liveness (search the daemon pidfile lock module for `O_EXCL` and `uuid`): reclaim by writing a successor file with `O_EXCL` (`lease.json.next`) then `rename` over the stale lease after re-reading it unchanged, never delete-then-create; heartbeat is refreshed by the holder every 10 s and expires after 60 s. Liveness and clock are injected.
4. Verify tests pass (GREEN).
5. Commit: "Add SpoolLease with O_EXCL succession".

**Done when:**
- `spool-lease.test.ts` asserts a live, fresh-heartbeat lease makes a second `SpoolLease.acquire()` return acquired false.
- `spool-lease.test.ts` asserts a dead-pid lease with an expired heartbeat is reclaimed, and a live-but-unrelated-pid lease with an expired heartbeat is reclaimed by uuid mismatch.
- `spool-lease.test.ts` asserts twenty concurrent `acquire()` calls against one stale lease yield exactly one holder, and reclaim creates its successor with the `wx` (O_EXCL) flag.
- `spool-lease.test.ts` asserts `release()` removes the lease so the next `acquire()` succeeds without waiting for heartbeat expiry.

**Files:**
- src/conductor/src/engine/otel/spool-lease.ts — new lease
- src/conductor/test/engine/otel/spool-lease.test.ts — lease tests

**Dependencies:** none

### Task 10: SpoolDrainer delivers oldest-first per signal and deletes on accept
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `spool-drainer.test.ts` against a local `node:http` test server: three `traces` files spooled while the server was closed are POSTed to `<endpoint>/v1/traces` in oldest-first order once it listens, each deleted after its 200; every request for both signals carries `Content-Type: application/x-protobuf` and the resolved `otel.headers`; a file whose data is days old is POSTed rather than skipped (no local age check); after the server returns 200 for a file but the test deletes nothing (simulated crash between accept and delete), a new drainer resends that file once and the second server receipt is counted.
2. Verify tests fail (RED).
3. Implement `src/conductor/src/engine/otel/spool-drainer.ts`: one sequential loop per signal reading one file at a time via `SpoolStore.read`, POSTing with `fetch` using `buildHttpExporterOptions`-equivalent URL and the drainer process's own resolved headers, applying `classifyResponse` (Task 7): `delete` and `drop` remove the file, `keep` leaves it.
4. Verify tests pass (GREEN).
5. Commit: "Add SpoolDrainer oldest-first delivery".

**Done when:**
- `spool-drainer.test.ts` asserts three spooled trace files are POSTed to `/v1/traces` oldest-first after the server starts and each file is deleted after its 2xx.
- `spool-drainer.test.ts` asserts every drained request for both signals carries `Content-Type: application/x-protobuf` and the headers resolved by the drainer at send time, so a header value changed between spooling and draining is the value sent.
- `spool-drainer.test.ts` asserts a batch with days-old timestamps is POSTed, not skipped, and its fate follows only the response.
- `spool-drainer.test.ts` asserts a file accepted but not deleted before a simulated crash is sent exactly once more by the next drainer, and the duplicate is tolerated: the resend's 2xx deletes the file and the drainer continues to the next file without error.

**Files:**
- src/conductor/src/engine/otel/spool-drainer.ts — new drainer
- src/conductor/test/engine/otel/spool-drainer.test.ts — delivery tests

**Dependencies:** 3, 7

### Task 11: Drainer backoff, Retry-After, per-signal independence and bounded stop
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests with an injected clock: a server answering 503, 503, 200 receives the same file three times with strictly increasing delays and the file is deleted after the 200; a 429 with `Retry-After: 30` blocks any traces POST for 30 s of injected time and keeps the file; a server that destroys the socket mid-request leaves the file in place, backs off, and a newer traces file is never sent before it; with traces stuck on 503, spooled metrics files are delivered and deleted; a server that accepts the connection and never responds lets `drainer.stop()` resolve within the export timeout (5 s default, injected lower) with the in-flight file still present.
2. Verify tests fail (RED).
3. Implement exponential backoff (1 s initial, x2, 60 s max, jitter) per signal loop, `Retry-After` precedence, `AbortController` on each POST bounded by the export timeout, and `stop()` aborting in-flight POSTs.
4. Verify tests pass (GREEN).
5. Commit: "Back off, honour Retry-After, and bound drainer stop".

**Done when:**
- `spool-drainer.test.ts` asserts a 503, 503, 200 sequence sends one file three times with strictly increasing delays and deletes it after the 200.
- `spool-drainer.test.ts` asserts a 429 with Retry-After 30 prevents any traces POST for 30 seconds of injected time and keeps the file.
- `spool-drainer.test.ts` asserts a mid-request connection drop keeps the file, retries it with backoff, and no newer traces file is POSTed before it, while metrics files are delivered and deleted during a traces 503 backlog.
- `spool-drainer.test.ts` asserts `stop()` resolves within the injected export timeout against a never-responding server and the in-flight file remains in the spool.

**Files:**
- src/conductor/src/engine/otel/spool-drainer.ts — backoff and bounded stop
- src/conductor/test/engine/otel/spool-drainer.test.ts — negative delivery tests

**Dependencies:** 10

### Task 12: Drainer emits drop events and keeps misconfiguration batches
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests with a recording emitter: a 400 and a 413 each delete the file and emit one `otel_spool_drop` with reason rejected, signal, item count and the status; a 200 partial-success rejecting 3 items deletes the whole file, the server receives it exactly once, and the drop event carries items 3; 401, 403 and 404 keep the file, emit no drop event, and the next `otel_spool_backlog` reports `lastFailureClass` auth (401/403) or endpoint (404); a `SpoolStore` eviction or oversize result from a write is emitted as `otel_spool_drop` with reason evicted and the counts.
2. Verify tests fail (RED).
3. Implement event emission in `spool-drainer.ts` on the bus passed by the owner, and have the spooling exporters forward store eviction results to the same emitter.
4. Verify tests pass (GREEN).
5. Commit: "Emit spool drop events; keep batches on auth and endpoint errors".

**Done when:**
- `spool-drainer.test.ts` asserts a 400 and a 413 each delete the file and emit one `otel_spool_drop` with reason rejected, the signal, the item count and the status.
- `spool-drainer.test.ts` asserts a partial-success response rejecting 3 items deletes the whole file, the server receives it exactly once, and the drop event carries 3 items.
- `spool-drainer.test.ts` asserts 401, 403 and 404 keep the file, emit no `otel_spool_drop`, and the next `otel_spool_backlog` reports last failure class auth for 401 and 403 and endpoint for 404.
- A test asserts a spool write that evicts files or rejects an oversize batch emits `otel_spool_drop` with reason evicted and the evicted batch and item counts.
- `spool-drainer.test.ts` asserts a batch with days-old timestamps answered 400 is deleted and emits `otel_spool_drop` with reason rejected.

**Files:**
- src/conductor/src/engine/otel/spool-drainer.ts — drop and backlog emission
- src/conductor/src/engine/otel/spooling-exporter.ts — forward eviction results
- src/conductor/test/engine/otel/spool-drainer.test.ts — event tests

**Dependencies:** 4, 8, 10

### Task 13: Periodic backlog events only while the spool is non-empty
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests with an injected clock: with two traces files (known bytes) and a 503 server, each backlog interval (30 s) emits one `otel_spool_backlog` per non-empty signal with file count 2, total bytes, oldest batch age and last failure class server; with an empty spool no `otel_spool_backlog` is emitted across three intervals.
2. Verify tests fail (RED).
3. Implement the backlog timer in `spool-drainer.ts`, reading sizes from `SpoolStore.list` metadata without reading file bodies.
4. Verify tests pass (GREEN).
5. Commit: "Report spool backlog per signal".

**Done when:**
- `spool-drainer.test.ts` asserts each backlog interval emits one `otel_spool_backlog` per non-empty signal carrying file count, total bytes, oldest batch age and last failure class.
- `spool-drainer.test.ts` asserts an empty spool emits no `otel_spool_backlog` across three intervals.

**Files:**
- src/conductor/src/engine/otel/spool-drainer.ts — backlog timer
- src/conductor/test/engine/otel/spool-drainer.test.ts — backlog tests

**Dependencies:** 12

### Task 14: Outages surface as one renderer_error per failure-class transition
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests with a recording emitter: a healthy drainer whose server starts refusing connections emits exactly one `renderer_error` naming the signal and failure class network, and none more across five further failed attempts; when the server recovers and a file is accepted, one recovery notice is emitted, and a subsequent refusal emits a new `renderer_error`; a drainer already warned for network whose server now answers 401 emits one new `renderer_error` naming class auth.
2. Verify tests fail (RED).
3. Implement a per-signal health state (`healthy` or a failure class) in `spool-drainer.ts`; emit `renderer_error` (rendererName `otel`) only on a change into a failure class and an info notice on return to healthy.
4. Verify tests pass (GREEN).
5. Commit: "Warn once per spool delivery failure transition".

**Done when:**
- `spool-drainer.test.ts` asserts a healthy-to-network transition emits exactly one `renderer_error` naming the signal and class network, and five further failed attempts emit none.
- `spool-drainer.test.ts` asserts recovery after an accepted file emits one recovery notice and a later refusal emits a new `renderer_error`.
- `spool-drainer.test.ts` asserts a network-to-auth change on a 401 emits one new `renderer_error` naming class auth.

**Files:**
- src/conductor/src/engine/otel/spool-drainer.ts — health transitions
- src/conductor/test/engine/otel/spool-drainer.test.ts — transition tests

**Dependencies:** 12

### Task 15: Resolve the spool at the main checkout, or disable it with one warning
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in a new `spool-wiring.test.ts` over a real temp git repo with a linked worktree: `resolveSpoolDir(startDir)` from the worktree returns `<mainRoot>/.daemon/otel-spool`; a batch spooled through wiring started from the worktree lands there and not under the worktree; after `git worktree remove` of that worktree the file is still present and a drainer delivers it; with an env-referenced header configured, no content or name under the spool directory (including `lease.json`) contains its value; from a non-git temp directory the wiring returns spool disabled, exports go direct, and exactly one `renderer_error` warning is emitted.
2. Verify tests fail (RED).
3. Implement `resolveSpoolDir` in `src/conductor/src/engine/otel/spool-wiring.ts` using `resolveMainRepoRoot` from `src/conductor/src/engine/park-marker.ts` (trait to preserve: resolve the main root via `git rev-parse --git-common-dir`, never the cwd). Add a process-level `SpoolRuntime` keyed by spool dir that owns one `SpoolStore`, one `SpoolLease` and at most one `SpoolDrainer`, and hands spooling exporters to `buildExporters`.
4. Verify tests pass (GREEN).
5. Commit: "Resolve the OTel spool at the main checkout".

**Done when:**
- `spool-wiring.test.ts` asserts a batch spooled from a linked worktree lands under the main checkout's `.daemon/otel-spool/` and not under the worktree.
- `spool-wiring.test.ts` asserts a spooled batch survives `git worktree remove` of the producing worktree and is delivered by the drainer.
- `spool-wiring.test.ts` asserts that outside a git checkout the spool is disabled, batches export directly, and exactly one `renderer_error` warning is emitted.
- `spool-wiring.test.ts` asserts no file content or file name anywhere under the spool directory, including `lease.json`, contains the resolved value of an env-referenced header.

**Files:**
- src/conductor/src/engine/otel/spool-wiring.ts — main-root resolution and SpoolRuntime
- src/conductor/src/engine/otel/transport.ts — accept spooling exporters from SpoolRuntime
- src/conductor/test/engine/otel/spool-wiring.test.ts — wiring tests

**Dependencies:** 5, 9, 10

### Task 16: Daemon OTel wiring spools every signal and owns the drainer
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests over `wireDaemonOtel` and the per-dispatch `wireOtelVisualizer` with a temp main root and a local HTTP test server that starts closed: spans and metrics recorded during a dispatch are spooled; the daemon handle's `stop()` flushes the SDK into the spool while the server is closed (files present after stop); a second `wireDaemonOtel` over the same main root acquires the lease and, once the server listens, delivers the first process's files; a per-dispatch visualizer stop (`tracerProvider.shutdown()`) leaves the drainer running and `lease.json` held by the daemon uuid; drop and backlog events from the daemon drainer are persisted to `<mainRoot>/.daemon/events.jsonl` through the daemon root bus persister.
2. Verify tests fail (RED).
3. Implement: `wireDaemonOtel` and the visualizer both obtain exporters from the `SpoolRuntime` (Task 15) when `spool.enabled`; `wireDaemonOtel` starts the drainer on the root bus and its `stop()` flushes providers then stops the drainer and releases the lease; per-dispatch shutdown calls only the exporter shutdown, which never touches the runtime.
4. Verify tests pass (GREEN). Pre-existing wire and visualizer tests pass unmodified, except those asserting that an unreachable endpoint yields a `renderer_error` from the SDK export path; with the spool on, that warning now comes from the drainer's failure-class transition (Task 14), so re-point those assertions to the drainer warning on the owning bus, or set `otel.spool.enabled: false` where the test is about the unspooled path.
5. Commit: "Wire the spool into daemon and dispatch OTel".

**Done when:**
- The wire test asserts `wireDaemonOtel` stop with the endpoint closed leaves the flushed span and metric batches as spool files.
- The wire test asserts a second `wireDaemonOtel` over the same main root acquires the lease and delivers the first instance's spooled files once the endpoint listens.
- The wire test asserts a per-dispatch visualizer stop leaves the drainer running and `lease.json` held by the daemon's uuid.
- The wire test asserts `otel_spool_drop` and `otel_spool_backlog` from the daemon drainer appear in `<mainRoot>/.daemon/events.jsonl`.
- The wire test asserts a `wireDaemonOtel` started over a main root whose `lease.json` names a dead pid with an expired heartbeat reclaims the lease and delivers the spooled files.

**Files:**
- src/conductor/src/engine/otel/wire.ts — daemon and interactive wiring use SpoolRuntime
- src/conductor/src/engine/otel/otel-visualizer.ts — per-dispatch exporters from SpoolRuntime
- src/conductor/test/engine/otel/spool-daemon-wiring.test.ts — daemon integration tests

**Dependencies:** 12, 15

### Task 17: Interactive runs drain when the lease is free
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests over `wireInteractiveOtelMetrics` and `wireOtelVisualizer` with no other lease holder: starting the interactive wiring acquires the lease and delivers pre-existing spool files during the run; stopping it with the endpoint closed flushes pending batches into the spool and releases the lease; with a live, fresh lease held by another `SpoolLease` instance the interactive run writes spool files and sends nothing.
2. Verify tests fail (RED).
3. Implement lease-if-free drainer start in the interactive wiring path, stopped on its existing stop.
4. Verify tests pass (GREEN).
5. Commit: "Let interactive runs drain the spool when no daemon does".

**Done when:**
- The interactive wiring test asserts a run that finds the lease free acquires it and delivers pre-existing spool files during the run.
- The interactive wiring test asserts stop with the endpoint closed leaves the flushed batches in the spool and releases the lease.
- The interactive wiring test asserts that while another live holder has a fresh lease the run writes spool files and its drainer POSTs nothing.

**Files:**
- src/conductor/src/engine/otel/wire.ts — interactive lease-if-free drainer
- src/conductor/test/engine/otel/spool-interactive-wiring.test.ts — interactive tests

**Dependencies:** 16

### Task 18: The daemon flushes and releases the lease on SIGHUP
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests over the daemon signal wiring with an injected process adapter (mock `process.on` and `process.kill`; assert the production adapter reaches the mock before exercising the handler, per the repo test-isolation rule): SIGHUP invokes the daemon OTel handle `stop()`, which flushes providers into the spool and releases the lease, then removes its own listener and re-raises SIGHUP so default termination proceeds; a `stop()` that hangs is abandoned after the bounded export timeout and SIGHUP is still re-raised.
2. Verify tests fail (RED).
3. Implement one process-level SIGHUP listener in `src/conductor/src/daemon-cli.ts` beside the SIGTERM handler, calling the daemon OTel handle only (no scheduler drain).
4. Verify tests pass (GREEN).
5. Commit: "Flush OTel spool and release lease on SIGHUP".

**Done when:**
- The daemon signal test asserts SIGHUP calls the daemon OTel stop so pending batches land in the spool and `lease.json` is removed before the signal is re-raised.
- The daemon signal test asserts a hanging OTel stop is abandoned after the export timeout and SIGHUP is still re-raised through the mocked process adapter.

**Files:**
- src/conductor/src/daemon-cli.ts — SIGHUP listener
- src/conductor/test/daemon-sighup-otel.test.ts — signal tests

**Dependencies:** 16

### Task 19: Spool disabled: direct export, no directory, leftover spool warned once
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests over the wiring: with `otel.spool.enabled: false` spans export through the direct OTLP exporter (test server receives them) and no `.daemon/otel-spool` directory is created; with `exporter: file` the file output bytes match the pre-change file exporter for the same spans and no spool directory is created; with `otel.spool.enabled: false` and three pre-existing spool files, starting OTel leaves all three byte-identical and emits exactly one `renderer_error` naming the spool path and total size.
2. Verify tests fail (RED).
3. Implement the disabled branch in `spool-wiring.ts`: stat the resolved spool dir without creating it; warn once if non-empty.
4. Verify tests pass (GREEN).
5. Commit: "Leave a disabled spool untouched and warn once".

**Done when:**
- `spool-wiring.test.ts` asserts `otel.spool.enabled: false` exports spans directly to the endpoint and creates no `.daemon/otel-spool` directory.
- `spool-wiring.test.ts` asserts `exporter: file` output is byte-identical to the unspooled file exporter and creates no spool directory.
- `spool-wiring.test.ts` asserts a disabled process leaves three pre-existing spool files byte-identical and emits exactly one warning naming the spool path and size.

**Files:**
- src/conductor/src/engine/otel/spool-wiring.ts — disabled branch
- src/conductor/test/engine/otel/spool-wiring.test.ts — disabled tests

**Dependencies:** 15
## Task Dependency Graph

```
Task 1 ─▶ Task 2
Task 3 ─┬─▶ Task 4 ─────────────┐
        ├─▶ Task 5 ─▶ Task 6    │
        │     │                 │
Task 7 ─┴─▶ Task 10 ─┬─▶ Task 11│
              │      └─▶ Task 12 ◀─ Task 8
              │            ├─▶ Task 13
              │            └─▶ Task 14
Task 9 ───────┴─▶ Task 15 (also needs 5, 10) ─┬─▶ Task 19
                             Task 12 + 15 ──▶ Task 16 ─┬─▶ Task 17
                                                       └─▶ Task 18
```

## Integration Points

- After Task 12: store, exporters, classifier and drainer are unit-proven against a local HTTP test double.
- After Task 15: the first production boundary. Wiring resolves the main-root spool and hands spooling exporters to `buildExporters`.
- After Task 16: daemon and per-dispatch OTel spool every signal, and the daemon owns the drainer and lease.
- After Tasks 17-18: interactive runs drain when the lease is free, and SIGHUP flushes before a respawn.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | The spool sits below the SDK exporters; the exporter stays a listener on the existing event bus and no emission site changes |
| adr-014-otel-observability-exporter#D2 | no-change | none | Packaging as the `visualizer:otel` plugin is untouched; the spool is selected by the existing `otel:` config gate |
| adr-014-otel-observability-exporter#D3 | existing | none | The shared visualizer wiring seam in `wire.ts` and `otel-visualizer.ts` already serves both entry points; the spool is threaded through it. The 2026-08-26 #1516 amendment (registry selection, `start(emitter, context)` seam, per-plugin error isolation, loader validation) is already shipped and unchanged by this feature |
| adr-014-otel-observability-exporter#D4 | no-change | none | The spool write runs inside the SDK exporter that the batch processor and periodic reader already call asynchronously; no bus handler gains I/O, awaiting, or run-scaled iteration |
| adr-014-otel-observability-exporter#D5 | task | task-6, task-14 | three consecutive failing writes emit exactly one `renderer_error` warning and no call throws |
| adr-014-otel-observability-exporter#D6 | task | task-1, task-2 | returns `enabled: true` with `spool.enabled` true and `spool.maxBytes` 536870912 |
| adr-014-otel-observability-exporter#D7 | no-change | none | The daemon-owned single MeterProvider and event-fed MetricsListener are unchanged; only the exporter handed to the reader is wrapped |
| adr-014-otel-observability-exporter#D8 | no-change | none | Metric identity and Resource attributes are unchanged; spooled bodies carry the same Resource the SDK serialized |
| adr-014-otel-observability-exporter#D9 | task | task-16 | appear in `<mainRoot>/.daemon/events.jsonl` |
| adr-014-otel-observability-exporter#D10 | no-change | none | No dispatch dimension or data-point label is added or moved |
| adr-014-otel-observability-exporter#D11 | no-change | none | Dispatch dimensions still travel on existing dispatch events; the two new spool events carry spool health, not dispatch dimensions |
| adr-014-otel-observability-exporter#D12 | no-change | none | `otel.attributes` validation and semantics are unchanged |
| adr-014-otel-observability-exporter#D13 | no-change | none | Static attributes still ride every Resource and data point; the spool stores the serialized request unchanged |
| adr-014-otel-observability-exporter#D14 | no-change | none | The complexity tier label contract is unchanged, including the 2026-09-15 #2528 amendment's optional `tier` on `feature_complete` and `loop_halt`, its outcome-metric ownership and deduplication, its regression coverage, and its re-tier documentation, all already shipped and untouched by this feature |
| adr-014-otel-observability-exporter#D15 | task | task-3, task-5, task-15 | the `traces` spool file exists at the moment `SpoolingSpanExporter` invokes its SUCCESS callback |
| adr-014-otel-observability-exporter#D16 | task | task-9, task-10, task-11, task-12, task-18 | twenty concurrent `acquire()` calls against one stale lease yield exactly one holder |
| adr-014-otel-observability-exporter#D17 | task | task-8, task-13, task-14, task-19 | a healthy-to-network transition emits exactly one `renderer_error` naming the signal and class network |
| adr-014-otel-observability-exporter#D18 | no-change | none | Run provenance on `feature_complete` and the root span belongs to the #2000 provenance feature; the spool stores serialized requests unchanged and emits no provenance |
| adr-014-otel-observability-exporter#D19 | no-change | none | Provenance placement on the trace resource and root span is owned by the #2000 feature; the spool does not alter resource or span attributes |
| adr-014-otel-observability-exporter#D20 | no-change | none | The `otel.provenance` toggles are owned by the #2000 feature; this feature adds only the `otel.spool` block and does not read or change provenance config |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `exporter: otlp` with the spool enabled and a reachable endpoint, when the span processor exports a batch, then a spool file for the `traces` signal exists under `<mainRoot>/.daemon/otel-spool/` before the SDK result callback reports success | 5, 15 | "the `traces` spool file exists at the moment `SpoolingSpanExporter` invokes its SUCCESS callback" | diff-local |
| Story 1 happy: Given `exporter: otlp` with the spool enabled, when the metric reader exports a batch, then the spooled file body is the OTLP/HTTP protobuf request body for `/v1/metrics` and decodes to the same resource metrics that were exported | 5 | "asserts it equals the exported resource metrics" | diff-local |
| Story 1 happy: Given the spool is enabled, when the metric exporter is asked for its aggregation temporality, then it returns the same `LOWMEMORY` selections the unspooled exporter returned (delta for counters and histograms, cumulative for gauges) | 5 | "equal the unspooled `LOWMEMORY` exporter's results for counter, histogram, gauge and up-down-counter" | diff-local |
| Story 1 negative: Given the spool directory's filesystem is full or unwritable, when a batch is exported, then the batch is sent directly to the endpoint, one bounded warning reaches the run's `renderer_error` path, and the run continues without failing | 6 | "three consecutive failing writes emit exactly one `renderer_error` warning and no call throws" | diff-local |
| Story 1 negative: Given a process dies after a spool file is fsynced and renamed but before any send, when the spool directory is inspected, then the complete batch file is present and no partially written file is visible under the final name | 3 | "a throwing rename leaves no file under a final `.pb` name" | diff-local |
| Story 1 negative: Given two processes export batches at the same millisecond into the same spool, when both writes complete, then two distinct files exist and neither overwrites the other | 3 | "two same-millisecond writes from two `SpoolStore` instances produce two distinct files" | diff-local |
| Story 1 negative: Given the configured OTLP headers include an API key resolved from an environment variable, when a batch is spooled, then no spool file or spool metadata contains that header's value | 5, 15 | "no spool file contains the resolved value of an env-referenced header" | diff-local |
| Story 2 happy: Given three trace batches spooled while the endpoint refused connections, when the endpoint starts accepting requests, then all three are POSTed to `<endpoint>/v1/traces` oldest-first and each file is deleted after its 2xx response | 10 | "POSTed to `/v1/traces` oldest-first after the server starts and each file is deleted after its 2xx" | diff-local |
| Story 2 happy: Given spooled batches for both signals, when they are drained, then each request carries `Content-Type: application/x-protobuf` and the configured `otel.headers` resolved at send time | 10 | "the headers resolved by the drainer at send time, so a header value changed between spooling and draining is the value sent" | diff-local |
| Story 2 happy: Given an endpoint that answers 503 twice and then 200, when the drainer sends one batch, then the batch is sent three times with increasing delay between attempts and is deleted after the 200 | 11 | "a 503, 503, 200 sequence sends one file three times with strictly increasing delays" | diff-local |
| Story 2 happy: Given a healthy drainer, when the endpoint starts refusing connections, then exactly one `renderer_error` names the signal and the failure class network, and no further `renderer_error` is emitted while that failure class persists | 14 | "a healthy-to-network transition emits exactly one `renderer_error` naming the signal and class network" | diff-local |
| Story 2 negative: Given an endpoint that answers 429 with `Retry-After: 30`, when the drainer sends a batch, then it does not resend that signal's batches for at least 30 seconds and the file is kept | 11 | "a 429 with Retry-After 30 prevents any traces POST for 30 seconds of injected time and keeps the file" | diff-local |
| Story 2 negative: Given the network drops mid-request, when the drainer's send fails with a connection error, then the file is kept and retried with backoff, and later batches of the same signal are not sent ahead of it | 11 | "a mid-request connection drop keeps the file, retries it with backoff, and no newer traces file is POSTed before it" | diff-local |
| Story 2 negative: Given a traces batch that keeps failing transiently, when metric batches are spooled, then metric delivery proceeds independently of the traces backlog | 11 | "metrics files are delivered and deleted during a traces 503 backlog" | diff-local |
| Story 2 negative: Given the endpoint accepted a batch but the process died before deleting its file, when draining resumes, then that batch is sent again at most once more and the duplicate is tolerated (at-least-once delivery) | 10 | "is sent exactly once more by the next drainer" | diff-local |
| Story 2 negative: Given a drainer in the network failure class, when the endpoint recovers and a batch is accepted, then one recovery notice is emitted, and a later failure emits a new `renderer_error` | 14 | "recovery after an accepted file emits one recovery notice and a later refusal emits a new `renderer_error`" | diff-local |
| Story 2 negative: Given an endpoint that accepts the connection but never responds, when the owning process stops, then stop completes within the bounded export timeout and the in-flight file is kept | 11 | "`stop()` resolves within the injected export timeout against a never-responding server and the in-flight file remains in the spool" | diff-local |
| Story 3 happy: Given the endpoint answers 400 for a batch, when the drainer processes the response, then the file is deleted and one `otel_spool_drop` event is emitted with `reason` rejected, the signal, the item count, and status 400 | 12 | "a 400 and a 413 each delete the file and emit one `otel_spool_drop` with reason rejected, the signal, the item count and the status" | diff-local |
| Story 3 happy: Given the endpoint answers 413 for a batch, when the drainer processes the response, then the file is deleted and one `otel_spool_drop` event with `reason` rejected and status 413 is emitted | 12 | "a 400 and a 413 each delete the file and emit one `otel_spool_drop` with reason rejected, the signal, the item count and the status" | diff-local |
| Story 3 happy: Given the endpoint answers 200 with an OTLP partial-success body rejecting some items, when the drainer processes the response, then the whole file is deleted, it is never resent in part, and an `otel_spool_drop` event carries the rejected item count | 12 | "deletes the whole file, the server receives it exactly once, and the drop event carries 3 items" | diff-local |
| Story 3 negative: Given the endpoint answers 401 or 403, when the drainer processes the response, then the file is kept, no drop event is emitted, and the next `otel_spool_backlog` event reports the last failure class as auth | 12 | "401, 403 and 404 keep the file, emit no `otel_spool_drop`, and the next `otel_spool_backlog` reports last failure class auth for 401 and 403" | diff-local |
| Story 3 negative: Given the endpoint answers 404 because the configured endpoint path is wrong, when the drainer processes the response, then the file is kept and the backlog event reports the last failure class as endpoint | 12 | "and endpoint for 404" | diff-local |
| Story 3 negative: Given a drainer already warned for the network failure class, when the endpoint becomes reachable but answers 401, then one new `renderer_error` names the auth failure class | 14 | "a network-to-auth change on a 401 emits one new `renderer_error` naming class auth" | diff-local |
| Story 3 negative: Given a batch whose data points are older than the backend's acceptance window, when the backend rejects it with a 4xx, then the drainer deletes and counts it as rejected without any client-side age check having skipped the send | 10, 12 | "a batch with days-old timestamps answered 400 is deleted and emits `otel_spool_drop` with reason rejected" | diff-local |
| Story 3 negative: Given a batch older than any backend window, when the drainer reaches it, then it is still sent (no local age cap) and its fate is decided only by the response | 10 | "a batch with days-old timestamps is POSTed, not skipped, and its fate follows only the response" | diff-local |
| Story 4 happy: Given batches spooled by a daemon process that then exits, when a new daemon process starts with the same OTel config, then it acquires the spool lease and delivers the previous process's batches | 16 | "acquires the lease and delivers the first instance's spooled files once the endpoint listens" | diff-local |
| Story 4 happy: Given a daemon is stopped gracefully, when its OTel providers shut down, then the SDK's final in-memory batches are flushed into the spool before the process exits, even if the endpoint is unreachable | 16 | "`wireDaemonOtel` stop with the endpoint closed leaves the flushed span and metric batches as spool files" | diff-local |
| Story 4 happy: Given no daemon is running, when an interactive run with OTel enabled starts and finds the lease free, then it takes the lease and drains the spool for the duration of the run | 17 | "a run that finds the lease free acquires it and delivers pre-existing spool files during the run" | diff-local |
| Story 4 happy: Given a running daemon holding the lease, when it receives SIGHUP as on a tmux respawn, then its providers flush pending batches into the spool and the lease is released before exit | 18 | "SIGHUP calls the daemon OTel stop so pending batches land in the spool and `lease.json` is removed before the signal is re-raised" | diff-local |
| Story 4 negative: Given a lease held by a process whose pid is dead and whose heartbeat has expired, when another OTel process starts, then it reclaims the lease and drains | 9, 16 | "a dead-pid lease with an expired heartbeat is reclaimed" | diff-local |
| Story 4 negative: Given a lease held by a live process with a fresh heartbeat, when a second OTel process starts, then the second process only writes spool files and never sends them | 9, 17 | "a live, fresh-heartbeat lease makes a second `SpoolLease.acquire()` return acquired false" | diff-local |
| Story 4 negative: Given two processes race to reclaim a stale lease, when both attempt acquisition, then exactly one holds the lease afterward | 9 | "twenty concurrent `acquire()` calls against one stale lease yield exactly one holder" | diff-local |
| Story 4 negative: Given a lease holder exits while holding the lease, when its shutdown completes, then the lease is released so the next process acquires it without waiting for heartbeat expiry | 9, 17 | "`release()` removes the lease so the next `acquire()` succeeds without waiting for heartbeat expiry" | diff-local |
| Story 4 negative: Given a lease file whose pid now belongs to an unrelated live process and whose heartbeat has expired, when another OTel process starts, then the uuid mismatch marks the lease stale and the new process reclaims it | 9 | "a live-but-unrelated-pid lease with an expired heartbeat is reclaimed by uuid mismatch" | diff-local |
| Story 4 negative: Given the daemon holds the lease, when a per-feature dispatch's tracer provider shuts down at dispatch end, then the drainer keeps running and the lease stays held | 16 | "a per-dispatch visualizer stop leaves the drainer running and `lease.json` held by the daemon's uuid" | diff-local |
| Story 5 happy: Given a daemon dispatch whose OTel provider runs for a linked worktree, when it spools a batch, then the file lands under the main checkout's `.daemon/otel-spool/`, not under the worktree | 15 | "a batch spooled from a linked worktree lands under the main checkout's `.daemon/otel-spool/` and not under the worktree" | diff-local |
| Story 5 happy: Given `otel.spool.max_bytes` is set to 1 MiB and the spool holds 1 MiB, when a new batch is spooled, then the oldest files are evicted until the total is within the cap and one `otel_spool_drop` event with `reason` evicted reports the evicted batch and item counts | 4, 12 | "a new write evicts oldest files until `totalBytes` is at or under 1 MiB and returns the evicted batch and item counts" | diff-local |
| Story 5 happy: Given the drainer is running with a non-empty spool, when each backlog reporting interval elapses, then an `otel_spool_backlog` event reports per signal the file count, total bytes, oldest batch age, and last failure class | 13 | "each backlog interval emits one `otel_spool_backlog` per non-empty signal carrying file count, total bytes, oldest batch age and last failure class" | diff-local |
| Story 5 negative: Given a worktree is removed while batches it produced are still spooled, when the drainer next runs, then those batches are still present and delivered | 15 | "a spooled batch survives `git worktree remove` of the producing worktree and is delivered by the drainer" | diff-local |
| Story 5 negative: Given a single batch larger than `max_bytes`, when it is spooled, then it is dropped with a counted `evicted` event rather than evicting the whole spool | 4, 12 | "a single batch larger than `maxBytes` is not written, returns `rejectedOversize` with its item count, and leaves every pre-existing file in place" | diff-local |
| Story 5 negative: Given the main-root resolution fails (not a git checkout), when OTel starts, then the spool is disabled for that process with one bounded warning and export falls back to direct send | 15 | "outside a git checkout the spool is disabled, batches export directly, and exactly one `renderer_error` warning is emitted" | diff-local |
| Story 5 negative: Given an empty spool, when the backlog interval elapses, then no `otel_spool_backlog` event is emitted | 13 | "an empty spool emits no `otel_spool_backlog` across three intervals" | diff-local |
| Story 5 negative: Given the drainer emits backlog and drop events, when they reach the event sinks, then they are persisted but not rendered to `daemon.log`, not exported as OTel signals, and not counted in cost or timing rollups | 8 | "while the renderer writes neither to `daemon.log` and `MetricsListener` records no instrument for either" | diff-local |
| Story 6 happy: Given an `otel:` block with `exporter: otlp` and no `spool` key, when config resolves, then the spool is enabled with a 512 MiB cap | 1 | "returns `enabled: true` with `spool.enabled` true and `spool.maxBytes` 536870912" | diff-local |
| Story 6 happy: Given `otel.spool.enabled: false`, when config resolves, then batches are exported directly with today's behavior and no spool directory is created | 1, 19 | "`otel.spool.enabled: false` exports spans directly to the endpoint and creates no `.daemon/otel-spool` directory" | diff-local |
| Story 6 happy: Given `exporter: file`, when config resolves, then no spool is used and file output is unchanged | 19 | "`exporter: file` output is byte-identical to the unspooled file exporter and creates no spool directory" | diff-local |
| Story 6 negative: Given `exporter: otlp` and `protocol: grpc` with no `otel.spool` key, when config resolves, then telemetry is enabled with protocol `grpc`, batches are exported unspooled, and exactly one bounded warning says the spool is inactive for gRPC | 2 | "resolves `enabled: true` with protocol `grpc`, `spool.enabled` false, and exactly one warning stating the spool is inactive for gRPC" | diff-local |
| Story 6 negative: Given `protocol: grpc` with an explicit `otel.spool.enabled: true`, when config resolves, then OTel is disabled with an error naming `protocol: http/protobuf` as the remedy | 2 | "resolves `enabled: false` with an error naming `protocol: http/protobuf` as the remedy" | diff-local |
| Story 6 negative: Given `otel.spool.max_bytes` is zero, negative, or not a number, when config resolves, then OTel is disabled with an error naming the key and the accepted range | 1 | "each resolve `enabled: false` with an error naming `otel.spool.max_bytes` and the positive-integer accepted range" | diff-local |
| Story 6 negative: Given an unknown key under `otel.spool`, when config resolves, then a warning names the key and the known keys are still applied | 1 | "an unknown `otel.spool.flush` key yields one warning naming `flush` while `max_bytes` from the same block is applied" | diff-local |
| Story 6 negative: Given `protocol: grpc` with `otel.spool.enabled: false`, when config resolves, then gRPC export works exactly as before | 2 | "makes `buildExporters` return the unwrapped gRPC trace and metric exporters with no spool warning" | diff-local |
| Story 6 negative: Given `otel.spool.enabled: false` and a non-empty spool left by earlier runs, when OTel starts, then the spool files are left untouched and one bounded warning names the spool path and size | 19 | "a disabled process leaves three pre-existing spool files byte-identical and emits exactly one warning naming the spool path and size" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
