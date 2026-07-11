# Plan: daemon releases the lock only after draining in-flight dispatch (#561)

Track: technical
Tier: S

Fix summary: on SIGTERM, the daemon must (1) stop STARTING new features and let
`runDaemon`'s existing in-flight drain settle, (2) release the 1-per-repo
pidfile only AFTER that drain, and (3) force-release within a bounded timeout if
the drain never completes. Today `daemonSigtermHandler`
(`src/conductor/src/daemon-cli.ts` ~L511-519) calls `process.exit(1)`, which
fires `releaseBackstop` (`lock.releaseSync()`, ~L496-500) and unlinks the pidfile
BEFORE the drain — the double-daemon window.

All paths below are relative to `src/conductor/`. Tests are vitest, run from
`src/conductor` (`npx vitest run <path>`), never from the worktree root.

---

### Task 1: Cooperative stop signal drains in-flight dispatch in `runDaemon`

**Story:** Story 1 (SIGTERM mid-dispatch keeps pidfile until dispatch settles,
then releases) — the engine-side half: a stop request stops new dispatch and
drains in-flight before returning.

**Type:** feature (engine)

**Steps:**
- RED: In `test/engine/daemon.test.ts`, add a test: construct `runDaemon` deps
  with one eligible backlog item and a `shouldStop: () => boolean` that returns
  `false` until the first feature has been dispatched, then `true`. Assert:
  (a) `result.stoppedReason === 'signal_teardown'`; (b) the in-flight feature is
  present in `result.processed` (it DRAINED, was not dropped); (c) no SECOND
  feature is started after the stop flips (a second eligible item is left
  un-dispatched). Fails: `shouldStop` is not a recognized dep and
  `'signal_teardown'` is not a `DaemonStopReason`.
