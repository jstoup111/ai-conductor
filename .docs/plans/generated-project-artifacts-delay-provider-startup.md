# Implementation Plan: attributable live-boundary fingerprint cost (#1219)

**Date:** 2026-09-21
**Stories:** .docs/stories/generated-project-artifacts-delay-provider-startup.md
**Conflict check:** Clean as of 2026-09-21

## Summary

Make the wall-clock cost of the self-host live-boundary fingerprint attributable: the fingerprint returns per-surface duration and file count as data, and the conductor emits one additive `self_host_boundary_fingerprint` event that is persisted and rendered. Seven tasks. No exclusion behaviour changes, no config key, and no claim that provider startup becomes faster.

## Technical Approach

- **Measurement lives in `manifest()`** (`src/conductor/src/engine/self-host/live-boundary.ts`). It times its own walk-and-hash and returns `{ entries, elapsedMs, fileCount }`; `fingerprintLiveBoundary` lifts those into `snapshot.measurements`, one per surface. `verifyLiveBoundary` keeps comparing `surface.manifest` only, so measurements can never cause a mismatch.
- **The safety module stays off the bus.** It returns data; `conductor.ts` owns the single emission directly after the awaited fingerprint in the self-host candidate preparation path, the same shape as `verifyLiveBoundary` returning a verdict that the conductor turns into `self_host_containment_verdict`. No timestamps are stamped into artifacts and no second channel is added.
- **Additive union member.** `EVENT_SINKS` is typed over `ConductorEvent['type']`, so the new member must declare its sinks to compile; it mirrors `self_host_containment_verdict` (`render: true, persist: true, audit: false, otel: false`). The daemon log line is a new case in `renderDaemonEventUnsafe` in `src/conductor/src/daemon-cli.ts`.
- **Architecture-review conditions.** C-1 is Tasks 4 and 5; C-2 holds because no task asserts a latency change; C-3 is Task 3; C-4 is Tasks 1 and 6.
- **Sequencing.** Tasks 1 and 4 are independent roots. Tasks 2 and 3 depend on 1; Task 5 on 4; Task 6 joins 1 and 4 and is the integration-owning task; Task 7 depends on 6.

## Prerequisites

- None. No migration, config key, or dependency is introduced.

## Tasks

### Task 1: Fingerprint returns per-surface measurements
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/self-host/live-boundary.test.ts`: over a temp fixture with a live checkout and a provider home, `fingerprintLiveBoundary` resolves a `measurements` array with one entry per surface labelled `live checkout` and `provider state`, each `elapsedMs` a non-negative integer; and for a surface holding N non-excluded files plus files under `node_modules` and `.git`, `fileCount` equals N.
2. Verify the tests fail (RED) because `measurements` is undefined.
3. Implement: `manifest()` times its own walk-and-hash with a monotonic clock and returns `{ entries, elapsedMs, fileCount }`, where `fileCount` is the number of files hashed (the `<absent>` placeholder is not a file). `fingerprintLiveBoundary` and `verifyLiveBoundary` consume `.entries`; `fingerprintLiveBoundary` adds `measurements: [{ label, elapsedMs, fileCount }]` to the returned `LiveBoundarySnapshot`, in surface order. Pattern to follow: this module already hands results back as plain data for `conductor.ts` to act on (`verifyLiveBoundary` returns `{ ok, reason, containedDrift }`); keep that trait — no emitter import, no logging, no new export beyond the widened snapshot type.
4. Verify the tests pass (GREEN).
5. Commit: "feat(self-host): report per-surface live-boundary fingerprint cost".

**Done when:**
- `fingerprintLiveBoundary` resolves a snapshot whose `measurements` holds exactly two entries labelled `live checkout` and `provider state`, each with an integer `elapsedMs >= 0`, asserted by a fixture test in the live-boundary unit suite.
- `manifest()` reports `fileCount` equal to the number of files it hashed, so a fixture surface with N non-excluded files reports N while files under excluded subtrees add nothing, asserted by the same suite.
- `src/conductor/src/engine/self-host/live-boundary.ts` still imports no event emitter: measurements leave the module only on the returned snapshot.

**Files:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — manifest() measurement return; snapshot gains measurements
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — measurement tests

**Dependencies:** none

### Task 2: Measurement edge cases: absent home, failed walk, vanishing file
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/self-host/live-boundary.test.ts`: (a) a provider home path that does not exist yields a `provider state` measurement with `fileCount` 0, integer `elapsedMs >= 0`, and a manifest of the single `<absent>` entry; (b) a walk failing with a non-ENOENT error (mock `readdir` to reject with `EACCES`) rejects `fingerprintLiveBoundary` with that error and resolves no snapshot; (c) a listed file whose `readFile` rejects with `ENOENT` takes the existing `readlink` fallback and is counted exactly once.
2. Verify RED for any case the Task 1 implementation does not already satisfy; a case already green is kept as a regression pin.
3. Implement only what the failing cases require inside `manifest()`: the ENOENT-root branch returns `fileCount: 0` with its elapsed time; the rethrow branch stays a rethrow; counting happens once per listed file regardless of which read path produced its bytes.
4. Verify GREEN.
5. Commit: "test(self-host): pin fingerprint measurement edge cases".

