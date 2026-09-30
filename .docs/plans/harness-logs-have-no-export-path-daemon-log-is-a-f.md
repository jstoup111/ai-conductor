# Implementation Plan: Configurable harness log export

**Date:** 2026-09-30
**Status:** Approved
**Approved by:** Operator in composer chat, 2026-09-30
**Source-Ref:** jstoup111/ai-conductor#1935
**Design:** [Approved PRD](../specs/harness-logs-have-no-export-path-daemon-log-is-a-f.md)
**Stories:** .docs/stories/harness-logs-have-no-export-path-daemon-log-is-a-f.md
**Conflict check:** [Clean, 2026-09-30](../conflicts/harness-logs-have-no-export-path-daemon-log-is-a-f.md)
**Architecture:** [ADR-014](../decisions/adr-014-otel-observability-exporter.md), especially approved D18–D21.

## Summary

Deliver separately enabled operational log export through one shared daemon/interactive implementation, preserving local output and existing signals. There are 23 behavior-owning tasks. This exceeds the 20-task advisory threshold; estimated scoped implementation work is roughly 1–2 hours before engine-owned aggregate verification and SHIP. The existing durable transport remains a separate prerequisite rather than expanding this feature.

## Technical Approach

Resolve `otel.logs` independently, default off, from one read-only canonical project policy. Extend the existing event union and total sink registry; capture missing diagnostics before display formatting and project selected occurrences with full source ownership. One daemon-root log owner and one interactive-run log owner use the same SDK log provider, explicit bounded processor and OTLP HTTP protobuf sender. Extend the prerequisite main-root spool runtime with a consent-checked logs signal, separate 64 MiB retention allowance and destination binding. No new drainer, watcher, local-log scraper or vendor adapter.

The existing `MetricsListener` supplies semantic patterns for event-derived projection and idempotent ownership, not an exact-copy contract. `ForwardingEventEmitter` and immutable/async-scoped feature loggers provide source identity. `loadMergedConfigForRead` is the policy-read precedent; migratory loaders must not run at send time. `buildResource`'s metrics branch supplies worker-stable identity without session writes. The stock SDK processor has no suitable public counted-overflow hook: the approved bounded processor is a deliberate local departure, using the public SDK interface only.

## Prerequisites

- **Blocked by jstoup111/ai-conductor#2870.** Before Task 1, inspect the merged completed durable-OTLP implementation: store, atomic commitment, classifier, lease, independent drainer loops and main-root `SpoolRuntime` must be present and production-wired. Spec PR #2848 alone and the partial implementation seen in PR #2868 do not satisfy this condition. The GitHub issue dependency is recorded on #1935. If incomplete, wait for that feature; do not implement or duplicate it here.
- Spool module names below are rediscovery hints from its approved specification. Bind to its actual merged APIs at BUILD HEAD while preserving the named semantics; any different structural boundary returns to architecture review rather than inventing a parallel runtime.
- Accepted stories and approved ADR amendment are the sealed behavior contract. Work in this feature's isolated implementation worktree. No task changes another feature's DECIDE artifacts.

## Execution and test ownership

Each task is one focused RED/GREEN slice, targeting 2–5 minutes of implementation work after its dependencies. Its listed checks completely define completion. Extend a focused fixture when it already covers the boundary; do not create tests merely to mirror file layout. `writing-system-tests` owns any story-level acceptance specs before implementation; the configured verifier gate owns aggregate testing. No terminal catch-all test or unspecified repair task is included.

All listed criteria are diff-local under a fixed checked-out dependency baseline: proof uses the production path up to fake external adapters and isolated local storage, not live vendor accounts, upstream PR state, timing on an operator process or mutable external resources. #2870 is a prerequisite, not an acceptance assertion. Test layers and assertions below cover each cited happy/negative criterion. Use controlled clocks for deadlines and counters; never signal real daemon/tmux processes or invoke providers/GitHub. Each fixture declares its stop boundary and awaits cleanup.

## Tasks

### Task 1: Resolve independent valid log settings

**Story:** Story 11 (happy path) — criteria S11.1, S11.2, S11.3.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Introduce the disabled/invalid/enabled log result and parse the raw nested block. Reuse the environment-reference validation semantics from resolveOtelConfig without calling its all-signal enabled gate. Keep endpoint/header references unresolved for send-time refresh. Normalize the HTTP base URL and suffix once; select the independent spool defaults.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `resolveLogConfig` accepts explicit true with a valid HTTP OTLP parent, inherits its endpoint and header references, and lets an explicit logs endpoint replace the parent; log-config unit cases assert the exact resolved destination.
- `resolveLogConfig` treats an explicit header map as replacement, including an empty map supplying no headers; unchanged reference objects contain no resolved secret values.
- `resolveLogConfig` honors independent log retention enabled/disabled and positive max_bytes settings, defaults enabled-log retention to true and 67,108,864 bytes, and returns disabled for absent/false log enablement.

**Files:**
- src/conductor/src/types/config.ts
- src/conductor/src/engine/otel/log-config.ts
- src/conductor/test/engine/otel/log-config.test.ts

**Dependencies:** none

### Task 2: Refuse malformed log settings without poisoning parent config

**Story:** Story 11 (negative paths) — criteria S11.4, S11.5, S11.6.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Add the logs key to accepted configuration and consumer declarations. Isolate nested log errors from validateConfig's fatal errors and resolveOtelConfig's parent signal result. Table-test nonboolean enablement, unknown log keys/vendor selectors, invalid reference shapes, unknown spool keys, nonboolean spool enablement and zero/negative/noninteger/nonnumber caps. Reuse reference syntax validation, not secret values.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `resolveLogConfig` returns invalid with a key-specific safe diagnostic for nonboolean enabled, unknown log options/vendor selectors, malformed header references, unknown retention keys, nonboolean spool.enabled and zero/negative/noninteger/nonnumber spool.max_bytes; it never coerces enablement to true and produces no sender, while the configuration-loader boundary retains valid parent telemetry and local logging inputs.
- `resolveLogConfig` refuses requested logs when the parent uses file/gRPC or has no destination and no explicit HTTP logs endpoint is supplied: the local error names otel.logs.endpoint and zero log requests are sent. It also rejects userinfo/query/fragment/non-HTTP(S) URLs before any send and names the remedy without echoing sensitive endpoint components.
- The production configuration loader accepts valid otel.logs keys and the total config-consumer registry maps them to the log resolver; log-only errors do not throw from the existing whole-run loader.

**Files:**
- src/conductor/src/engine/otel/log-config.ts
- src/conductor/src/engine/config.ts
- src/conductor/test/engine/otel/log-config.test.ts
- src/conductor/test/engine/config-consumer-registry.ts

**Dependencies:** Task 1

### Task 3: Read one canonical project log policy without mutations

**Story:** Story 1 (happy path, negative paths) — criteria S1.2, S1.6.
**Story:** Story 11 (negative paths) — criteria S11.7.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Resolve mainRoot once with resolveMainRepoRootStrict and adapt loadMergedConfigForRead into a log-only policy reader. Preserve its user-then-project merge and avoid migrate/materialize loaders. Compare the invocation's worktree-local log block only for a bounded warning, never authorization. Test with temporary main/linked-worktree configurations and mocked root-resolution failure.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `readLogPolicy` returns the same main-root user/project merged policy from both checkout forms, with project values overriding user values; a differing worktree-local log block cannot replace consent or destination and yields one warning naming the canonical path.
- `readLogPolicy` reports root-resolution failure, missing/unreadable configuration and invalid policy as unsendable with a bounded safe diagnostic, never guesses another root, and performs no configuration-file write.
- The policy-reader integration fixture keeps local run handling and otherwise valid signal configuration usable on these log-only failures; runtime send authorization consumes the same typed result rather than reinterpreting raw YAML.

**Files:**
- src/conductor/src/engine/otel/log-policy.ts
- src/conductor/src/engine/config.ts
- src/conductor/test/engine/otel/log-policy.test.ts

**Dependencies:** Task 1, Task 2

### Task 4: Preserve occurrence timestamps and feature metadata through forwarding

**Story:** Story 4 (happy path) — criteria S4.1.
**Type:** infrastructure

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Add first-emission metadata at ConductorEventEmitter dispatch and carry it through cloneForwardedEvent with existing feature/execution context. Preserve known authoritative source timestamps; otherwise capture an injected clock once. Keep forwarding's existing mark and no-double-persistence behavior. This follows existing WeakMap/forwarding metadata semantics, not another event ledger.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `ConductorEventEmitter` stamps first observation once and `ForwardingEventEmitter` preserves it with complete feature and execution context across delayed local/root delivery; tests assert the original timestamp rather than delivery time.
- Forwarding retains its existing local persistence and root forwarded marker behavior without duplicating a persisted occurrence or changing source event payload fields unrelated to logs.

**Files:**
- src/conductor/src/ui/events.ts
- src/conductor/src/engine/event-persister.ts
- src/conductor/test/engine/event-persister.test.ts
- src/conductor/test/ui/events.test.ts

**Dependencies:** none

### Task 5: Capture structured operational diagnostics with immutable ownership

