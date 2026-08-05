# Implementation Plan: conduct-state mutation ownership

**Date:** 2026-08-01
**Design:** `.docs/decisions/adr-2026-08-01-conduct-state-mutation-port.md`
**Stories:** `.docs/stories/conduct-state-json-lost-update-conductor-s-whole-o.md`
**Conflict check:** Clean as of 2026-08-01

## Summary

Build an intent-bearing `ConductStateStore` port, a correct single-host filesystem adapter, and migrate every production state writer behind it. Eighteen scoped TDD tasks cover field/batch mutations, conflicts, leases, atomic persistence, reset compatibility, production wiring, and deterministic bypass prevention.

## Technical Approach

- Add semantic mutation, batch, replace, result, and error types beside the existing state domain; ordinary commands carry expected/current intent and never imply deletion by omission.
- Keep `readState` compatibility while moving persistence into a filesystem `ConductStateStore` adapter that acquires a bounded cross-process lease, re-reads under lease, resolves conflicts exhaustively, and atomically replaces the JSON file.
- Inject the store at production composition roots. Migrate helper, conductor, finish-record, daemon, and index/reset writes in bounded slices; no direct `conduct-state.json` persistence remains outside the adapter.
- Register only field-specific semantic precedence (`feature_status: complete` initially). Step-status changes, including deliberate invalidation, use expected values rather than generic ranking.
- Enforce the boundary mechanically with a deterministic source audit and isolated tests. The hosted adapter/service remains out of scope.

## Prerequisites

- Approved ADR `adr-2026-08-01-conduct-state-mutation-port`.
- Existing Node/TypeScript stack and Vitest suite; no new external service or account.
- Test work follows `.agents/skills/write-tests/SKILL.md`: isolated temporary roots, mocked/fake third-party boundaries, and no real daemon/provider calls.

## Tasks

### Task 1: Define intent-bearing state-store domain types

**Story:** TS-1 ordinary mutations and atomic invariants; TS-2 typed conflicts; TS-5 replaceable seam
**Type:** infrastructure

**Steps:**
1. Write failing type/runtime contract tests for single-field mutations, named atomic batches, explicit replace, applied/idempotent/resolved results, and typed conflict/lease/persistence errors.
2. Verify the tests fail because the state-store contract does not exist.
3. Implement exhaustive semantic types and the `ConductStateStore` interface without filesystem mechanics.
4. Verify the contract tests pass.
5. Commit with message: `feat(state): define mutation store contract`.

**Files:**
- `src/conductor/src/types/state.ts`
- `src/conductor/src/engine/conduct-state-store.ts`
- `src/conductor/test/engine/conduct-state-store.test.ts`

**Wired-into:** `src/conductor/src/engine/state.ts#saveStepStatus, src/conductor/src/engine/conductor.ts#Conductor`

**Dependencies:** none

### Task 2: Implement local adapter read compatibility and single-field apply

**Story:** TS-1 happy path; TS-4 flat-JSON compatibility
**Type:** happy-path

**Steps:**
1. Write failing adapter tests that load representative existing flat JSON and apply one expected-value field mutation while preserving every other field.
2. Verify RED, including the stale whole-snapshot reproduction.
3. Implement the filesystem adapter's read and single-field apply core using an injectable persistence boundary; defer lease/atomic hardening to owning tasks.
4. Verify GREEN.
5. Commit with message: `feat(state): apply field mutations without clobbering peers`.

**Files:**
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/filesystem-conduct-state-store.test.ts`

**Wired-into:** `src/conductor/src/engine/state.ts#saveStepStatus`

**Dependencies:** Task 1

### Task 3: Pin the two-writer disjoint-update race

**Story:** TS-1 disjoint concurrent updates in both orders
**Type:** happy-path

**Steps:**
1. Add failing deterministic tests with two stale clients mutating different fields in both commit orders.
2. Verify the legacy whole-object path loses one update while the adapter contract test fails RED.
3. Complete adapter merge behavior so each command authorizes only its target field.
4. Verify both orderings retain both values.
5. Commit with message: `test(state): pin disjoint writer preservation`.

**Files:**
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/filesystem-conduct-state-store.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 4: Make mutation batches all-or-nothing

**Story:** TS-1 multi-field invariant and conflict rollback
**Type:** negative-path

**Steps:**
1. Write failing tests for a named step-status/`last_step` batch and for a batch whose second operation conflicts.
2. Verify RED proves partial application is possible or unsupported.
3. Evaluate the full batch against one current snapshot and persist only after every operation resolves successfully.
4. Verify success changes both fields and failure changes neither.
5. Commit with message: `feat(state): apply invariant batches atomically`.

