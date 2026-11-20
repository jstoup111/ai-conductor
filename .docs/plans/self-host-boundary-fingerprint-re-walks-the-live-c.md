# Implementation Plan: One live-boundary snapshot per self-host dispatch

**Date:** 2026-11-15
**Design:** none (technical track, Tier S — see `.docs/track/self-host-boundary-fingerprint-re-walks-the-live-c.md`)
**Stories:** .docs/stories/self-host-boundary-fingerprint-re-walks-the-live-c.md
**Conflict check:** Not required (Tier S)

## Summary

Make every provider candidate in one admitted self-host dispatch share one live-boundary snapshot (#3621). The live checkout and each distinct provider home are fingerprinted once and verified once per dispatch, instead of once per candidate preparation, and one fingerprint event is emitted per snapshot taken. Five tasks.

## Technical Approach

- **Verified current shape (main at `5d2f96421a`).**
  - `runAdmittedSelfBuildDispatch` in `src/conductor/src/engine/conductor.ts` installs `this.providerExecution.prepareCandidateSelfHost` for the duration of one `this.stepRunner.run(...)` call and restores the prior value in that call's `finally`. That installed closure is the dispatch scope; for `build_review` it covers every rubric reviewer of one lap.
  - Each call of that closure opens its own coordinator window (`openWindow?.({ contained: false, reason: 'candidate preparing' })`), calls `fingerprintLiveBoundary` (one walk of the live checkout plus one of the provider home), emits `self_host_boundary_fingerprint`, runs `probeContainment`, and returns an invocation whose `teardown` runs `verify()` (another walk of both surfaces through `verifyLiveBoundary`) and then the home or sandbox teardown. `verify()` emits `self_host_containment_verdict`, emits `contained_live_checkout_drift` when contained drift is found, sets `this.pendingLiveBoundaryHalt` on a violation, and closes the window.
  - `executeProviderCandidates` in `src/conductor/src/engine/provider-execution.ts` calls `prepareCandidateSelfHost` and then immediately `teardown()` for every candidate when `prepareCandidateBaseline` is supplied (multi-provider `build_review` rubrics, `step-runners.ts`), and again for the candidate it actually invokes. So a cross-provider panel pays two full walks per baseline preparation plus two per invocation.
  - `LiveBoundaryCoordinator.runDispatch` (`src/conductor/src/engine/self-host/live-boundary-coordinator.ts`) holds a reservation window for the whole admitted dispatch, so no dispatcher root mutation runs inside it; candidate windows can outlive the dispatch ("an expired preparation may still be unwinding").
  - `consumePendingLiveBoundaryHalt` writes the mechanical HALT at the next dispatch boundary; nothing between candidates consumes it.
  - The provider-home and sandbox teardowns write only into their own tmpdir scratch home and the feature worktree's `.pipeline/transcripts/` (`transcript-harvest.ts`), which is excluded from the live checkout surface, so moving verification after them changes neither surface.
- **Per-surface fingerprinting.** In `src/conductor/src/engine/self-host/live-boundary.ts`, extract two exported functions from `fingerprintLiveBoundary`: `fingerprintLiveCheckoutSurface(liveCheckout)` and `fingerprintProviderStateSurface({ unrelatedProviderState, provider, selectedAuthPaths })`, each returning `{ surface, measurement }`. `fingerprintLiveBoundary` composes them and keeps its exact output. `verifyLiveBoundary` already iterates `snapshot.surfaces` by label, so it accepts a snapshot with several `provider state` surfaces unchanged. No exclusion list, digest rule, diff classification, or containment rule changes.
- **Dispatch-scoped shared snapshot.** New `src/conductor/src/engine/self-host/dispatch-live-boundary.ts` exports `DispatchLiveBoundary`, constructed with `{ openWindow?, emit, onViolation }` plus injectable `fingerprintLiveCheckout`, `fingerprintProviderState` and `verify` (defaulting to the real functions). `acquire({ liveCheckout, providerHome, provider, selectedAuthPaths, probe })` returns `{ containment, release }`:
  - The first acquire opens one coordinator window. Surfaces are memoized by key (`live checkout` by root path; `provider state` by provider id plus home path) as shared promises, so concurrent acquires wait on one walk. A rejected fingerprint is not memoized: the acquire rejects, and if no surface has been taken and no lease is held the window is closed.
  - Each acquire that takes at least one new surface emits one `self_host_boundary_fingerprint` event carrying exactly the measurements it took (the first carries `live checkout` and its `provider state`; a later new home carries only its `provider state`).
  - `probe` runs once per dispatch, with the first snapshot; every lease returns that verdict.
  - A reference count tracks live leases. `end()` marks the dispatch ended. Verification runs exactly once, when the dispatch has ended and the count is zero: either inside `end()` or inside the last `release()` after it. It calls `verify` once over all memoized surfaces with the shared verdict, emits `self_host_containment_verdict`, emits `contained_live_checkout_drift` when the result carries contained drift, calls `onViolation(reason)` on failure (and `'Live boundary could not be verified.'` when `verify` throws), and closes the window in a `finally`. With no surface taken, `end()` verifies nothing and emits nothing. `acquire` after `end()` rejects without opening a window.
- **Conductor wiring.** `runAdmittedSelfBuildDispatch` constructs one `DispatchLiveBoundary` beside the installed closure (with `openWindow`, `this.events.emit`, and an `onViolation` that sets `this.pendingLiveBoundaryHalt`). The closure replaces its own window, `fingerprintLiveBoundary`, event emission, `probeContainment` call and `verify()` with `acquire(...)` (the probe callback is the existing `probeContainment` call or the disabled verdict). Teardown calls `release()` after the home or sandbox teardown; the existing `ownershipTransferred` `finally` calls `release()` on a failed preparation. The `finally` that restores the closure awaits `end()` so verification completes before the dispatch returns.
- **Test patterns.** Unit cases follow `src/conductor/test/engine/self-host/live-boundary.test.ts` (real temporary directories) and `src/conductor/test/engine/live-boundary-coordinator.test.ts` (real `LiveBoundaryCoordinator`, `runMutation` ordering). Conductor cases follow the `harness()` in `src/conductor/test/engine/conductor-live-boundary-events.test.ts`, whose fake runner calls `providerExecution.prepareCandidateSelfHost` `candidateAttempts` times inside one `stepRunner.run`, and the deferral harness in `src/conductor/test/engine/conductor-live-boundary-deferral.test.ts`. Count walks there with `vi.spyOn(liveBoundary, ...)` on the module namespace, as the existing fingerprint-failure case already does for `fingerprintLiveBoundary`.

## Prerequisites

- None.

## Tasks

### Task 1: Fingerprint each boundary surface on its own
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/self-host/live-boundary.test.ts`: over temporary live-checkout and provider-home directories, `fingerprintLiveCheckoutSurface` and `fingerprintProviderStateSurface` return the same surface and measurement entries that `fingerprintLiveBoundary` returns for the same inputs; and `verifyLiveBoundary` over a snapshot holding one `live checkout` and two `provider state` surfaces returns `ok: false` naming `provider state` when only the second home changed.
2. Verify RED.
3. Implement the two exported per-surface functions in `live-boundary.ts`; `fingerprintLiveBoundary` composes them. Leave `LIVE_CHECKOUT_VOLATILE`, the provider-state exclusions, `manifest`, `diffManifests`, `classifyLiveCheckoutDiff` and `verifyLiveBoundary` unchanged.
4. Verify GREEN; commit.

**Done when:**
- [test] `fingerprintLiveCheckoutSurface` and `fingerprintProviderStateSurface` return surfaces and measurements deep-equal to the matching entries of `fingerprintLiveBoundary` for the same live checkout and provider home.
- [test] `verifyLiveBoundary` over a snapshot with one `live checkout` and two `provider state` surfaces reports `ok: false` with a reason starting `provider state changed during self-host execution` when a file in only the second home changed.
- The diff to `live-boundary.ts` adds no entry to `LIVE_CHECKOUT_VOLATILE` or to any provider-state exclusion list.

**Files likely touched:**
- src/conductor/src/engine/self-host/live-boundary.ts — per-surface fingerprint functions
- src/conductor/test/engine/self-host/live-boundary.test.ts — composition and multi-home verify cases

**Dependencies:** none

### Task 2: A dispatch shares one fingerprint per surface across its candidates
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/self-host/dispatch-live-boundary.test.ts` with counting fakes for `fingerprintLiveCheckout`, `fingerprintProviderState`, `verify` and `probe`, a recording `emit`, and a real `LiveBoundaryCoordinator` driven through `runDispatch` for `openWindow`:
   - four sequential acquire/release pairs of one provider, then `end()`: one live-checkout fingerprint call, one provider-state fingerprint call, one `verify` call, one `probe` call, one emitted `self_host_boundary_fingerprint` carrying both measurements;
   - two acquires for providers `claude` and `codex` with different homes: one live-checkout fingerprint, one provider-state fingerprint per home, one `verify` call over three surfaces, and exactly two fingerprint events, the second carrying only the second home's `provider state` measurement;
   - four acquires started concurrently before any fingerprint resolves: one live-checkout fingerprint call serves all four;
   - the first live-checkout fingerprint rejects: that acquire rejects, no event is emitted, the coordinator holds no open window, and the next acquire calls the fingerprint again and succeeds;
   - `end()` with no acquire: no fingerprint, no `probe`, no `verify`, no event, and no window ever opened.
2. Verify RED.
3. Implement `DispatchLiveBoundary.acquire` as described in Technical Approach (memoized surface promises keyed by surface, one window, one probe, one event per acquire that took new surfaces, failed fingerprints not memoized).
4. Verify GREEN; commit.

**Done when:**
- [test] Four acquire/release pairs of one provider followed by `end()` call `fingerprintLiveCheckout` once, `fingerprintProviderState` once, `verify` once and `probe` once, and emit exactly one `self_host_boundary_fingerprint` whose surfaces are `live checkout` and `provider state`.
- [test] Acquires for two providers with different homes call `fingerprintLiveCheckout` once, `fingerprintProviderState` once per home and `verify` once over three surfaces, and emit exactly two fingerprint events, the first carrying the `live checkout` and first home's `provider state` measurements and the second carrying only the second home's `provider state` measurement.
- [test] Four concurrent acquires started before the first fingerprint resolves all resolve, each returning a lease backed by the same live-checkout surface, with exactly one `fingerprintLiveCheckout` call.
- [test] When the first `fingerprintLiveCheckout` rejects, that acquire rejects, no fingerprint event is emitted, the coordinator has no open window (a queued `runMutation` runs), and the next acquire calls `fingerprintLiveCheckout` a second time and resolves.
- [test] `end()` with no prior acquire makes no fingerprint, `probe` or `verify` call, emits no event, and opens no coordinator window.

**Files likely touched:**
- src/conductor/src/engine/self-host/dispatch-live-boundary.ts — new dispatch-scoped shared snapshot
- src/conductor/test/engine/self-host/dispatch-live-boundary.test.ts — sharing, concurrency, failure and empty cases

**Dependencies:** Task 1

### Task 3: The shared snapshot is verified once, after the dispatch ends and its last candidate releases
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/self-host/dispatch-live-boundary.test.ts`, using the real `verifyLiveBoundary` over temporary directories where the case needs real drift, and a real `LiveBoundaryCoordinator`:
   - a lease still held when `end()` resolves: `verify` has not run; an untracked file added to the live checkout before that lease's `release()` is reported, after release, through `onViolation` with a reason containing `added <that file>`;
   - a `runMutation` queued after the first acquire: it has not run after every lease is released while `verify` is held pending, and runs only after `verify` resolves;
   - an acquire whose candidate fails after the snapshot (its lease is released without invocation) followed by `end()`: `verify` runs exactly once and a queued `runMutation` then runs;
   - a live-checkout file changed after the snapshot and restored to its original bytes before `end()`: `onViolation` is not called;
   - proven containment with live-checkout drift: exactly one `self_host_containment_verdict` (`contained: true`) and one `contained_live_checkout_drift` event, and `onViolation` is not called;
   - `verify` throwing: `onViolation` receives `Live boundary could not be verified.` and the window is closed.
2. Verify RED.
3. Implement the reference count, `release()` and `end()` single-verification lifecycle and its event and violation reporting as described in Technical Approach.
4. Verify GREEN; commit.

**Done when:**
- [test] With a lease still held, `end()` resolves without calling `verify`, and an untracked live-checkout file added before that lease's `release()` produces exactly one `onViolation` call whose reason contains `added` and that file's path.
- [test] A `runMutation` queued after the first acquire does not run while `verify` is pending after the last release, and runs after `verify` resolves; the same holds when one candidate's lease was released without invocation, with `verify` called exactly once.
- [test] A live-checkout file changed after the snapshot and restored to its original bytes before verification produces no `onViolation` call.
- [test] Under a proven containment verdict, live-checkout drift produces exactly one `self_host_containment_verdict` with `contained: true`, exactly one `contained_live_checkout_drift`, and no `onViolation` call.
- [test] When `verify` throws, `onViolation` receives `Live boundary could not be verified.` and the coordinator window is closed.

**Files likely touched:**
- src/conductor/src/engine/self-host/dispatch-live-boundary.ts — release/end single-verification lifecycle
- src/conductor/test/engine/self-host/dispatch-live-boundary.test.ts — deferral, window, failure, restore and contained cases

**Dependencies:** Task 2

### Task 4: Self-host dispatches prepare every candidate from the shared snapshot
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-live-boundary-events.test.ts` with the existing `harness()`:
   - replace `emits one fingerprint for each completed candidate preparation across a retry` with a case whose two candidate preparations run in one dispatch and persist exactly one `self_host_boundary_fingerprint` to `.pipeline/events.jsonl`;
   - `candidateAttempts: 4` with spies on `liveBoundary.fingerprintLiveCheckoutSurface` and `liveBoundary.verifyLiveBoundary`: each called exactly once, and one fingerprint event carrying `live checkout` and `provider state` persisted;
   - update the existing fingerprint-failure case to spy on `liveBoundary.fingerprintLiveCheckoutSurface` (instead of the no-longer-called `fingerprintLiveBoundary`) and keep its assertions;
   - keep the existing `isolates a throwing fingerprint subscriber` case unchanged.
2. Verify RED.
3. In `runAdmittedSelfBuildDispatch`, construct one `DispatchLiveBoundary` per dispatch and replace the closure's window, `fingerprintLiveBoundary`, event emission, `probeContainment` and per-candidate `verify()` with `acquire`/`release`, and await `end()` in the `finally` that restores `prepareCandidateSelfHost`, as described in Technical Approach. Teardown calls `release()` after the home or sandbox teardown; the `ownershipTransferred` `finally` calls `release()` on a failed preparation. Keep `pendingLiveBoundaryHalt` and `consumePendingLiveBoundaryHalt` as the only HALT path.
4. Verify GREEN; commit.

**Done when:**
- [test] A dispatch with four candidate preparations calls `fingerprintLiveCheckoutSurface` once and `verifyLiveBoundary` once, and persists exactly one `self_host_boundary_fingerprint` whose surfaces are `live checkout` and `provider state`.
- [test] A dispatch with two candidate preparations persists exactly one `self_host_boundary_fingerprint` to `.pipeline/events.jsonl`, and the existing `daemon-render-boundary-fingerprint.test.ts` still renders one such event as one `self-host boundary fingerprint` line.
- [test] When `fingerprintLiveCheckoutSurface` rejects, no `self_host_boundary_fingerprint` event is persisted and the provider is not invoked.
- [test] The existing `isolates a throwing fingerprint subscriber` case still shows the provider invoked once and exactly one containment verdict emitted when a `self_host_boundary_fingerprint` subscriber throws.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — prepare candidates through one DispatchLiveBoundary per dispatch
- src/conductor/test/engine/conductor-live-boundary-events.test.ts — per-dispatch event, walk-count and fingerprint-failure cases

**Dependencies:** Task 3

### Task 5: Drift during any candidate of a shared-snapshot dispatch still halts at the next boundary
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Add tests in `src/conductor/test/engine/conductor-live-boundary-events.test.ts` with the existing `harness()`; they prove Task 4's wiring and are expected to pass on it:
   - `candidateAttempts: 2` where the first attempt fails and the second writes an untracked file into the live checkout and succeeds: the `build` step state is `done`, a `loop_halt` is emitted, and the mechanical HALT reason contains `added` and that file name;
   - the existing contained-drift case re-run with `candidateAttempts: 2`: exactly one `contained_live_checkout_drift` and one `self_host_containment_verdict` persisted, and no HALT;
   - `maxRetries: 2` with a first dispatch that fails and a spy on `liveBoundary.fingerprintProviderStateSurface` whose second call first rewrites a non-volatile file in the provider home and then calls through: two fingerprint events persisted, and no `loop_halt` or HALT marker.
2. Run the existing `src/conductor/test/engine/conductor-live-boundary-deferral.test.ts` against Task 4's wiring; adjust only harness plumbing that named the removed per-candidate call, never an assertion.
3. Verify GREEN; commit.

**Done when:**
- [test] When the second of two candidates in one dispatch adds an untracked live-checkout file and succeeds, the `build` step state is `done`, a `loop_halt` is emitted at the next dispatch boundary, and the mechanical HALT reason contains `added` and that file name.
- [test] With two candidates under proven containment and live-checkout drift, exactly one `contained_live_checkout_drift` and exactly one `self_host_containment_verdict` are persisted and no HALT is written.
- [test] Across two dispatches where the provider home changes after the first dispatch's verification and before the second's fingerprint, two fingerprint events are persisted and neither `loop_halt` nor a HALT marker is written.
- [test] The existing deferral cases `lets a step that completed mid-change keep its own success verdict` and `still halts the run, with the boundary reason and a mechanical class` pass with unchanged assertions.

**Files likely touched:**
- src/conductor/test/engine/conductor-live-boundary-events.test.ts — drift, contained and two-dispatch cases
- src/conductor/test/engine/conductor-live-boundary-deferral.test.ts — harness plumbing only, if needed

**Verify-only:** yes

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ─> Task 2 ─> Task 3 ─> Task 4 ─> Task 5
```

## Integration Points

- After Task 4: a self-host `build_review` lap fingerprints and verifies the live checkout once, and the daemon log shows one fingerprint line per snapshot.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given one self-host dispatch that runs four candidate preparations of the same provider against the same live checkout, when the dispatch completes, then the live checkout is walked exactly twice in that dispatch: once to fingerprint and once to verify. | 4 | "A dispatch with four candidate preparations calls `fingerprintLiveCheckoutSurface` once and `verifyLiveBoundary` once, and persists exactly one `self_host_boundary_fingerprint` whose surfaces are `live checkout` and `provider state`." | diff-local |
| Story 1 happy: Given one self-host dispatch whose candidates come from two providers with different provider homes, when the dispatch completes, then the live checkout is walked exactly twice and each provider home is walked exactly twice (once to fingerprint, once to verify). | 2 | "Acquires for two providers with different homes call `fingerprintLiveCheckout` once, `fingerprintProviderState` once per home and `verify` once over three surfaces, and emit exactly two fingerprint events, the first carrying the `live checkout` and first home's `provider state` measurements and the second carrying only the second home's `provider state` measurement." | diff-local |
| Story 1 happy: Given several candidate preparations in one dispatch that request the snapshot concurrently, when they all resolve, then a single live-checkout fingerprint walk serves every one of them. | 2 | "Four concurrent acquires started before the first fingerprint resolves all resolve, each returning a lease backed by the same live-checkout surface, with exactly one `fingerprintLiveCheckout` call." | diff-local |
| Story 1 negative: Given two consecutive self-host dispatches where the provider state changed between them, when the second dispatch prepares its first candidate, then it takes a fresh snapshot instead of reusing the first dispatch's baseline, and the second dispatch verifies clean. | 5 | "Across two dispatches where the provider home changes after the first dispatch's verification and before the second's fingerprint, two fingerprint events are persisted and neither `loop_halt` nor a HALT marker is written." | diff-local |
| Story 1 negative: Given the first fingerprint attempt in a dispatch throws, when that candidate's preparation ends, then no fingerprint event is emitted, that candidate's provider is not invoked, and the next candidate preparation in the same dispatch attempts a new fingerprint instead of reusing the failure. | 2, 4 | "When the first `fingerprintLiveCheckout` rejects, that acquire rejects, no fingerprint event is emitted, the coordinator has no open window (a queued `runMutation` runs), and the next acquire calls `fingerprintLiveCheckout` a second time and resolves." | diff-local |
| Story 1 negative: Given a dispatch in which no candidate reaches self-host preparation, when the dispatch completes, then no fingerprint is taken, no coordinator window is opened, and no verification runs. | 2 | "`end()` with no prior acquire makes no fingerprint, `probe` or `verify` call, emits no event, and opens no coordinator window." | diff-local |
| Story 2 happy: Given one dispatch with several candidates and unproven containment, when an untracked file appears in the live checkout during any one candidate's run, then the dispatch's verification records a live-boundary violation naming that added path and the next dispatch boundary writes the mechanical HALT. | 5 | "When the second of two candidates in one dispatch adds an untracked live-checkout file and succeeds, the `build` step state is `done`, a `loop_halt` is emitted at the next dispatch boundary, and the mechanical HALT reason contains `added` and that file name." | diff-local |
| Story 2 happy: Given one dispatch with several candidates and proven containment, when the live checkout drifts during a candidate's run, then the dispatch persists exactly one `contained_live_checkout_drift` record and exactly one `self_host_containment_verdict`, and no HALT is written. | 5 | "With two candidates under proven containment and live-checkout drift, exactly one `contained_live_checkout_drift` and exactly one `self_host_containment_verdict` are persisted and no HALT is written." | diff-local |
| Story 2 happy: Given a dispatch whose candidates have all torn down when its step run settles, when the dispatch returns, then its verification has already completed, so the next dispatch boundary sees any violation it recorded. | 5 | "When the second of two candidates in one dispatch adds an untracked live-checkout file and succeeds, the `build` step state is `done`, a `loop_halt` is emitted at the next dispatch boundary, and the mechanical HALT reason contains `added` and that file name." | diff-local |
| Story 2 happy: Given a step that succeeded while the live checkout drifted, when the next dispatch boundary is reached, then the completed step keeps its own success verdict and the run halts there with the boundary reason and a mechanical class. | 5 | "The existing deferral cases `lets a step that completed mid-change keep its own success verdict` and `still halts the run, with the boundary reason and a mechanical class` pass with unchanged assertions." | diff-local |
| Story 2 negative: Given a candidate that is still unwinding after its dispatch has returned, when the dispatch returns, then verification waits until that candidate tears down, and a live-checkout change made before that teardown is still recorded as a violation. | 3 | "With a lease still held, `end()` resolves without calling `verify`, and an untracked live-checkout file added before that lease's `release()` produces exactly one `onViolation` call whose reason contains `added` and that file's path." | diff-local |
| Story 2 negative: Given a dispatcher root mutation queued while a dispatch holds a snapshot, when every candidate has torn down but the dispatch's verification has not finished, then the mutation waits until that verification finishes. | 3 | "A `runMutation` queued after the first acquire does not run while `verify` is pending after the last release, and runs after `verify` resolves; the same holds when one candidate's lease was released without invocation, with `verify` called exactly once." | diff-local |
| Story 2 negative: Given a candidate whose preparation fails after the dispatch's snapshot was taken, when the dispatch ends, then the snapshot is still verified once and the dispatch's coordinator window is closed, so no later root mutation is blocked. | 3 | "A `runMutation` queued after the first acquire does not run while `verify` is pending after the last release, and runs after `verify` resolves; the same holds when one candidate's lease was released without invocation, with `verify` called exactly once." | diff-local |
| Story 2 negative: Given the live checkout is restored to its snapshot state before the verification runs, when the dispatch verifies, then no violation is recorded, exactly as a per-candidate window that saw the same restore would record none. | 3 | "A live-checkout file changed after the snapshot and restored to its original bytes before verification produces no `onViolation` call." | diff-local |
| Story 3 happy: Given one dispatch with several candidates of one provider, when the dispatch completes, then exactly one `self_host_boundary_fingerprint` event is emitted and persisted, carrying both the `live checkout` and the `provider state` measurement, and the daemon log renders one `self-host boundary fingerprint` line for it. | 4 | "A dispatch with two candidate preparations persists exactly one `self_host_boundary_fingerprint` to `.pipeline/events.jsonl`, and the existing `daemon-render-boundary-fingerprint.test.ts` still renders one such event as one `self-host boundary fingerprint` line." | diff-local |
| Story 3 happy: Given one dispatch whose candidates use two provider homes, when the dispatch completes, then exactly two `self_host_boundary_fingerprint` events are emitted: the first carries the `live checkout` and first `provider state` measurements, the second carries only the second home's `provider state` measurement. | 2 | "Acquires for two providers with different homes call `fingerprintLiveCheckout` once, `fingerprintProviderState` once per home and `verify` once over three surfaces, and emit exactly two fingerprint events, the first carrying the `live checkout` and first home's `provider state` measurements and the second carrying only the second home's `provider state` measurement." | diff-local |
| Story 3 negative: Given a dispatch whose first fingerprint attempt throws, when the dispatch completes, then no `self_host_boundary_fingerprint` event is emitted for the failed attempt. | 2, 4 | "When the first `fingerprintLiveCheckout` rejects, that acquire rejects, no fingerprint event is emitted, the coordinator has no open window (a queued `runMutation` runs), and the next acquire calls `fingerprintLiveCheckout` a second time and resolves." | diff-local |
| Story 3 negative: Given a `self_host_boundary_fingerprint` subscriber that throws, when the event is emitted, then the candidate's provider is still invoked and the dispatch's containment verdict is still emitted. | 4 | "The existing `isolates a throwing fingerprint subscriber` case still shows the provider invoked once and exactly one containment verdict emitted when a `self_host_boundary_fingerprint` subscriber throws." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-R1: Remove the production-unreachable fingerprintLiveBoundary export from src/conductor/src/engine/self-host/live-boundary.ts. Move its two-surface composition (fingerprintLiveCheckoutSurface + fingerprintProviderStateSurface into { surfaces, measurements }) into a local helper in src/conductor/test/engine/self-host/live-boundary.test.ts, so every existing baseline and task 1's deep-equal assertion keep the same inputs and outputs. Drop the fingerprintLiveBoundary mock entry from src/conductor/test/engine/self-host-dispatch-admission.test.ts. Add no entry to LIVE_CHECKOUT_VOLATILE or to any provider-state exclusion list.
**Gate:** as-built
**Rationale:** Verified: fingerprintLiveBoundary (src/conductor/src/engine/self-host/live-boundary.ts:511) has no production caller. DispatchLiveBoundary (dispatch-live-boundary.ts) now calls fingerprintLiveCheckoutSurface and fingerprintProviderStateSurface directly. The only remaining references are live-boundary.test.ts, which uses it to build baselines and as the deep-equal oracle, and a vi.fn mock entry in self-host-dispatch-admission.test.ts. This is implementation drift inside task 1, which owns the per-surface extraction in live-boundary.ts. It needs no architecture decision: no ADR, exclusion list, digest rule, or containment rule changes. The repair moves the two-surface composition out of production into a test-local helper with the same name and output. Task 1's coverage survives: its deep-equal criterion and every existing baseline in live-boundary.test.ts are kept against the identical composition, and verifyLiveBoundary stays unchanged. Sibling check: the other production exports (verifyLiveBoundary and the two surface functions) are reached through DispatchLiveBoundary. Earlier features' ADRs that mention fingerprintLiveBoundary are sealed and only describe history, so they are found and excluded with no amendment.
**Parent task:** 1
**Governing clause:** Task 1
**Done when:**
- Task 1 is satisfied by this task.
- The repair for task rem-as-built-R1 is committed and its targeted tests pass.
