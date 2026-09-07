# Implementation Plan: Run memory-store setup on daemon dispatch

**Date:** 2026-09-06
**Stories:** .docs/stories/run-memory-store-setup-on-daemon-dispatch.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing memory contract — the same idempotent setup the inline path already runs, the same canonical store keyed by worktree-independent project identity, and the same event spine every other daemon observation rides.

## Summary

Five bounded tasks deliver #2062 by running the existing memory-store setup on the daemon's worktree-preparation path and reporting the resulting placement as an event. Memory read paths, provider selection, the write-fallback design, the migration algorithm, and the inline prelude's behaviour are outside this small slice.

## Technical Approach

The defect is a missing call, not missing behaviour. `dispatchMemorySetup` already performs exactly what the daemon path needs — migrate a real `.memory/` directory, otherwise ensure the canonical store — and both branches are idempotent. It is reached only from the inline prelude, so no daemon-dispatched worktree ever gets it.

Add the call at the daemon's dispatch preparation binding in `daemon-deps.ts`, immediately before it invokes `prepareWorktree`. That binding is daemon-only by construction and runs on every dispatch, which places setup before the project's setup script and before any session in the worktree, and makes the fix reach worktrees that already exist: a worktree carrying a stranded real `.memory/` directory is migrated on its next dispatch rather than needing separate one-off tooling. The deliberate alternative — calling from inside `prepareWorktree` — is rejected: that function also serves resolve worktrees through `autoresolve.ts` and is called directly by existing engine and acceptance tests against temporary directories, so an unconditional call there would create store directories under the operator's real home during an ordinary test run and drop an untracked symlink into fixtures whose tree cleanliness is asserted. Reaching the same seam through an opt-in option, the shape `dispatchStart` uses, would buy nothing here that the daemon-only binding does not already give.

`dispatchMemorySetup` writes progress lines to the console and maps failure to an exit code, which is right for a CLI and wrong for a daemon path: a raw console line for a fact an event already carries is the second-channel pattern the setup-marker decision record forbids on this exact function's neighbour. Extract the branch selection into a non-printing core in the same module that returns which branch ran and throws on failure, leave `dispatchMemorySetup` delegating to it with its printing and exit codes intact, and give the daemon path a separate fail-open observer in that module: it classifies `.memory/` before the call, runs the core, re-reads the path afterwards to decide whether it is canonical, emits one `memory_setup` event, and never throws. Deciding "canonical" by observing the path after the fact, rather than by trusting the branch that ran, keeps the report honest when the store is in a state neither branch fully resolved.

The event carries the state observed before setup, a boolean canonical verdict, and an optional failure reason. Registration is three places and no more: the union in `types/events.ts`, the exhaustive sink map in `event-sinks.ts` (persisted and rendered, not audited, not OTel), and the `renderDaemonEvent` switch in `daemon-cli.ts`. Persistence is derived from the sink map by the existing persister, so no persister change is needed, and the daemon dashboard's own subscription list is unrelated to the feature log this event belongs to.

Tests follow the repository's local test rules. The observer's cases are unit tests in the memory CLI test file, which already establishes the pattern this work reuses: redirect `HOME` and `USERPROFILE` to a temporary directory in `beforeEach`, build a real local git repository with an `origin` remote so the project key is stable, and restore the environment in `afterEach`. Search for that fixture pair in the existing memory tests rather than inventing a new one. The daemon binding test reuses the existing daemon-deps convention of mocking the worktree-prepare module and asserting on the binding's observable calls, so the real observer runs against a temporary worktree while the project setup boundary stays mocked. The renderer test follows the existing per-event daemon render tests, which call the exported renderer directly with a collecting log. No test may reach a real provider, network, or package registry, and none of these needs a conductor run.

## Preconditions and claim ledger

