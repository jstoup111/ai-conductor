# Implementation Plan: Engine updates reach dispatched features without a full daemon drain (#2392)

**Date:** 2026-10-15
**Design:** .docs/decisions/adr-2026-10-15-per-dispatch-engine-pinned-executor.md (technical track; no PRD)
**Stories:** .docs/stories/engine-updates-reach-dispatched-features-only-afte.md
**Conflict check:** Clean as of 2026-10-15
**Scope-exception:** The operator declined the proposed three-spec split on 2026-10-15 and chose one spec (adr-2026-10-15-per-dispatch-engine-pinned-executor D10); the executor move, the per-dispatch pin and the restart policy only deliver #2392 together.

## Summary

Move each daemon feature dispatch into a child executor process pinned to the immutable engine build that `dist` names at claim time, broker the dispatcher-owned services across the process boundary, rebuild on a cadence while busy, restart the stale supervisor at a natural idle with an age-capped drain fallback, and record and display each feature engine version. 31 tasks.

## Technical Approach

- Protocol first (Task 1): a closed, versioned `ExecutorMessage` union with validation. Every later piece speaks it.
- Pin and order (Tasks 2-3): `resolveEnginePin` turns the floating `dist` symlink into an immutable `dist-versions/<id>` at claim, with a supervisor-build fallback; the WorkOrder carries `engineVersionId` and `schemaVersion`.
- Broker (Tasks 8-13): `createExecutorBroker` on the supervisor side owns request handlers backed by the EXISTING `rateLimitEpisode`, `providerAvailability`, `liveBoundaryCoordinator` and `worktreeLifecycle` instances built in `daemon-cli.ts`; `executor-proxies.ts` gives the child objects with the same APIs, so `runConductorInWorktree` and `makeRunFeature` take them where they take the real instances today. Pattern: keep each proxy signature identical to the in-process object it replaces, including synchronous methods (search `rate-limit-episode.ts`, `provider-availability.ts`, `LiveBoundaryCoordinator`, `WorktreeLifecycleQueue`). Synchronous reads (`active`, `nextWaitSeconds`, `isAvailable`) are served from a local replica that the supervisor keeps current by broadcasting state on every change and after each accepted hello; only already-async methods become requests.
- Event spine (Tasks 7, 12, 13): the child is the single writer of its feature ledger (event-spine exceptions A and B); feature events are re-emitted on a supervisor proxy feature bus carrying the existing renderer and OTel wiring from `beginFeatureRun`; the supervisor alone emits `feature_dispatch_started`/`feature_dispatch_ended`. Pattern source for re-emission: the single-writer sibling ledger of adr-2026-08-08-pipeline-owned-closeout-timestamps (same schema, re-emitted on the live bus).
- Child and adapter (Tasks 14-20): `executor-child.ts` behind a hidden `executor-child` subcommand; `child-feature-executor.ts` forks `<engineDir>/index.js` with `child_process.fork`, runs the handshake, sends the WorkOrder, writes executor records, and collects outcomes into the existing `FeatureExecutionOutcome`. Tests mock the fork boundary and assert it is reached before any process is created (repository test-isolation rule).
- Wiring (Task 21) selects the adapter by `executor_isolation`; Task 30 proves child/in-process parity.
- Restart and cadence (Tasks 25-29): a staleness tracker measured from first staleness, natural-idle restart replacing the drained stale-engine gate in `daemon.ts`, age-cap and mismatch drains, and the rebuild moved into the single-flight maintenance job under `coordinatedRootMutation`. Tasks 26 and 28 also flip the tests of shipped criteria that this change replaced (`daemon-serial-equivalence`, single-repo concurrency acceptance, stale-engine origin-advance acceptance).
- Background job on this base: the single-flight job is the existing `startRefresh`/`refreshJob` in `runDaemon` (`daemon.ts`); Tasks 28-29 extend it. If #1174 reshapes that job before BUILD, the rebuild moves with it (architecture review condition 3).

## Prerequisites

- None beyond the existing engine store (`dist-versions/`, `dist` symlink) and the WorkOrder seam.

## Tasks

### Task 1: Executor protocol message union and validation
**Story:** Story 3, Story 7
**Type:** infrastructure

**Steps:**
1. Write failing tests in `executor-protocol.test.ts` for `parseExecutorMessage`: a well-formed hello, work-order, event, log, request, response, stop and outcome message each parse to their discriminated kind; a hello missing `protocolVersion` or carrying a non-numeric one, and an event message whose payload is not valid JSON, each return a typed `malformed` result naming the defect instead of throwing.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/executor-protocol.ts`: export `EXECUTOR_PROTOCOL_VERSION` (integer), the closed `ExecutorMessage` union (kinds `hello`, `work-order`, `event` with scope `feature` or `root`, `log`, `request`, `response`, `stop`, `outcome`), and `parseExecutorMessage(raw)` returning `{ kind: "ok", message }` or `{ kind: "malformed", reason }`. Event payloads carry a `ConductorEvent` object unchanged; an unknown `type` is still `ok` (ADR D4).
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): versioned executor protocol message union"

**Done when:**
- [test] `parseExecutorMessage` returns `ok` with the correct discriminated kind for each of the eight message kinds, as asserted by the round-trip test.
- [test] `parseExecutorMessage` returns `malformed` naming the defect for a hello missing `protocolVersion`, a hello with a non-numeric `protocolVersion`, and an event payload that is not valid JSON, and never throws.
- [test] An event message whose `ConductorEvent.type` is not in the union parses as `ok` with the payload unchanged.

**Files likely touched:**
- `src/conductor/src/engine/executor-protocol.ts`
- `src/conductor/test/engine/executor-protocol.test.ts`

**Dependencies:** none

### Task 2: Engine pin resolver with supervisor-build fallback
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `engine-pin.test.ts` for `resolveEnginePin({ conductorRoot, storeRoot, ownEngineDir })` over temp engine stores, including one whose `storeRoot` is an external `AI_CONDUCTOR_ENGINE_STORE` directory separate from `conductorRoot`: `dist` -> `dist-versions/v2` resolves to `{ engineVersionId: v2, engineDir: <realpath of v2>, fallbackReason: undefined }`; a dangling `dist` symlink, a present `.publish-incomplete` sentinel, and a `dist` target whose name fails `versionIdFromEngineDir` each resolve to the supervisor own engine dir and version with `fallbackReason` set to `dangling-dist`, `publish-incomplete` and `unparseable-version-id` respectively.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/engine-pin.ts` taking `conductorRoot` (whose `dist` symlink `currentTarget` reads) and `storeRoot` (from `resolveEngineStoreRoot`, which may be external) as distinct inputs, using the existing `currentTarget` (engine-store.ts) and `versionIdFromEngineDir` (engine-version-id.ts); never return an unparseable id.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): resolve per-dispatch engine pin"

**Done when:**
- [test] `resolveEnginePin` returns the realpath of the v2 version directory and `engineVersionId` v2 when `<conductorRoot>/dist` points at v2, both for the default store and for an external `storeRoot` separate from `conductorRoot`.
- [test] `resolveEnginePin` returns the supervisor own engine dir with `fallbackReason` `dangling-dist`, `publish-incomplete`, or `unparseable-version-id` for each of those three store fixtures, and never returns the partially published target.
- [test] No result of `resolveEnginePin` carries an `engineVersionId` that fails `versionIdFromEngineDir`, asserted across all fixtures.

**Files likely touched:**
- `src/conductor/src/engine/engine-pin.ts`
- `src/conductor/test/engine/engine-pin.test.ts`

**Dependencies:** none

### Task 3: WorkOrder carries engineVersionId and schemaVersion
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `work-order.test.ts`: `buildWorkOrder` given a resolved pin produces an order whose `engineVersionId` equals the pin and whose `schemaVersion` equals the exported `WORK_ORDER_SCHEMA_VERSION`; the order survives `JSON.parse(JSON.stringify(order))` unchanged; `verifyWorkOrder` rejects an order whose `schemaVersion` differs or whose `engineVersionId` fails `versionIdFromEngineDir`.
2. Verify the tests fail (RED).
3. Implement the two fields in `src/conductor/src/engine/work-order.ts` and pass the pin from `createWorkOrder` in `src/conductor/src/daemon-cli.ts`, calling `resolveEnginePin` (Task 2) at claim time. Migrate the typed WorkOrder fixtures in `feature-executor.test.ts`, `daemon-maintenance.test.ts` and `park-dispatch-enumeration.test.ts` to carry both fields, and pass a resolved pin in the direct `buildWorkOrder` call of `daemon-deps.test.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): pin engine version in the WorkOrder"

**Done when:**
- [test] `buildWorkOrder` sets `engineVersionId` to the claim-time pin and `schemaVersion` to `WORK_ORDER_SCHEMA_VERSION`, and the order is unchanged by a JSON round trip.
- [test] `verifyWorkOrder` rejects an order with a different `schemaVersion` or an unparseable `engineVersionId`.
- `createWorkOrder` in daemon-cli.ts calls `resolveEnginePin` once per claim, so every claim resolves the current `dist` target rather than reusing an earlier dispatch pin.
- The typed WorkOrder fixtures in `feature-executor.test.ts`, `daemon-maintenance.test.ts` and `park-dispatch-enumeration.test.ts` carry `engineVersionId` and `schemaVersion`, the direct `buildWorkOrder` call in `daemon-deps.test.ts` passes a resolved pin, and `npm run typecheck:test` in `src/conductor` reports no WorkOrder type error.

**Files likely touched:**
- `src/conductor/src/engine/work-order.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/work-order.test.ts`
- `src/conductor/test/engine/feature-executor.test.ts`
- `src/conductor/test/engine/daemon-maintenance.test.ts`
- `src/conductor/test/engine/park-dispatch-enumeration.test.ts`
- `src/conductor/test/engine/daemon-deps.test.ts`

**Dependencies:** Task 2

### Task 4: Config keys executor_isolation and supervisor_max_stale_hours
**Story:** Story 11, Story 15
**Type:** infrastructure

**Steps:**
1. Write failing tests in `config.test.ts`: no `executor_isolation` key yields `child`; `in-process` and `child` parse; any other value throws a config error whose message names `executor_isolation` and the allowed values `child` and `in-process`. `supervisor_max_stale_hours` absent yields 24; zero, negative, and non-numeric values produce a config warning naming `supervisor_max_stale_hours` and the default 24, and resolve to 24.
2. Verify the tests fail (RED).
3. Implement the keys in `src/conductor/src/types/config.ts` and `src/conductor/src/engine/config.ts`, add both to `templates/project-config.yml.template`, and register both in `src/conductor/test/engine/config-consumer-registry.ts` with their consumers (Tasks 21 and 25) and their user-level/self-host classification.
4. Verify the tests pass (GREEN).
5. Commit: "feat(config): executor_isolation and supervisor_max_stale_hours"

**Done when:**
- [test] The config loader resolves a missing `executor_isolation` to `child`, accepts `child` and `in-process`, and throws for any other value with a message naming `executor_isolation` and the allowed values `child` and `in-process`.
- [test] The config loader resolves a missing `supervisor_max_stale_hours` to 24 and, for zero, negative, or non-numeric values, emits a warning naming `supervisor_max_stale_hours` and the default and resolves to 24.
- [test] The config consumer registry test passes with both keys registered to their production consumers.

**Files likely touched:**
- `src/conductor/src/types/config.ts`
- `src/conductor/src/engine/config.ts`
- `templates/project-config.yml.template`
- `src/conductor/test/engine/config-consumer-registry.ts`
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** none

### Task 5: Executor reference records with boot sweep and successor takeover
**Story:** Story 2, Story 9
**Type:** infrastructure

**Steps:**
1. Write failing tests in `executor-records.test.ts` (mock the process boundary: pid liveness, cmdline read and kill are injected): `writeExecutorRecord` writes `.daemon/executors/<slug>.json` with `{pid, engineDir, engineVersionId, startedAt}` via temp file plus rename; `removeExecutorRecord` deletes it; `listExecutorRecords` returns parsed records and a typed `unreadable` entry for a corrupt file; `sweepExecutorRecordsOnBoot` removes records whose pid is dead, and for a record whose pid is alive and whose cmdline matches the recorded executor entrypoint it kills that pid and removes the record; a live pid whose cmdline does not match is left unkilled and its record removed.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/executor-records.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): executor reference records"

**Done when:**
- [test] `writeExecutorRecord` and `removeExecutorRecord` create and delete `.daemon/executors/<slug>.json` with the four fields, written atomically by temp file plus rename.
- [test] `sweepExecutorRecordsOnBoot` removes every dead-pid record so it no longer appears in `listExecutorRecords`.
- [test] `sweepExecutorRecordsOnBoot` kills a live pid only after its cmdline matches the recorded executor entrypoint, then removes that record; a live pid with a non-matching cmdline is never killed.
- [test] `listExecutorRecords` reports a corrupt record as `unreadable` instead of throwing.

**Files likely touched:**
- `src/conductor/src/engine/executor-records.ts`
- `src/conductor/test/engine/executor-records.test.ts`

**Dependencies:** none

### Task 6: GC protects engine versions pinned by live executors
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `engine-store-gc.test.ts`: with `dist` on v3 and an executor record naming v1, `gcVersions` retains v1 even when v1 is outside keep-last-K and older than min-age; after the record is removed, the same pass deletes v1; an unreadable executor record aborts the pass with zero deletions.
2. Verify the tests fail (RED).
3. Extend `readLiveReferencedVersionIds` in `src/conductor/src/engine/engine-store.ts` to read each registered repo `.daemon/executors/` via `listExecutorRecords` (Task 5) alongside the pidfile, with the same fail-closed rule for `unreadable`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(gc): protect executor-pinned engine versions"

**Done when:**
- [test] `gcVersions` retains a version named only by a live executor record while `dist` points elsewhere, as asserted by the executor-pin GC test.
- [test] `gcVersions` deletes that version once its executor record is removed and it falls outside keep-last-K and min-age.
- [test] An unreadable executor record makes `gcVersions` abort the whole pass with zero deletions.

**Files likely touched:**
- `src/conductor/src/engine/engine-store.ts`
- `src/conductor/test/engine/engine-store-gc.test.ts`

**Dependencies:** Task 5

### Task 7: executor_started event and feature_dispatch_started.engineVersionId
**Story:** Story 13
**Type:** infrastructure

**Steps:**
1. Write failing tests: `executor_started` with `slug`, `engineVersionId`, `protocolVersion` and `supervisorEngineVersionId` is a `ConductorEvent` with a sink declaration in `event-sinks.ts` (feature ledger plus daemon.log render); `feature_dispatch_started` accepts optional `engineVersionId` and `pinFallbackReason`; a `.daemon/events.jsonl` fixture written before this change parses through the existing ledger reader with `engineVersionId` undefined.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/types/events.ts` and `src/conductor/src/engine/event-sinks.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(events): executor_started and dispatch engine version"

**Done when:**
- [test] The `ConductorEvent` union includes `executor_started` with the four fields, and the event-sink exhaustiveness test passes with its sink declaration.
- [test] `feature_dispatch_started` carries optional `engineVersionId` and `pinFallbackReason`, and the legacy `.daemon/events.jsonl` fixture without it parses through the daemon ledger reader with `engineVersionId` undefined.

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/engine/daemon-ledger-readers.test.ts`

