# Implementation Plan: Sweep stale vitest run temp roots at global setup

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2223
**Stories:** .docs/stories/sweep-stale-vitest-run-temp-roots-at-global-setup-.md
**Conflict check:** No blocking conflicts identified; separate conflict-check artifact skipped on Small composer route.

## Summary

Four tasks give every vitest run a heartbeat ownership marker inside its temp root and add a fail-open pre-run sweep to global setup that reaps only roots whose owner is provably gone, so interrupted runs stop accumulating in the operator's real tmpdir.

## Technical Approach

All code lives in this repository's own suite infrastructure: `src/conductor/test/tmpdir-leak-guard.ts` (pure helpers + fs seams) and `src/conductor/test/global-setup.ts` (wiring). Nothing in the engine, CLI, config schema, `HARNESS.md`, or shipped `skills/` changes.

- **Liveness predicate is a heartbeat marker, not a pid probe.** Self-host containment (`src/conductor/src/engine/self-host/live-containment.ts`) runs `--unshare-pid` with the real `/` bound, so concurrent daemon builds share the operator's tmpdir but cannot see each other's pids. Each run writes `<root>/.owner` (JSON: pid, hostname, startedAt) and refreshes its mtime on an `unref`'d interval; the marker's mtime is the liveness signal, readable from any pid namespace on the same filesystem. Constants live in the guard module as named exports: `RUN_TMP_ROOT_OWNER_MARKER = '.owner'`, `RUN_TMP_ROOT_HEARTBEAT_MS` (60s), `RUN_TMP_ROOT_STALE_AFTER_MS` (3h), `RUN_TMP_ROOT_LEGACY_STALE_AFTER_MS` (24h), with one override env var `AI_CONDUCTOR_TEST_TMP_ROOT_STALE_AFTER_MS` read by the wiring, never by the pure helper.
- **Decision is pure; effects are injected.** `decideStaleRunRoots(input)` takes `{ entries: RunRootEntry[], ownRoot, now, staleAfterMs, legacyStaleAfterMs }` where each entry carries `{ name, isDirectory, dirMtimeMs, marker: { kind: 'present', mtimeMs } | { kind: 'absent' } | { kind: 'unreadable', error } }` and returns `{ reap: string[], retain: { name, reason }[] }` with reasons exactly `live | own-root | unmarked-recent | marker-unreadable | not-a-directory`. `sweepStaleRunTmpRoots(realTmpdir, opts)` lists the tmpdir, reads markers, calls the decision, and removes via an injectable `remove` (default `removeRunTmpRoot`, which already handles read-only nesting), collecting `{ reaped, retained, failures }`. It never throws: a listing failure returns an empty result with the error recorded.
- **Retention on ambiguity.** Anything not a directory, any unreadable marker, any fresh marker, and any unmarked root younger than 24h is retained. Only a stale marker, or no marker plus a directory mtime past 24h (pre-marker legacy debris), reaps.
- **Wiring mirrors the tmux sweep.** In `setup()`, immediately after the real-tmpdir window opens (`process.env.TMPDIR = realTmpdir`) and before `snapshotTmpdirEntries(realTmpdir)`, run the sweep and log one `tmpdir-leak-guard: swept N stale run root(s) left behind by a previous interrupted run …` line; failures log separately. The marker is written and the heartbeat started right after `runTmpRoot` is known; the heartbeat is stopped in the teardown closure before `removeRunTmpRoot` and in `installInterruptReap`'s signal handler before `rmSync`. The existing teardown diff stays fail-closed and untouched: the marker is inside the run root, so it is never a real-tmpdir entry.
- **Test pattern.** Follow the existing `tmpdir-leak-guard.test.ts` shape: pure helpers tested with literal inputs; fs-backed helpers tested inside a `mkdtemp` fixture directory created under the run root (search hint: `describe('tmpdir-leak-guard: run root lifecycle'`), never against the real tmpdir; logger and `remove` injected as spies. Allowed variation: use `vi.useFakeTimers()` for the heartbeat interval.