- GREEN: In `src/engine/daemon.ts`: add `'signal_teardown'` to the
  `DaemonStopReason` union (~L409-416); add
  `shouldStop?: () => boolean;` to `DaemonDeps` (place beside `repoRootMissing`
  ~L362, with a doc comment modeled on it — "checked at loop top; when it returns
  true, stop STARTING new features and drain in-flight before returning"); at the
  top of the `while (true)` loop (before `ceilingHit()`, ~L710) add
  `if (deps.shouldStop?.()) { log('[daemon] teardown requested — draining in-flight, no new dispatch'); stopReason = 'signal_teardown'; break; }`. The
  EXISTING drain loop (~L976-979) already settles in-flight work before return —
  no change needed there.
- COMMIT: `feat(daemon): cooperative shouldStop signal drains in-flight before stop (#561)`

**Files:**
- `src/conductor/src/engine/daemon.ts` (DaemonStopReason, DaemonDeps.shouldStop, loop-top check)
- `src/conductor/test/engine/daemon.test.ts` (new test)

**Dependencies:** none

---

### Task 2: Testable bounded-timeout teardown coordinator (`daemon-teardown.ts`)

**Story:** Story 3 (hung daemon force-releases after a bounded timeout, logged) —
the deterministic core, extracted so the timer logic is unit-testable with a fake
timer rather than only through a real process.

**Type:** feature (engine helper)

**Steps:**
- RED: Add `test/engine/daemon-teardown.test.ts`. Import
  `createDaemonTeardown` from `../../src/engine/daemon-teardown.js`. With an
  injected fake timer (`setTimer`/`clearTimer` capturing the callback + delay),
  assert: (a) fresh controller `shouldStop()` is `false`; (b) after
  `requestStop()`, `shouldStop()` is `true` and the timer was armed with the
  configured `timeoutMs`; (c) firing the fake timer invokes `onForceRelease`
  exactly once; (d) `cancel()` clears the timer so a subsequent fake fire does
  NOT call `onForceRelease`; (e) `requestStop()` is idempotent (second call does
  not arm a second timer / does not double-fire). Fails: module does not exist.
- GREEN: Add `src/engine/daemon-teardown.ts` exporting
  `interface DaemonTeardown { requestStop(): void; shouldStop(): boolean; cancel(): void; }`
  and `createDaemonTeardown(opts: { timeoutMs: number; onForceRelease: () => void; setTimer?: (cb, ms) => T; clearTimer?: (h: T) => void }): DaemonTeardown`.
  Internals: a boolean flag + a stored timer handle. `requestStop()` — if already
  requested, no-op; else flip flag and arm `setTimer(onForceRelease, timeoutMs)`
  (default `setTimer`/`clearTimer` = global `setTimeout`/`clearTimeout`, and the
  handle should be `.unref()`'d when available so the timer never keeps the
  process alive on its own). `shouldStop()` returns the flag. `cancel()` clears
  the timer via `clearTimer` (idempotent). Pure over its injected deps.
- COMMIT: `feat(daemon): createDaemonTeardown bounded force-release coordinator (#561)`

**Files:**
- `src/conductor/src/engine/daemon-teardown.ts` (NEW)
- `src/conductor/test/engine/daemon-teardown.test.ts` (NEW)

**Dependencies:** none

---

### Task 3: Rewire the SIGTERM handler to drain-then-release with bounded force-release

**Story:** Story 1 (release only after drain) + Story 3 (bounded force-release,
logged) — the daemon-cli wiring that stops force-exiting and moves the release
after the drain.

**Type:** feature (daemon-cli wiring)

**Steps:**
- RED: In `test/engine/daemon-cli.test.ts`, add source-level + wiring assertions
  against `src/daemon-cli.ts` (mirroring the existing Task-22 SIGTERM
  source-assert block ~L203): (a) `daemonSigtermHandler` no longer calls
  `process.exit` directly in its body — assert the handler body does NOT contain
  `process.exit` and DOES call the teardown controller's `requestStop`;
  (b) `runDaemon` is invoked with a `shouldStop` dep wired to the teardown
  controller; (c) the `onForceRelease` callback passed to `createDaemonTeardown`
  both releases the lock synchronously (references `releaseBackstop` /
  `lock.releaseSync`) and logs a greppable force-release line
  (e.g. contains the substring `force-release`); (d) the normal-completion path
  calls the controller's `cancel()` before/around `await lock.release()` so the
  timer cannot fire post-release. These fail against the current force-exit
  handler.
- GREEN: In `src/daemon-cli.ts`, inside `runDaemonMode`:
  - Construct `const teardown = createDaemonTeardown({ timeoutMs: <bounded, e.g. config-or-default seconds>, onForceRelease: () => { log('[daemon] teardown force-release: drain did not complete within <N>s — releasing lock and exiting'); releaseBackstop(); const exitProcess = opts.exitProcess ?? process.exit; exitProcess(1); } })`
    AFTER `releaseBackstop` is defined (~L496-500).
  - Change `daemonSigtermHandler` (~L511-519) to: abort all `allWaitSignals`
    controllers (KEEP), then `teardown.requestStop()`, then RETURN — remove the
    `process.exit(1)`.
  - Add `shouldStop: () => teardown.shouldStop(),` to the `runDaemon` deps object
    (~L1077 block, beside `repoRootMissing`-style deps).
  - In the normal-completion path (~L1436-1442): call `teardown.cancel()` before
    `process.off('exit', releaseBackstop)` / `await lock.release()`, then after
    `await lock.release()` exit cleanly via `(opts.exitProcess ?? process.exit)(0)`
    ONLY when a teardown was requested (so non-signal normal completion keeps
    today's return-and-let-event-loop-drain behavior; guard on
    `teardown.shouldStop()`).
- COMMIT: `fix(daemon): SIGTERM drains then releases lock; bounded force-release (#561)`

**Files:**
- `src/conductor/src/daemon-cli.ts` (teardown construction, handler rewire, shouldStop wiring, completion-path cancel/exit)
- `src/conductor/test/engine/daemon-cli.test.ts` (source/wiring assertions)

**Dependencies:** Task 1 (`shouldStop` dep + `signal_teardown`), Task 2 (`createDaemonTeardown`)

---

### Task 4: Pidfile persists through drain ⇒ successor `holdLock` refuses (Story 2 guard)

**Story:** Story 2 (a successor booting during the predecessor's drain is refused
/ waits until genuinely free).

**Type:** test (integration, no production change)

**Steps:**
- RED/GREEN (assertion of the invariant this fix guarantees): In
  `test/engine/daemon-restart-lock.test.ts`, add a test in an isolated temp repo
  (`mkdtemp`): call `holdLock(repo)` as owner A (live pid = `process.pid`,
  pidfile written). While A's handle is UN-released (modeling the drain window
  during which this fix keeps the pidfile), call
  `holdLock(repo, { takeoverWaitMs: 300, pollMs: 50 })` as successor B and assert
  it returns `null` (live-owner refusal — B does NOT reclaim a live lock).
  Then `await A.release()` (drain complete) and assert a subsequent
  `holdLock(repo)` for B now ACQUIRES (`handle !== null`, `handle.owned === true`)
  — cleanly, via `O_EXCL`, once the pidfile is genuinely free. This encodes the
  fix's guarantee: because the pidfile now PERSISTS through the drain, the
  successor is refused until A releases. No production code changes in this task
  (it verifies Task 3's observable effect using the unchanged `holdLock`
  primitive); if the assertion already holds given `holdLock` semantics, the test
  documents and locks the invariant that Task 3 must not regress.