**Dependencies:** none

### Task 8: Broker the rate-limit episode across processes
**Story:** Story 4, Story 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `executor-broker.test.ts` with two in-memory child proxies over a fake channel pair: proxy A `enter(deadline)` makes the supervisor single `RateLimitEpisode` active so `episode.active()` is true and the claim loop gate reads it; the supervisor broadcasts an episode snapshot (deadline and escalation counter) to every child, so proxy B synchronous `active()` and `nextWaitSeconds()` answer from its local replica without a round trip and match the supervisor after the broadcast is delivered; proxy B `clear(signal)` resolves only when that same episode clears; a supervisor `abortAll()` (shutdown) rejects B pending clear with an abort, and closing B channel rejects its pending clear.
2. Verify the tests fail (RED).
3. Implement `createExecutorBroker` in `src/conductor/src/engine/executor-broker.ts` with the rate-limit request handlers backed by the existing episode, and the child-side `createRateLimitEpisodeProxy` in `src/conductor/src/engine/executor-proxies.ts` with the same synchronous signatures as `rate-limit-episode.ts` (`enter`, `active`, `nextWaitSeconds` synchronous over a supervisor-broadcast replica; `clear` asynchronous over a request). The child receives the current snapshot right after its hello is accepted.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): broker rate-limit episode"

**Done when:**
- [test] A rate-limit `enter` from child proxy A makes the supervisor single `RateLimitEpisode` report `active()` true, so the claim-loop pick gate claims no new feature, as asserted by the broker test.
- [test] Child proxy B `clear` resolves only when the same supervisor episode clears, not before, and B synchronous `active()` returns true from its replica once the supervisor snapshot broadcast is delivered.
- [test] Supervisor shutdown and B channel disconnect each reject B pending `clear` with an abort, so the waiter returns to its shutdown path instead of hanging.

**Files likely touched:**
- `src/conductor/src/engine/executor-broker.ts`
- `src/conductor/src/engine/executor-proxies.ts`
- `src/conductor/test/engine/executor-broker.test.ts`

**Dependencies:** Task 1

### Task 9: Broker provider suppression and availability
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `executor-broker.test.ts`: `createProviderAvailabilityProxy` keeps the synchronous `ProviderAvailability` interface (`suppress(provider, untilMs): void`, `isAvailable(provider): boolean`); proxy A `suppress(provider, deadline)` updates its local replica at once and sends the suppression to the supervisor, which records it in the shared `providerAvailability` and broadcasts the window to every child, so proxy B synchronous `isAvailable` returns false until the deadline and true after; a child launched after the suppression receives the window in its post-hello snapshot; the broker handler records and broadcasts the window but emits no event, while the child `onProviderSuppressed` callback event, forwarded as a root event through Task 12, is persisted to `.daemon/events.jsonl` exactly once per suppression.
2. Verify the tests fail (RED).
3. Add the provider-availability suppress handler and window broadcast to `createExecutorBroker`, backed by the existing shared `providerAvailability`, and `createProviderAvailabilityProxy` in `executor-proxies.ts` whose `isAvailable` reads only its local replica, so `provider-execution.ts` keeps its synchronous `isAvailable(providerKey) === false` check unchanged.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): broker provider availability"

**Done when:**
- [test] A suppression from child proxy A makes child proxy B synchronous `isAvailable` return false until the deadline and true after it, once the supervisor broadcast is delivered, and a child launched later receives the window in its snapshot.
- [test] `createProviderAvailabilityProxy` satisfies the `ProviderAvailability` interface with a synchronous `isAvailable` that returns a boolean, never a Promise.
- [test] One brokered suppression yields exactly one `provider_suppressed` in `.daemon/events.jsonl`: the child callback event forwarded as a root event, with no event emitted by the broker handler.

**Files likely touched:**
- `src/conductor/src/engine/executor-broker.ts`
- `src/conductor/src/engine/executor-proxies.ts`
- `src/conductor/test/engine/executor-broker.test.ts`

**Dependencies:** Tasks 8, 12

### Task 10: Broker live-boundary windows and root mutations
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `executor-broker.test.ts` with a real `LiveBoundaryCoordinator`: a child proxy holding an open window makes a supervisor `runMutation` wait until the proxy closes it; a window requested while a mutation runs opens only after the mutation resolves; closing the child channel closes every window it held so a queued mutation proceeds; a broker built without a coordinator (non-self-host) answers no live-boundary requests and the child proxy is the no-op used today.
2. Verify the tests fail (RED).
3. Add `runDispatch`, `openWindow` and `close` handlers to `createExecutorBroker` backed by the existing `liveBoundaryCoordinator`, plus `createLiveBoundaryProxy` in `executor-proxies.ts`; track windows per channel and close them on disconnect.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): broker live-boundary windows"

**Done when:**
- [test] A supervisor `runMutation` does not start while a child proxy window is open and starts after `close`, as asserted by the ordering test.
- [test] A child window requested during a running mutation opens only after the mutation resolves.
- [test] Disconnecting a child channel closes every window it held, and a queued mutation then proceeds.
- [test] With no coordinator (non-self-host), no live-boundary request is sent and no window is opened.

**Files likely touched:**
- `src/conductor/src/engine/executor-broker.ts`
- `src/conductor/src/engine/executor-proxies.ts`
- `src/conductor/test/engine/executor-broker.test.ts`

**Dependencies:** Task 8

### Task 11: Broker the worktree lifecycle lock
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `executor-broker.test.ts` with the real `WorktreeLifecycleQueue`: two child proxies requesting the lock at once run their critical sections one after the other; a proxy request made while a supervisor-side sweep holds the queue waits for its release; disconnecting a holding child releases the lock and the next waiter proceeds; a pending request at supervisor shutdown is rejected.
2. Verify the tests fail (RED).
3. Add lock acquire/release handlers to `createExecutorBroker` over the existing `worktreeLifecycle` queue, and `createWorktreeLifecycleProxy` in `executor-proxies.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): broker worktree lifecycle lock"

**Done when:**
- [test] Two child proxies never hold the worktree lifecycle lock at the same time, and a child waits while a supervisor sweep holds it.
- [test] A child that disconnects while holding the lock releases it and the next waiter proceeds.
- [test] A lock request pending at supervisor shutdown is rejected so the child takes its shutdown path.

**Files likely touched:**
- `src/conductor/src/engine/executor-broker.ts`
- `src/conductor/src/engine/executor-proxies.ts`
- `src/conductor/test/engine/executor-broker.test.ts`

**Dependencies:** Task 8

### Task 12: Forward executor events to a supervisor proxy feature bus
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `executor-event-forwarding.test.ts`: feature-scoped event messages are re-emitted on a per-executor proxy feature bus to which the existing per-feature daemon.log renderer is attached, producing lines tagged with the slug; the supervisor attaches no `EventPersister` to that bus, so the feature ledger file receives no supervisor write; root-scoped messages (`feature_shipped`, `provider_suppressed`) are emitted on the root bus and persisted to `.daemon/events.jsonl`; an unknown event type is accepted, not rendered and not persisted; a malformed event message is logged and dropped while later messages still flow.
2. Verify the tests fail (RED).
3. Export from `src/conductor/src/engine/event-persister.ts` a factory for the existing private `ForwardingEventEmitter` that takes no persister, so the forwarded-from-feature markers read by `isForwardedFromFeature` and `forwardedFeatureOf` are set exactly as for in-process features; use it as the per-executor proxy feature bus in `attachExecutorEventForwarding` in `src/conductor/src/engine/executor-broker.ts`, reusing `featureLogFor(slug)` and the per-feature renderer wiring from `beginFeatureRun` in `src/conductor/src/daemon-cli.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): forward executor events to the supervisor"

**Done when:**
- [test] A forwarded feature event is rendered by the per-feature daemon.log renderer with the feature slug, and the supervisor writes nothing to that feature `.pipeline/events.jsonl`.
- [test] A forwarded `feature_shipped` root event is emitted on the root bus and persisted to `.daemon/events.jsonl`, and a forwarded feature event reaches root-bus listeners with `isForwardedFromFeature` true and `forwardedFeatureOf` equal to the slug.
- [test] A forwarded unknown event type is accepted without throwing and is neither rendered nor persisted by the supervisor.
- [test] A malformed event message is logged and dropped, and the next well-formed message from the same executor is still rendered.

**Files likely touched:**
- `src/conductor/src/engine/executor-broker.ts`
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/executor-event-forwarding.test.ts`

**Dependencies:** Tasks 7, 8

### Task 13: Forward executor log lines with slug attribution
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `executor-event-forwarding.test.ts`: a child `log` message and a forwarded child `console.warn` line reach the daemon.log sink through `featureLogFor(slug)` tagged with the slug.
2. Verify the tests fail (RED).
3. Add the `log` handler to the broker and a child-side console tee in `executor-proxies.ts` that sends `log` messages.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): forward executor logs"

**Done when:**
- [test] A child feature log line and a child `console.warn` line both appear in the daemon.log sink tagged with the feature slug.
- [test] The child console tee sends each line as one `log` message and writes nothing to the supervisor console directly.

**Files likely touched:**
- `src/conductor/src/engine/executor-broker.ts`
- `src/conductor/src/engine/executor-proxies.ts`
- `src/conductor/test/engine/executor-event-forwarding.test.ts`

**Dependencies:** Task 8

### Task 14: Executor child entrypoint
**Story:** Story 1, Story 10, Story 13
**Type:** happy-path

**Steps:**
1. Write failing tests in `executor-child.test.ts` driving `runExecutorChild(channel)` over a fake channel with stubbed `makeRunFeature`: it sends `hello` with `EXECUTOR_PROTOCOL_VERSION` and its own `engineVersionId` before anything else; after a `work-order` message it passes the order to the existing `createWorktree` seam of `daemon-deps.ts`, which still runs `verifyWorkOrder` before `ensureWorktree` and cuts the worktree from the pinned base under the lifecycle proxy, and only after that returns writes `.pipeline/work-order.json`; it emits `executor_started` with `slug`, `engineVersionId`, `protocolVersion` and `supervisorEngineVersionId` into its own feature ledger through its own `EventPersister`; it runs the feature with the brokered proxies of Tasks 8-13 and sends exactly one `outcome`.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/executor-child.ts` and register a hidden `executor-child` subcommand in `src/conductor/src/index.ts`; the child command line is `node <engineDir>/index.js executor-child` and never contains `daemon --continuous`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): child executor entrypoint"