## Prerequisites

None. `removeRunTmpRoot`, `snapshotTmpdirEntries`, the real-tmpdir window, and `installInterruptReap` already exist on main.

## Tasks

### Task 1: Owner marker and heartbeat for the run root

**Story:** 1 (happy path H1, H2; negative path N1)
**Type:** happy-path
**Files:** src/conductor/test/tmpdir-leak-guard.ts; src/conductor/test/tmpdir-leak-guard.test.ts
**Dependencies:** none

**Steps:**

1. Write failing tests in `tmpdir-leak-guard.test.ts` under a new `describe('tmpdir-leak-guard: owner marker')`: (a) `writeRunRootOwnerMarker(root, { pid, hostname, startedAt })` creates `<root>/.owner` whose JSON parses to those fields and whose mtime is set; (b) with fake timers, `startRunRootHeartbeat(root, { intervalMs, logger })` refreshes the marker mtime after each interval and creates no other entry in `root` or its parent; (c) `stop()` clears the interval so no further refresh happens; (d) when the root has been removed before a tick, the tick logs one `tmpdir-leak-guard: owner marker …` line and does not throw, and a write failure at `writeRunRootOwnerMarker` (root missing) likewise logs once and returns.
2. Verify RED.
3. Implement in `tmpdir-leak-guard.ts`: export the constants named in Technical Approach, `RunRootOwnerMarker` type, `writeRunRootOwnerMarker`, and `startRunRootHeartbeat` returning `{ stop }`; the interval is `unref()`'d; refresh uses `utimesSync` on the marker; every fs error is caught and logged once per call site.
4. Verify GREEN. Commit: `test(tmpdir-leak-guard): give each vitest run root a heartbeat owner marker (#2223)`.

**Done when:**

- `tmpdir-leak-guard.test.ts` proves `writeRunRootOwnerMarker` writes `<root>/.owner` with pid, hostname, and startedAt fields.
- `tmpdir-leak-guard.test.ts` proves the heartbeat refreshes the marker mtime on each interval and adds no other entry to the root or its parent.
- `tmpdir-leak-guard.test.ts` proves a missing root at write time and at a heartbeat tick logs one guard line and throws nothing.
- `stop()` clears the interval; a tick after `stop()` performs no refresh.

### Task 2: Pure stale-root decision helper

**Story:** 2 (happy path H4); 3 (happy path H1, H2, H3, H4; negative path N1, N2, N3, N4)
**Type:** happy-path
**Files:** src/conductor/test/tmpdir-leak-guard.ts; src/conductor/test/tmpdir-leak-guard.test.ts
**Dependencies:** none

**Steps:**

1. Write failing tests under `describe('tmpdir-leak-guard: stale run root decision')` calling `decideStaleRunRoots` with literal entry arrays and a fixed `now`: stale marker → reap; fresh marker → retain `live`; own root with stale marker → retain `own-root`; absent marker + dir mtime > 24h → reap; absent marker + recent dir mtime → retain `unmarked-recent`; unreadable marker → retain `marker-unreadable`; `isDirectory: false` → retain `not-a-directory`; two entries with markers 0–1s old → both retained `live`; a custom `staleAfterMs` changes the live/stale boundary and appears in the retain reasons' detail; the helper is called with no fs seam and performs no I/O (assert it is a plain function of its argument by calling it twice with the same input and comparing results).
2. Verify RED.
3. Implement `decideStaleRunRoots` and the `RunRootEntry` / `StaleRunRootDecision` types as described in Technical Approach; only names starting with `RUN_TMP_ROOT_PREFIX` are considered, and the own root is matched by basename.
4. Verify GREEN. Commit: `test(tmpdir-leak-guard): decide stale run roots from marker heartbeats, retaining on ambiguity (#2223)`.

**Done when:**