**Story:** Story 2 (happy path) — criteria S2.2.
**Story:** Story 4 (negative paths) — criteria S4.3.
**Story:** Story 5 (happy path, negative paths) — criteria S5.1, S5.3, S5.5.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Add operational_log and a shared logger boundary accepting severity, raw body, occurrence time and discriminated ownership. Emit on the existing bus best-effort and preserve original local sink arguments. Reuse immutable feature logger closures and AsyncLocalStorage execution ownership; capture before formatDaemonFeatureTag. Do not intercept stdout or introduce a global current-feature slot. Known warn/error callsites must pass source severity rather than text heuristics.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `createOperationalLogger` emits typed info/warn/error occurrences with original operational content and passes unchanged content to its existing local sink; emitter failure is caught and does not replace the caller's result.
- The diagnostic-boundary interleaving test uses two full slugs with the same shortened prefix and proves ordinary and deferred warn/error records keep their own complete slug, including A's scheduled diagnostic after A ends while B continues.
- `createOperationalLogger` leaves unowned repository-wide diagnostics project-scoped even during feature execution; ANSI or misleading prefix text never supplies identity or borrows the active/last feature.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/operational-log.ts
- src/conductor/src/engine/daemon-log.ts
- src/conductor/test/engine/operational-log.test.ts

**Dependencies:** Task 4

### Task 6: Project typed records and stable log resources

**Story:** Story 2 (negative paths) — criteria S2.5.
**Story:** Story 4 (happy path, negative paths) — criteria S4.1, S4.2, S4.4.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Create typed per-event projection with standard OTel timestamp/severity/body and explicit record attributes. Reuse MetricsListener's start/stop and event-derived ownership traits while selecting logs independently. Add a worker-stable logs Resource branch without session-id side effects; reuse validated static attributes and released version conventions. Exclude transcripts, raw application streams, snapshots and unrelated administrative output.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `projectLogRecord` produces decoded timestamp, severity, body, project, worker, event name, conductor.scope explicitly set to feature, and complete feature slug for feature occurrences; the received sample retains source/first-emission time after delayed forwarding and includes step/attempt only when supplied.
- `buildResource(..., 'logs')` and `projectLogRecord` produce stable project/worker identity and validated custom attributes for project-wide records with conductor.scope explicitly set to project, omit feature identity there, and keep conductor-owned values on collision without creating or rewriting session identity files.
- `projectLogRecord` returns no log record for provider transcript chunks, raw application output, dashboard snapshots or unrelated administrative output; sentinel content is absent from projected batches and no arbitrary event-object serialization is used.

**Files:**
- src/conductor/src/engine/otel/log-listener.ts
- src/conductor/src/engine/otel/resource.ts
- src/conductor/test/engine/otel/log-listener.test.ts
- src/conductor/test/engine/otel/resource.test.ts

**Dependencies:** Task 4, Task 5

### Task 7: Bound remote records without shortening identity or local output

**Story:** Story 4 (negative paths) — criteria S4.5.
**Story:** Story 6 (negative paths) — criteria S6.4.
**Story:** Story 8 (negative paths) — criteria S8.6.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Normalize primitive log fields before expensive serialization. Measure UTF-8 bytes; retain required identity and at most 64 attributes, truncate only remote body at 32 KiB with a marker, and reject required fields that cannot fit 64 KiB. Feed countable oversize loss into the owner's health accumulator. No mutation of the source event/local message.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `normalizeLogRecord` caps body at 32 KiB using UTF-8-safe truncation and a visible truncation attribute, caps normalized record at 64 KiB and attributes at 64, and never shortens mandatory identity.
- Boundary-size fixtures through the projector observe a counted whole-record discard when mandatory identity cannot fit, and unchanged complete local content whether the remote record is truncated, attribute-bounded or discarded.

**Files:**
- src/conductor/src/engine/otel/log-record.ts
- src/conductor/src/engine/otel/log-listener.ts
- src/conductor/test/engine/otel/log-record.test.ts

**Dependencies:** Task 6

### Task 8: Derive log subscriptions and suppress rendering recapture

**Story:** Story 2 (negative paths) — criteria S2.6.
**Story:** Story 5 (happy path, negative paths) — criteria S5.2, S5.4.
**Story:** Story 10 (negative paths) — criteria S10.4.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Add required logs declarations to the total registry and derive typed handler subscriptions; retain existing sink fields. Place a shared async-scoped capture-suppression guard around terminal/daemon event rendering, feature-pool event-associated lifecycle lines and delivery-health rendering. The guard marks the render operation, not all concurrent activity; no text cache. Operational diagnostics already locally rendered persist without another render.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `LogListener` subscribes from the exhaustive logs registry and its total typed projection table; each selected event is handled, deliberate exclusions stay excluded, and existing trace/metric/render/persist/audit declarations remain unchanged.
- Feature-to-root plus terminal/daemon render integration emits exactly one logical remote record for one forwarded/rendered occurrence before transport retries; two separate occurrences with identical message text still produce two records.
- `withLogRenderSuppressed` excludes rendered delivery-health text and event-derived output from diagnostic recapture without suppressing unrelated concurrent diagnostics; persisted/rendered health creates zero remote records and zero recursive delivery attempts.

**Files:**
- src/conductor/src/engine/event-sinks.ts
- src/conductor/src/engine/otel/log-listener.ts
- src/conductor/src/engine/operational-log.ts
- src/conductor/src/ui/subscriber.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/otel/log-listener.test.ts
- src/conductor/test/engine/operational-log.test.ts

**Dependencies:** Task 5, Task 6

### Task 9: Implement the single bounded asynchronous log processor

**Story:** Story 8 (happy path, negative paths) — criteria S8.1, S8.2, S8.4, S8.5, S8.7.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Declare direct compatible log API/SDK dependencies and implement the SDK public processor interface with one admission queue. Count admitted/in-flight records and normalized bytes until settlement. Schedule an unreferenced timer and serialize/split off the event callback. The installed stock batch processor exposes no suitable overflow callback; D20 explicitly authorizes this bounded processor rather than stacking SDK/private queues.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `BoundedLogProcessor.onEmit` admits bounded records synchronously and returns without awaiting disk/network; a stalled fake exporter leaves its producer and subsequent event handlers unblocked.
- `BoundedLogProcessor` permits at most 1,024 records and 8 MiB normalized payload including in-flight records; an overflow drops the newest record with an exact loss count and never increases admitted state beyond either cap.
- `BoundedLogProcessor` schedules flush within one second of pending traffic unless the preceding bounded attempt is settling, emits at most 128 records and 1 MiB serialized bytes per request, and splits large groups by actual serialized size away from event callbacks.
- The processor's timer is unreferenced and its export callback settles admitted accounting exactly once on success, rejection or exception; it contains serialization/export errors instead of propagating them to event producers.

**Files:**
- src/conductor/package.json
- src/conductor/package-lock.json
- src/conductor/src/engine/otel/log-processor.ts
- src/conductor/test/engine/otel/log-processor.test.ts

**Dependencies:** Task 6, Task 7

### Task 10: Send one OTLP log contract for all destination configurations

**Story:** Story 3 (happy path, negative paths) — criteria S3.1, S3.2, S3.5.
**Story:** Story 11 (happy path) — criteria S11.1, S11.2.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Extend the prerequisite shared HTTP sender seam for the logs signal and use ProtobufLogsSerializer. Preserve the parent traces/metrics exporter factory. Normalize base paths and exact-once /v1/logs, inherit or replace header references as resolved by Task 1, and resolve values at send. Add four faithful destination contract fixtures; replace only the third-party HTTP boundary, not internal serialization/wiring.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `sendLogBatch` sends Content-Type application/x-protobuf requests for Loki, OTLP-capable Elasticsearch or its collector, Sumo Logic and Datadog fixture configurations with the configured authentication values and base path followed by exactly one /v1/logs; an already suffixed endpoint receives no second suffix.
- The common sender/serializer integration decodes separately queryable project and full feature fields at each fake destination, including the intermediary case, with no engine vendor switch, scraping or project-filesystem access.
- The request matrix proves HTTP-parent endpoint/header inheritance, explicit destination override, header-map replacement and an explicitly empty header map sending no inherited headers; configuration and retained metadata never receive resolved secret values.

**Files:**
- src/conductor/src/engine/otel/log-transport.ts
- src/conductor/src/engine/otel/transport.ts
- src/conductor/test/engine/otel/log-transport.test.ts

**Dependencies:** Task 1, Task 9

### Task 11: Authorize each queued or retained send against current policy

**Story:** Story 1 (negative paths) — criteria S1.5.
**Story:** Story 9 (negative paths) — criteria S9.4.
**Story:** Story 11 (negative paths) — criteria S11.7.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Bind admission to a nonsecret destination identity covering normalized endpoint and reference names, not credential values. Before every direct/retained/fallback request, asynchronously refresh canonical policy and match that identity inside the sender. Off/invalid/unreadable/missing states prohibit sends. Stop after the current request on revocation; do not claim to retract requests already issued. Use the shared drainer's logs callback, not a watcher.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `sendLogBatch` re-reads canonical consent before each new direct, retained or fallback request and issues none when policy is false, invalid, missing or unreadable, even if an earlier process/attempt admitted the batch; a running-sender fixture proves revocation stops the next request without asserting retraction of one already issued.
- Destination identity matching in the sender prevents any admitted/retained record from being rerouted after an endpoint or header-reference change; previously durable mismatches remain retained within the log cap, unretained mismatches are discarded/counted, and restoring the original policy makes retained records eligible.
- Identity metadata contains only a nonsecret fingerprint of destination/reference configuration, never resolved header values; rotating a value under the same reference preserves matching authorization.

**Files:**
- src/conductor/src/engine/otel/log-policy.ts
- src/conductor/src/engine/otel/log-transport.ts
- src/conductor/src/engine/otel/spool-drainer.ts
- src/conductor/test/engine/otel/log-policy.test.ts
- src/conductor/test/engine/otel/log-transport.test.ts

**Dependencies:** Task 3, Task 10

### Task 12: Cancel timed-out delivery before late work can send

