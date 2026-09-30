**Status:** Accepted

# Stories: Durable OTel export spool

**Source:** operator idea via composer, 2026-09-29 (technical track; criteria derived from the explore decision and ADR-014 as amended 2026-09-29, Decisions 15 to 17, plus architecture-review-2026-09-29-durable-otel-export-queue-telemetry-is-buffered-wh conditions 1, 3 and 4)

## Story 1: A batch is durable before the SDK is told it was exported

As an operator, I want every span and metric batch persisted locally before any send so that no outage or crash after acknowledgment can lose it.

### Acceptance Criteria

#### Happy Path
- Given `exporter: otlp` with the spool enabled and a reachable endpoint, when the span processor exports a batch, then a spool file for the `traces` signal exists under `<mainRoot>/.daemon/otel-spool/` before the SDK result callback reports success
- Given `exporter: otlp` with the spool enabled, when the metric reader exports a batch, then the spooled file body is the OTLP/HTTP protobuf request body for `/v1/metrics` and decodes to the same resource metrics that were exported
- Given the spool is enabled, when the metric exporter is asked for its aggregation temporality, then it returns the same `LOWMEMORY` selections the unspooled exporter returned (delta for counters and histograms, cumulative for gauges)

#### Negative Paths
- Given the spool directory's filesystem is full or unwritable, when a batch is exported, then the batch is sent directly to the endpoint, one bounded warning reaches the run's `renderer_error` path, and the run continues without failing
- Given a process dies after a spool file is fsynced and renamed but before any send, when the spool directory is inspected, then the complete batch file is present and no partially written file is visible under the final name
- Given two processes export batches at the same millisecond into the same spool, when both writes complete, then two distinct files exist and neither overwrites the other
- Given the configured OTLP headers include an API key resolved from an environment variable, when a batch is spooled, then no spool file or spool metadata contains that header's value

### Done When
- [ ] A test proves the spool file exists before the SDK success callback fires, for both the traces and the metrics signal
- [ ] A test decodes a spooled metrics file with the OTLP protobuf deserializer and matches the exported data points
- [ ] A test asserts the spooling metric exporter's temporality selections equal the unspooled exporter's
- [ ] A test with an unwritable spool directory asserts direct send, one warning, and no thrown error
- [ ] A test asserts spool files never contain a configured header value

## Story 2: Spooled batches are delivered after the endpoint recovers

As an operator, I want telemetry queued during a collector, agent, backend, or network outage to arrive once the endpoint is reachable again, so that outages leave no gaps.

### Acceptance Criteria

#### Happy Path
- Given three trace batches spooled while the endpoint refused connections, when the endpoint starts accepting requests, then all three are POSTed to `<endpoint>/v1/traces` oldest-first and each file is deleted after its 2xx response
- Given spooled batches for both signals, when they are drained, then each request carries `Content-Type: application/x-protobuf` and the configured `otel.headers` resolved at send time
- Given an endpoint that answers 503 twice and then 200, when the drainer sends one batch, then the batch is sent three times with increasing delay between attempts and is deleted after the 200
- Given a healthy drainer, when the endpoint starts refusing connections, then exactly one `renderer_error` names the signal and the failure class network, and no further `renderer_error` is emitted while that failure class persists

#### Negative Paths
- Given an endpoint that answers 429 with `Retry-After: 30`, when the drainer sends a batch, then it does not resend that signal's batches for at least 30 seconds and the file is kept
- Given the network drops mid-request, when the drainer's send fails with a connection error, then the file is kept and retried with backoff, and later batches of the same signal are not sent ahead of it
- Given a traces batch that keeps failing transiently, when metric batches are spooled, then metric delivery proceeds independently of the traces backlog
- Given the endpoint accepted a batch but the process died before deleting its file, when draining resumes, then that batch is sent again at most once more and the duplicate is tolerated (at-least-once delivery)
- Given a drainer in the network failure class, when the endpoint recovers and a batch is accepted, then one recovery notice is emitted, and a later failure emits a new `renderer_error`
- Given an endpoint that accepts the connection but never responds, when the owning process stops, then stop completes within the bounded export timeout and the in-flight file is kept