- `decideStaleRunRoots` reaps a root whose marker heartbeat is older than `staleAfterMs`.
- `decideStaleRunRoots` reaps an unmarked root whose directory mtime is older than `legacyStaleAfterMs`.
- `decideStaleRunRoots` retains with reasons `live`, `own-root`, `unmarked-recent`, `marker-unreadable`, and `not-a-directory` for the corresponding fixtures, and retains both roots when two fresh markers are within one second of each other.
- `decideStaleRunRoots` honours a caller-supplied `staleAfterMs` and takes no filesystem seam.

### Task 3: Fail-open filesystem sweep runner

**Story:** 2 (happy path H1, H3; negative path N1, N2)
**Type:** negative-path
**Files:** src/conductor/test/tmpdir-leak-guard.ts; src/conductor/test/tmpdir-leak-guard.test.ts
**Dependencies:** Task 2

**Steps:**

1. Write failing tests under `describe('tmpdir-leak-guard: stale run root sweep')` using a `mkdtemp` fixture directory as the fake real tmpdir: (a) two `ai-conductor-vitest-run-*` roots with stale markers, one containing a read-only nested directory, are removed and reported in `reaped`; a third with a fresh marker survives in `retained`; (b) an empty fixture yields `reaped: []` and the logger is never called; (c) with an injected `remove` that rejects for the first root, the second stale root is still removed, `failures` names the first root and its error, and the promise resolves; (d) with a non-existent fixture path, the result is empty, `failures` carries the listing error, and nothing throws.
2. Verify RED.
3. Implement `sweepStaleRunTmpRoots(realTmpdir, { ownRoot, now, staleAfterMs, legacyStaleAfterMs, remove = removeRunTmpRoot, logger })`: `readdir` with `withFileTypes`, `lstat` per prefixed entry (never following symlinks), read the marker with `statSync`/`readFileSync` into the `marker` shape, call `decideStaleRunRoots`, remove each `reap` entry sequentially inside its own try/catch, and return `{ reaped, retained, failures }`. A marker is `present` only when its JSON carries the `RunRootOwnerMarker` shape (numeric `pid`, string `hostname`, string `startedAt`); syntactically valid JSON without that shape is `unreadable`, exactly like unparseable bytes (amended 2026-09-06 for as-built PG-1, Story 3 N2).
4. Verify GREEN. Commit: `test(tmpdir-leak-guard): sweep stale run roots fail-open with injected removal (#2223)`.

**Done when:**

- `sweepStaleRunTmpRoots` removes every stale-marker root in the fixture, including one holding a read-only nested directory, and leaves the fresh-marker root in place.
- `sweepStaleRunTmpRoots` on an empty fixture returns no reaped roots and never calls the logger.
- `sweepStaleRunTmpRoots` with a rejecting `remove` for the first root still removes the second, records the first in `failures`, and resolves without throwing.
- `sweepStaleRunTmpRoots` on an unlistable directory resolves with an empty result and the listing error in `failures`.
- `sweepStaleRunTmpRoots` retains a root whose marker is valid JSON but not the owner shape as `marker-unreadable`, logs the reason, and never reaps it however stale its mtime.

### Task 4: Wire marker, heartbeat, and sweep into global setup

**Story:** 1 (happy path H3; negative path N2); 2 (happy path H2; negative path N3)
**Type:** happy-path
**Files:** src/conductor/test/global-setup.ts; src/conductor/test/global-setup-engineer-signals.test.ts
**Dependencies:** Task 1, Task 3

**Steps:**