**Story:** Story 8 (happy path, negative paths) — criteria S8.3, S8.7.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Wrap read/resolve/serialize/send completion in one two-second attempt deadline with cancellation token and AbortController. Pass cancellation into I/O adapters where supported and check token before any late continuation issues HTTP. Settle accounting/health once; catch thrown values and rejected promises through the same safe failure result. Timers unref and clear.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `sendLogBatch` enforces one two-second total budget across policy reading, credential resolution and request, cancels or abandons stalled work, and never initiates a late HTTP request after timeout.
- Thrown/rejected serialization, policy and credential operations and never-settling fake operations return safe delivery failure without escaping into the build or exceeding the attempt deadline; controlled late resolutions produce zero further requests.
- Delivery deadline timers are unreferenced and cleared on every terminal path, and repeated completion cannot release accounting twice or start a retry inside the expired attempt.

**Files:**
- src/conductor/src/engine/otel/log-transport.ts
- src/conductor/test/engine/otel/log-transport.test.ts

**Dependencies:** Task 11

### Task 13: Extend durable write-first delivery with authorized log batches

**Story:** Story 1 (happy path) — criteria S1.3.
**Story:** Story 9 (happy path) — criteria S9.1, S9.2, S9.3.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Extend the merged prerequisite store/exporter/drainer through its actual APIs with logs payloads and destination identity. Reuse fsync/rename immutable batch commitment and per-signal order; do not build another durable queue. Distinguish asynchronous committed acknowledgment from in-memory admission. Keep credentials at send only and use existing classification hooks.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- The logs spooling exporter serializes and commits a complete immutable protobuf batch before acknowledging retention and before any network send; a later authorized owner over the same storage observes and delivers that payload after the first exits.
- The shared drainer attempts eligible matching-destination log batches oldest-first without a client-side age cutoff and removes each after full acceptance; an enabled later invocation with the same destination can replay previously retained logs.
- The drainer resolves current environment-reference values on send, so value rotation with unchanged references is used by the next request; storage and health captures contain no secret-value sentinel.

**Files:**
- src/conductor/src/engine/otel/spooling-exporter.ts
- src/conductor/src/engine/otel/spool-store.ts
- src/conductor/src/engine/otel/spool-drainer.ts
- src/conductor/test/engine/otel/log-spool.test.ts

**Dependencies:** Task 9, Task 11, Task 12

### Task 14: Apply existing response dispositions to logs

**Story:** Story 3 (negative paths) — criteria S3.3, S3.4.
**Story:** Story 9 (negative paths) — criteria S9.7.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Extend the prerequisite classifier's protobuf partial-success handling for log rejected-record counts. Reuse keep/delete/backoff rules and per-signal pacing. Feed safe failure classes/counts to health; never forward raw response bodies or exceptions into diagnostics. Cover destination 404 and unavailable intermediary as well as auth failures.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- The logs classifier/drainer deletes/counts a batch for 400, 413 and OTLP partial rejection, deletes only after full acceptance for ordinary 2xx, and retains/backoffs for 401, 403, 404, 408, 429, 5xx and network failure while honoring Retry-After; retries are bounded to one in-flight log attempt per runtime and a two-second total budget per attempt, with retained data subject to the configured log byte cap.
- Fake 401/403, incorrect-path 404 and unavailable-intermediary integration cases retain enabled-spool batches, never redirect to another destination, let the run continue with its original result, and produce bounded safe local auth/endpoint/network warnings containing no credential value.
- The logs signal reuses the prerequisite retry scheduler/classifier rather than an SDK or vendor retry loop, so failure in logs does not wait on or reorder other signals' sends.

**Files:**
- src/conductor/src/engine/otel/delivery-classifier.ts
- src/conductor/src/engine/otel/spool-drainer.ts
- src/conductor/test/engine/otel/log-spool.test.ts

**Dependencies:** Task 13

### Task 15: Enforce a separate log storage cap and safe disk fallback

**Story:** Story 7 (negative paths) — criteria S7.5.
**Story:** Story 9 (negative paths) — criteria S9.5, S9.6.
**Story:** Story 11 (happy path) — criteria S11.3.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Extend store accounting to the independent log cap across active/inactive destination identities; evict oldest log payloads through existing atomic store operations. Preserve all trace/metric files and allowances. On full/unwritable disk use the same direct sender with current-policy check and deadline; count/report failed preservation and any eventual loss. A batch larger than cap uses existing counted disposition.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- The log store enforces configured max_bytes with default 64 MiB across all retained log destinations, evicts oldest log batches with exact counts, and never evicts or charges trace/metric files against that cap.
- With disk-full and permission-denied writes, the logs spooling exporter reports a bounded preservation failure and calls the common direct sender only under current matching consent and its two-second budget; otherwise it does not send, and neither branch fails the build.
- Isolated storage integration keeps trace/metric backlog byte-identical during log eviction and leaves local message output complete during disk failure.

**Files:**
- src/conductor/src/engine/otel/spool-store.ts
- src/conductor/src/engine/otel/spooling-exporter.ts
- src/conductor/test/engine/otel/log-spool.test.ts

**Dependencies:** Task 13, Task 14

### Task 16: Make the shared runtime respect log opt-out and ownership

**Story:** Story 1 (negative paths) — criteria S1.4.
**Story:** Story 9 (negative paths) — criteria S9.8, S9.9.
**Story:** Story 11 (happy path) — criteria S11.3.
**Story:** Story 12 (negative paths) — criteria S12.6.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Extend the prerequisite SpoolRuntime signal registration/refcount seam for logs. Keep one main-root lease/runtime with separate signal loops; gate logs from canonical consent even when a traces/metrics-only process holds the lease. Distinguish logs disabled from log retention disabled; neither may drain leftover log batches. Use existing safe lease logic, no new lock.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- The shared runtime's log loop sends retained logs only for its current authorized lease owner and enabled matching log policy; contention/lost-ownership fixtures permit only that owner to send, and a trace/metric owner with logs disabled sends zero log requests.
- Absent/false log enablement leaves all retained log batches unsent; log-spool-disabled mode sends newly admitted logs directly through the common sender, leaves old batches untouched, and emits one bounded local notice identifying their presence.
- Main-root runtime registration shares the prerequisite drainer/lease rather than creating a logs drainer, preserves independent trace/metric loops, and does not let per-feature release stop another owner's transport.
- Starting with retained log batches and absent/false log enablement emits one bounded local notice that the backlog remains unsent; it performs no log send or backlog purge.

> **Amended 2026-09-30 by #1935:** Coherence review makes D20's disabled-backlog notice explicit in Task 16 completion checks; approved consent, retention and local-output behavior are unchanged.

**Files:**
- src/conductor/src/engine/otel/spool-wiring.ts
- src/conductor/src/engine/otel/spool-drainer.ts
- src/conductor/test/engine/otel/log-spool-wiring.test.ts

**Dependencies:** Task 3, Task 13, Task 15

### Task 17: Aggregate safe delivery health on the existing spine

**Story:** Story 10 (happy path, negative paths) — criteria S10.1, S10.2, S10.3, S10.4, S10.5.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Extend the prerequisite typed spool health vocabulary for log admission/oversize/storage/rejection counts. Accumulate per log owner; emit one prompt failure, then one summary per60s across classes and at most one recovery notice per60s. Use controlled safe destination identity/class data, not raw backend text. Reuse root/interactive event persistence and local renderer; exclude these events from logs and traces/metrics recursion.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `LogHealth` emits a prompt first local warning naming logs, a sanitized destination and actionable failure class; subsequent failure/drop summaries aggregate exact counts at most once per 60 seconds per owner even when thousands of records fail or classes change.
- `LogHealth` emits at most one recovery notice per 60 seconds; deterministic clock tests assert both warning and recovery bounds and retain the build's ordinary diagnostics between summaries.
- Delivery health events reach the existing persisted/local render path with logs disabled for their sink and rendering capture suppressed; an induced failure episode produces zero exported health records and zero recursive send attempts.
- Health construction selects safe fields only: credential, Authorization, sensitive URL-path and raw-response/exception sentinels are absent from local health output and retained health metadata.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/src/engine/otel/log-health.ts
- src/conductor/src/engine/otel/spool-drainer.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/src/ui/create-renderer.ts
- src/conductor/test/engine/otel/log-health.test.ts

**Dependencies:** Task 5, Task 8, Task 12, Task 14, Task 15, Task 16

### Task 18: Compose the shared log owner through the OTel wiring seam

**Story:** Story 1 (happy path) — criteria S1.1.
**Story:** Story 2 (happy path) — criteria S2.2.
**Type:** infrastructure

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Add one shared log-owner factory used by both modes: canonical typed policy, LoggerProvider with stable log resource, bounded processor, common transport/runtime, log listener, health and idempotent stop. Reuse MetricsListener's explicit attachment/teardown traits without per-feature daemon exporters. Default-off/invalid paths install no sending owner; construction errors warn safely and leave the caller usable.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- `wireOtelLogs` composes the same listener/provider/processor/sender path for both modes and delivers typed operational records with source severity under explicit valid policy.
- `wireOtelLogs` returns no sending log owner for absent/false/invalid policy, catches construction failures into bounded local health, and never enables or disables the existing metric/tracing owners.
- The factory's start/stop ownership is idempotent, stores no mutable current-feature identity, and acquires only the existing main-root runtime reference; Tasks 19/20 own proof that real entry points invoke it.

**Files:**
- src/conductor/src/engine/otel/wire.ts
- src/conductor/src/engine/otel/log-listener.ts
- src/conductor/src/engine/otel/log-processor.ts
- src/conductor/test/engine/otel/log-wire.test.ts

**Dependencies:** Task 3, Task 6, Task 8, Task 9, Task 10, Task 12, Task 16, Task 17