**Done when:**
- [test] `runExecutorChild` sends `hello` first, runs the existing pre-creation `verifyWorkOrder` and pinned-base worktree creation of `daemon-deps.ts` `createWorktree`, and writes `.pipeline/work-order.json` only after the worktree exists, with nothing written under `.worktrees/<slug>` before the work-order message.
- [test] `runExecutorChild` appends one `executor_started` event carrying `slug`, `engineVersionId`, `protocolVersion` and `supervisorEngineVersionId` to the feature `.pipeline/events.jsonl`.
- [test] `runExecutorChild` runs the feature with the brokered rate-limit, availability, live-boundary and lifecycle proxies and sends exactly one `outcome` message.
- [test] The executor launch command line built for the child does not contain `daemon --continuous`, so the single-generation process pattern in `daemon-tmux.ts` cannot match it.
- [test] `runExecutorChild` appends every feature event it emits, including a type absent from the supervisor union, to the feature `.pipeline/events.jsonl` through its own `EventPersister`, and after the child is killed mid-run every complete line of that ledger parses and none was written by the supervisor.

**Files likely touched:**
- `src/conductor/src/engine/executor-child.ts`
- `src/conductor/src/index.ts`
- `src/conductor/test/engine/executor-child.test.ts`

**Dependencies:** Tasks 1, 3, 7, 8, 9, 10, 11, 12, 13

### Task 15: Executor child shutdown on stop request and disconnect
**Story:** Story 4, Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `executor-child.test.ts`: a `stop` message aborts the child pending rate-limit waits and sets `conductor.shutdownRequested`, so the run returns at its next shutdown boundary; a channel `disconnect` takes the same path and the child exits; an operator park marker for the slug still terminates the run as `parked` through the existing file-based park boundary.
2. Verify the tests fail (RED).
3. Implement the handlers in `executor-child.ts`, reusing `closeOpenExecutionsForShutdown` and the abort-signal registry of `runConductorInWorktree`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): child shutdown path"

**Done when:**
- [test] A `stop` message aborts the child pending rate-limit waits and the run returns at its next shutdown boundary.
- [test] A channel disconnect makes the child take the same shutdown path and exit, leaving its `.pipeline/` state for a later dispatch to resume.
- [test] An operator park marker terminates a child-mode run with outcome `parked`.

**Files likely touched:**
- `src/conductor/src/engine/executor-child.ts`
- `src/conductor/test/engine/executor-child.test.ts`

**Dependencies:** Task 14

### Task 16: Legacy-branch concurrency refusal in child mode
**Story:** Story 10
**Type:** negative-path

**Steps:**
1. Write a failing test in `executor-child.test.ts`: a work-order message carrying `effectiveConcurrency: 2` and a dispatch that would take the legacy no-`providerExecution` branch is refused fail-closed with the existing logged reason, exactly as `runConductorInWorktree` refuses it in-process.
2. Verify the test fails (RED).
3. Carry the supervisor effective concurrency in the work-order message and pass it to the existing guard in the child.
4. Verify the test passes (GREEN).
5. Commit: "fix(executor): keep legacy-branch refusal in child mode"

**Done when:**
- [test] In child mode, a legacy no-`providerExecution` dispatch with supervisor effective concurrency 2 is refused fail-closed with the existing reason naming the branch and the concurrency conflict.
- The work-order message type in `executor-protocol.ts` carries `effectiveConcurrency`, and `runExecutorChild` passes it to the existing guard.

**Files likely touched:**
- `src/conductor/src/engine/executor-child.ts`
- `src/conductor/src/engine/executor-protocol.ts`
- `src/conductor/test/engine/executor-child.test.ts`

**Dependencies:** Task 14

### Task 17: Child-process feature executor: launch, handshake and records
**Story:** Story 1, Story 2, Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `child-feature-executor.test.ts` with the fork boundary mocked (assert the mocked `fork` is reached with the expected module path before any process is created): `execute(order)` forks `<pinned engineDir>/index.js executor-child`, never a path through `dist`; on a hello with an equal protocol version it sends the WorkOrder and writes the executor record; the record is removed when the child exits.
2. Verify the tests fail (RED).
3. Implement `createChildProcessFeatureExecutor` in `src/conductor/src/engine/child-feature-executor.ts` using `child_process.fork`, the broker of Tasks 8-13, and `writeExecutorRecord`/`removeExecutorRecord` (Task 5).
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): child-process feature executor"

**Done when:**
- [test] `createChildProcessFeatureExecutor` forks the realpath `dist-versions/<id>/index.js` named by `order.engineVersionId`, never a path through the `dist` symlink, so a later `dist` flip cannot change the running child module path and every step and verdict of that dispatch runs the pinned build.
- [test] On a hello whose protocol version equals the supervisor own, the adapter sends the WorkOrder and writes `.daemon/executors/<slug>.json`, and removes that record when the child exits.
- [test] Two consecutive `execute` calls with orders pinned to v1 and v2 fork two different `dist-versions` directories while the first child is still running.

**Files likely touched:**
- `src/conductor/src/engine/child-feature-executor.ts`
- `src/conductor/test/engine/child-feature-executor.test.ts`

**Dependencies:** Tasks 2, 3, 5, 14

### Task 18: Handshake failures relaunch on the supervisor build
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `child-feature-executor.test.ts`: a mismatched protocol version terminates the child before any work-order message, relaunches the same dispatch from the supervisor own engine dir, emits an executor protocol mismatch event, and reports `restartRequested: true` only when the stale-engine gates are armed; a malformed hello follows the same relaunch path; no hello within `dispatchStartTimeoutSeconds` kills the child and returns outcome `error` with reason naming the missing handshake; a relaunch whose handshake also fails returns `error` naming both failures and forks no third process.
2. Verify the tests fail (RED).
3. Implement the handshake state machine in `child-feature-executor.ts`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): handshake failure handling"

**Done when:**
- [test] A protocol mismatch or a malformed hello terminates the child before any work-order message and relaunches the dispatch from the supervisor own engine dir, emitting a protocol mismatch event.
- [test] The mismatch sets the supervisor restart reason to protocol mismatch when the stale-engine gates are armed and requests no restart when they are not.
- [test] A missing hello within the dispatch start timeout kills the child and yields outcome `error` naming the missing handshake, and the claim is released.
- [test] A failed relaunch handshake yields outcome `error` naming both failures, and `fork` is called exactly twice.

**Files likely touched:**
- `src/conductor/src/engine/child-feature-executor.ts`
- `src/conductor/test/engine/child-feature-executor.test.ts`

**Dependencies:** Task 17

### Task 19: Collect child outcomes and own dispatch events
**Story:** Story 7, Story 8, Story 10
**Type:** negative-path

**Steps:**
1. Write failing tests in `child-feature-executor.test.ts`: the adapter emits `feature_dispatch_started` with `engineVersionId` (and `pinFallbackReason` when Task 2 fell back) at launch and exactly one `feature_dispatch_ended` at collection; a received `outcome` is returned as the `FeatureExecutionOutcome` with its terminal effects; a child exiting non-zero without an outcome yields `error` naming the exit code and signal; a child that sends an outcome and does not exit is killed after the teardown budget and the received outcome is returned; a second outcome is ignored and logged; a child killed by V8 heap exhaustion yields `error` naming heap exhaustion; a crash before outcome still yields exactly one `feature_dispatch_ended`.
2. Verify the tests fail (RED).
3. Implement collection in `child-feature-executor.ts`, moving `feature_dispatch_started`/`feature_dispatch_ended` emission for child mode from `makeRunFeature` in `src/conductor/src/engine/daemon-runner.ts` to the adapter.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): child outcome collection"

**Done when:**
- [test] For every child-mode dispatch the adapter itself, never a forwarded child event, emits exactly one `feature_dispatch_started` carrying `engineVersionId`, plus `pinFallbackReason` when the pin fell back, at launch, persisted to `.daemon/events.jsonl` where it remains after the feature worktree is removed, and exactly one `feature_dispatch_ended` at collection, including when the child crashes before sending an outcome.
- [test] A child exit without an outcome yields `error` whose reason names the exit code and signal, and a V8 heap-exhaustion exit yields `error` naming heap exhaustion.
- [test] A child that sends an outcome and hangs is killed after the teardown budget, and the already-received outcome is returned.
- [test] A second outcome message is ignored and logged, so the returned outcome and its terminal effects are the first one only.
- [test] Two dispatches of the same slug pinned to v1 then v2 each emit their own `feature_dispatch_started` carrying their own `engineVersionId`, and neither overwrites the other in `.daemon/events.jsonl`.

**Files likely touched:**
- `src/conductor/src/engine/child-feature-executor.ts`
- `src/conductor/src/engine/daemon-runner.ts`
- `src/conductor/test/engine/child-feature-executor.test.ts`

**Dependencies:** Task 17

### Task 20: Supervisor SIGTERM fans out stop to children
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `child-feature-executor.test.ts` with mocked children: `stopAll()` sends a `stop` message to every live child; a child still alive when the scaled teardown budget expires is killed before the adapter reports stop complete, so the daemon lock is released only after.
2. Verify the tests fail (RED).
3. Implement `stopAll` in the adapter and call it from the existing SIGTERM handler in `src/conductor/src/daemon-cli.ts` before `teardown.requestStop()`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(executor): stop children on SIGTERM"

**Done when:**
- [test] `stopAll` sends `stop` to every live child.
- [test] A child that ignores `stop` is force-killed when the scaled teardown budget expires, before `stopAll` resolves.
- The SIGTERM handler in daemon-cli.ts calls the child adapter `stopAll` before the lock release path.

**Files likely touched:**
- `src/conductor/src/engine/child-feature-executor.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/child-feature-executor.test.ts`

**Dependencies:** Tasks 15, 17

### Task 21: Wire executor_isolation and the child adapter into the daemon
**Story:** Story 1, Story 2, Story 3, Story 9, Story 15
**Type:** happy-path

**Steps:**
1. Write failing tests in `daemon-cli-executor-wiring.test.ts` (process boundary mocked): with no `executor_isolation` key the daemon wires `createChildProcessFeatureExecutor` with a broker built from the existing `rateLimitEpisode`, `providerAvailability`, `liveBoundaryCoordinator` and `worktreeLifecycle`; with `in-process` it wires `createInProcessFeatureExecutor` and logs that per-dispatch engine pinning is disabled; startup calls `sweepExecutorRecordsOnBoot` before the first claim; through `runDaemon` with a fake dispatch, feature A claimed on v1 stays running while `dist` flips to v2 and feature B is claimed and launched on v2 with no drain begun; a halted feature re-dispatched after the flip launches on v2.
2. Verify the tests fail (RED).
3. Implement the selection in `src/conductor/src/daemon-cli.ts` where `createInProcessFeatureExecutor` is wired today.
4. Verify the tests pass (GREEN).
5. Commit: "feat(daemon): select executor isolation"