1. Write failing tests for a new exported pure `applyRunRootSweepDecision(result, realTmpdir, logger)` in `global-setup-engineer-signals.test.ts` (search hint: the existing `applyTmpdirTeardownDecision` cases): a result with two reaped roots logs exactly one line containing `swept 2 stale run root(s)`, both paths, and `previous interrupted run`; a result with a failure logs a separate line naming the root and error; an empty result logs nothing; no input ever makes it throw.
2. Verify RED.
3. Implement `applyRunRootSweepDecision` and the wiring in `setup()`: after `runTmpRoot` is resolved, `writeRunRootOwnerMarker` and `startRunRootHeartbeat` (logger `console.error`); inside the real-tmpdir window, before `snapshotTmpdirEntries(realTmpdir)`, `await sweepStaleRunTmpRoots(realTmpdir, { ownRoot: runTmpRoot, staleAfterMs: <env override or default>, … })` and pass the result to `applyRunRootSweepDecision`; call `stop()` at the top of the teardown closure and inside `installInterruptReap`'s handler before `rmSync`. The teardown `diffTmpdirEntries` path is not modified.
4. Verify GREEN; run the two changed test files through `ai-conductor scoped-run`, then the aggregate suite (test-infrastructure change) and observe that this run's own root is reported as `own-root` retention when `AI_CONDUCTOR_TEST_TMP_ROOT_STALE_AFTER_MS=0` is set for a single verification run, confirming the sweep observes the real tmpdir and not the redirected root.
5. Commit: `fix(test): sweep stale vitest run roots at global setup before the baseline snapshot (#2223)`.

**Done when:**

- `applyRunRootSweepDecision` logs one report line naming the count and every reaped root path with the phrase `previous interrupted run`, a separate line per failure, and nothing for an empty result.
- `setup()` calls the sweep before `snapshotTmpdirEntries(realTmpdir)` and inside the block where `process.env.TMPDIR` equals `realTmpdir`.
- The heartbeat `stop()` is invoked in the teardown closure before `removeRunTmpRoot` and in the SIGINT/SIGTERM handler before `rmSync`.
- With `AI_CONDUCTOR_TEST_TMP_ROOT_STALE_AFTER_MS=0`, a suite run reports its own root as retained `own-root` and reaps no other live root.
- The aggregate suite passes with `AGGREGATE_TEST_SUITE_PASS` and the teardown diff reports no marker-attributable stray entry.

## Task Dependency Graph

```
Task 1 ─┐
        ├─▶ Task 4
Task 2 ─▶ Task 3 ─┘
```

## Integration Points