### Task 19: Wire daemon capture and recovery forwarding into the root log owner

**Story:** Story 1 (happy path, negative paths) — criteria S1.1, S1.4.
**Story:** Story 2 (happy path, negative paths) — criteria S2.1, S2.2, S2.3, S2.4, S2.6.
**Story:** Story 8 (happy path) — criteria S8.1.
**Story:** Story 12 (happy path) — criteria S12.2.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Start root event/diagnostic ownership after configuration can be resolved and before configured-run lifecycle output, using the shared factory once. Integrate process warn/error capture with the existing local tee; keep unconfigured early failures local. Reuse ForwardingEventEmitter behavior for createSlugScopedProviderExecution/recovery without a second persistence owner. Keep root configuration/transport adapters outside feature executors. Tie feature-pool display to render suppression. Tests invoke the daemon composition boundary with fake process/provider/network adapters and stop after observations.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- Through the real daemon startup/run composition path, explicit true policy sends startup, step completion, final completion and source info/warn/error records through `wireOtelLogs`; absent/false policy sends zero log requests even with retained backlog, while existing local output remains available.
- Daemon scheduling/recovery integration sends project-wide diagnostics without feature identity and feature recovery/provider diagnostics with full source slug via root forwarding; one typed lifecycle plus its rendered line yields one logical log record.
- The daemon root log owner outlives one feature's finish and continues sending for the daemon and remaining features with their own attribution; no feature constructs another log exporter or reads shared-root policy directly.
- Daemon startup/shutdown error paths offer locally reported configured-run failures to the same bounded logging path without changing the original run result; lifecycle cleanup is finalized by Task 23.
- With the connected log disk/network adapter stalled, a daemon step continues and a subsequent progress observation occurs before remote completion; neither event delivery nor build outcome waits on log export.

**Files:**
- src/conductor/src/daemon-cli.ts
- src/conductor/src/engine/event-persister.ts
- src/conductor/src/engine/daemon-log.ts
- src/conductor/test/daemon-otel-wiring.test.ts
- src/conductor/test/engine/daemon-log-feature-tags.acceptance.test.ts

**Dependencies:** Task 18

### Task 20: Wire interactive diagnostics through the same log owner

**Story:** Story 1 (happy path, negative paths) — criteria S1.1, S1.4, S1.7.
**Story:** Story 2 (happy path, negative paths) — criteria S2.1, S2.2, S2.4, S2.5.
**Story:** Story 8 (happy path) — criteria S8.1.
**Story:** Story 12 (happy path) — criteria S12.3.
**Type:** happy-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Attach the shared owner and scoped operational/console warn/error bridge after configuration and before configured-run lifecycle/diagnostics. Retain existing UI selection and existing trace/metric visualizers. Use try/finally on all later exits. Do not capture unrelated admin commands or stdout streams. Production entry fixtures supply fake runners/network and an explicit early stop boundary; no full harness build.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- Through the real interactive configured-run composition path, true policy delivers startup, step completion, final completion and source info/warn/error with the daemon-equivalent fields; absent/false policy sends zero logs including retained backlog, and local output remains available.
- An interactive restart after enabling previously disabled logs captures new occurrences and can send already-authorized matching retained batches but does not replay disabled-time events or historical local files.
- The interactive entry's startup/shutdown failure path offers configured-run diagnostics to the bounded owner and preserves the original result/local error; partial initialization is cleaned up exactly once through its finally path.
- Two sequential interactive starts/stops in one process restore the diagnostic bridge and listener counts, produce one log per new occurrence, and carry no stale feature attribution.
- With the connected log disk/network adapter stalled, an interactive step and subsequent progress continue before remote completion and retain their original result; no arbitrary stdout or provider transcript is newly captured.

**Files:**
- src/conductor/src/index.ts
- src/conductor/src/engine/otel/wire.ts
- src/conductor/test/interactive-otel-wiring.test.ts

**Dependencies:** Task 18

### Task 21: Isolate log validation and failures from existing signal wiring

**Story:** Story 6 (negative paths) — criteria S6.3.
**Story:** Story 7 (happy path, negative paths) — criteria S7.1, S7.2, S7.3, S7.4.
**Story:** Story 11 (negative paths) — criteria S11.4.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Complete independent result plumbing through the entry configuration/wiring boundaries. Separate parent exporter factory branches from logs; a log-only error must not abort valid traces/metrics. Exercise the off/enabled/invalid/failing log matrix with existing in-memory trace/metric fixtures and fake HTTP log sender. Keep emitted resource/metric semantics, temporality selectors, transport and enablement unchanged.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- The daemon and interactive entry-point configuration matrix toggles only log enablement and observes unchanged trace/metric destination, identity, payload semantics, temporality and enablement; no existing trace/metric contract changes to make logs work.
- Both production wiring paths send explicitly enabled HTTP logs to their own endpoint alongside gRPC, file or disabled parent signals without changing those parent settings; malformed log-only settings instead yield a named local error and zero logs while valid traces/metrics and local output continue.
- The shared runtime/owner wiring independently schedules healthy trace/metric deliveries while the log destination is unavailable, with no wait for log recovery and no change to the build outcome.
- Existing parent unknown-protocol/header refusals and custom-attribute validation remain scoped to their original signals; the new log result cannot silently override them or enable either parent signal.

**Files:**
- src/conductor/src/engine/config.ts
- src/conductor/src/engine/otel/wire.ts
- src/conductor/src/engine/otel/transport.ts
- src/conductor/test/daemon-otel-wiring.test.ts
- src/conductor/test/interactive-otel-wiring.test.ts

**Dependencies:** Task 2, Task 19, Task 20

### Task 22: Integrate capture while preserving local file and terminal behavior

**Story:** Story 6 (happy path, negative paths) — criteria S6.1, S6.2, S6.3, S6.4.
**Type:** refactor

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Complete the local-sink adapter ordering at the changed capture boundaries. Preserve original local arguments, status-transition suppression, prefix/timestamp formatting, ANSI handling, read/follow and rotation. Reuse existing daemon log fixtures rather than a new whole-run suite. Compare identical occurrence sequences with logs off/on/invalid/failing; delivery-health additions are separately identified.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- Through the changed daemon logger and terminal subscriber boundaries, an identical sequence with logs off/on retains the exact local message/prefix/timestamp formatting, complete content and transition suppression; only intentional additional health diagnostics differ.
- Existing read/follow/rotation boundary fixtures run with log capture enabled and observe the same expected persisted and followed records, including complete retained records across rotation.
- Malformed log configuration and failed remote sends leave terminal/file diagnostics and the build's own messages available; remote body truncation, queue overflow and retention eviction cannot shorten or suppress the original local message.

**Files:**
- src/conductor/src/engine/daemon-log.ts
- src/conductor/src/engine/operational-log.ts
- src/conductor/src/ui/subscriber.ts
- src/conductor/test/engine/daemon-log.test.ts
- src/conductor/test/ui/subscriber.test.ts

**Dependencies:** Task 8, Task 19, Task 20, Task 21

### Task 23: Finalize bounded owner shutdown and repeated-run cleanup

**Story:** Story 2 (negative paths) — criteria S2.4.
**Story:** Story 12 (happy path, negative paths) — criteria S12.1, S12.2, S12.3, S12.4, S12.5, S12.6, S12.7.
**Type:** negative-path

**Steps:**
1. Write failing targeted tests for the named checks through the lowest sufficient layer: unit for parsing/projection/state transitions, integration for the named production entry or storage/network adapter boundary.
2. Run those selectors through `ai-conductor scoped-run` and establish RED.
3. Implement the final lifecycle ordering at daemon/interactive completion, signals and partial startup: final diagnostic, stop admission, bounded preserve/flush, detach/restore, release this owner's reference. Reuse prerequisite SIGHUP/SIGTERM and shared runtime shutdown seams. One global two-second log-stop deadline includes every queued operation; cancellation gates late continuations. Use controlled process/network adapters only; never signal a real daemon in tests.
4. Run the same selectors to GREEN and applicable static checks; do not launch an aggregate suite.
5. Commit the scoped behavior and its tests with the task identity.

**Done when:**
- Daemon and interactive owner-stop integration includes the final lifecycle diagnostic in the flush/preservation attempt, then returns within one total two-second log shutdown budget even when destination or storage never completes; it clears/unrefs log timers and prevents any late request after stop.
- Partial-initialization and exceptional-finally fixtures release acquired logging resources and restore the original console diagnostic bridge exactly once while retaining complete local error output and the original run result.
- Per-feature completion and local provider stop release only their own references, leaving root/other-feature logs correctly attributed and another process owner's lease/delivery intact; tests observe the remaining feature and project records after one feature ends.
- Repeated start/stop through both entry lifecycles returns listener counts to baseline and yields one record per new occurrence without prior-run feature identity.
- Shared-runtime owner replacement after a durably committed batch survives loss before acknowledgment/removal and makes that batch eligible under later matching consent; replay may duplicate delivery and no test asserts crash safety for unretained memory or exactly-once network delivery.

**Files:**
- src/conductor/src/engine/otel/wire.ts
- src/conductor/src/engine/otel/log-processor.ts
- src/conductor/src/engine/otel/spool-wiring.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/src/index.ts
- src/conductor/test/engine/otel/log-lifecycle.test.ts

**Dependencies:** Task 19, Task 20, Task 21, Task 22

## Integration Points

Each changed boundary has one integration-proof owner; sibling unit checks do not substitute for these assertions.