**Done when:**
- [test] With no `executor_isolation` key the daemon dispatches through `createChildProcessFeatureExecutor`, and with `in-process` it dispatches through `createInProcessFeatureExecutor` on the supervisor boot build and logs that per-dispatch engine pinning is disabled.
- [test] Through `runDaemon`, in both a self-host daemon and a consumer daemon, feature B claimed after a `dist` flip to v2 launches on v2 while feature A, launched on v1, is still running, and no drain or claim-stop begins.
- [test] Through `runDaemon`, a halted feature re-dispatched after the flip launches on v2.
- [test] Daemon startup runs `sweepExecutorRecordsOnBoot` before the first claim.
- [test] Through `runDaemon`, a child `done` outcome with `markProcessed` and `enrollWatch` completes the claim and runs both effects in the supervisor, and a `halted`, `parked` or `error` outcome parks the claim and registers the HALT-cleared watcher.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/daemon-cli-executor-wiring.test.ts`

**Dependencies:** Tasks 4, 6, 17, 18, 19, 20

### Task 22: OTel trace engine version uses the executor pin
**Story:** Story 13
**Type:** happy-path

**Steps:**
1. Write a failing test in `executor-event-forwarding.test.ts`: the per-dispatch OTel visualizer attached to the proxy feature bus is started with `engineVersion` equal to the WorkOrder `engineVersionId`, not `resolveEngineVersion(__dirname)` of the supervisor.
2. Verify the test fails (RED).
3. Pass the pin into `wireOtelVisualizer` start context for child-mode dispatches in `src/conductor/src/daemon-cli.ts`.
4. Verify the test passes (GREEN).
5. Commit: "feat(otel): trace engine version is the executor pin"

**Done when:**
- [test] The child-mode OTel visualizer start context `engineVersion` equals the WorkOrder `engineVersionId` when the supervisor boot build differs, and the built trace resource carries that value as its `conductor.engine.version` attribute.
- The in-process path keeps `resolveEngineVersion(__dirname)` unchanged, as the existing OTel wiring test still asserts.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/executor-event-forwarding.test.ts`

**Dependencies:** Tasks 3, 12

### Task 23: Daemon memory sampling stays supervisor-only
**Story:** Story 10
**Type:** negative-path

**Steps:**
1. Write failing tests in `daemon-memory.test.ts`: forwarded `step_started`/`step_completed` events from a child-mode feature produce `daemon_memory_sample` records with the supervisor `process.pid`, daemon-origin and the feature slug, with fields unchanged; a child rss above the threshold never causes `writeHeapSnapshot`, because only `process.memoryUsage()` of the supervisor is compared.
2. Verify the tests fail (RED).
3. Attach the existing memory sampler to the root-bus forwarding of child-mode feature events.
4. Verify the tests pass (GREEN).
5. Commit: "fix(memory): keep daemon memory samples supervisor-only"

**Done when:**
- [test] A child-mode step boundary produces a `daemon_memory_sample` with the supervisor pid, daemon origin, the feature slug, and the existing field set.
- [test] A child rss above the threshold produces no supervisor heap snapshot.

**Files likely touched:**
- `src/conductor/src/engine/daemon-memory.ts`
- `src/conductor/test/engine/daemon-memory.test.ts`

**Dependencies:** Task 12

### Task 24: Daemon status shows per-feature engine versions
**Story:** Story 3, Story 14
**Type:** happy-path

**Steps:**
1. Write failing tests in `daemon-observe-cli.test.ts`: with executor records on v1 and v2 and `dist` on v2, `daemon status` lists both features with their versions and marks the v1 row older than current v2; a stale supervisor row shows its own version marked older; an unreadable record renders that feature with version unknown plus a warning while other rows render; an unresolvable `dist` renders current as unknown and marks no row older.
2. Verify the tests fail (RED).
3. Implement the per-feature engine section in `src/conductor/src/engine/daemon-observe-cli.ts` from `listExecutorRecords` and `currentTarget`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(status): per-feature engine version"

**Done when:**
- [test] `daemon status` renders each live executor with its engine version and marks the v1 feature older than current v2, and renders the stale supervisor row with its own version marked older.
- [test] An unreadable executor record renders that feature as unknown with a warning while the other rows still render.
- [test] With `dist` unresolvable, current renders as unknown and no feature row is marked older.
- [test] A feature relaunched on the supervisor build after a protocol mismatch renders with the supervisor engine version.
- [test] A `feature_dispatch_started` record without `engineVersionId` renders that dispatch version as unknown.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts`
- `src/conductor/test/engine/daemon-observe-cli.test.ts`

**Dependencies:** Task 5

### Task 25: Supervisor staleness tracker
**Story:** Story 11
**Type:** infrastructure

**Steps:**
1. Write failing tests in `supervisor-staleness.test.ts`: `createSupervisorStaleness` records the first moment the supervisor boot identity differs from `dist` and keeps it across later rebuilds; `ageHours(now)` measures from that first moment; `capExceeded` compares with `supervisor_max_stale_hours`; `markProtocolMismatch()` sets a sticky mismatch reason; a return to the boot identity clears the first-stale timestamp.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/supervisor-staleness.ts` over the existing stale-engine checker.
4. Verify the tests pass (GREEN).
5. Commit: "feat(daemon): supervisor staleness tracker"

**Done when:**
- [test] `ageHours` measures from the first moment of staleness and is unchanged by later rebuilds that keep the supervisor stale.
- [test] `capExceeded` is true only when age exceeds `supervisor_max_stale_hours`, and `markProtocolMismatch` makes the drain reason protocol mismatch regardless of age.

**Files likely touched:**
- `src/conductor/src/engine/supervisor-staleness.ts`
- `src/conductor/test/engine/supervisor-staleness.test.ts`

**Dependencies:** Task 4

### Task 26: Natural-idle supervisor restart without claim-stop
**Story:** Story 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `daemon.test.ts` replacing the drained stale-engine gate: with gates armed and the supervisor stale, a busy pool below the cap keeps claiming and begins no drain; when no executor is running, whether or not eligible backlog remains, the existing single-generation trigger fires before the next claim; a rate-limit episode active at that idle defers the restart until it ends; a failed trigger keeps the daemon alive and dispatching and retries at a later boundary; with gates unarmed no restart and no drain occur.
2. Verify the tests fail (RED).
3. Change `observeBusyDrainRequest` and `idleBoundary` in `src/conductor/src/engine/daemon.ts` to use the Task 25 tracker for stale-engine restarts; update `src/conductor/test/engine/daemon-serial-equivalence.test.ts` so the N=1 order pins dispatch, refresh and sweep only, and the stale-engine expectations in `src/conductor/test/acceptance/single-repo-daemon-concurrency.acceptance.test.ts` to the new policy.
4. Verify the tests pass (GREEN).
5. Commit: "feat(daemon): restart stale supervisor at natural idle"

**Done when:**
- [test] With gates armed and executors running below the age cap, `runDaemon` keeps claiming and `maintenance.beginDrain` is never called for staleness.
- [test] With no executor running, both with eligible backlog present and with none, the single-generation restart trigger fires before the next claim and the predecessor exits after the handoff.
- [test] An active rate-limit episode defers the natural-idle restart until the episode ends, and a failed trigger leaves the daemon alive and dispatching and retries only at a later natural-idle or drained boundary, spawning no successor, so two supervisor generations are never alive at once.
- [test] With the stale-engine gates unarmed, a stale supervisor triggers no restart and no drain while dispatches continue and launch on the current `dist` build.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/test/engine/daemon.test.ts`
- `src/conductor/test/engine/daemon-serial-equivalence.test.ts`
- `src/conductor/test/acceptance/single-repo-daemon-concurrency.acceptance.test.ts`

**Dependencies:** Task 25

### Task 27: Age-cap and protocol-mismatch drain restarts
**Story:** Story 3, Story 11
**Type:** negative-path

**Steps:**
1. Write failing tests in `daemon.test.ts`: when `capExceeded` becomes true the dispatcher stops claiming, drains in-flight executors and fires the restart at the drained boundary; a recorded protocol mismatch starts the same drain regardless of age; an operator RESTART-PENDING marker still takes drain-then-act.
2. Verify the tests fail (RED).
3. Add the cap and mismatch drain reasons to the drain path in `daemon.ts`, and wire the Task 18 restart request into the tracker.
4. Verify the tests pass (GREEN).
5. Commit: "feat(daemon): age-capped stale drain"

**Done when:**
- [test] Crossing `supervisor_max_stale_hours` measured from first staleness stops claiming, drains executors, and fires the restart once at the drained boundary.
- [test] A protocol mismatch starts the claim-stop drain regardless of stale age.
- [test] An operator RESTART-PENDING marker still drains then acts, unchanged.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/test/engine/daemon.test.ts`

**Dependencies:** Tasks 18, 25

### Task 28: Cadence engine rebuild in the single-flight background refresh job
**Story:** Story 5, Story 12
**Type:** happy-path

**Steps:**
1. Write failing tests in `daemon.test.ts` against the existing single-flight background refresh job (`startRefresh`/`refreshJob` in `runDaemon`): with gates armed, executors in flight and `engine_refresh_min_interval_seconds` elapsed, the job runs `refreshEngineSource` then `rebuildEngine`, each through `coordinatedRootMutation`, and the `dist` flip happens with no drain; inside the interval no fetch or rebuild runs; a trigger during a running rebuild merges into it; a failed fetch or rebuild leaves `dist` unchanged, logs it and retries after the next interval; with `auto_restart_on_stale_engine: false` no rebuild runs while the origin refresh and fast-forward behave as before; a consumer daemon registers no rebuild. Update `src/conductor/test/acceptance/daemon-stale-engine-origin-advance.acceptance.test.ts` for the replaced in-flight criterion, and `src/conductor/test/engine/daemon-stale-respawn.e2e.test.ts` where it asserts a failed refresh still proceeds to `rebuildEngine` and that refresh is skipped while a dispatch is in flight, and add a case where a child window verified after a mid-feature flip reports no live-boundary drift.
2. Verify the tests fail (RED).
3. Move the rebuild from `rebuildAndMaybeRestartForStaleEngine` in `src/conductor/src/engine/daemon.ts` into the existing single-flight `refreshJob` of `runDaemon` in the same file, after its origin refresh, with the gate and interval check in `src/conductor/src/engine/daemon-maintenance.ts` (`refreshStartable`); the job never requests a restart. This is the background maintenance job that the adr-2026-10-14 amendment names on this base.
4. Verify the tests pass (GREEN).
5. Commit: "feat(daemon): cadence engine rebuild while busy"

**Done when:**
- [test] With gates armed and executors in flight, the single-flight `refreshJob` runs fetch, fast-forward and `rebuildEngine` through `coordinatedRootMutation` and flips `dist` without any drain, and never requests a restart.
- [test] Inside `engine_refresh_min_interval_seconds` no fetch or rebuild runs, and a trigger during a running rebuild starts no second rebuild.
- [test] A failed fetch or rebuild leaves `dist` unchanged and running executors unaffected, logs the failure, and retries after the next interval.
- [test] With `auto_restart_on_stale_engine: false` the `refreshJob` runs no engine rebuild while its origin refresh and fast-forward still run, and a consumer daemon registers no rebuild.
- [test] A child-mode feature whose provider windows straddle a mid-feature `dist` flip verifies with no live-boundary drift.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/src/engine/daemon-maintenance.ts`
- `src/conductor/test/engine/daemon.test.ts`
- `src/conductor/test/engine/daemon-stale-respawn.e2e.test.ts`
- `src/conductor/test/acceptance/daemon-stale-engine-origin-advance.acceptance.test.ts`

**Dependencies:** Tasks 4, 21

### Task 29: A pending restart stops new maintenance runs
**Story:** Story 11
**Type:** negative-path

**Steps:**
1. Write failing tests in `daemon.test.ts`: once a restart becomes pending (pool naturally empty, or a drain begun) while the job is mid-rebuild, no new job run starts and the restart fires only after the running job settles; a stale supervisor with no restart boundary reached still runs the job on its interval.
2. Verify the tests fail (RED).
3. Gate `startRefresh` in `daemon.ts` on the restart-pending state, and make the restart boundary await the in-flight `refreshJob`.
4. Verify the tests pass (GREEN).
5. Commit: "fix(daemon): pending restart waits for maintenance"

**Done when:**
- [test] After a restart becomes pending during a running rebuild, no new `refreshJob` run starts and the restart fires only after the running job settles.
- [test] A stale supervisor that has reached no restart boundary still runs the `refreshJob` on its interval.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/test/engine/daemon.test.ts`

**Dependencies:** Tasks 26, 27, 28