**Files:**
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/filesystem-conduct-state-store.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 3

### Task 5: Implement exhaustive same-field conflict policy

**Story:** TS-2 idempotency, terminal completion, deliberate invalidation, unresolved conflict
**Type:** negative-path

**Steps:**
1. Write failing table tests for expected-match apply, already-equal idempotency, terminal `feature_status: complete`, authorized `done → stale`, and unruled same-field conflict.
2. Verify RED.
3. Implement exhaustive field-specific conflict evaluation with no generic `StepStatus` ordering.
4. Verify each disposition and unchanged-state assertion passes.
5. Commit with message: `feat(state): resolve only proven state conflicts`.

**Files:**
- `src/conductor/src/engine/conduct-state-conflicts.ts`
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/conduct-state-conflicts.test.ts`

**Wired-into:** `src/conductor/src/engine/filesystem-conduct-state-store.ts#apply`

**Dependencies:** Task 4

### Task 6: Emit safe structured conflict diagnostics

**Story:** TS-2 conflict visibility and secret-safe summaries
**Type:** negative-path

**Steps:**
1. Write failing tests for conflict/resolution diagnostics containing field, writer, intent, disposition, and bounded/redacted value summaries.
2. Verify RED and assert raw secret-like/unbounded values are absent.
3. Add injectable diagnostics and safe summarization to conflict outcomes.
4. Verify GREEN.
5. Commit with message: `feat(state): log state conflicts without leaking values`.

**Files:**
- `src/conductor/src/engine/conduct-state-conflicts.ts`
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/conduct-state-conflicts.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Task 5

### Task 7: Persist accepted mutations by atomic replacement

**Story:** TS-3 valid JSON and persistence failure integrity
**Type:** negative-path

**Steps:**
1. Write failing failure-injection tests for temporary-file creation, sync/close, rename, and cleanup boundaries; assert prior bytes remain valid and no success is returned.
2. Verify RED.
3. Implement same-directory temporary write, durable close/sync as supported by the existing platform contract, atomic rename, and cleanup with injectable filesystem operations.
4. Verify success produces backward-compatible formatted JSON and every injected failure preserves the prior file.
5. Commit with message: `feat(state): persist mutations with atomic replacement`.

**Files:**
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/filesystem-conduct-state-store.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 6

### Task 8: Serialize competing local processes

**Story:** TS-3 exclusive writer serialization and fresh re-evaluation
**Type:** infrastructure

**Steps:**
1. Write a failing deterministic process-boundary test whose first writer holds the lease while a second attempts a mutation, then releases it.
2. Verify RED without launching a real daemon.
3. Implement atomic lease acquisition, bounded polling, owner metadata, and release around read/evaluate/persist.
4. Verify exactly one writer evaluates at a time and the second sees the first's committed state.
5. Commit with message: `feat(state): serialize local state writers`.

**Files:**
- `src/conductor/src/engine/conduct-state-lease.ts`
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/conduct-state-lease.test.ts`

**Wired-into:** `src/conductor/src/engine/filesystem-conduct-state-store.ts#apply, src/conductor/src/engine/filesystem-conduct-state-store.ts#replace`

**Dependencies:** Task 7

### Task 9: Fail closed on lease contention and ambiguous recovery

**Story:** TS-3 live-owner timeout, dead-owner recovery, corrupt metadata, worktree isolation
**Type:** negative-path

**Steps:**
1. Write failing tests for live-owner timeout, provably dead owner recovery, corrupt/ambiguous metadata refusal, and two independent worktree state paths.
2. Verify RED.
3. Implement conservative recovery proof, typed timeout/recovery errors, recovery diagnostics, and path-local lease identity.
4. Verify no ambiguous case steals a lease and distinct worktrees never contend.
5. Commit with message: `feat(state): recover leases conservatively`.

**Files:**
- `src/conductor/src/engine/conduct-state-lease.ts`
- `src/conductor/test/engine/conduct-state-lease.test.ts`

**Wired-into:** same as Task 8

**Dependencies:** Task 8

### Task 10: Implement privileged replacement for reset

**Story:** TS-4 explicit reset, omitted-field preservation, corrupt-file and lease failures
**Type:** negative-path

**Steps:**
1. Write failing tests showing ordinary mutations cannot delete omitted fields while privileged replacement clears all intended fields, including `pr_url` and completion.
2. Add corrupt/empty state, lease-failure, and atomic-replacement failure cases that preserve original bytes and return failure.
3. Implement the separate replacement operation under the same lease/atomic boundary.
4. Verify GREEN and no ordinary mutation exposes replacement authority.
5. Commit with message: `feat(state): make reset an explicit replacement`.