| Changed boundary | Owner task | Observable proof |
| --- | --- | --- |
| Raw loaded configuration to independent log result | 2 | Invalid log input becomes a named logs-only refusal while valid run/parent inputs survive. |
| Checkout/user/project sources to canonical read-only policy | 3 | Linked-worktree precedence, canonical-path warning and no mutation. |
| Feature bus to root bus | 4 | Original timestamp, feature identity, context and persistence marker survive forwarding. |
| Local diagnostic source to typed occurrence | 5 | Source severity, original local content and async ownership survive. |
| Event registry/rendering to log listener | 8 | Exhaustive routing, no rendered recapture and no false text deduplication. |
| Log request to external HTTP boundary | 10 | One protobuf contract, correct destination paths/auth, separately queryable fields. |
| Fresh consent to queued/retained HTTP issuance | 11 | No send after revocation and no destination rerouting. |
| Log retention acknowledgment and durable recovery | 13 | Write-first acknowledgment and later authorized replay through the shared store. |
| Backend response to retained/deleted disposition | 14 | Logs use the existing retry/rejection contract. |
| Log disk capacity/failure to eviction/fallback | 15 | Separate cap and consent-checked fallback preserve other signals. |
| Main-root transport ownership to logs signal | 16 | Single owner, disabled retained backlog untouched. |
| Delivery health to local renderer/persistence | 17 | Bounded warnings and no remote health recursion or secrets. |
| Daemon configured-run/recovery to shared log owner | 19 | Root-only coverage, progress and feature independence. |
| Interactive configured-run to shared log owner | 20 | Same coverage, progress and run-local ownership. |
| Log configuration/failure to other signal owners | 21 | Existing traces/metrics continue unchanged through both entries. |
| Remote capture to existing local sinks/readers | 22 | Local content/read/follow/rotation remain intact. |
| Entry completion/partial failure to shutdown | 23 | Final diagnostic, one deadline, no leaked owner or late send. |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | task | task-8, task-18 | `LogListener` subscribes from the exhaustive logs registry and its total typed projection table; each selected event is handled, deliberate exclusions stay excluded, and existing trace/metric/render/persist/audit declarations remain unchanged. |
| adr-014-otel-observability-exporter#D2 | no-change | none | Existing trace visualizer packaging remains unchanged; logs ownership is the explicit additive D18–D21 extension, not a replacement plugin kind. |
| adr-014-otel-observability-exporter#D3 | no-change | none | The original generic visualizer discovery/selection remains unchanged; this feature invokes a shared log owner beside the established trace/metric wiring. |
| adr-014-otel-observability-exporter#D4 | task | task-9 | `BoundedLogProcessor.onEmit` admits bounded records synchronously and returns without awaiting disk/network; a stalled fake exporter leaves its producer and subsequent event handlers unblocked. |
| adr-014-otel-observability-exporter#D5 | task | task-12, task-17, task-23 | Thrown/rejected serialization, policy and credential operations and never-settling fake operations return safe delivery failure without escaping into the build or exceeding the attempt deadline; controlled late resolutions produce zero further requests. |
| adr-014-otel-observability-exporter#D6 | no-change | none | Existing file and OTLP trace/metric transport choices remain unchanged; independent HTTP logs are governed by D18. |
| adr-014-otel-observability-exporter#D7 | task | task-18, task-19, task-20, task-21 | The daemon root log owner outlives one feature's finish and continues sending for the daemon and remaining features with their own attribution; no feature constructs another log exporter or reads shared-root policy directly. |
| adr-014-otel-observability-exporter#D8 | no-change | none | Existing trace/metric identity rules remain unchanged; no metric label or run-id behavior is added by this feature. |
| adr-014-otel-observability-exporter#D9 | task | task-4, task-19 | Forwarding retains its existing local persistence and root forwarded marker behavior without duplicating a persisted occurrence or changing source event payload fields unrelated to logs. |
| adr-014-otel-observability-exporter#D10 | no-change | none | No metric instruments, labels, bucket boundaries, dispatch accounting or cost semantics change; logs only consume occurrences. |
| adr-014-otel-observability-exporter#D11 | no-change | none | Existing optional metric dimensions on lifecycle events are preserved; no new metric dimension is introduced. |
| adr-014-otel-observability-exporter#D12 | no-change | none | Existing custom attribute validation, reserved namespaces and limits are reused; no new attribute source or parent-signal policy is introduced. |
| adr-014-otel-observability-exporter#D13 | no-change | none | Trace/metric Resource and data-point metadata placement is preserved; the additional log Resource and record mapping is governed by D19. |
| adr-014-otel-observability-exporter#D14 | no-change | none | Existing feature/step tier metric placement and unresolved-absence behavior are unchanged; no metric is recorded from the log listener. |
| adr-014-otel-observability-exporter#D15 | task | task-13, task-15 | The logs spooling exporter serializes and commits a complete immutable protobuf batch before acknowledging retention and before any network send; a later authorized owner over the same storage observes and delivers that payload after the first exits. |
| adr-014-otel-observability-exporter#D16 | task | task-11, task-13, task-14, task-16, task-23 | The shared runtime's log loop sends retained logs only for its current authorized lease owner and enabled matching log policy; contention/lost-ownership fixtures permit only that owner to send, and a trace/metric owner with logs disabled sends zero log requests. |
| adr-014-otel-observability-exporter#D17 | task | task-17 | Delivery health events reach the existing persisted/local render path with logs disabled for their sink and rendering capture suppressed; an induced failure episode produces zero exported health records and zero recursive send attempts. |
| adr-014-otel-observability-exporter#D18 | task | task-1, task-2, task-3, task-10, task-11, task-19, task-20, task-21 | `sendLogBatch` re-reads canonical consent before each new direct, retained or fallback request and issues none when policy is false, invalid, missing or unreadable, even if an earlier process/attempt admitted the batch; a running-sender fixture proves revocation stops the next request without asserting retraction of one already issued. |
| adr-014-otel-observability-exporter#D19 | task | task-4, task-5, task-6, task-7, task-8, task-19, task-20 | Feature-to-root plus terminal/daemon render integration emits exactly one logical remote record for one forwarded/rendered occurrence before transport retries; two separate occurrences with identical message text still produce two records. |
| adr-014-otel-observability-exporter#D20 | task | task-9, task-10, task-11, task-12, task-13, task-14, task-15, task-16, task-17, task-23 | `BoundedLogProcessor` permits at most 1,024 records and 8 MiB normalized payload including in-flight records; an overflow drops the newest record with an exact loss count and never increases admitted state beyond either cap. |
| adr-014-otel-observability-exporter#D21 | task | task-10, task-19, task-20, task-22, task-23 | Daemon and interactive owner-stop integration includes the final lifecycle diagnostic in the flush/preservation attempt, then returns within one total two-second log shutdown budget even when destination or storage never completes; it clears/unrefs log timers and prevents any late request after stop. |

## Coverage Check