### Done When
- [ ] A test against a local HTTP test double asserts oldest-first POST order, the protobuf content type, the resolved headers, and deletion after 2xx
- [ ] A test asserts the backoff sequence on 503 and honouring of `Retry-After` on 429
- [ ] A test asserts per-signal independence: a stuck traces head does not block metrics delivery
- [ ] A test asserts exactly one `renderer_error` per transition into a failure class and one recovery notice on return to healthy
- [ ] A test asserts stop is bounded by the export timeout against a non-responding endpoint

## Story 3: The backend's response decides whether a batch is kept or dropped

As an operator, I want permanently rejected batches discarded and counted, but misconfiguration never to destroy queued data, so that the spool neither clogs nor loses data silently.

### Acceptance Criteria

#### Happy Path
- Given the endpoint answers 400 for a batch, when the drainer processes the response, then the file is deleted and one `otel_spool_drop` event is emitted with `reason` rejected, the signal, the item count, and status 400
- Given the endpoint answers 413 for a batch, when the drainer processes the response, then the file is deleted and one `otel_spool_drop` event with `reason` rejected and status 413 is emitted
- Given the endpoint answers 200 with an OTLP partial-success body rejecting some items, when the drainer processes the response, then the whole file is deleted, it is never resent in part, and an `otel_spool_drop` event carries the rejected item count

#### Negative Paths
- Given the endpoint answers 401 or 403, when the drainer processes the response, then the file is kept, no drop event is emitted, and the next `otel_spool_backlog` event reports the last failure class as auth
- Given the endpoint answers 404 because the configured endpoint path is wrong, when the drainer processes the response, then the file is kept and the backlog event reports the last failure class as endpoint
- Given a drainer already warned for the network failure class, when the endpoint becomes reachable but answers 401, then one new `renderer_error` names the auth failure class
- Given a batch whose data points are older than the backend's acceptance window, when the backend rejects it with a 4xx, then the drainer deletes and counts it as rejected without any client-side age check having skipped the send
- Given a batch older than any backend window, when the drainer reaches it, then it is still sent (no local age cap) and its fate is decided only by the response

### Done When
- [ ] A table-driven test covers 2xx, 400, 413, partial-success, 401, 403, 404, 408, 429 and 5xx, plus a network error, asserting keep or delete and event emission for each
- [ ] `otel_spool_drop` is a `ConductorEvent` union member with an `EVENT_SINKS` row
- [ ] A test asserts a stale-timestamp batch is sent rather than skipped locally

## Story 4: Queued telemetry survives a daemon restart or crash

As an operator, I want a restart or crash to lose nothing that was already spooled, and a graceful stop or respawn to spool what is still in memory, so that daemon restarts and stale-engine respawns create no telemetry gaps on a best-effort basis.

### Acceptance Criteria

#### Happy Path
- Given batches spooled by a daemon process that then exits, when a new daemon process starts with the same OTel config, then it acquires the spool lease and delivers the previous process's batches
- Given a daemon is stopped gracefully, when its OTel providers shut down, then the SDK's final in-memory batches are flushed into the spool before the process exits, even if the endpoint is unreachable
- Given no daemon is running, when an interactive run with OTel enabled starts and finds the lease free, then it takes the lease and drains the spool for the duration of the run
- Given a running daemon holding the lease, when it receives SIGHUP as on a tmux respawn, then its providers flush pending batches into the spool and the lease is released before exit

#### Negative Paths
- Given a lease held by a process whose pid is dead and whose heartbeat has expired, when another OTel process starts, then it reclaims the lease and drains
- Given a lease held by a live process with a fresh heartbeat, when a second OTel process starts, then the second process only writes spool files and never sends them
- Given two processes race to reclaim a stale lease, when both attempt acquisition, then exactly one holds the lease afterward
- Given a lease holder exits while holding the lease, when its shutdown completes, then the lease is released so the next process acquires it without waiting for heartbeat expiry
- Given a lease file whose pid now belongs to an unrelated live process and whose heartbeat has expired, when another OTel process starts, then the uuid mismatch marks the lease stale and the new process reclaims it
- Given the daemon holds the lease, when a per-feature dispatch's tracer provider shuts down at dispatch end, then the drainer keeps running and the lease stays held

### Done When
- [ ] A test with two sequential drainer instances over one spool directory proves cross-process delivery after the first stops
- [ ] A test asserts exactly one winner in a concurrent lease acquisition
- [ ] A test asserts graceful shutdown flushes pending SDK batches into the spool while the endpoint is down
- [ ] A test asserts a live, heartbeating lease blocks a second drainer
- [ ] A test asserts SIGHUP flushes providers into the spool and releases the lease
- [ ] A test asserts pid reuse with an expired heartbeat is reclaimed and that reclaim uses exclusive creation