- Operator approved Small scope, the daemon-binding call site, the extracted non-printing core, and both stories on 2026-09-06 (delegated).
- Verified: `dispatchMemorySetup` in the memory CLI module selects migrate for a real directory and ensure otherwise, returns 0 or 1, and prints two possible progress lines; its only production caller is the inline prelude, which is called only from the CLI entry module.
- Verified: the daemon dispatch preparation binding in `daemon-deps.ts` receives the worktree, the log, the feature event emitter, and the work order, and calls `prepareWorktree` with the resolved base SHA; the daemon runner invokes that binding on every feature dispatch.
- Verified: `ensureMemoryStore` creates the canonical directory tree and index, replaces a symlink pointing elsewhere, and leaves a real directory untouched; `migrateMemory` copies to a backup, unions into the canonical store, verifies, then swaps to a symlink, and aborts without destructive change when verification fails.
- Verified: the project key derives from the origin URL, falling back to the common git directory, so a linked worktree and its root checkout resolve to the same store.
- Verified: `EVENT_SINKS` is typed as an exhaustive record over the union, so an added variant fails to compile until it is declared; the persister derives its subscriptions from that map.
- Verified: `renderDaemonEvent` is exported from the daemon CLI module and is exercised directly by existing per-event render tests.
- Verified: the memory CLI test file already redirects `HOME` and `USERPROFILE` to a temporary home and builds a real local repository with an origin remote.
- Scope check: consumer-facing engine behaviour; no new skill; provider-agnostic. Event spine: extend the union, no new channel, no exception needed.
- Verify-claims verdict: CLEAR. Every path, symbol, and behaviour above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Add the memory_setup event and its sink declaration
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, src/conductor/test/engine/event-sinks.test.ts
**Dependencies:** none

**Steps:**
1. Write a failing sink test asserting the new type is present in the persisted and rendered type lists and absent from the audited and OTel lists.
2. Verify the test fails (RED).
3. Add the union variant: a literal type tag, a before field limited to absent, directory, and symlink, a boolean canonical field, and an optional reason string, each with a short doc comment in the style of its neighbours.
4. Add the matching sink declaration with render and persist true, audit and OTel false.
5. Verify the test passes (GREEN) and the package typecheck target that includes tests is clean.
6. Commit the focused change.

**Done when:**
1. The new event type appears in the persisted and rendered type lists and in neither the audited nor the OTel list.
2. The sink map compiles as an exhaustive record over the union with the new variant declared.
3. The scoped test run for the sink test file passes and the typecheck target covering tests is clean.

### Task 2: Extract a non-printing setup core and add a fail-open observer
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/memory-cli.ts, src/conductor/test/engine/memory-cli.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit tests for a new observer function covering three starting states in a temporary repository under a redirected home: no memory path, a memory path that is already a symlink into the canonical store, and a real memory directory holding one entry file.
2. Assert in each case that the memory path ends as a symlink, that the migrated case's entry content is readable through the canonical store, and that the already-canonical case leaves the symlink target and the store's existing entries untouched.
3. Assert the observer emits exactly one event through an injected emitter, carrying the before state it observed and a true canonical verdict.
4. Verify the tests fail (RED).
5. Extract the existing branch selection into a non-printing core in the same module that returns which branch ran and throws on failure, and leave the existing CLI dispatch delegating to it with its console output and exit codes unchanged.
6. Implement the observer on top of that core: classify the memory path first, call the core, re-read the path to decide the canonical verdict, emit the event through the optional emitter, and return without throwing.
7. Verify the tests pass (GREEN) and commit.

**Done when:**
1. The observer leaves the memory path a symlink to the canonical store from the absent, already-canonical, and real-directory starting states.
2. The migrated fixture's entry content is readable through the canonical store after the observer runs.
3. The already-canonical fixture's symlink target and existing store entries are byte-identical before and after.
4. The existing CLI dispatch tests still pass unchanged, proving the extraction preserved its printing and exit-code contract.

### Task 3: Contain a setup failure so the dispatch survives it
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/memory-cli.ts, src/conductor/test/engine/memory-cli.test.ts
**Dependencies:** 2

**Steps:**
1. Write a failing unit test that drives the observer against a path whose setup cannot succeed, using an unwritable or nonexistent project directory so the core throws for a real reason rather than a stubbed one.
2. Assert the observer resolves rather than rejecting, and that it emits one event with a false canonical verdict carrying a non-empty reason derived from the underlying error.
3. Add a second case where the memory path exists but does not end canonical, asserting the verdict is false and the event is still emitted rather than omitted.
4. Verify the tests fail (RED).
5. Implement the containment: wrap the core call so any thrown error becomes the event's reason and a false verdict, and ensure the emit itself cannot propagate a failure to the caller.
6. Verify the tests pass (GREEN) and commit.

**Done when:**
1. The observer resolves without throwing when the underlying setup fails.
2. The emitted event carries a false canonical verdict and a non-empty reason for the failing case.
3. An event is emitted for the non-canonical outcome rather than suppressed.

### Task 4: Run the observer on the daemon's dispatch preparation
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon-deps.ts, src/conductor/test/engine/daemon-deps.test.ts
**Dependencies:** 3