Every exact criterion maps to the checks below. The quoted check is verbatim from a cited task; all checks from all cited tasks participate in the independent coverage judgment.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a valid canonical project configuration with `otel.logs.enabled: true` and an HTTP log destination, when a daemon or interactive configured run emits operational logs, then those logs can be sent to that destination using the same project policy. | 19, 20, 18 | Through the real daemon startup/run composition path, explicit true policy sends startup, step completion, final completion and source info/warn/error records through `wireOtelLogs`; absent/false policy sends zero log requests even with retained backlog, while existing local output remains available. | diff-local |
| Story 1 happy: Given a user-level log policy and a project-level override, when either mode starts from the main checkout or a linked worktree, then project values override user values and every checkout uses the canonical main project's resulting log policy. | 3 | `readLogPolicy` returns the same main-root user/project merged policy from both checkout forms, with project values overriding user values; a differing worktree-local log block cannot replace consent or destination and yields one warning naming the canonical path. | diff-local |
| Story 1 happy: Given enabled logs were previously retained, when a later invocation has the same enabled destination policy, then those retained logs are eligible for delivery. | 13 | The shared drainer attempts eligible matching-destination log batches oldest-first without a client-side age cutoff and removes each after full acceptance; an enabled later invocation with the same destination can replay previously retained logs. | diff-local |
| Story 1 negative: Given trace/metric telemetry is enabled and `otel.logs.enabled` is absent or false, when either mode runs or finds retained logs, then it sends zero log requests and leaves retained log batches unsent. | 16, 19, 20 | Absent/false log enablement leaves all retained log batches unsent; log-spool-disabled mode sends newly admitted logs directly through the common sender, leaves old batches untouched, and emits one bounded local notice identifying their presence. | diff-local |
| Story 1 negative: Given a running sender and retained batches, when the canonical log policy changes to false, becomes unreadable, or becomes invalid before the next send, then no new log request starts under that policy; already-issued requests are not claimed to be retractable. | 11 | `sendLogBatch` re-reads canonical consent before each new direct, retained or fallback request and issues none when policy is false, invalid, missing or unreadable, even if an earlier process/attempt admitted the batch; a running-sender fixture proves revocation stops the next request without asserting retraction of one already issued. | diff-local |
| Story 1 negative: Given a differing worktree-local log policy, when a run starts from that worktree, then it cannot override main-project consent or destination and one local warning names the canonical configuration path. | 3 | `readLogPolicy` returns the same main-root user/project merged policy from both checkout forms, with project values overriding user values; a differing worktree-local log block cannot replace consent or destination and yields one warning naming the canonical path. | diff-local |
| Story 1 negative: Given logs were disabled when events occurred, when logs are enabled and the run is restarted, then only newly captured events and previously authorized retained batches are eligible; disabled-time output and historical local files are not replayed. | 20 | An interactive restart after enabling previously disabled logs captures new occurrences and can send already-authorized matching retained batches but does not replay disabled-time events or historical local files. | diff-local |
| Story 2 happy: Given enabled log sending, when a configured daemon or interactive run starts, completes a step, and finishes, then the destination receives corresponding lifecycle records with consistent field meanings. | 19, 20 | Through the real daemon startup/run composition path, explicit true policy sends startup, step completion, final completion and source info/warn/error records through `wireOtelLogs`; absent/false policy sends zero log requests even with retained backlog, while existing local output remains available. | diff-local |
| Story 2 happy: Given harness info, warning and error diagnostics during either run, when they are delivered, then the messages retain their source severity and operational content. | 5, 18, 19, 20 | `createOperationalLogger` emits typed info/warn/error occurrences with original operational content and passes unchanged content to its existing local sink; emitter failure is caught and does not replace the caller's result. | diff-local |
| Story 2 happy: Given daemon-wide scheduling/recovery activity and feature-owned recovery/provider execution, when each reports an operational diagnostic, then the destination receives the daemon-wide record as project-scoped and the feature-owned record with that feature's identity. | 19 | Daemon scheduling/recovery integration sends project-wide diagnostics without feature identity and feature recovery/provider diagnostics with full source slug via root forwarding; one typed lifecycle plus its rendered line yields one logical log record. | diff-local |
| Story 2 negative: Given a configured run fails during startup or shutdown, when the harness reports the failure locally, then its diagnostic is eligible for the same bounded delivery attempt as other operational records without replacing the run's original result. | 19, 20, 23 | Daemon startup/shutdown error paths offer locally reported configured-run failures to the same bounded logging path without changing the original run result; lifecycle cleanup is finalized by Task 23. | diff-local |
| Story 2 negative: Given provider transcript chunks, raw application output, or unrelated administrative command output, when those bytes are produced, then they are not added to remote operational logs by this capability. | 6, 20 | `projectLogRecord` returns no log record for provider transcript chunks, raw application output, dashboard snapshots or unrelated administrative output; sentinel content is absent from projected batches and no arbitrary event-object serialization is used. | diff-local |
| Story 2 negative: Given an already-exported lifecycle occurrence also appears in terminal or daemon display output, when that display is rendered, then it does not produce a second logical log record. | 8, 19 | Feature-to-root plus terminal/daemon render integration emits exactly one logical remote record for one forwarded/rendered occurrence before transport retries; two separate occurrences with identical message text still produce two records. | diff-local |
| Story 3 happy: Given a valid OTLP HTTP configuration for each of Loki, an OTLP-capable Elasticsearch deployment or compatible network collector, Sumo Logic, and Datadog, when a sample log batch is sent, then its destination receives a protobuf log request at the configured base path plus exactly one `/v1/logs` suffix with the configured authentication headers. | 10 | `sendLogBatch` sends Content-Type application/x-protobuf requests for Loki, OTLP-capable Elasticsearch or its collector, Sumo Logic and Datadog fixture configurations with the configured authentication values and base path followed by exactly one /v1/logs; an already suffixed endpoint receives no second suffix. | diff-local |
| Story 3 happy: Given a destination requires a network intermediary or attribute mapping, when the intermediary receives the harness request, then the decoded record contains separately available project and complete feature identity without any file scraping or checkout access. | 10 | The common sender/serializer integration decodes separately queryable project and full feature fields at each fake destination, including the intermediary case, with no engine vendor switch, scraping or project-filesystem access. | diff-local |
| Story 3 negative: Given a destination rejects authentication with 401 or 403, when delivery is attempted, then the log batch is retained under the enabled retention policy, the build continues, and the warning exposes no credential value. | 14 | Fake 401/403, incorrect-path 404 and unavailable-intermediary integration cases retain enabled-spool batches, never redirect to another destination, let the run continue with its original result, and produce bounded safe local auth/endpoint/network warnings containing no credential value. | diff-local |
| Story 3 negative: Given an incorrect base path producing 404 or an unavailable intermediary, when delivery fails, then the batch is not redirected to another destination and the error is reported locally without failing the run. | 14 | Fake 401/403, incorrect-path 404 and unavailable-intermediary integration cases retain enabled-spool batches, never redirect to another destination, let the run continue with its original result, and produce bounded safe local auth/endpoint/network warnings containing no credential value. | diff-local |
| Story 3 negative: Given a configured endpoint already ending in `/v1/logs`, when its request is constructed, then that suffix is not appended a second time. | 10 | `sendLogBatch` sends Content-Type application/x-protobuf requests for Loki, OTLP-capable Elasticsearch or its collector, Sumo Logic and Datadog fixture configurations with the configured authentication values and base path followed by exactly one /v1/logs; an already suffixed endpoint receives no second suffix. | diff-local |
| Story 4 happy: Given a feature-owned occurrence with a slug longer than the local display limit, when its log record is received, then timestamp, severity, body, project, worker, event name, feature scope and the complete slug are independently available; its timestamp remains the occurrence time even if forwarding or delivery is delayed. | 6, 4 | `projectLogRecord` produces decoded timestamp, severity, body, project, worker, event name, conductor.scope explicitly set to feature, and complete feature slug for feature occurrences; the received sample retains source/first-emission time after delayed forwarding and includes step/attempt only when supplied. | diff-local |
| Story 4 happy: Given a project-wide occurrence and validated custom attributes, when its record is received, then it has project scope, stable project/worker resource identity and those custom attributes, and has no feature identity. | 6 | `buildResource(..., 'logs')` and `projectLogRecord` produce stable project/worker identity and validated custom attributes for project-wide records with conductor.scope explicitly set to project, omit feature identity there, and keep conductor-owned values on collision without creating or rewriting session identity files. | diff-local |
| Story 4 negative: Given a message contains ANSI formatting or text resembling a different feature's prefix, when it is exported, then structured ownership still identifies its actual source and no identity is parsed from that text. | 5 | `createOperationalLogger` leaves unowned repository-wide diagnostics project-scoped even during feature execution; ANSI or misleading prefix text never supplies identity or borrows the active/last feature. | diff-local |
| Story 4 negative: Given a custom attribute collides with a conductor-owned identity field, when a record is constructed, then it cannot replace the conductor-owned value. | 6 | `buildResource(..., 'logs')` and `projectLogRecord` produce stable project/worker identity and validated custom attributes for project-wide records with conductor.scope explicitly set to project, omit feature identity there, and keep conductor-owned values on collision without creating or rewriting session identity files. | diff-local |
| Story 4 negative: Given a message exceeds the 32 KiB UTF-8 remote body limit or a required identity cannot fit the 64 KiB record limit, when it is handled, then the body is truncated with a visible truncation attribute in the first case, or the whole record is dropped and counted in the second; full identity is never truncated and local output remains complete. | 7 | `normalizeLogRecord` caps body at 32 KiB using UTF-8-safe truncation and a visible truncation attribute, caps normalized record at 64 KiB and attributes at 64, and never shortens mandatory identity. | diff-local |
| Story 5 happy: Given two concurrent daemon features with different complete slugs but identical truncated display prefixes, when their ordinary and deferred warning/error messages interleave, then every received record retains its originating complete slug. | 5 | The diagnostic-boundary interleaving test uses two full slugs with the same shortened prefix and proves ordinary and deferred warn/error records keep their own complete slug, including A's scheduled diagnostic after A ends while B continues. | diff-local |
| Story 5 happy: Given one occurrence passes through feature handling and daemon handling, when it is exported, then exactly one logical record is produced before any transport retry. | 8 | Feature-to-root plus terminal/daemon render integration emits exactly one logical remote record for one forwarded/rendered occurrence before transport retries; two separate occurrences with identical message text still produce two records. | diff-local |
| Story 5 negative: Given a project-wide message occurs while feature execution is active, when it is delivered, then it does not inherit the active or most recently completed feature's identity. | 5 | `createOperationalLogger` leaves unowned repository-wide diagnostics project-scoped even during feature execution; ANSI or misleading prefix text never supplies identity or borrows the active/last feature. | diff-local |
| Story 5 negative: Given two legitimate occurrences have identical message text, when both occur, then both are delivered as separate logical records; text matching does not suppress either. | 8 | Feature-to-root plus terminal/daemon render integration emits exactly one logical remote record for one forwarded/rendered occurrence before transport retries; two separate occurrences with identical message text still produce two records. | diff-local |
| Story 5 negative: Given feature A finishes while feature B continues and A has already scheduled a deferred diagnostic, when that diagnostic and B's next message arrive, then each retains its original owner rather than a mutable current-feature value. | 5 | The diagnostic-boundary interleaving test uses two full slugs with the same shortened prefix and proves ordinary and deferred warn/error records keep their own complete slug, including A's scheduled diagnostic after A ends while B continues. | diff-local |
| Story 6 happy: Given the same operational occurrence sequence, when it runs with logs off or on, then existing terminal output and daemon log content retain their local prefixes, complete message content, timestamps and transition suppression. | 22 | Through the changed daemon logger and terminal subscriber boundaries, an identical sequence with logs off/on retains the exact local message/prefix/timestamp formatting, complete content and transition suppression; only intentional additional health diagnostics differ. | diff-local |
| Story 6 happy: Given daemon logs are produced during an enabled run, when the operator reads or follows them, then current log reading, following and rotation behavior continues to expose the expected local records. | 22 | Existing read/follow/rotation boundary fixtures run with log capture enabled and observe the same expected persisted and followed records, including complete retained records across rotation. | diff-local |
| Story 6 negative: Given invalid log-only configuration or a remote failure, when a run reports diagnostics, then local terminal and file output remain available and preserve the build's own messages. | 22, 21 | Malformed log configuration and failed remote sends leave terminal/file diagnostics and the build's own messages available; remote body truncation, queue overflow and retention eviction cannot shorten or suppress the original local message. | diff-local |
| Story 6 negative: Given remote record truncation, queue overflow or retention eviction, when a local message is written, then no remote limit truncates or suppresses its local version. | 22, 7 | Malformed log configuration and failed remote sends leave terminal/file diagnostics and the build's own messages available; remote body truncation, queue overflow and retention eviction cannot shorten or suppress the original local message. | diff-local |
| Story 7 happy: Given a valid trace/metric configuration, when only `otel.logs.enabled` changes, then trace and metric destination, identity, payload semantics and enablement remain unchanged. | 21 | The daemon and interactive entry-point configuration matrix toggles only log enablement and observes unchanged trace/metric destination, identity, payload semantics, temporality and enablement; no existing trace/metric contract changes to make logs work. | diff-local |
| Story 7 happy: Given traces/metrics use gRPC, file output, or are not enabled, when logs are explicitly enabled with their own HTTP endpoint, then logs can be sent over HTTP without changing those existing signal settings. | 21 | Both production wiring paths send explicitly enabled HTTP logs to their own endpoint alongside gRPC, file or disabled parent signals without changing those parent settings; malformed log-only settings instead yield a named local error and zero logs while valid traces/metrics and local output continue. | diff-local |
| Story 7 negative: Given a valid existing telemetry configuration and malformed log-only configuration, when either entry mode starts, then traces and metrics continue under their original settings while logs remain disabled with a named error. | 21 | Both production wiring paths send explicitly enabled HTTP logs to their own endpoint alongside gRPC, file or disabled parent signals without changing those parent settings; malformed log-only settings instead yield a named local error and zero logs while valid traces/metrics and local output continue. | diff-local |
| Story 7 negative: Given an unavailable log destination, when trace and metric batches are ready for healthy destinations, then their delivery progresses without waiting for log recovery. | 21 | The shared runtime/owner wiring independently schedules healthy trace/metric deliveries while the log destination is unavailable, with no wait for log recovery and no change to the build outcome. | diff-local |
| Story 7 negative: Given log retention reaches its cap, when old log batches are evicted, then trace and metric retained batches are neither removed nor charged against that log cap. | 15 | The log store enforces configured max_bytes with default 64 MiB across all retained log destinations, evicts oldest log batches with exact counts, and never evicts or charges trace/metric files against that cap. | diff-local |
| Story 8 happy: Given enabled logs below the admission limits, when operational events arrive, then build progress proceeds without waiting for network or disk completion while logs are batched for delivery. | 9, 19, 20 | `BoundedLogProcessor.onEmit` admits bounded records synchronously and returns without awaiting disk/network; a stalled fake exporter leaves its producer and subsequent event handlers unblocked. | diff-local |
| Story 8 happy: Given steady admitted traffic, when batches are formed, then each contains at most 128 records and 1 MiB of serialized request data, with a flush scheduled within one second unless an earlier delivery is still boundedly settling. | 9 | `BoundedLogProcessor` schedules flush within one second of pending traffic unless the preceding bounded attempt is settling, emits at most 128 records and 1 MiB serialized bytes per request, and splits large groups by actual serialized size away from event callbacks. | diff-local |
| Story 8 happy: Given a stalled delivery operation, when its two-second total budget expires, then that operation is cancelled or abandoned without starting a late request, and execution continues. | 12 | `sendLogBatch` enforces one two-second total budget across policy reading, credential resolution and request, cancels or abandons stalled work, and never initiates a late HTTP request after timeout. | diff-local |
| Story 8 negative: Given 1,024 records or 8 MiB of admitted normalized payload including in-flight records, when another record would exceed either limit, then the newest record is discarded and counted while admitted payload remains within both limits. | 9 | `BoundedLogProcessor` permits at most 1,024 records and 8 MiB normalized payload including in-flight records; an overflow drops the newest record with an exact loss count and never increases admitted state beyond either cap. | diff-local |
| Story 8 negative: Given many large records, when a request would exceed 1 MiB, then records are split into bounded requests; no oversized request is sent and the split work does not wait on the build's event delivery. | 9 | `BoundedLogProcessor` schedules flush within one second of pending traffic unless the preceding bounded attempt is settling, emits at most 128 records and 1 MiB serialized bytes per request, and splits large groups by actual serialized size away from event callbacks. | diff-local |
| Story 8 negative: Given a record has more than 64 attributes or exceeds the normalized record limit, when it is admitted, then a delivered record has at most 64 attributes and retains complete mandatory identity; if those required fields cannot fit, the whole record is discarded and counted. | 7 | `normalizeLogRecord` caps body at 32 KiB using UTF-8-safe truncation and a visible truncation attribute, caps normalized record at 64 KiB and attributes at 64, and never shortens mandatory identity. | diff-local |
| Story 8 negative: Given serialization, policy reading or credential resolution fails or never settles, when delivery handles the failure, then it cannot throw into the build, exceed the two-second delivery budget, or initiate a request after that attempt has ended. | 12, 9 | Thrown/rejected serialization, policy and credential operations and never-settling fake operations return safe delivery failure without escaping into the build or exceeding the attempt deadline; controlled late resolutions produce zero further requests. | diff-local |
| Story 9 happy: Given enabled default log retention and an unavailable destination, when a log batch is acknowledged as retained, then its complete durable payload exists before any send; a later invocation with matching consent can deliver it. | 13 | The logs spooling exporter serializes and commits a complete immutable protobuf batch before acknowledging retention and before any network send; a later authorized owner over the same storage observes and delivers that payload after the first exits. | diff-local |
| Story 9 happy: Given retained batches for a currently enabled destination, when that destination recovers, then batches for that destination are attempted oldest-first and removed after full acceptance; no local age limit silently skips an otherwise eligible batch. | 13 | The shared drainer attempts eligible matching-destination log batches oldest-first without a client-side age cutoff and removes each after full acceptance; an enabled later invocation with the same destination can replay previously retained logs. | diff-local |
| Story 9 happy: Given the credential value changes under the same configured reference, when a retained batch is sent, then it uses the current value and neither retained payload metadata nor health output contains that value. | 13 | The drainer resolves current environment-reference values on send, so value rotation with unchanged references is used by the next request; storage and health captures contain no secret-value sentinel. | diff-local |
| Story 9 negative: Given a destination changes after records are admitted or retained, when delivery continues, then old records are never rerouted to the new destination; already-retained records remain unsent within the log cap, while unretained mismatching records are discarded and counted. | 11 | Destination identity matching in the sender prevents any admitted/retained record from being rerouted after an endpoint or header-reference change; previously durable mismatches remain retained within the log cap, unretained mismatches are discarded/counted, and restoring the original policy makes retained records eligible. | diff-local |
| Story 9 negative: Given a full log backlog, when new retained batches exceed the configured log byte cap (64 MiB by default), then old log batches are evicted and counted within that cap, including batches for inactive destinations; other signals remain intact. | 15 | The log store enforces configured max_bytes with default 64 MiB across all retained log destinations, evicts oldest log batches with exact counts, and never evicts or charges trace/metric files against that cap. | diff-local |
| Story 9 negative: Given a write fails because log storage is full or inaccessible, when direct fallback is attempted, then it still requires current matching consent, obeys the operation budget, reports the failure, and cannot fail the build. | 15 | With disk-full and permission-denied writes, the logs spooling exporter reports a bounded preservation failure and calls the common direct sender only under current matching consent and its two-second budget; otherwise it does not send, and neither branch fails the build. | diff-local |
| Story 9 negative: Given 400, 413 or OTLP partial rejection, when a retained batch is processed, then the batch is removed and its rejection counted; given 401, 403, 404, 408, 429, 5xx or network failure, then it is retained with bounded retries and applicable Retry-After. | 14 | The logs classifier/drainer deletes/counts a batch for 400, 413 and OTLP partial rejection, deletes only after full acceptance for ordinary 2xx, and retains/backoffs for 401, 403, 404, 408, 429, 5xx and network failure while honoring Retry-After; retries are bounded to one in-flight log attempt per runtime and a two-second total budget per attempt, with retained data subject to the configured log byte cap. | diff-local |
| Story 9 negative: Given two processes contend for delivery or one loses ownership, when they attempt retained sends, then only the authorized current transport owner sends; a trace/metric owner with logs disabled sends no retained logs. | 16 | The shared runtime's log loop sends retained logs only for its current authorized lease owner and enabled matching log policy; contention/lost-ownership fixtures permit only that owner to send, and a trace/metric owner with logs disabled sends zero log requests. | diff-local |
| Story 9 negative: Given log retention is explicitly disabled with old batches present, when new logs are delivered directly, then old batches remain untouched and one bounded local notice reports their presence. | 16 | Absent/false log enablement leaves all retained log batches unsent; log-spool-disabled mode sends newly admitted logs directly through the common sender, leaves old batches untouched, and emits one bounded local notice identifying their presence. | diff-local |
| Story 10 happy: Given healthy log delivery enters a failure state, when that failure is first observed, then local output identifies logs, a sanitized destination and the actionable failure class promptly. | 17 | `LogHealth` emits a prompt first local warning naming logs, a sanitized destination and actionable failure class; subsequent failure/drop summaries aggregate exact counts at most once per 60 seconds per owner even when thousands of records fail or classes change. | diff-local |
| Story 10 happy: Given continuing failure and discarded records, when summary time advances, then warnings aggregate failure/drop counts at most once per 60 seconds per owner, and recovery is reported at most once per 60 seconds. | 17 | `LogHealth` emits a prompt first local warning naming logs, a sanitized destination and actionable failure class; subsequent failure/drop summaries aggregate exact counts at most once per 60 seconds per owner even when thousands of records fail or classes change. | diff-local |
| Story 10 negative: Given thousands of failed or discarded records and changing failure classes within a minute, when health is reported, then the owner does not emit one warning per record or bypass the aggregate rate limit by changing class. | 17 | `LogHealth` emits a prompt first local warning naming logs, a sanitized destination and actionable failure class; subsequent failure/drop summaries aggregate exact counts at most once per 60 seconds per owner even when thousands of records fail or classes change. | diff-local |
| Story 10 negative: Given delivery-health warnings are rendered and persisted, when operational logging continues, then those warnings produce no remote log records and no recursive delivery attempts. | 17, 8 | Delivery health events reach the existing persisted/local render path with logs disabled for their sink and rendering capture suppressed; an induced failure episode produces zero exported health records and zero recursive send attempts. | diff-local |
| Story 10 negative: Given an exception or backend response contains an API key, authorization header or sensitive URL path, when a warning is produced, then none of that raw material appears in local health text or retained health metadata. | 17 | Health construction selects safe fields only: credential, Authorization, sensitive URL-path and raw-response/exception sentinels are absent from local health output and retained health metadata. | diff-local |
| Story 11 happy: Given explicit true enablement and a valid existing HTTP OTLP destination, when log configuration is resolved, then logs inherit its endpoint and headers unless overridden. | 1, 10 | `resolveLogConfig` accepts explicit true with a valid HTTP OTLP parent, inherits its endpoint and header references, and lets an explicit logs endpoint replace the parent; log-config unit cases assert the exact resolved destination. | diff-local |
| Story 11 happy: Given an explicit HTTP logs endpoint and an explicit header map, when configuration is resolved, then that map replaces inherited headers, and an empty map intentionally supplies none. | 1, 10 | `resolveLogConfig` treats an explicit header map as replacement, including an empty map supplying no headers; unchanged reference objects contain no resolved secret values. | diff-local |
| Story 11 happy: Given valid log retention settings, when logs start, then the selected retention mode and positive byte limit are honored independently of other signal retention settings. | 1, 15, 16 | `resolveLogConfig` honors independent log retention enabled/disabled and positive max_bytes settings, defaults enabled-log retention to true and 67,108,864 bytes, and returns disabled for absent/false log enablement. | diff-local |
| Story 11 negative: Given a nonboolean enabled value, an unknown log option/vendor selector, malformed header reference, or invalid retention field, when either mode starts, then a local error names the invalid log setting, logs remain disabled, and valid existing signals/local output continue. | 2, 21 | `resolveLogConfig` returns invalid with a key-specific safe diagnostic for nonboolean enabled, unknown log options/vendor selectors, malformed header references, unknown retention keys, nonboolean spool.enabled and zero/negative/noninteger/nonnumber spool.max_bytes; it never coerces enablement to true and produces no sender, while the configuration-loader boundary retains valid parent telemetry and local logging inputs. | diff-local |
| Story 11 negative: Given a file/gRPC/no parent destination and no explicit HTTP log endpoint, when log sending is requested, then the error names `otel.logs.endpoint` and no log request is sent. | 2 | `resolveLogConfig` refuses requested logs when the parent uses file/gRPC or has no destination and no explicit HTTP logs endpoint is supplied: the local error names otel.logs.endpoint and zero log requests are sent. It also rejects userinfo/query/fragment/non-HTTP(S) URLs before any send and names the remedy without echoing sensitive endpoint components. | diff-local |
| Story 11 negative: Given an endpoint with userinfo, query parameters, fragments, or a non-HTTP(S) scheme, when it is configured, then logs are rejected before any send and the diagnostic does not echo sensitive endpoint content. | 2 | `resolveLogConfig` refuses requested logs when the parent uses file/gRPC or has no destination and no explicit HTTP logs endpoint is supplied: the local error names otel.logs.endpoint and zero log requests are sent. It also rejects userinfo/query/fragment/non-HTTP(S) URLs before any send and names the remedy without echoing sensitive endpoint components. | diff-local |
| Story 11 negative: Given the canonical root cannot be established or its log policy cannot be read, when logs would start or send, then logs remain unsent with a bounded local diagnostic and do not guess another project's configuration. | 3, 11 | `readLogPolicy` reports root-resolution failure, missing/unreadable configuration and invalid policy as unsendable with a bounded safe diagnostic, never guesses another root, and performs no configuration-file write. | diff-local |
| Story 12 happy: Given a normally completing configured run, when it emits its final lifecycle diagnostic and stops, then that final diagnostic participates in a log flush/preservation attempt within one total two-second log shutdown budget. | 23 | Daemon and interactive owner-stop integration includes the final lifecycle diagnostic in the flush/preservation attempt, then returns within one total two-second log shutdown budget even when destination or storage never completes; it clears/unrefs log timers and prevents any late request after stop. | diff-local |
| Story 12 happy: Given multiple active daemon features, when one finishes, then the daemon and remaining features continue delivering logs with their own attribution. | 23, 19 | Per-feature completion and local provider stop release only their own references, leaving root/other-feature logs correctly attributed and another process owner's lease/delivery intact; tests observe the remaining feature and project records after one feature ends. | diff-local |
| Story 12 happy: Given a prior run has stopped, when a later run starts in the same process, then each new occurrence is delivered once without subscriptions or identity retained from the previous run. | 23, 20 | Repeated start/stop through both entry lifecycles returns listener counts to baseline and yields one record per new occurrence without prior-run feature identity. | diff-local |
| Story 12 negative: Given pending records and a destination or storage operation that never completes, when stop occurs, then log shutdown returns within two seconds, no log-owned timer keeps the process alive, and no late request starts after shutdown. | 23 | Daemon and interactive owner-stop integration includes the final lifecycle diagnostic in the flush/preservation attempt, then returns within one total two-second log shutdown budget even when destination or storage never completes; it clears/unrefs log timers and prevents any late request after stop. | diff-local |
| Story 12 negative: Given an enabled run fails after partial initialization, when cleanup executes, then acquired logging resources and any diagnostic bridge are released exactly once while local error output and the original result are preserved. | 23 | Partial-initialization and exceptional-finally fixtures release acquired logging resources and restore the original console diagnostic bridge exactly once while retaining complete local error output and the original run result. | diff-local |
| Story 12 negative: Given a feature ends while a different process owns shared retained delivery, when its local provider stops, then it cannot terminate the other owner's delivery or release its ownership. | 23, 16 | Per-feature completion and local provider stop release only their own references, leaving root/other-feature logs correctly attributed and another process owner's lease/delivery intact; tests observe the remaining feature and project records after one feature ends. | diff-local |
| Story 12 negative: Given the process dies after a batch was durably retained but before acknowledgment/removal, when a later authorized owner starts, then that batch remains eligible for delivery; transport replay may duplicate delivery and no exactly-once guarantee is asserted. | 23 | Shared-runtime owner replacement after a durably committed batch survives loss before acknowledgment/removal and makes that batch eligible under later matching consent; replay may duplicate delivery and no test asserts crash safety for unretained memory or exactly-once network delivery. | diff-local |