**Files:**
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/filesystem-conduct-state-store.test.ts`

**Wired-into:** `src/conductor/src/engine/command-state.ts#replaceCommandState`

**Dependencies:** Task 9

### Task 11: Migrate reusable state helper functions

**Story:** TS-4 migration compatibility; TS-5 helper wiring and typed failures
**Type:** refactor

**Steps:**
1. Write failing helper tests proving step status plus `last_step` is one batch and complexity, PR URL, and completion use field mutations.
2. Verify RED against direct whole-object helper writes.
3. Refactor `saveStepStatus`, `setComplexityTier`, `savePrUrl`, and `markFeatureComplete` to use an injected/default store and propagate typed errors.
4. Verify existing read/migration helpers remain compatible and tests pass.
5. Commit with message: `refactor(state): route helpers through mutation store`.

**Files:**
- `src/conductor/src/engine/state.ts`
- `src/conductor/test/engine/state.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor, src/conductor/src/engine/finish-record-cli.ts#dispatchFinishRecord`

**Dependencies:** Task 10

### Task 12: Inject the persistent adapter into conductor composition

**Story:** TS-5 persistent production default and replaceable adapter
**Type:** infrastructure

**Steps:**
1. Write failing composition tests asserting production constructs the filesystem adapter and a supplied fake adapter receives conductor mutations.
2. Verify RED.
3. Add store injection to conductor dependencies with the persistent filesystem adapter as the production default; do not register an in-memory default.
4. Verify GREEN and existing constructor callers compile.
5. Commit with message: `feat(conductor): inject persistent state store`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/conductor-deps.ts`
- `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main, src/conductor/src/daemon-cli.ts#runConductorInWorktree`

**Dependencies:** Task 11

### Task 13: Migrate conductor initialization and DECIDE transitions

**Story:** TS-1 preservation; TS-5 complete conductor wiring
**Type:** happy-path

**Steps:**
1. Write failing focused conductor tests for session/run timestamps, worktree metadata, complexity, track, and DECIDE step transitions through a recording store fake.
2. Verify RED identifies direct writes in these paths.
3. Replace initialization and DECIDE whole-state saves with field mutations or named invariant batches.
4. Verify behavior and error propagation remain correct.
5. Commit with message: `refactor(conductor): mutate decide state through store`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** same as Task 12

**Dependencies:** Task 12

### Task 14: Migrate conductor BUILD and kickback transitions

**Story:** TS-1 atomic transitions; TS-2 explicit invalidation; TS-5 typed failure propagation
**Type:** happy-path

**Steps:**
1. Write failing focused tests for BUILD progress, grouped joins, failure/stale transitions, kickbacks, and navigation batches through the store fake.
2. Verify RED identifies direct writes and pins `done → stale/pending` as explicit expected-value mutations.
3. Migrate BUILD, group, navigation, and kickback write sites in bounded logical batches.
4. Verify GREEN, including failed store outcomes never becoming successful step transitions.
5. Commit with message: `refactor(conductor): mutate build state through store`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/conductor.test.ts`
- `src/conductor/test/engine/when-parallel.test.ts`

**Wired-into:** same as Task 12

**Dependencies:** Task 13

### Task 15: Migrate conductor SHIP, termination, and completion transitions

**Story:** TS-2 terminal completion; TS-5 complete conductor wiring and failures
**Type:** happy-path

**Steps:**
1. Write failing focused tests for finish adoption, checkpoint quit/back, terminal markers, completion, signal handling, and error exits through the store fake.
2. Verify RED identifies remaining direct writes.
3. Migrate SHIP and termination paths; use terminal completion policy and retain best-effort behavior only where the existing contract explicitly allows it, with diagnostics.
4. Verify GREEN and no conflict/persistence error is silently reported as a successful ship.
5. Commit with message: `refactor(conductor): mutate terminal state through store`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/conductor-terminal-marker.test.ts`
- `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** same as Task 12

**Dependencies:** Task 14

### Task 16: Migrate finish-record to the shared authority

**Story:** TS-1 observed two-writer race; TS-4 corrupt-state compatibility; TS-5 CLI wiring
**Type:** happy-path

**Steps:**
1. Write failing finish-record tests proving `pr_url` mutation preserves concurrent unrelated fields, conflicts propagate, corrupt JSON remains byte-identical, and the finish-choice marker remains the commit point.
2. Verify RED against direct read-modify-write.
3. Inject/use the store port for `pr_url` while preserving durable shipment checks and state-before-marker ordering.
4. Verify GREEN and remove dependence on sticky `pr_url` write behavior.
5. Commit with message: `refactor(finish): record pr url through state store`.

**Files:**
- `src/conductor/src/engine/finish-record-cli.ts`
- `src/conductor/test/engine/finish-record-cli.test.ts`

**Wired-into:** `src/conductor/src/engine/finish-record-cli.ts#dispatchFinishRecord`

