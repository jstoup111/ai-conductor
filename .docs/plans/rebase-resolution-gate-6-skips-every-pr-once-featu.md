# Implementation Plan: Rebase resolution with retained feature worktrees

**Date:** 2026-07-30
**Design:** `.docs/decisions/adr-2026-07-04-resolution-worktree-lifecycle.md`
**Stories:** `.docs/stories/rebase-resolution-gate-6-skips-every-pr-once-featu.md`
**Conflict check:** Skipped for Small tier; the pre-existing autoresolve story and lifecycle ADR
have been amended in this spec to remove their former contradiction.

## Summary

Replace autoresolve's retained-directory proxy with the daemon pool's authoritative in-memory
feature-run ownership signal. Three TDD tasks change the eligibility contract, carry the live
predicate through the daemon sweep boundary, and wire the production autoresolve callback.

## Technical Approach

The daemon pool's `inFlight` map is the existing mechanical authority for feature runs owned by the
current process. Extend the zero-argument mergeable-sweep dependency so the core supplies a
read-only `isFeatureInFlight(slug)` predicate derived from that map. The production daemon binding
passes the predicate into autoresolve eligibility, replacing `worktreeExists`; retained directories
therefore become irrelevant to eligibility while active slugs fail closed with an explicit reason.
The existing `resolutionInFlight` flag remains the separate authority for serializing resolution
attempts.

No filesystem marker or persisted lease is introduced. This avoids stale-marker recovery semantics
and keeps the change scoped to live concurrency ownership.

## Prerequisites

- Issue #1091's retained-worktree behavior is present on the base branch.
- The accepted story and amended lifecycle ADR in this spec are authoritative.
- All tests use injected predicates and local temporary files only; no GitHub, provider, or network
  boundary is called.

## Tasks

### Task 1: Replace directory eligibility with feature-run activity

**Story:** Resolve conflicts while an idle feature worktree is retained — retained-idle happy path
and active-run negative path.
**Type:** happy-path

**Steps:**
1. Change the focused autoresolve tests so an injected inactive predicate makes a retained slug
   eligible and an active predicate rejects it with an `active feature run` reason; verify RED.
2. Replace `AutoresolveFs.worktreeExists` with an injected feature-activity contract queried by
   `entry.slug`.
3. Remove the `.worktrees/<slug>` existence calculation from Gate 6 while leaving gates 0–5 and
   their ordering unchanged.
4. Run the focused autoresolve test files and verify GREEN.
5. Commit with message: `fix(autoresolve): gate on active feature runs (#1150)`.

**Files:**
- `src/conductor/src/engine/autoresolve.ts`
- `src/conductor/test/engine/autoresolve.test.ts`
- `src/conductor/test/engine/autoresolve-guards.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#sweepMergeableLabels autoresolve binding`

**Dependencies:** none

### Task 2: Carry live feature ownership through the daemon sweep

**Story:** Resolve conflicts while an idle feature worktree is retained — eligibility returns after
the active run ends; existing resolution serialization remains unchanged.
**Type:** infrastructure

**Steps:**
1. Add focused daemon-core tests whose injected sweep captures `isFeatureInFlight`: before dispatch
   it returns false, during a controlled unresolved `runFeature` promise it returns true for only
   that slug, and after settlement it returns false; verify RED.
2. Widen `DaemonDeps.sweepMergeableLabels` to receive a read-only activity context.
3. Have `sweepBestEffort` supply a predicate closed over the daemon pool's `inFlight` map without
   exposing or mutating the map.
4. Keep startup, completion-boundary, and idle sweep failures best-effort and preserve existing
   resolution serialization behavior.
5. Run the focused daemon tests and verify GREEN.
6. Commit with message: `refactor(daemon): expose live feature ownership to sweeps (#1150)`.

**Files:**
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/test/engine/daemon.test.ts`

**Wired-into:** `src/conductor/src/engine/daemon.ts#sweepBestEffort`

**Dependencies:** Task 1

### Task 3: Wire production eligibility and retained-worktree coexistence

**Story:** Resolve conflicts while an idle feature worktree is retained — production dispatch,
explicit active-run logging, and disjoint checkout coexistence.
**Type:** negative-path

**Steps:**
1. Add a focused production-wiring test proving the daemon-supplied predicate reaches
   `isEligibleForResolve`; verify RED for both inactive and active slug states.
2. Update the `daemon-cli` mergeable-sweep binding to accept the activity context and inject its
   predicate into autoresolve eligibility, removing the `existsSync` worktree adapter.
3. Update the focused worktree-lifecycle integration fixture so a retained feature checkout and
   `resolve-<slug>` checkout coexist through resolution teardown, while only the transient checkout
   is removed.
4. Assert the active case creates no transient checkout and logs the active-run skip reason.
5. Run the affected production-wiring and lifecycle tests plus the test-file-inclusive typecheck;
   verify GREEN.
6. Commit with message: `fix(daemon): allow resolution beside retained worktrees (#1150)`.

**Files:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/integration/mergeable-sweep-autoresolve.test.ts`
- `src/conductor/test/integration/autoresolve-worktree-lifecycle.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemon sweepMergeableLabels dependency`

**Dependencies:** Task 2

## Task Dependency Graph

`Task 1 → Task 2 → Task 3`

## Integration Points

- After Task 1: autoresolve's pure eligibility truth table distinguishes active from idle slugs.
- After Task 2: daemon sweep callbacks can observe exact live pool ownership without persisted state.
- After Task 3: the production sweep uses that authority and retained/transient worktree coexistence
  is covered at the lifecycle boundary.

## Acceptance Coverage

| Story criterion | Tasks |
|---|---|
| Retained, idle feature worktree allows resolution | 1, 3 |
| Retained feature and transient resolution checkouts coexist | 3 |
| Eligibility returns after the feature run ends | 2, 3 |
| Active feature run skips resolution with an explicit reason | 1, 3 |
| Existing resolution serial guard remains effective | 1, 2 |
| Lifecycle ADR no longer equates directory presence with ownership | Spec amendment already committed with this plan |

## Verification

- [x] All happy-path criteria map to implementation tasks.
- [x] The active-run negative path has focused RED/GREEN ownership.
- [x] No task invokes a real third party or unbounded Conductor fixture.
- [x] Every task declares an explicit acyclic dependency and production wiring site.
- [x] No terminal catch-all validation task is present.