- After Task 3: the sweep can be exercised against a fixture directory end to end without the suite wiring.
- After Task 4: a suite run exercises marker write, heartbeat, pre-run sweep, and teardown stop through the real `globalSetup` entry point.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: H1: Given global setup has installed this run's root, when setup completes, then the root contains an owner marker file recording the run's pid, hostname, and start time, and its mtime is the heartbeat. | 1 | "writes `<root>/.owner` with pid, hostname, and startedAt fields" | diff-local |
| Story 1 happy: H2: Given a run in progress, when the heartbeat interval elapses, then the owner marker's mtime is refreshed without creating any other entry in the root or the real tmpdir. | 1 | "refreshes the marker mtime on each interval and adds no other entry to the root or its parent" | diff-local |
| Story 1 happy: H3: Given a run reaching global teardown, when the run root is removed, then the heartbeat timer is cleared first and the marker disappears with the root; the teardown leak diff reports no new real-tmpdir entry attributable to the marker. | 4 | "invoked in the teardown closure before `removeRunTmpRoot`" | diff-local |
| Story 1 negative: N1: Given the owner marker cannot be written or refreshed (permission denied, root already removed), when setup or a heartbeat tick hits the error, then the failure is logged once through the guard logger and the run continues; the suite neither throws nor fails because of the marker. | 1 | "logs one guard line and throws nothing" | diff-local |
| Story 1 negative: N2: Given a run interrupted by SIGINT or SIGTERM, when the existing interrupt reap runs, then the heartbeat timer is cleared so the process can exit and no further marker refresh occurs after the root is reaped. | 4 | "in the SIGINT/SIGTERM handler before `rmSync`" | diff-local |
| Story 2 happy: H1: Given the real tmpdir contains `ai-conductor-vitest-run-*` roots whose owner marker heartbeat is older than the staleness window, when global setup runs its pre-run sweep before the baseline tmpdir snapshot, then each such root is removed recursively, including read-only nested directories. | 3 | "removes every stale-marker root in the fixture, including one holding a read-only nested directory" | diff-local |
| Story 2 happy: H2: Given at least one root is reaped, when the sweep completes, then one logger line names the count and every removed root path and states the debris came from a previous run, mirroring the tmux sweep's report shape. | 4 | "logs one report line naming the count and every reaped root path with the phrase `previous interrupted run`" | diff-local |
| Story 2 happy: H3: Given no stale roots exist, when the sweep runs, then nothing is removed and nothing is logged. | 3 | "returns no reaped roots and never calls the logger" | diff-local |
| Story 2 happy: H4: Given the sweep decision is computed from an enumerated entry list plus per-root marker readings, when the decision helper is called with injected inputs, then it returns the reap and retain sets with a reason per retained root, with no filesystem access. | 2 | "takes no filesystem seam" | diff-local |
| Story 2 negative: N1: Given a stale root whose removal fails (EACCES, EBUSY, or a removal error part-way), when the sweep handles it, then the failure is logged naming the root and the error, the remaining stale roots are still attempted, and setup continues; the run is never failed by the sweep. | 3 | "still removes the second, records the first in `failures`, and resolves without throwing" | diff-local |
| Story 2 negative: N2: Given the real tmpdir cannot be listed, when the sweep runs, then it reaps nothing, logs the read failure once, and setup continues (fail open toward retention, matching the guard's failed-baseline stance). | 3 | "resolves with an empty result and the listing error in `failures`" | diff-local |
| Story 2 negative: N3: Given the sweep runs under the real tmpdir window opened for the tmux sweep, when it reaps, then it observes `os.tmpdir()` as the real tmpdir, not this run's redirected root, and never enumerates entries inside the run root. | 4 | "inside the block where `process.env.TMPDIR` equals `realTmpdir`" | diff-local |
| Story 3 happy: H1: Given a root whose owner marker heartbeat is younger than the staleness window, when the sweep decides, then the root is retained with reason `live`. | 2 | "retains with reasons `live`" | diff-local |
| Story 3 happy: H2: Given this run's own root, when the sweep decides, then it is retained with reason `own-root` regardless of its marker state. | 2 | "`own-root`" | diff-local |
| Story 3 happy: H3: Given a root with no owner marker at all and a directory mtime older than the legacy fallback window (24h), when the sweep decides, then it is reaped so pre-marker debris drains once. | 2 | "reaps an unmarked root whose directory mtime is older than `legacyStaleAfterMs`" | diff-local |
| Story 3 happy: H4: Given the staleness window is overridden through the guard's single named override, when the sweep decides, then the override value is used and reported in the retain reasons. | 2 | "honours a caller-supplied `staleAfterMs`" | diff-local |
| Story 3 negative: N1: Given a root with no owner marker and a directory mtime younger than the legacy fallback window, when the sweep decides, then the root is retained with reason `unmarked-recent`. | 2 | "`unmarked-recent`" | diff-local |
| Story 3 negative: N2: Given a root whose owner marker is present but unreadable or malformed, when the sweep decides, then the root is retained with reason `marker-unreadable` and the reason is logged; it is never reaped on that evidence. | 2 | "`marker-unreadable`" | diff-local |
| Story 3 negative: N3: Given an entry under the real tmpdir that matches the prefix but is a file or a symlink rather than a directory, when the sweep decides, then it is retained with reason `not-a-directory` and never followed or removed. | 2 | "`not-a-directory`" | diff-local |
| Story 3 negative: N4: Given two suites start within the same second and both sweep, when each reads the other's fresh marker, then neither reaps the other's root and both runs complete with their roots intact until their own teardown. | 2 | "retains both roots when two fresh markers are within one second of each other" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; "fail-open" is closed as: catch every fs error, record it in `failures`, log, never throw
- [x] Dependencies are explicit and acyclic