**Dependencies:** Task 15

### Task 17: Migrate daemon, reset, and recovery command writers

**Story:** TS-4 explicit reset/start-over; TS-5 all production CLI writers
**Type:** happy-path

**Steps:**
1. Write failing command tests for daemon base-state mutations, corrective writes, `--reset`, and start-over using recording/failing store fakes.
2. Verify RED identifies direct writes and pins explicit replacement only on deliberate clearing paths.
3. Route daemon/index/recovery mutation sites through the store, inject the production adapter at command composition, and remove `allowPrUrlClear`.
4. Verify GREEN and typed store failures remain visible/actionable.
5. Commit with message: `refactor(cli): centralize conduct state mutations`.

**Files:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/src/index.ts`
- `src/conductor/src/engine/state.ts`
- `src/conductor/src/engine/command-state.ts`
- `src/conductor/src/engine/daemon-state.ts`
- `src/conductor/test/engine/daemon-cli.test.ts`
- `src/conductor/test/engine/state.test.ts`

**Wired-into:** `src/conductor/src/engine/command-state.ts#recoverCommandState, src/conductor/src/engine/daemon-state.ts#persistDaemonBaseState`

**Dependencies:** Task 16

### Task 18: Enforce the no-bypass production boundary

**Story:** TS-5 deterministic bypass prevention and isolated test policy
**Type:** negative-path

**Steps:**
1. Write a failing deterministic structural test that inventories production references to raw `conduct-state.json` persistence and permits them only inside the filesystem adapter; include a fixture proving a bypass is rejected.
2. Verify RED against any remaining direct writer and ensure read-only consumers are not false positives.
3. Remove/migrate the final bypasses and encode the narrow allowed persistence boundary in the audit.
4. Verify GREEN using isolated fixtures only—no real daemon, provider, GitHub, or operator state.
5. Commit with message: `test(state): reject conduct state writer bypasses`.

**Files:**
- `src/conductor/test/engine/conduct-state-writer-boundary.test.ts`
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/src/engine/state.ts`

**Wired-into:** `src/conductor/src/engine/filesystem-conduct-state-store.ts#createFilesystemConductStateStore`

**Dependencies:** Task 17

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12
                                                12 → 13 → 14 → 15 → 16 → 17 → 18
```

## Integration Points

- After Task 5: mutation and conflict semantics are executable independent of filesystem concurrency.
- After Task 10: the complete local adapter contract—mutation, batch, conflict, lease, atomic persistence, and reset—is usable.
- After Task 12: production composition can substitute recording/failing or future adapters without changing clients.
- After Task 15: every conductor phase uses the mutation authority.
- After Task 17: all known production CLI/state writers use the same authority.
- Task 18 owns the permanent mechanical prevention of writer bypasses.

## Acceptance Coverage

| Story criterion group | Owning tasks |
|---|---|
| TS-1 disjoint mutations, both orders | 2, 3 |
| TS-1 atomic invariant batch and rollback | 4 |
| TS-2 idempotency, completion precedence, invalidation, conflict | 5 |
| TS-2 safe diagnostics | 6 |
| TS-3 atomic JSON persistence and injected failures | 7 |
| TS-3 serialization | 8 |
| TS-3 contention, recovery, corrupt metadata, worktree isolation | 9 |
| TS-4 compatibility, omission, explicit reset, corrupt/failure paths | 2, 10, 11, 17 |
| TS-5 port/types and persistent default | 1, 12 |
| TS-5 conductor production wiring | 13, 14, 15 |
| TS-5 finish-record and CLI wiring | 16, 17 |
| TS-5 typed error propagation | 11–17 |
| TS-5 deterministic bypass audit and isolated boundaries | 18 |

## Verification

- [x] Every accepted happy path maps to at least one task.
- [x] Every accepted negative path maps to an explicit behavior-owning task.
- [x] Every task declares dependencies and the graph is acyclic.
- [x] Every new production surface declares a design-derived `Wired-into:` contract.
- [x] No terminal catch-all validation task exists; Task 18 implements the named production bypass invariant.
- [x] Task count is 18, within the normal 1–20 range.