- COMMIT: `test(daemon): successor holdLock refuses while predecessor pidfile persists through drain (#561)`

**Files:**
- `src/conductor/src/engine/daemon-lock.ts` (READ only — `holdLock`, no change)
- `src/conductor/test/engine/daemon-restart-lock.test.ts` (new test)

**Dependencies:** Task 3 (guarantees the pidfile persistence this test locks in)

---

## Task Dependency Graph

```
Task 1 (shouldStop + signal_teardown, drain)  ─┐
Task 2 (createDaemonTeardown coordinator)      ─┼─▶ Task 3 (SIGTERM rewire, wiring) ─▶ Task 4 (successor-refusal guard)
```

- Task 1 and Task 2 are independent and may proceed in parallel.
- Task 3 depends on both Task 1 (the `shouldStop` dep + stop reason it wires) and
  Task 2 (the `createDaemonTeardown` helper it constructs).
- Task 4 depends on Task 3 (it locks the pidfile-persistence invariant Task 3
  produces).

## Verification

- `cd src/conductor && npx vitest run test/engine/daemon.test.ts test/engine/daemon-teardown.test.ts test/engine/daemon-cli.test.ts test/engine/daemon-restart-lock.test.ts` — all green.
- `cd src/conductor && npx tsc --noEmit` — the new `DaemonDeps.shouldStop`,
  `DaemonStopReason` member, and `daemon-teardown.ts` types compile.
- Behavioral assertion of Story 1 (engine): Task 1's test proves a stop request
  drains the in-flight feature (`processed` includes it) and starts no new one,
  returning `stoppedReason === 'signal_teardown'`.
- Behavioral assertion of Story 3 (core): Task 2's fake-timer test proves the
  bounded force-release fires exactly once on timeout and never after `cancel()`.
- Wiring assertion of Story 1 + Story 3 (daemon-cli): Task 3's source/wiring test
  proves the handler drains (no direct `process.exit`), the release moved after
  the drain, `onForceRelease` releases+logs, and the normal path cancels the
  timer.
- Invariant assertion of Story 2: Task 4 proves a successor `holdLock` is refused
  while the predecessor pidfile persists and acquires cleanly once released.
- Regression sweep: `cd src/conductor && npx vitest run test/engine/daemon-lock.test.ts test/engine/daemon-cli-lock-loser-exit.test.ts` — the pre-existing lock/exit paths (early lock-loser `releaseSync`+exit at daemon-cli.ts ~L307/331/352/357) are untouched and still pass.

## Coverage Mapping

| Story | Task(s) | Evidence |
| --- | --- | --- |
| Story 1 — SIGTERM keeps pidfile until dispatch settles, then releases | Task 1 (engine drain), Task 3 (release moved after drain) | Task 1 test: `stoppedReason==='signal_teardown'`, in-flight feature drained, no new dispatch. Task 3 test: handler has no direct `process.exit`; `cancel()`+`lock.release()` on completion path. |
| Story 2 — successor booting during drain is refused / waits | Task 4 | Task 4 test: successor `holdLock` returns `null` while predecessor pidfile persists; acquires after release. |
| Story 3 — hung daemon force-releases after bounded timeout, logged | Task 2 (bounded timer core), Task 3 (wiring + log line + exit) | Task 2 test: force-release fires once on timeout, never after cancel. Task 3 test: `onForceRelease` references `releaseBackstop`/`releaseSync` and logs a `force-release` line, exits non-zero. |