### Task 30: Child-mode parity with in-process execution
**Story:** Story 4, Story 16
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-parity.integration.test.ts`: one fixture feature with a stubbed provider dispatched through `createChildProcessFeatureExecutor` (real fork of the built entrypoint) and through `createInProcessFeatureExecutor` records the same ordered step sequence, ledger event types (excluding `executor_started`), terminal status and terminal effects; a variant whose first provider call is rate-limited waits on the supervisor episode and completes in both modes, and is recorded episode-caused if it halts; a variant halting at a gate produces matching halt marker, ledger and outcome.
2. Verify the tests fail (RED).
3. Fix any divergence in the adapter or broker that the comparison exposes.
4. Verify the tests pass (GREEN).
5. Commit: "test(executor): child and in-process parity"

**Done when:**
- [test] The parity test records an identical ordered step sequence, ledger event types excluding `executor_started`, terminal status and terminal effects for the fixture feature in child and in-process modes.
- [test] The rate-limited variant waits on the daemon-wide episode and completes in both modes, and a halt during the episode is recorded episode-caused and recovered by the existing episode-halt sweep.
- [test] The gate-halt variant produces the same halt marker content, the same ledger event sequence with identical fields other than timestamps, run ids and `executor_started`, and the same collected outcome in both modes.

**Files likely touched:**
- `src/conductor/test/engine/executor-parity.integration.test.ts`
- `src/conductor/src/engine/child-feature-executor.ts`
- `src/conductor/src/engine/executor-broker.ts`

**Dependencies:** Task 21

### Task 31: Shipped-record engine_version is the executor pin
**Story:** Story 13
**Type:** happy-path

**Steps:**
1. Write a failing test in `executor-child.test.ts`: a child running from a pinned engine dir that writes the shipped-record at finish records `engine_version` equal to its pinned `engineVersionId`, not the supervisor build.
2. Verify the test fails (RED).
3. Ensure the finish path resolves `resolveEngineVersion` from the executing engine dir in child mode.
4. Verify the test passes (GREEN).
5. Commit: "fix(executor): shipped-record records pinned engine"

**Done when:**
- [test] A child-mode finish writes a shipped-record whose `engine_version` equals the child pinned `engineVersionId`.
- `runExecutorChild` derives its `engineVersionId` from its own module directory via `versionIdFromEngineDir`, never from a value inherited from the supervisor environment.

**Files likely touched:**
- `src/conductor/src/engine/executor-child.ts`
- `src/conductor/test/engine/executor-child.test.ts`

**Dependencies:** Task 14

## Task Dependency Graph

```
Task 1 <- none
Task 2 <- none
Task 3 <- Task 2
Task 4 <- none
Task 5 <- none
Task 6 <- Task 5
Task 7 <- none
Task 8 <- Task 1
Task 9 <- Tasks 8, 12
Task 10 <- Task 8
Task 11 <- Task 8
Task 12 <- Tasks 7, 8
Task 13 <- Task 8
Task 14 <- Tasks 1, 3, 7, 8, 9, 10, 11, 12, 13
Task 15 <- Task 14
Task 16 <- Task 14
Task 17 <- Tasks 2, 3, 5, 14
Task 18 <- Task 17
Task 19 <- Task 17
Task 20 <- Tasks 15, 17
Task 21 <- Tasks 4, 6, 17, 18, 19, 20
Task 22 <- Tasks 3, 12
Task 23 <- Task 12
Task 24 <- Task 5
Task 25 <- Task 4
Task 26 <- Task 25
Task 27 <- Tasks 18, 25
Task 28 <- Tasks 4, 21
Task 29 <- Tasks 26, 27, 28
Task 30 <- Task 21
Task 31 <- Task 14
```

## Integration Points

- After Task 14: a child can run one feature against in-memory proxies.
- After Task 21: the daemon dispatches through child executors end to end.
- After Task 28: rebuilds land while busy and reach the next claim.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon in `executor_isolation: child` mode whose supervisor booted on build v1 and `dist` now points to v2, when a feature is claimed, then its executor process runs from `dist-versions/v2` and its WorkOrder records `engineVersionId` v2. | 17, 3 | "forks the realpath `dist-versions/<id>/index.js` named by `order.engineVersionId`" | diff-local |
| Story 1 happy: Given feature A is in flight on v1 and `dist` flips to v2, when feature B is claimed while A is still running, then B is dispatched immediately on v2 with no claim-stop and without waiting for A to finish. | 21 | "feature B claimed after a `dist` flip to v2 launches on v2 while feature A, launched on v1, is still running, and no drain or claim-stop begins" | diff-local |
| Story 1 happy: Given a feature halted on v1 and `dist` now points to v2, when the halt is cleared and the feature is re-dispatched, then the new dispatch runs on v2, not v1. | 21 | "a halted feature re-dispatched after the flip launches on v2" | diff-local |
| Story 1 negative: Given `dist` is a dangling symlink at claim time, when a feature is claimed, then it is dispatched on the supervisor's own engine build, and an event records the resolution failure with its reason. | 2, 19, 3, 17 | "`fallbackReason` `dangling-dist`, `publish-incomplete`, or `unparseable-version-id`" | diff-local |
| Story 1 negative: Given a `.publish-incomplete` sentinel is present in the engine store at claim time, when a feature is claimed, then it is dispatched on the supervisor's own engine build rather than the partially published target, and the reason is recorded. | 2, 19, 3, 17 | "never returns the partially published target" | diff-local |
| Story 1 negative: Given `dist` resolves to a directory whose name does not parse as a version id, when a feature is claimed, then the dispatch falls back to the supervisor's own build, and no WorkOrder is ever written with an unparseable `engineVersionId`. | 2, 3 | "No result of `resolveEnginePin` carries an `engineVersionId` that fails `versionIdFromEngineDir`" | diff-local |
| Story 1 negative: Given a first dispatch whose worktree does not exist yet, when the executor is launched, then the supervisor has written nothing under `.worktrees/«slug»`, worktree creation succeeds, and the child persists the WorkOrder to `.pipeline/work-order.json` only after the worktree exists. | 14 | "writes `.pipeline/work-order.json` only after the worktree exists, with nothing written under `.worktrees/<slug>` before the work-order message" | diff-local |
| Story 2 happy: Given feature A's executor is running from `dist-versions/v1`, when a rebuild flips `dist` to v2, then A's process keeps executing v1 code to completion, and every step and gate verdict it records is produced by v1. | 17 | "so a later `dist` flip cannot change the running child module path" | diff-local |
| Story 2 happy: Given A is running on v1 and GC runs after `dist` moves to v3, when GC evaluates v1, then v1 is retained because a live executor record references it. | 6 | "`gcVersions` retains a version named only by a live executor record while `dist` points elsewhere" | diff-local |
| Story 2 negative: Given A is running on v1, when the executor record for A cannot be parsed during a GC pass, then the GC pass aborts with zero deletions. | 6 | "An unreadable executor record makes `gcVersions` abort the whole pass with zero deletions" | diff-local |
| Story 2 negative: Given A's executor process has exited and its record was removed, when GC next runs and v1 is outside the keep window, then v1 becomes eligible for deletion. | 6 | "`gcVersions` deletes that version once its executor record is removed" | diff-local |
| Story 2 negative: Given the supervisor restarts and finds an executor record whose pid is dead, when boot completes, then that stale record is removed and no longer protects its version. | 5, 6, 21 | "`sweepExecutorRecordsOnBoot` removes every dead-pid record so it no longer appears in `listExecutorRecords`" | diff-local |
| Story 3 happy: Given the supervisor and the pinned executor report the same `EXECUTOR_PROTOCOL_VERSION`, when the child sends its hello, then the supervisor accepts it and the child starts the feature. | 17, 14 | "On a hello whose protocol version equals the supervisor own, the adapter sends the WorkOrder" | diff-local |
| Story 3 happy: Given a self-host daemon with the stale-engine gates armed and a pinned executor that reports a different protocol version, when the hello arrives, then the supervisor terminates that child before any worktree or step work, relaunches the same dispatch from the supervisor's own build, records the mismatch as an event, and requests a supervisor restart under the drain fallback. | 18 | "A protocol mismatch or a malformed hello terminates the child before any work-order message and relaunches the dispatch from the supervisor own engine dir, emitting a protocol mismatch event" | diff-local |
| Story 3 negative: Given a child that never sends a hello within the dispatch start timeout, when the timeout elapses, then the supervisor kills the child, the dispatch ends with an `error` outcome naming the missing handshake, and the claim is released. | 18 | "A missing hello within the dispatch start timeout kills the child and yields outcome `error` naming the missing handshake, and the claim is released" | diff-local |
| Story 3 negative: Given a child whose hello is malformed (missing fields or non-numeric protocol version), when it arrives, then it is treated as a mismatch and the dispatch is relaunched on the supervisor's own build. | 18 | "A protocol mismatch or a malformed hello terminates the child before any work-order message" | diff-local |
| Story 3 negative: Given a consumer daemon (stale-engine gates not armed) and a protocol mismatch, when the hello arrives, then the dispatch is relaunched on the supervisor's own build, no supervisor restart is requested, and `daemon status` shows the feature on the supervisor's build. | 18, 24 | "requests no restart when they are not" | diff-local |
| Story 3 negative: Given a relaunch on the supervisor's own build also fails its handshake, when that happens, then the dispatch ends `error` with both failures recorded, and no further relaunch loop occurs. | 18 | "A failed relaunch handshake yields outcome `error` naming both failures, and `fork` is called exactly twice" | diff-local |
| Story 4 happy: Given two executors in flight, when executor A reports a rate-limit with a deadline, then the supervisor's episode becomes active, no new feature is claimed, and executor B's next rate-limit wait blocks until the same episode clears. | 8 | "makes the supervisor single `RateLimitEpisode` report `active()` true, so the claim-loop pick gate claims no new feature" | diff-local |
| Story 4 happy: Given an executor suppresses a provider on usage exhaustion, when another executor selects a provider, then it sees that provider as unavailable until the deadline, and a `provider_suppressed` event is persisted to `.daemon/events.jsonl`. | 9 | "A suppression from child proxy A makes child proxy B synchronous `isAvailable` return false until the deadline" | diff-local |
| Story 4 negative: Given an executor is blocked waiting on an episode, when the supervisor shuts down, then the wait is aborted and the executor takes the shutdown path instead of hanging. | 8 | "Supervisor shutdown and B channel disconnect each reject B pending `clear` with an abort" | diff-local |
| Story 4 negative: Given the IPC channel drops while an executor is waiting on an episode, when the disconnect is observed, then the executor stops waiting and exits through the shutdown path. | 15, 8 | "A channel disconnect makes the child take the same shutdown path and exit" | diff-local |
| Story 4 negative: Given an executor halts during an active episode, when the dispatcher collects it, then the halt is still recorded as episode-caused and recovered by the existing episode-halt sweep. | 30 | "a halt during the episode is recorded episode-caused and recovered by the existing episode-halt sweep" | diff-local |
| Story 5 happy: Given a child executor holds an open live-boundary window, when the supervisor starts a root mutation (fast-forward, rebuild or relink), then the mutation waits until that window closes. | 10 | "A supervisor `runMutation` does not start while a child proxy window is open and starts after `close`" | diff-local |
| Story 5 happy: Given a root mutation is in progress, when a child requests a new window, then the window opens only after the mutation completes. | 10 | "A child window requested during a running mutation opens only after the mutation resolves" | diff-local |
| Story 5 negative: Given a child dies while holding a window, when its IPC channel disconnects, then the supervisor closes that window so later mutations are not blocked forever. | 10 | "Disconnecting a child channel closes every window it held, and a queued mutation then proceeds" | diff-local |
| Story 5 negative: Given a `dist` flip completes between two of a feature's provider dispatches, when that feature verifies its next window, then no live-boundary drift is reported for the flip. | 28 | "A child-mode feature whose provider windows straddle a mid-feature `dist` flip verifies with no live-boundary drift" | diff-local |
| Story 5 negative: Given a non-self-host daemon, when executors run, then no live-boundary messages are exchanged and no window is opened. | 10 | "With no coordinator (non-self-host), no live-boundary request is sent and no window is opened" | diff-local |
| Story 6 happy: Given two children creating worktrees at the same moment, when both request the lifecycle lock, then their `git worktree add` operations run one after the other. | 11 | "Two child proxies never hold the worktree lifecycle lock at the same time" | diff-local |
| Story 6 happy: Given a supervisor sweep is removing a worktree, when a child requests the lifecycle lock, then the child waits until the sweep releases it. | 11 | "a child waits while a supervisor sweep holds it" | diff-local |
| Story 6 negative: Given a child dies while holding the lifecycle lock, when its channel disconnects, then the supervisor releases the lock and the next waiter proceeds. | 11 | "A child that disconnects while holding the lock releases it and the next waiter proceeds" | diff-local |
| Story 6 negative: Given a child's lock request is pending when the supervisor shuts down, when shutdown starts, then the request is rejected and the child takes the shutdown path. | 11 | "A lock request pending at supervisor shutdown is rejected so the child takes its shutdown path" | diff-local |
| Story 7 happy: Given a child executor emits feature events, when they are forwarded, then the child alone appends them to `.worktrees/«slug»/.pipeline/events.jsonl`, and the supervisor re-emits them so the per-feature daemon.log renderer prints them with the feature's slug attribution. | 12, 14 | "A forwarded feature event is rendered by the per-feature daemon.log renderer with the feature slug, and the supervisor writes nothing to that feature `.pipeline/events.jsonl`" | diff-local |
| Story 7 happy: Given a child emits a root-scoped event such as `feature_shipped`, when it is forwarded, then the supervisor emits it on the root bus and it is persisted to `.daemon/events.jsonl`; `feature_dispatch_started` and `feature_dispatch_ended` are emitted by the supervisor itself, once per dispatch, at launch and at collection. | 19, 12 | "and exactly one `feature_dispatch_ended` at collection" | diff-local |
| Story 7 happy: Given a child writes a feature log line or a `console.warn`, when it is forwarded, then it appears in daemon.log tagged with the feature's slug. | 13 | "A child feature log line and a child `console.warn` line both appear in the daemon.log sink tagged with the feature slug" | diff-local |
| Story 7 negative: Given a newer child emits an event variant the supervisor's union does not define, when it is forwarded, then the supervisor accepts it without throwing, neither renders nor persists it, and the child's own ledger still records it. | 12, 14 | "A forwarded unknown event type is accepted without throwing and is neither rendered nor persisted by the supervisor" | diff-local |
| Story 7 negative: Given a child crashes mid-run, when the supervisor inspects that feature's ledger, then every complete line is parseable and no line was written by the supervisor. | 12, 14 | "the supervisor writes nothing to that feature `.pipeline/events.jsonl`" | diff-local |
| Story 7 negative: Given an event message whose payload is not valid JSON, when the supervisor receives it, then it logs and drops that one message, and keeps the executor and the rest of the stream running. | 12 | "A malformed event message is logged and dropped, and the next well-formed message from the same executor is still rendered" | diff-local |
| Story 8 happy: Given a child finishes with status `done` and terminal effects including `markProcessed` and `enrollWatch`, when the dispatcher collects it, then the claim completes and both effects run supervisor-side. | 21, 30 | "a child `done` outcome with `markProcessed` and `enrollWatch` completes the claim and runs both effects in the supervisor" | diff-local |
| Story 8 happy: Given a child ends `halted` or `parked`, when it is collected, then the claim is parked and a HALT-cleared watcher is registered, exactly as for in-process outcomes. | 21, 30 | "a `halted`, `parked` or `error` outcome parks the claim and registers the HALT-cleared watcher" | diff-local |
| Story 8 negative: Given a child process exits non-zero without sending an outcome, when the supervisor observes the exit, then the dispatch is collected as `error` with the exit code and signal in its reason, and the claim is released into the halted path. | 19, 21 | "A child exit without an outcome yields `error` whose reason names the exit code and signal" | diff-local |
| Story 8 negative: Given a child sends an outcome and then hangs instead of exiting, when the teardown budget elapses, then the supervisor kills it, and the already-received outcome is the one recorded. | 19 | "A child that sends an outcome and hangs is killed after the teardown budget, and the already-received outcome is returned" | diff-local |
| Story 8 negative: Given a child sends two outcome messages, when the second arrives, then it is ignored and logged, and the terminal effects run only once. | 19 | "A second outcome message is ignored and logged, so the returned outcome and its terminal effects are the first one only" | diff-local |
| Story 8 negative: Given a child crashes before sending an outcome, when the supervisor collects the dispatch, then exactly one `feature_dispatch_ended` is emitted for it, by the supervisor. | 19 | "including when the child crashes before sending an outcome" | diff-local |
| Story 9 happy: Given children are running, when the supervisor receives SIGTERM, then every child receives a stop request, aborts its rate-limit waits, and stops at its next shutdown boundary. | 20, 15 | "`stopAll` sends `stop` to every live child" | diff-local |
| Story 9 happy: Given the supervisor process dies abruptly, when each child observes its IPC channel disconnect, then the child takes the shutdown path and exits, and the feature resumes from its `.pipeline/` state on a later dispatch. | 15 | "A channel disconnect makes the child take the same shutdown path and exit, leaving its `.pipeline/` state for a later dispatch to resume" | diff-local |
| Story 9 negative: Given a child ignores the stop request, when the scaled teardown budget expires, then the supervisor force-kills it before releasing the daemon lock. | 20 | "A child that ignores `stop` is force-killed when the scaled teardown budget expires, before `stopAll` resolves" | diff-local |
| Story 9 negative: Given a supervisor died and a successor boots while a previous generation's child for slug X is still alive, when boot completes, then the successor terminates that pid (after confirming it is the recorded executor process) and removes its record before slug X can be dispatched again. | 5, 21 | "`sweepExecutorRecordsOnBoot` kills a live pid only after its cmdline matches the recorded executor entrypoint, then removes that record" | diff-local |
| Story 9 negative: Given an operator parks a feature whose child is running, when the child reaches its next park boundary, then it terminates as `parked` through the existing file-based park check. | 15 | "An operator park marker terminates a child-mode run with outcome `parked`" | diff-local |
| Story 10 happy: Given a child-mode feature reaches a step boundary, when the daemon memory sample is recorded, then it is still the supervisor's own memory with the supervisor's pid, daemon-origin, carrying the feature slug, exactly as before this change. | 23 | "A child-mode step boundary produces a `daemon_memory_sample` with the supervisor pid, daemon origin, the feature slug, and the existing field set" | diff-local |
| Story 10 happy: Given three child executors and one supervisor are running, when the single-generation process check counts `daemon --continuous` processes, then it counts exactly one. | 14 | "does not contain `daemon --continuous`, so the single-generation process pattern in `daemon-tmux.ts` cannot match it" | diff-local |
| Story 10 happy: Given a child executor exhausts its inherited V8 heap cap, when it dies, then the dispatch is collected as `error` naming heap exhaustion, the supervisor keeps running, and no supervisor heap snapshot is written for the child's memory. | 19, 23 | "a V8 heap-exhaustion exit yields `error` naming heap exhaustion" | diff-local |
| Story 10 negative: Given a child's rss crosses the daemon memory threshold, when the supervisor evaluates its threshold, then no supervisor heap snapshot is written, because only the supervisor's own memory is compared. | 23 | "A child rss above the threshold produces no supervisor heap snapshot" | diff-local |
| Story 10 negative: Given a child is launched, when its command line is inspected, then it does not contain `daemon --continuous`, so it can never satisfy the supervisor process pattern. | 14 | "The executor launch command line built for the child does not contain `daemon --continuous`" | diff-local |
| Story 10 negative: Given a child-mode dispatch would take the legacy no-`providerExecution` branch while the supervisor's effective concurrency is greater than 1, when the child evaluates the guard, then it refuses fail-closed exactly as in-process mode does, using the effective concurrency passed by the supervisor. | 16 | "is refused fail-closed with the existing reason naming the branch and the concurrency conflict" | diff-local |
| Story 11 happy: Given the supervisor's boot build differs from `dist` and executors are running, when the next claim boundary arrives, then claiming continues and no drain begins. | 26 | "keeps claiming and `maintenance.beginDrain` is never called for staleness" | diff-local |
| Story 11 happy: Given the supervisor is stale, when the pool becomes naturally empty (no executor running, whether or not eligible backlog remains), then the existing single-generation restart trigger fires before the next claim and the predecessor exits after handing off. | 26 | "the single-generation restart trigger fires before the next claim and the predecessor exits after the handoff" | diff-local |
| Story 11 happy: Given the supervisor first became stale more than `supervisor_max_stale_hours` ago, including when further rebuilds have landed since, when that threshold is crossed, then claiming stops, in-flight executors drain, and the restart trigger fires at the drained boundary. | 27, 25 | "Crossing `supervisor_max_stale_hours` measured from first staleness stops claiming, drains executors, and fires the restart once at the drained boundary" | diff-local |
| Story 11 negative: Given a protocol mismatch was recorded, when the next claim boundary arrives, then a claim-stop drain begins regardless of stale age. | 27, 25 | "A protocol mismatch starts the claim-stop drain regardless of stale age" | diff-local |
| Story 11 negative: Given `supervisor_max_stale_hours` is set to zero, negative or non-numeric, when the config loads, then it is rejected with a message naming the key and the default of 24 applies. | 4 | "emits a warning naming `supervisor_max_stale_hours` and the default and resolves to 24" | diff-local |
| Story 11 negative: Given the restart trigger fails, when that happens, then the supervisor stays alive, keeps dispatching, and retries at a later idle or drained boundary, never leaving two live generations. | 26 | "a failed trigger leaves the daemon alive and dispatching and retries only at a later natural-idle or drained boundary" | diff-local |
| Story 11 negative: Given an operator-queued RESTART-PENDING exists, when it is observed, then it keeps today's drain-then-act behavior. | 27 | "An operator RESTART-PENDING marker still drains then acts, unchanged" | diff-local |
| Story 11 negative: Given a rate-limit episode is active when the pool becomes naturally idle, when the restart would fire, then it is deferred until the episode ends. | 26 | "An active rate-limit episode defers the natural-idle restart until the episode ends" | diff-local |
| Story 11 negative: Given a supervisor restart becomes pending (pool naturally empty, or a drain has begun) while the background maintenance job is running a rebuild, when the restart boundary is reached, then no new job run starts and the restart fires only after the running job settles. | 29 | "no new `refreshJob` run starts and the restart fires only after the running job settles" | diff-local |
| Story 11 negative: Given the supervisor is stale but no restart boundary has been reached, when the maintenance interval elapses, then the job still runs, because staleness alone never marks a restart pending. | 29 | "A stale supervisor that has reached no restart boundary still runs the `refreshJob` on its interval" | diff-local |
| Story 11 negative: Given the stale-engine gates are not armed, when the supervisor's boot build differs from `dist`, then no restart and no drain occur, and new dispatches still run on the current build. | 26 | "a stale supervisor triggers no restart and no drain while dispatches continue" | diff-local |
| Story 12 happy: Given a self-host daemon with the stale-engine gates armed, executors in flight and `engine_refresh_min_interval_seconds` elapsed, when the background maintenance job runs, then it fetches, fast-forwards, rebuilds and flips `dist` without waiting for the pool to drain. | 28 | "runs fetch, fast-forward and `rebuildEngine` through `coordinatedRootMutation` and flips `dist` without any drain" | diff-local |
| Story 12 happy: Given a daemon in `executor_isolation: child` mode and that rebuild produced a new build, when the next feature is claimed, then that feature runs on the new build. | 21, 28 | "feature B claimed after a `dist` flip to v2 launches on v2" | diff-local |
| Story 12 happy: Given a consumer (non-self-host) daemon in child mode, when the shared install is rebuilt by any means into a protocol-compatible build, then its next claim runs on the new build, and no rebuild job runs in the consumer daemon. | 28, 21 | "a consumer daemon registers no rebuild" | diff-local |
| Story 12 negative: Given the fetch or the rebuild fails, when the job ends, then `dist` is unchanged, executors are unaffected, the failure is logged, and the job retries after the next interval. | 28 | "A failed fetch or rebuild leaves `dist` unchanged and running executors unaffected, logs the failure, and retries after the next interval" | diff-local |
| Story 12 negative: Given the minimum interval has not elapsed, when the maintenance job is evaluated, then no fetch or rebuild runs. | 28 | "Inside `engine_refresh_min_interval_seconds` no fetch or rebuild runs" | diff-local |
| Story 12 negative: Given a rebuild is already running, when the interval elapses again, then no second concurrent rebuild starts. | 28 | "a trigger during a running rebuild starts no second rebuild" | diff-local |
| Story 12 negative: Given a self-host daemon with `auto_restart_on_stale_engine: false`, when the interval elapses, then no engine rebuild runs from the maintenance job, while its existing origin refresh and fast-forward behave as before. | 28 | "runs no engine rebuild while its origin refresh and fast-forward still run" | diff-local |
| Story 13 happy: Given a child-mode dispatch starts, when its executor initializes, then an `executor_started` event carrying `slug`, `engineVersionId`, `protocolVersion` and `supervisorEngineVersionId` is appended to the feature's `.pipeline/events.jsonl`. | 14 | "appends one `executor_started` event carrying `slug`, `engineVersionId`, `protocolVersion` and `supervisorEngineVersionId`" | diff-local |
| Story 13 happy: Given a dispatch starts, when the supervisor emits `feature_dispatch_started`, then the event carries `engineVersionId` and is persisted to `.daemon/events.jsonl`, where it remains after the worktree is removed. | 19 | "emits exactly one `feature_dispatch_started` carrying `engineVersionId`, plus `pinFallbackReason` when the pin fell back, at launch, persisted to `.daemon/events.jsonl`" | diff-local |
| Story 13 happy: Given a feature ships, when its shipped-record is written, then its `engine_version` is the executor's pinned version, not the supervisor's. | 31 | "writes a shipped-record whose `engine_version` equals the child pinned `engineVersionId`" | diff-local |
| Story 13 happy: Given a child-mode dispatch exports OTel traces, when the trace resource is built, then its engine version attribute is the WorkOrder's pinned `engineVersionId`, not the supervisor's boot build. | 22 | "The child-mode OTel visualizer start context `engineVersion` equals the WorkOrder `engineVersionId`" | diff-local |
| Story 13 negative: Given a feature was dispatched twice on different builds, when its records are read, then each dispatch carries its own `engineVersionId` and neither overwrites the other. | 19 | "each emit their own `feature_dispatch_started` carrying their own `engineVersionId`, and neither overwrites the other" | diff-local |
| Story 13 negative: Given a `.daemon/events.jsonl` written before this change, when it is read, then `feature_dispatch_started` events without `engineVersionId` parse successfully and report the version as unknown. | 7, 24 | "the legacy `.daemon/events.jsonl` fixture without it parses through the daemon ledger reader with `engineVersionId` undefined" | diff-local |
| Story 14 happy: Given two live executors, one on v1 and one on v2, with `dist` on v2, when I run `ai-conductor daemon status`, then both features are listed with their version, and the v1 feature is marked as older than current v2. | 24 | "marks the v1 feature older than current v2" | diff-local |
| Story 14 happy: Given the supervisor itself is stale, when status renders, then the supervisor row shows its own version and that it is older than current. | 24 | "renders the stale supervisor row with its own version marked older" | diff-local |
| Story 14 negative: Given an executor record that cannot be parsed, when status renders, then that feature is shown with an unknown version and a warning, and the other rows still render. | 24 | "An unreadable executor record renders that feature as unknown with a warning while the other rows still render" | diff-local |
| Story 14 negative: Given `dist` cannot be resolved, when status renders, then the current build is shown as unknown, and no feature is falsely marked as older. | 24 | "With `dist` unresolvable, current renders as unknown and no feature row is marked older" | diff-local |
| Story 15 happy: Given no `executor_isolation` key in config, when the daemon starts, then it uses child mode. | 4, 21 | "resolves a missing `executor_isolation` to `child`" | diff-local |
| Story 15 happy: Given `executor_isolation: in-process`, when the daemon starts, then features run in the supervisor process on its boot build, exactly as before this change, and its startup log says that per-dispatch engine pinning is disabled. | 21 | "with `in-process` it dispatches through `createInProcessFeatureExecutor` on the supervisor boot build and logs that per-dispatch engine pinning is disabled" | diff-local |
| Story 15 negative: Given `executor_isolation` set to an unrecognized value, when the config loads, then startup fails with a message naming the key and its allowed values `child` and `in-process`. | 4 | "throws for any other value with a message naming `executor_isolation` and the allowed values `child` and `in-process`" | diff-local |
| Story 16 happy: Given a fixture feature with a stubbed provider, when it is dispatched once in child mode and once in in-process mode, then both runs record the same ordered step sequence, the same terminal status and the same terminal effects. | 30 | "records an identical ordered step sequence, ledger event types excluding `executor_started`, terminal status and terminal effects" | diff-local |
| Story 16 negative: Given the fixture provider returns a rate-limit on its first call, when the feature runs in child mode, then the run waits on the daemon-wide episode and completes after it clears, matching in-process behavior. | 30 | "The rate-limited variant waits on the daemon-wide episode and completes in both modes" | diff-local |
| Story 16 negative: Given the fixture feature halts at a gate, when it runs in child mode, then the halt marker, the ledger and the collected outcome match the in-process run. | 30 | "the same ledger event sequence with identical fields other than timestamps, run ids and `executor_started`, and the same collected outcome in both modes" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D1 | task | task-17, task-21 | the daemon dispatches through `createChildProcessFeatureExecutor` |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D2 | task | task-2, task-3, task-17 | `createWorkOrder` in daemon-cli.ts calls `resolveEnginePin` once per claim |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D3 | task | task-1, task-14, task-17, task-18 | A protocol mismatch or a malformed hello terminates the child before any work-order message |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D4 | task | task-8, task-9, task-10, task-11, task-12, task-13 | the supervisor writes nothing to that feature `.pipeline/events.jsonl` |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D5 | task | task-5, task-15, task-19, task-20, task-23 | A child that ignores `stop` is force-killed when the scaled teardown budget expires |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D6 | task | task-5, task-6, task-17 | `gcVersions` retains a version named only by a live executor record |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D7 | task | task-25, task-26, task-27, task-29 | the single-generation restart trigger fires before the next claim |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D8 | task | task-28 | runs fetch, fast-forward and `rebuildEngine` through `coordinatedRootMutation` |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D9 | task | task-7, task-14, task-19, task-22, task-24, task-31 | renders each live executor with its engine version |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D10 | no-change | none | Delivery-shape decision: this plan is the single spec and carries the `**Scope-exception:**` declaration; no implementation follows from it. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D1 | task | task-17, task-21 | the daemon dispatches through `createChildProcessFeatureExecutor` |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D2 | task | task-3 | `buildWorkOrder` sets `engineVersionId` to the claim-time pin |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D3 | existing | none | WorkClaims stays the single in-memory dispatch authority (`engine/work-claims.ts`); child mode releases claims through the same `collectOne` path in `engine/daemon.ts`. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D4 | existing | none | Pinned-base work orders already exist: `buildWorkOrder` carries `baseSha` and the worktree is cut from it (`engine/daemon-deps.ts`); the engine pin is added beside it, not in place of it. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D5 | task | task-26, task-28 | flips `dist` without any drain |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D6 | task | task-10, task-28 | A supervisor `runMutation` does not start while a child proxy window is open |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D7 | existing | none | `daemon_concurrency` parsing and clamping are unchanged; child mode launches at most that many executors through the existing claim loop. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D8 | task | task-12, task-13 | tagged with the feature slug |
| adr-2026-07-07-single-generation-stale-respawn#D1 | task | task-26 | the predecessor exits after the handoff |
| adr-2026-07-07-single-generation-stale-respawn#D2 | existing | none | The one-shot-per-firing `requestRestart` contract is reused unchanged by the natural-idle and drained restart paths. |
| adr-2026-07-07-single-generation-stale-respawn#D3 | existing | none | Bounded lock takeover in `holdLock` is unchanged; executor children never take the daemon lock. |
| adr-2026-07-07-single-generation-stale-respawn#D4 | existing | none | Lock-loser `process.exit(0)` is unchanged; executor children never contend for the lock. |
| adr-2026-07-07-single-generation-stale-respawn#D5 | existing | none | `auto_restart_on_stale_engine: true` is already set in `.ai-conductor/config.yml`; this plan gates on it unchanged. |
| adr-2026-07-03-daemon-auto-restart-stale-engine#D1 | existing | none | EngineIdentity content hashing in `engine/engine-identity.ts` is reused unchanged by the staleness tracker. |
| adr-2026-07-03-daemon-auto-restart-stale-engine#D2 | task | task-25, task-26, task-28 | keeps claiming and `maintenance.beginDrain` is never called for staleness |
| adr-2026-07-03-daemon-auto-restart-stale-engine#D3 | existing | none | RestartRequester marker/exit semantics are reused unchanged; only the boundary that calls it changes. |
| adr-2026-07-03-daemon-auto-restart-stale-engine#D4 | existing | none | Startup handshake and loop-guard in `engine/stale-engine-init.ts` are unchanged. |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D1 | no-change | none | First-claim-before-maintenance ordering is untouched; the cadence rebuild runs inside the existing job after that first claim. |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D2 | no-change | none | The single startup fetch is untouched by this plan. |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D3 | task | task-28, task-29 | no new `refreshJob` run starts and the restart fires only after the running job settles |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D4 | no-change | none | In-flight slug skipping for mutating sweeps is untouched. |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D5 | no-change | none | Pooled CI-fix and autoresolve repairs are untouched. |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D6 | no-change | none | Parked reconciliation skipping is untouched. |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D7 | no-change | none | Phase-duration events and their emission are untouched by this plan. |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D8 | task | task-26 | keeps claiming and `maintenance.beginDrain` is never called for staleness |
| adr-2026-07-22-origin-refresh-before-engine-rebuild#D1 | task | task-28 | runs fetch, fast-forward and `rebuildEngine` through `coordinatedRootMutation` |
| adr-2026-07-22-origin-refresh-before-engine-rebuild#D2 | task | task-28 | Inside `engine_refresh_min_interval_seconds` no fetch or rebuild runs |
| adr-2026-07-22-origin-refresh-before-engine-rebuild#D3 | existing | none | The source-SHA stamp in `scripts/publish-engine.mjs` is unchanged. |
| adr-2026-07-22-origin-refresh-before-engine-rebuild#D4 | existing | none | Loud staleness surfacing on degraded paths is unchanged; a failed cadence rebuild logs through the same path. |
| adr-2026-07-22-origin-refresh-before-engine-rebuild#D5 | existing | none | Content-hash restart trigger and non-convergence suppression are reused unchanged. |
| adr-2026-07-03-harness-daemon-profile#D1 | no-change | none | Builds still stop at PR-open; executor isolation does not change the finish path. |
| adr-2026-07-03-harness-daemon-profile#D2 | no-change | none | `bin/setup` is untouched. |
| adr-2026-07-03-harness-daemon-profile#D3 | no-change | none | Version-bump escalation is untouched. |
| adr-2026-07-03-harness-daemon-profile#D4 | no-change | none | Documentation reconciliation decision has no implementation in this plan. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-R1: executor-child-runtime.ts + index.ts: pass selfHost (from WorkOrder/supervisor self-host flag), log: featureLog forwarder, stateStore and readOnlyReviewCapabilities into the child Conductor exactly as daemon-cli.ts in-process composition does; test that a self-host child dispatch opens a window via the live-boundary proxy
**Gate:** prd-audit
**Rationale:** Verified (99%): executor-child-runtime.ts Conductor construction omits selfHost, so isSelfBuild() is false in child mode and the live-boundary window is never requested. Approved architecture (ADR D4, Task 14) already requires the brokered live-boundary path; this is conforming implementation drift.
**Criterion:** S5.1
**Parent task:** 14
**Done when:**
- [test] S5.1 is satisfied by this task.
- The repair for task rem-prd-audit-R1 is committed and its targeted tests pass.

### Task rem-prd-audit-R5: daemon/executor tests: add Task 28 test — a self-host child-mode feature whose provider windows straddle a mid-feature dist flip verifies with no live-boundary drift
**Gate:** prd-audit
**Rationale:** Task 28's straddle test is missing and the criterion is only vacuously met because the child never enters the self-build path. After R1 enables it, add the planned test.
**Criterion:** S5.4
**Parent task:** 28
**Done when:**
- [test] S5.4 is satisfied by this task.
- The repair for task rem-prd-audit-R5 is committed and its targeted tests pass.

### Task rem-prd-audit-R2: child-feature-executor.ts: consume the forked child's piped stdout/stderr line-by-line into the slug-tagged daemon.log sink (or route child console.log through teeExecutorConsole); test a child feature log line and a console.log line both reach daemon.log tagged with the slug and a large output cannot block the child
**Gate:** prd-audit
**Rationale:** Verified: child Conductor has no log wiring, and child-feature-executor.ts forks with silent:true without reading stdout/stderr (dropped output, possible pipe-full block). Task 13 admits both repairs.
**Criterion:** S7.3
**Parent task:** 13
**Done when:**
- [test] S7.3 is satisfied by this task.
- The repair for task rem-prd-audit-R2 is committed and its targeted tests pass.

### Task rem-prd-audit-R8: daemon.ts + daemon-maintenance.ts: consult isSuppressed before the cap drain, end the drain (endDrain + reopen maintenance) on every restartStaleSupervisor path that does not fire a restart, honor recorded protocol mismatch independent of current staleness, and run stale-age/mismatch observation at pool width 1; tests for each path
**Gate:** prd-audit
**Rationale:** Verified in daemon.ts: observeBusyDrainRequest begins a stale-engine drain on capExceeded without the suppression check, and restartStaleSupervisor's early-return-false paths (suppressed target, no longer stale) never call maintenance.endDrain(), leaving claims paused. Task 27 admits the repair.
**Criterion:** S11.3
**Parent task:** 27
**Done when:**
- [test] S11.3 is satisfied by this task.
- The repair for task rem-prd-audit-R8 is committed and its targeted tests pass.

### Task rem-prd-audit-R3: executor-child-runtime.ts/index.ts: run the child feature through the shared daemon-runner.ts whole-feature lifecycle (prepareWorktree, setup triage incl. autoPark, REKICK/stack preflight, teardown) and return cleanupHaltPresentation and engineerSignal in terminalEffects for supervisor collection
**Gate:** prd-audit
**Rationale:** Task 30's parity test is absent and the child composition diverges (no selfHost/log/stateStore/readOnlyReviewCapabilities; skips prepareWorktree and REKICK/stack preflight). Restoring composition and lifecycle parity and adding the planned test is approved scope.
**Criterion:** S16.1
**Parent task:** 30
**Done when:**
- [test] S16.1 is satisfied by this task.
- The repair for task rem-prd-audit-R3 is committed and its targeted tests pass.

### Task rem-prd-audit-R4: Add Task 30 parity tests: identical step sequence, ledger event types (excluding executor_started), terminal status/effects for child vs in-process; rate-limited episode variant; gate-halt variant with identical halt marker and collected outcome
**Gate:** prd-audit
**Rationale:** Task 30's parity test is absent and the child composition diverges (no selfHost/log/stateStore/readOnlyReviewCapabilities; skips prepareWorktree and REKICK/stack preflight). Restoring composition and lifecycle parity and adding the planned test is approved scope.
**Criterion:** S16.1
**Parent task:** 30
**Done when:**
- [test] S16.1 is satisfied by this task.
- The repair for task rem-prd-audit-R4 is committed and its targeted tests pass.

### Task rem-as-built-R6: executor-proxies.ts + executor-broker.ts: retain the latest snapshot in proxies and replay to late subscribers; subscribe the broker to authoritative rate-limit/availability services and broadcast after each mutation (clear broadcast after rate-limit-episode reset); tests for pre-subscribe snapshot and supervisor-side change propagation
**Gate:** as-built
**Rationale:** ADR D4 requires faithful replicas; proxies drop snapshots before subscribers exist, supervisor-side changes are not propagated, and clear broadcasts before the authoritative reset. Clear implementation drift.
**Governing clause:** adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4
**Done when:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4 is satisfied by this task.
- The repair for task rem-as-built-R6 is committed and its targeted tests pass.

### Task rem-as-built-R7: child-feature-executor.ts: route the record-publication failure through the existing bounded SIGTERM→SIGKILL termination path with exit confirmation; test an uncooperative child after accepted hello is killed within budget
**Gate:** as-built
**Rationale:** ADR D5 bounded termination; record-publication failure still uses SIGTERM-only and may await exit indefinitely. Reuse the existing bounded path.
**Governing clause:** adr-2026-10-15-per-dispatch-engine-pinned-executor decision 5
**Done when:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor decision 5 is satisfied by this task.
- The repair for task rem-as-built-R7 is committed and its targeted tests pass.

### Task rem-as-built-R9: daemon.ts/daemon-cli.ts: when engine source refresh is throttled or skipped, run backlog discovery without the fetch/fast-forward (refresh:false or a throttle-aware fastForwardRoot) so origin mutation honors engine_refresh_min_interval_seconds; test no fetch inside the interval while discovery still runs
**Gate:** as-built
**Rationale:** ADR D8 cadence: verified daemon.ts calls discoverBacklog({refresh:true}) even when refreshEngineSource was throttled, so fetch/fast-forward bypasses the interval. Task 28 admits the fix.
**Governing clause:** adr-2026-10-15-per-dispatch-engine-pinned-executor decision 8
**Done when:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor decision 8 is satisfied by this task.
- The repair for task rem-as-built-R9 is committed and its targeted tests pass.

### Task rem-as-built-rem-vg-1: executor-child-runtime.ts/index.ts: replace the direct Conductor construction with a child composition of daemon-runner.ts makeRunFeature. Supply child-side deps for prepareWorktree, runSetupTriage, teardownWorktree and runConductor. The FeatureExecutionOutcome must carry the runner's own terminalEffects (autoPark, cleanupHaltPresentation, engineerSignal, markProcessed, enrollWatch, sweep) as declarative data, so root-owned effects still apply only at supervisor collection. Delete the handcrafted effect objects at executor-child-runtime.ts:170-188. Add targeted tests in executor-child-runtime.test.ts covering setup-triage park → autoPark, halt → cleanupHaltPresentation and engineerSignal, and teardown invocation.
**Gate:** as-built
**Rationale:** Verified (99%): ADR D1 says the child runs the whole per-feature path, including preparation, setup triage, runConductorInWorktree and teardown. executor-child-runtime.ts:95-188 builds a Conductor directly and handcrafts terminalEffects ({markProcessed, enrollWatch, sweep} / {sweep}). It bypasses makeRunFeature in daemon-runner.ts (prepareWorktree :470, runSetupTriage/autoPark :488-516, teardown :511/648/663/692, cleanupHaltPresentation/engineerSignal :563-600). The approved architecture is unambiguous, so this is conforming implementation work. Earlier laps patched individual effects instead of reusing the shared runner, so the repair must compose makeRunFeature itself and stop re-deriving its outputs.
**Governing clause:** adr-2026-10-15-per-dispatch-engine-pinned-executor decision 1
**Done when:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor decision 1 is satisfied by this task.
- The repair for task rem-as-built-rem-vg-1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg-2: daemon parity test (e.g. test/engine/executor-parity.test.ts): run one fixture feature through createChildProcessFeatureExecutor and createInProcessFeatureExecutor. Assert an identical ordered step sequence, identical ledger event types excluding executor_started, identical terminal status, and identical terminalEffects. Add the rate-limited-episode variant: wait on the daemon-wide episode in both modes, and record a halt during the episode as episode-caused and recovered by the episode-halt sweep.
**Gate:** prd-audit
**Rationale:** Verified (99%): same root cause as the lifecycle as-built finding (the child bypasses daemon-runner's whole-feature lifecycle), and no child-versus-in-process parity test exists. The code repair is rem-vg-1. This disposition adds the missing parity coverage that task 30 and rem-prd-audit-R4 already admit, so the criterion is proven rather than asserted.
**Criterion:** S16.1
**Parent task:** rem-prd-audit-R3
**Done when:**
- [test] S16.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg-2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg-3: Add the gate-halt parity variant to the parity test. A gate halt in child and in-process modes must produce identical HALT marker content, an identical ledger event sequence (fields equal except timestamps, run ids and executor_started), and an identical collected outcome including terminalEffects.
**Gate:** prd-audit
**Rationale:** Verified (99%): on a halt, the child returns only {sweep:true}. The in-process path also produces cleanupHaltPresentation, engineerSignal and (for triage) autoPark, and runs teardown. rem-vg-1 fixes the behavior. Task 30's third done-when (the gate-halt variant) has no test, so this adds it.
**Criterion:** S16.3
**Parent task:** 30
**Done when:**
- [test] S16.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg-3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg-4: executor-child.ts / shipped-record-cli.ts / finish path: in child mode, pass the child's pinned engineVersionId (derived via versionIdFromEngineDir from the child's own module dir, never inherited from supervisor env) to the shipped-record writer. For example, the child exports it to the finish step's conduct invocation, or the finish step launches the CLI from the pinned dist-versions/<id>. Add an executor-child.test.ts test asserting that a child-mode finish writes engine_version equal to the pinned engineVersionId, not the supervisor or floating-dist build.
**Gate:** prd-audit
**Rationale:** Verified (95%): shipped-record-cli.ts stamps engine_version from resolveEngineVersion of its own module dir. Invoked through the conduct CLI from a child, that resolves through the floating dist instead of the child's pinned dist-versions/<id>. Task 31 Steps 1-4 directly admit the fix: make the finish path resolve from the executing engine dir in child mode, and add the missing child-mode test.
**Criterion:** S13.3
**Parent task:** 31
**Done when:**
- [test] S13.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg-4 is committed and its targeted tests pass.

### Task rem-as-built-rem-vg-5: daemon.ts: honor a recorded protocol mismatch independently of current staleness at both the drained boundary (:1565) and the idle boundary (:1916). Record pending mismatches before reading recordedMismatch. Ensure a fallback child that completes before busy observation still has its mismatch recorded and starts the claim-stop drain/restart. Add daemon.test.ts cases: mismatch with current staleness false still restarts at drained and idle boundaries, and a fast-completing fallback child does not permit another claim.
**Gate:** as-built
**Rationale:** Verified (95%): ADR D7 and task 27's done-when require that a recorded protocol mismatch start the drain/restart regardless of stale age. daemon.ts:1565-1568 reads recordedMismatch before the observation that records it, and abandons the drain when staleness is false. The idle path at :1916-1921 requires observeSupervisorStaleness() before restarting. A fallback child that settles before busy observation (:1998-2003) skips mismatch observation entirely. This is clear conforming scheduling work inside task 27.
**Governing clause:** adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7
**Done when:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7 is satisfied by this task.
- The repair for task rem-as-built-rem-vg-5 is committed and its targeted tests pass.

### Task rem-as-built-R1: src/conductor/src/engine/executor-child-runtime.ts: supply beginFeatureRun in makeExecutorChildFeatureRunner and the production lifecycle deps so the child-owned forwarded events bus is the feature-run scope at daemon-runner.ts:419. Keep feature_dispatch_started/ended supervisor-owned. Add a RED test asserting that shipment, setup/triage, shipment-refusal and termination events reach the forwarded bus and that no dispatch-start/end is emitted from the child.
**Gate:** as-built
**Rationale:** Verified (95%): makeExecutorChildFeatureRunner in executor-child-runtime.ts takes input.events but the makeRunFeature deps it builds supply no beginFeatureRun. The production lifecycle deps (~:193) and index.ts omit it too (grep finds no beginFeatureRun there), so daemon-runner.ts:419 runs with no feature event scope. That drops shipment, setup/triage, refusal and termination events. ADR D4 stays authoritative and the repair is clear wiring, so no architecture decision is needed. Bind the child-owned forwarded bus as the runner's feature scope. Dispatch-start/end stay supervisor-owned and are not re-emitted from the child (Task 19). Admitted by Task 12 (forward executor events to the proxy feature bus), Task 14 (child entrypoint composition) and Task 30 (child-mode parity).
**Governing clause:** adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4
**Done when:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor decision 4 is satisfied by this task.
- The repair for task rem-as-built-R1 is committed and its targeted tests pass.

### Task rem-as-built-R2: src/conductor/src/engine/daemon.ts: route every collection path (immediate completedWorker, the maxIdlePolls===0 direct collect, and the post-busy-poll collect) through one helper that observes any pending protocol-mismatch drain request before collectOne can reopen a slot. Add a RED scheduler test: with another executor alive, a fallback child completes during the busy wait and no new feature is claimed before the drain starts.
**Gate:** as-built
**Rationale:** Verified (95%): in daemon.ts, observeBusyDrainRequest runs only before the immediate completedWorker collection (~:2033). The maxIdlePolls===0 direct collectOne (~:2043) and the post-busy-poll collectOne (~:2076) skip it. A fallback child that completes during the wait can free a slot, and claiming refills it before the protocol mismatch is recorded. ADR D7 is clear: the mismatch must be honored before claiming reopens. This is conforming implementation drift admitted by Task 27 (age-cap and protocol-mismatch drain restarts) and Task 29 (a pending restart stops new maintenance/claims).
**Governing clause:** adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7
**Done when:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor decision 7 is satisfied by this task.
- The repair for task rem-as-built-R2 is committed and its targeted tests pass.