**Done when:**
- For a nonexistent provider home, `manifest()` returns `fileCount: 0` with an integer `elapsedMs >= 0` while its entries remain the single `<absent>` placeholder, asserted by a unit test.
- When the walk rejects with a non-ENOENT error, `fingerprintLiveBoundary` rejects with that same error and no snapshot or measurement is produced, asserted by a unit test that mocks `readdir`.
- A listed file whose read falls back through the existing ENOENT/EISDIR `readlink` branch contributes exactly 1 to `fileCount`, asserted by a unit test.

**Files:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — edge-case handling in manifest()
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — edge-case tests

**Dependencies:** Task 1

### Task 3: Pin the guard as unchanged by instrumentation
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/self-host/live-boundary.test.ts` over one fixture containing non-excluded files plus `node_modules/` and `.git/` content: (a) each surface's manifest equals an independently computed expectation — sorted non-excluded relative paths with their sha256 digests — and each surface's `exclude` equals `LIVE_CHECKOUT_VOLATILE` / the provider volatile list; (b) `verifyLiveBoundary` on an unchanged tree returns `{ ok: true }`; (c) after adding an unexcluded untracked file, with the default not-contained verdict, it returns `ok: false` with a reason containing `live checkout changed during self-host execution` and the added path; (d) a snapshot whose `measurements[].elapsedMs` is overwritten with a different value still verifies `ok: true`; (e) files under `node_modules/` and `.git/` appear in no manifest and are excluded from `fileCount`.
2. Verify any RED; if Task 1 left manifests intact these pass immediately and stand as pins — do not change production code to manufacture a failure.
3. Implement nothing unless a pin fails; a failing pin means Task 1 altered guard behaviour and is fixed there, in `manifest()`.
4. Verify GREEN.
5. Commit: "test(self-host): pin live-boundary guard behaviour under instrumentation".

**Done when:**
- A unit test computes the expected manifest (sorted non-excluded paths with sha256 digests) independently and asserts `fingerprintLiveBoundary` produces exactly it, with `Surface.exclude` equal to the existing volatile lists.
- `verifyLiveBoundary` returns `{ ok: true }` for an unchanged tree when given a snapshot that carries measurements, asserted by a unit test.
- With an unexcluded untracked file added and containment not in force, `verifyLiveBoundary` returns `ok: false` whose reason contains `live checkout changed during self-host execution` and names the path, asserted by a unit test.
- `verifyLiveBoundary` compares only `surface.manifest`, so a snapshot whose `elapsedMs` differs from the re-walk still verifies ok, asserted by a unit test that mutates the measurement.
- Files under `node_modules/` and `.git/` appear in no manifest and add nothing to `fileCount`, and the diff leaves `LIVE_CHECKOUT_VOLATILE`, the provider volatile lists, `diffManifests`, and `classifyLiveCheckoutDiff` unmodified.

**Files:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — behaviour pins

**Dependencies:** Task 1

### Task 4: Declare the self_host_boundary_fingerprint event and its sinks
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing assertions in `src/conductor/test/engine/event-sinks.test.ts`: `self_host_boundary_fingerprint` is listed among persisted and rendered event types and absent from audit and OTel types (extend the existing expected-type lists that already carry `self_host_containment_verdict`).
2. Verify RED.
3. Implement: add `{ type: 'self_host_boundary_fingerprint'; surfaces: readonly { label: string; elapsedMs: number; fileCount: number }[] }` to the `ConductorEvent` union next to `self_host_containment_verdict`; add `self_host_boundary_fingerprint: { render: true, persist: true, audit: false, otel: false }` to `EVENT_SINKS`. Pattern: mirror the sibling `self_host_containment_verdict` entry exactly; the registry is typed over the union, so the compiler rejects the union member until the sink row exists.
4. Verify GREEN and that `tsc` accepts the registry.
5. Commit: "feat(events): declare self_host_boundary_fingerprint".

**Done when:**
- The `ConductorEvent` union has a `self_host_boundary_fingerprint` member carrying `surfaces` of `{ label, elapsedMs, fileCount }`.
- `EVENT_SINKS.self_host_boundary_fingerprint` equals `{ render: true, persist: true, audit: false, otel: false }`, and the event-sinks test lists the type as persisted and rendered but not audited or exported to OTel.

**Files:**
- `src/conductor/src/types/events.ts` — union member
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `src/conductor/test/engine/event-sinks.test.ts` — expected lists

**Dependencies:** none

### Task 5: Render the fingerprint event in the daemon log
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test `src/conductor/test/daemon-render-boundary-fingerprint.test.ts` modelled on `daemon-render-memory-setup.test.ts`: calling the exported `renderDaemonEvent` with a two-surface `self_host_boundary_fingerprint` event logs exactly one line containing both labels, both durations, and both file counts.
2. Verify RED.
3. Implement a `case 'self_host_boundary_fingerprint'` in `renderDaemonEventUnsafe` beside the `self_host_containment_verdict` case, in the same dim one-line style, e.g. `self-host boundary fingerprint: live checkout 410ms/6391 files; provider state 95ms/812 files`.
4. Verify GREEN.
5. Commit: "feat(daemon): render live-boundary fingerprint cost".

**Done when:**
- `renderDaemonEvent` logs exactly one line for a `self_host_boundary_fingerprint` event, and that line contains each surface label with its `elapsedMs` and `fileCount`, asserted by a render unit test.
- The render case sits in `renderDaemonEventUnsafe` and writes through the supplied `log` callback only.

**Files:**
- `src/conductor/src/daemon-cli.ts` — render case
- `src/conductor/test/daemon-render-boundary-fingerprint.test.ts` — render test

**Dependencies:** Task 4

### Task 6: Conductor emits one fingerprint event per completed fingerprint
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-live-boundary-events.test.ts`, reusing its real-`Conductor` harness with `EventPersister` attached: a self-host dispatch emits exactly one `self_host_boundary_fingerprint` event whose `surfaces` carry both labels with integer `elapsedMs` and `fileCount`, observed before the fake provider binary is invoked; and the run's `.pipeline/events.jsonl` holds one record of that type with the same values.
2. Verify RED.
3. Implement in the self-host candidate preparation path of `src/conductor/src/engine/conductor.ts`: immediately after `fingerprintLiveBoundary` resolves, `await this.events.emit({ type: 'self_host_boundary_fingerprint', surfaces: boundary.measurements })`. This is the integration-owning task and the only emission site. Pattern: same emitter and style as the existing `self_host_containment_verdict` emit in this path; do not time anything in `conductor.ts` and do not stamp the numbers into any artifact.
4. Verify GREEN.
5. Commit: "feat(self-host): emit live-boundary fingerprint cost on the event spine".