## Story 5: The spool lives at the main checkout and is bounded on disk

As an operator, I want one spool per project that worktree cleanup cannot delete, with a hard disk ceiling, so that queued data survives worktree removal and a long outage cannot fill the disk.

### Acceptance Criteria

#### Happy Path
- Given a daemon dispatch whose OTel provider runs for a linked worktree, when it spools a batch, then the file lands under the main checkout's `.daemon/otel-spool/`, not under the worktree
- Given `otel.spool.max_bytes` is set to 1 MiB and the spool holds 1 MiB, when a new batch is spooled, then the oldest files are evicted until the total is within the cap and one `otel_spool_drop` event with `reason` evicted reports the evicted batch and item counts
- Given the drainer is running with a non-empty spool, when each backlog reporting interval elapses, then an `otel_spool_backlog` event reports per signal the file count, total bytes, oldest batch age, and last failure class

#### Negative Paths
- Given a worktree is removed while batches it produced are still spooled, when the drainer next runs, then those batches are still present and delivered
- Given a single batch larger than `max_bytes`, when it is spooled, then it is dropped with a counted `evicted` event rather than evicting the whole spool
- Given the main-root resolution fails (not a git checkout), when OTel starts, then the spool is disabled for that process with one bounded warning and export falls back to direct send
- Given an empty spool, when the backlog interval elapses, then no `otel_spool_backlog` event is emitted
- Given the drainer emits backlog and drop events, when they reach the event sinks, then they are persisted but not rendered to `daemon.log`, not exported as OTel signals, and not counted in cost or timing rollups

### Done When
- [ ] A test from a linked worktree asserts the spool path is under the main root
- [ ] A test asserts oldest-first eviction at the byte cap and the evicted drop event
- [ ] `otel_spool_backlog` is a `ConductorEvent` union member with an `EVENT_SINKS` row, and a test asserts its fields
- [ ] Spool events emitted by the daemon drainer are persisted to `<mainRoot>/.daemon/events.jsonl`
- [ ] The `EVENT_SINKS` rows for both spool events set OTel export off and render off

## Story 6: Spool configuration is on by default and validated

As an operator, I want durable export without extra config, with a clear error for combinations the spool cannot serve, so that no configuration silently runs unspooled.

### Acceptance Criteria

#### Happy Path
- Given an `otel:` block with `exporter: otlp` and no `spool` key, when config resolves, then the spool is enabled with a 512 MiB cap
- Given `otel.spool.enabled: false`, when config resolves, then batches are exported directly with today's behavior and no spool directory is created
- Given `exporter: file`, when config resolves, then no spool is used and file output is unchanged

#### Negative Paths
- Given `exporter: otlp` and `protocol: grpc` with no `otel.spool` key, when config resolves, then telemetry is enabled with protocol `grpc`, batches are exported unspooled, and exactly one bounded warning says the spool is inactive for gRPC
- Given `protocol: grpc` with an explicit `otel.spool.enabled: true`, when config resolves, then OTel is disabled with an error naming `protocol: http/protobuf` as the remedy
- Given `otel.spool.max_bytes` is zero, negative, or not a number, when config resolves, then OTel is disabled with an error naming the key and the accepted range
- Given an unknown key under `otel.spool`, when config resolves, then a warning names the key and the known keys are still applied
- Given `protocol: grpc` with `otel.spool.enabled: false`, when config resolves, then gRPC export works exactly as before
- Given `otel.spool.enabled: false` and a non-empty spool left by earlier runs, when OTel starts, then the spool files are left untouched and one bounded warning names the spool path and size

### Done When
- [ ] Config resolution tests cover the default, opt-out, file exporter, gRPC fallback with its warning, the explicit-enable gRPC error, invalid `max_bytes`, and unknown keys
- [ ] `spool` is a known `otel` key in config validation, so a valid `otel.spool` block produces no unknown-key warning
- [ ] A test asserts a disabled process leaves an existing spool untouched and warns once
- [ ] A test asserts `protocol: grpc` with `otel.spool.enabled: false` builds the gRPC exporters unchanged