## Verify-Claims Ledger

Verified against local source: `ConductorEventEmitter` awaits handler promises; event types live in `types/events.ts`; total sink routing is in `engine/event-sinks.ts`; immutable feature logging and forwarding already exist; `loadMergedConfigForRead` avoids the mutating loader; stable Resource construction has a no-session-write branch. Existing test paths and module hints were checked. APIs proposed under `engine/otel/log-*` are new implementation names, not claims of existing exports.

The spool modules are an explicit approved-but-pending prerequisite. Their exact merged API signatures are not assumed. Direct log SDK/transformer compatibility was verified in installed 0.221.0 declarations during architecture review; use the compatible dependency family at BUILD HEAD. Structural disagreement with either prerequisite returns to DECIDE; it does not authorize an alternative transport.

No new load-bearing product assumption: canonical consent, record/storage/time bounds, destination binding, shared paths and failure dispositions were explicitly approved with D18–D21. Verdict: CLEAR for planning on the stated prerequisite baseline.

## Verification

- All 72 happy and negative criteria have explicit task mappings and falsifiable checks; all 72 passed the independent coverage judgment after three rounds, including rechecking every claim whose cited checks changed. No refusal remains.
- All 23 tasks have concrete repository-relative file sets, 2–5 single-line Done-when checks, and explicit acyclic dependencies.
- Every changed production boundary has one integration-proof owner; no task asks BUILD to amend another feature's DECIDE artifacts.
- No test, implementation, aggregate verifier, live vendor request, or build was run while authoring this specification.

## Independent Coverage Judgment

A fresh subagent judged all 72 criterion/check claims under plan §7a. Round 1 found three missing assertions; round 2 checked all ten claims affected by the corrections and identified two further precision gaps. Round 3 checked all seven claims affected by those changes and returned asserts for every one. Final result: 72/72 asserted, zero refusals. Only task checks were strengthened; accepted criteria were unchanged. The supplied evidence was limited to exact criteria and cited Done-when checks.

## Advisory Overlap Scan

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/config.ts, src/conductor/src/types/config.ts
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/daemon-cli.ts
Open blocker: jstoup111/ai-conductor#2870
Note: renames or name-only diffs may not be detected by this scan.
```

This is advisory; the prerequisite remains the explicit #2870 dependency above.

Mechanical authoring validation: the repository's production artifact parsers recognized 23 tasks, 72 criteria/coverage rows and 21 ADR decisions. Criterion grounding, story coverage, coverage-table consistency and architecture-obligation checks passed. `ai-conductor plan-protected-targets` reported no violations. These are artifact checks, not behavioral test results.

Coherence follow-up: the additive Task 16 disabled-backlog notice was independently rechecked against all five affected criterion claims; every claim returned asserts. Production plan and coherence validators passed after the amendment.