**Done when:**
- A self-host dispatch through the real `Conductor` emits exactly one `self_host_boundary_fingerprint` event carrying both surfaces' `label`, `elapsedMs`, and `fileCount`, and the harness observes it before the provider executable starts.
- With `EventPersister` attached, `.pipeline/events.jsonl` contains one `self_host_boundary_fingerprint` record whose per-surface values equal the emitted event's.
- `conductor.ts` contains a single emit of this type, placed after `fingerprintLiveBoundary` resolves, and takes its values from `boundary.measurements` without measuring time itself.

**Files:**
- `src/conductor/src/engine/conductor.ts` — single emission site
- `src/conductor/test/engine/conductor-live-boundary-events.test.ts` — emission + persistence tests

**Dependencies:** Task 1, Task 4

### Task 7: Emission negatives: non-self-host, failed fingerprint, throwing subscriber, candidate retry
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/conductor-live-boundary-events.test.ts`: (a) a dispatch with self-host activation off emits no `self_host_boundary_fingerprint`; (b) with `fingerprintLiveBoundary` mocked to reject, no such event is emitted and the step fails the way it does without this feature (same error surfaced, same state written); (c) a subscriber that throws on this event type does not stop the dispatch — the containment verdict event still fires and the provider still runs; (d) when the first provider candidate fails after its fingerprint and a second candidate is prepared, the count of these events equals the count of completed fingerprints (two), never more.
2. Verify RED where behaviour is missing; cases already green stand as pins.
3. Implement only what fails: the emit stays inside the self-host-only path after the awaited fingerprint, so (a) and (b) hold structurally; (c) relies on `ConductorEventEmitter.emit` isolating handler errors — use `emit`, never `emitOrThrow`.
4. Verify GREEN.
5. Commit: "test(self-host): pin fingerprint event emission boundaries".

**Done when:**
- A non-self-host dispatch through the real `Conductor` emits zero `self_host_boundary_fingerprint` events, asserted by a harness test.
- When `fingerprintLiveBoundary` rejects, zero `self_host_boundary_fingerprint` events are emitted and the step outcome matches the pre-existing fingerprint-failure handling, asserted by a harness test.
- The event is dispatched with `ConductorEventEmitter.emit`, which isolates handler errors, so a throwing subscriber leaves the containment verdict emit and provider launch intact, asserted by a harness test.
- Across a two-candidate dispatch the number of `self_host_boundary_fingerprint` events equals the number of completed fingerprints, one per candidate and none duplicated, asserted by a harness test.

**Files:**
- `src/conductor/src/engine/conductor.ts` — only if a negative case fails
- `src/conductor/test/engine/conductor-live-boundary-events.test.ts` — negative tests

**Dependencies:** Task 6

## Task Dependency Graph

```text
Task 1 ──┬─> Task 2
         ├─> Task 3
         └─┐