**Steps:**
1. Write a failing test in the existing daemon-deps suite that invokes the dispatch preparation binding against a temporary worktree under a redirected home, following the file's existing convention of mocking the worktree-prepare module while the observer runs for real.
2. Assert the memory path is a symlink to the canonical store, that the mocked project preparation was called after the store was established, and that the feature emitter received the new event.
3. Add a case proving a failing observer does not prevent the binding from reaching the project preparation call.
4. Verify the tests fail (RED).
5. Call the observer at the top of the dispatch preparation binding, passing the worktree path and the emitter the binding already receives, before it invokes project preparation.
6. Verify the tests pass (GREEN) and commit.

**Done when:**
1. The dispatch preparation binding leaves the worktree's memory path a symlink to the canonical store.
2. The store is established before the binding invokes project preparation, asserted by call order rather than by inspection of the observer.
3. A failing observer still reaches the project preparation call, and the binding resolves.
4. The feature emitter passed to the binding receives exactly one of the new events per invocation.

### Task 5: Render the placement verdict in the daemon log
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-memory-setup.test.ts
**Dependencies:** 1

**Steps:**
1. Create the named test file as a new file, following the existing per-event daemon render tests: call the exported renderer directly with a collecting log function.
2. Write failing cases for a canonical payload, a non-canonical payload without a reason, and a non-canonical payload carrying a reason.
3. Verify the tests fail (RED).
4. Add the renderer case, naming the canonical verdict and the before state on one line and appending the reason only when present, using the same dimmed-dot prefix its neighbours use.
5. Verify the tests pass (GREEN), and confirm the renderer's defensive wrapper still swallows a malformed payload rather than throwing.
6. Commit the focused change.

**Done when:**
1. The rendered line for a canonical payload names the canonical verdict and the observed before state.
2. The rendered line for a non-canonical payload names the non-canonical verdict, and includes the reason only when the payload carries one.
3. The new render test file passes in isolation and alongside the existing daemon render tests.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon-dispatched worktree whose `.memory/` is absent, when the daemon prepares that worktree, then `.memory/` is a symlink to the project's canonical store before the project's setup script is run. | 2, 4 | "The store is established before the binding invokes project preparation, asserted by call order rather than by inspection of the observer." | diff-local |
| Story 1 happy: Given a daemon-dispatched worktree whose `.memory/` is already a symlink to the canonical store, when the daemon prepares that worktree, then the symlink target and the store's existing entries are unchanged. | 2 | "The already-canonical fixture's symlink target and existing store entries are byte-identical before and after." | diff-local |
| Story 1 happy: Given a daemon-dispatched worktree holding a real `.memory/` directory with entries, when the daemon prepares that worktree, then those entries are readable in the canonical store and `.memory/` is a symlink to it. | 2 | "The migrated fixture's entry content is readable through the canonical store after the observer runs." | diff-local |
| Story 1 negative: Given memory-store setup throws for a daemon-dispatched worktree, when the daemon prepares that worktree, then preparation continues to the project setup step and the dispatch is not aborted. | 3, 4 | "A failing observer still reaches the project preparation call, and the binding resolves." | diff-local |
| Story 2 happy: Given the daemon prepares a worktree, when memory-store setup completes, then one event records the state observed before setup and whether `.memory/` is canonical afterwards. | 1, 2, 4 | "The feature emitter passed to the binding receives exactly one of the new events per invocation." | diff-local |
| Story 2 happy: Given that event reaches the daemon renderer, when the daemon log line is written, then it names the canonical verdict and the state observed before setup. | 5 | "The rendered line for a canonical payload names the canonical verdict and the observed before state." | diff-local |
| Story 2 negative: Given memory-store setup fails, when the event is emitted, then it reports a non-canonical verdict carrying the failure reason rather than being omitted. | 3, 5 | "The emitted event carries a false canonical verdict and a non-empty reason for the failing case." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the sink-declaration unit assertions for the persisted and rendered routing. Task 2 owns the observer's unit cases for the three starting states and the single emission, and inherits the existing CLI dispatch cases as the regression pin on the extraction. Task 3 owns the failure-containment unit cases. Task 4 owns the one integration point — the daemon's dispatch preparation binding — with the project-preparation boundary mocked per the existing convention in that suite and the observer running for real. Task 5 owns the renderer cases. The existing memory store and migration suites remain authoritative for store creation, idempotency, concurrency, and migration reversal; none of that is re-tested here. No aggregate, conductor-driven, or external-service test is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 3 -> Task 4
Task 1 -> Task 5