Task 4 ──┬─┴─> Task 6 ──> Task 7
         └─> Task 5
```

## Integration Points

- After Task 6: a self-host dispatch through the real `Conductor` harness shows the event on the bus and in the persisted event ledger.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a self-host dispatch whose live checkout and provider home both exist, when the live-boundary fingerprint is built, then its result carries one measurement per surface, labelled `live checkout` and `provider state`, each with a non-negative integer elapsed-milliseconds value and the count of files hashed on that surface. | 1 | "`fingerprintLiveBoundary` resolves a snapshot whose `measurements` holds exactly two entries labelled `live checkout` and `provider state`, each with an integer `elapsedMs >= 0`, asserted by a fixture test in the live-boundary unit suite." | diff-local |
| Story 1 happy: Given a surface containing exactly N files outside its exclusion set, when the fingerprint is built, then that surface's reported file count is N and excluded subtrees contribute nothing to it. | 1 | "`manifest()` reports `fileCount` equal to the number of files it hashed, so a fixture surface with N non-excluded files reports N while files under excluded subtrees add nothing, asserted by the same suite." | diff-local |
| Story 1 negative: Given a provider home directory that does not exist, when the fingerprint is built, then the `provider state` measurement reports a file count of 0 with a non-negative elapsed value, and the surface's manifest is still the existing single `<absent>` entry. | 2 | "For a nonexistent provider home, `manifest()` returns `fileCount: 0` with an integer `elapsedMs >= 0` while its entries remain the single `<absent>` placeholder, asserted by a unit test." | diff-local |
| Story 1 negative: Given a surface whose walk fails with an error other than a missing root, when the fingerprint is built, then the fingerprint fails with that same error exactly as it does today and no measurement is returned for a fingerprint that did not complete. | 2 | "When the walk rejects with a non-ENOENT error, `fingerprintLiveBoundary` rejects with that same error and no snapshot or measurement is produced, asserted by a unit test that mocks `readdir`." | diff-local |
| Story 1 negative: Given a file that disappears between being listed and being read, when the fingerprint is built, then the existing symlink-or-missing fallback still applies and the file is counted once, never zero times or twice. | 2 | "A listed file whose read falls back through the existing ENOENT/EISDIR `readlink` branch contributes exactly 1 to `fileCount`, asserted by a unit test." | diff-local |
| Story 2 happy: Given a self-host dispatch whose fingerprint completes, when the conductor receives the snapshot, then it emits exactly one `self_host_boundary_fingerprint` event carrying both surfaces' label, elapsed milliseconds, and file count, before the provider is launched. | 6 | "A self-host dispatch through the real `Conductor` emits exactly one `self_host_boundary_fingerprint` event carrying both surfaces' `label`, `elapsedMs`, and `fileCount`, and the harness observes it before the provider executable starts." | diff-local |
| Story 2 happy: Given that event is emitted with the production sinks attached, when the run's `.pipeline/events.jsonl` is read, then it contains one record of type `self_host_boundary_fingerprint` with the same per-surface values. | 6 | "With `EventPersister` attached, `.pipeline/events.jsonl` contains one `self_host_boundary_fingerprint` record whose per-surface values equal the emitted event's." | diff-local |
| Story 2 happy: Given that event is emitted with the daemon renderer attached, when the daemon log is read, then it contains one line naming each surface with its duration and file count. | 5 | "`renderDaemonEvent` logs exactly one line for a `self_host_boundary_fingerprint` event, and that line contains each surface label with its `elapsedMs` and `fileCount`, asserted by a render unit test." | diff-local |
| Story 2 negative: Given a dispatch that is not self-hosted, when a step is dispatched, then no `self_host_boundary_fingerprint` event is emitted. | 7 | "A non-self-host dispatch through the real `Conductor` emits zero `self_host_boundary_fingerprint` events, asserted by a harness test." | diff-local |
| Story 2 negative: Given a fingerprint that throws, when the conductor handles the failure, then no `self_host_boundary_fingerprint` event is emitted and the existing failure handling is unchanged. | 7 | "When `fingerprintLiveBoundary` rejects, zero `self_host_boundary_fingerprint` events are emitted and the step outcome matches the pre-existing fingerprint-failure handling, asserted by a harness test." | diff-local |
| Story 2 negative: Given an event subscriber that throws while handling `self_host_boundary_fingerprint`, when the event is emitted, then the dispatch proceeds to containment probing and provider launch exactly as if the subscriber had succeeded. | 7 | "The event is dispatched with `ConductorEventEmitter.emit`, which isolates handler errors, so a throwing subscriber leaves the containment verdict emit and provider launch intact, asserted by a harness test." | diff-local |
| Story 2 negative: Given a provider candidate that fails and a second candidate is prepared, when each candidate's fingerprint completes, then one event is emitted per completed fingerprint and none is duplicated for a single fingerprint. | 7 | "Across a two-candidate dispatch the number of `self_host_boundary_fingerprint` events equals the number of completed fingerprints, one per candidate and none duplicated, asserted by a harness test." | diff-local |
| Story 3 happy: Given the same fixture tree, when the fingerprint is built before and after this change, then each surface's manifest (paths and digests) and exclusion sets are identical. | 3 | "A unit test computes the expected manifest (sorted non-excluded paths with sha256 digests) independently and asserts `fingerprintLiveBoundary` produces exactly it, with `Surface.exclude` equal to the existing volatile lists." | diff-local |
| Story 3 happy: Given a snapshot produced with measurements, when `verifyLiveBoundary` runs against an unchanged tree, then it returns ok exactly as today. | 3 | "`verifyLiveBoundary` returns `{ ok: true }` for an unchanged tree when given a snapshot that carries measurements, asserted by a unit test." | diff-local |
| Story 3 negative: Given a snapshot produced with measurements, when an unexcluded untracked file appears in the live checkout before verification and containment is not in force, then verification fails with the existing `live checkout changed during self-host execution` reason naming that path. | 3 | "With an unexcluded untracked file added and containment not in force, `verifyLiveBoundary` returns `ok: false` whose reason contains `live checkout changed during self-host execution` and names the path, asserted by a unit test." | diff-local |
| Story 3 negative: Given two fingerprints of an unchanged tree whose elapsed times differ, when the second is verified against the first's snapshot, then verification returns ok, because measurements are never part of the manifest comparison. | 3 | "`verifyLiveBoundary` compares only `surface.manifest`, so a snapshot whose `elapsedMs` differs from the re-walk still verifies ok, asserted by a unit test that mutates the measurement." | diff-local |
| Story 3 negative: Given a file inside an excluded subtree such as `node_modules` or `.git`, when the fingerprint is built, then that file is neither hashed nor counted. | 3 | "Files under `node_modules/` and `.git/` appear in no manifest and add nothing to `fileCount`, and the diff leaves `LIVE_CHECKOUT_VOLATILE`, the provider volatile lists, `diffManifests`, and `classifyLiveCheckoutDiff` unmodified." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks naming a mechanism
- [ ] Dependencies are explicit and acyclic
