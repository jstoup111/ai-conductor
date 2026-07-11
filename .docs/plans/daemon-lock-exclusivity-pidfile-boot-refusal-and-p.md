# Plan: daemon lock exclusivity — pidfile boot refusal and per-sweep ownership check (#554 descoped S)

Tier: S. Track: technical. Anchor: ADR-010 (1-per-repo pidfile mutex).

All paths are relative to `src/conductor/`. Tests live under `test/…`, never beside source.
The injectable-probe pattern already used for `KillProbe` in `src/engine/daemon-lock.ts` is
reused for the new process-signature probe, so every path stays deterministically testable
without spawning real processes.

Scope boundary: NO orphan census, NO `daemon status` surface (deferred post-v1 per the
#554 operator descope). This plan touches only the boot-exclusivity decision and the
per-sweep ownership gate.

---

### Task 1: Additive process-signature capture on the pidfile record

**Story:** Story 4 (additive/back-compat), foundation for Story 2.
**Type:** feature (additive field + injectable capture)
**Steps:**
- RED: add `test/engine/daemon-lock-signature.test.ts`. Assert: (a) a record written by
  `acquire()` carries an additive `signature?: string` field derived from an injectable
  signature source; (b) `readPidRecord()` on a legacy record WITHOUT the field returns it
  intact (field `undefined`) and never throws.
- GREEN: in `src/engine/daemon-lock.ts`, add optional `signature?: string` to `PidRecord`
  (documented additive, readers must tolerate `undefined`, mirroring the existing
  `engineDir?` / `transient?` fields). Add a module-level default signature source
  `defaultOwnSignature()` that returns a stable command-signature token for THIS process
  (derived from `process.argv`; e.g. joins argv and is matched against a
  `DAEMON_CMDLINE_MARKERS` constant). Populate `record.signature` in `writePidfileExcl()`.
  Do NOT change the runtime shape guard in `readPidRecord()` beyond tolerating the new
  optional field.
- COMMIT: `feat(daemon-lock): additive process-signature field on pidfile record (#554)`
**Files:**
- `src/conductor/src/engine/daemon-lock.ts` (PidRecord, writePidfileExcl, new default signature source + DAEMON_CMDLINE_MARKERS constant)
- `src/conductor/test/engine/daemon-lock-signature.test.ts` (new)
**Dependencies:** none

---

### Task 2: Fold a signature probe into the holdLock live-owner decision

**Story:** Story 2 (imposter reclaim / real-daemon refuse / unknown → conservative refuse).
**Type:** feature
**Steps:**
- RED: extend `test/engine/daemon-lock-signature.test.ts`. Using injected `KillProbe`
  (alive) plus an injected signature probe, assert `holdLock`: (a) owner alive + probe
  `mismatch` → reclaims and returns an owned handle (imposter → takeover); (b) owner alive
  + probe `match` → returns `null` (real live daemon refused); (c) owner alive + probe
  `unknown` → returns `null` (conservative fallback = today's liveness-only behavior).
- GREEN: in `src/engine/daemon-lock.ts` add an injectable
  `SignatureProbe = (pid: number, expected?: string) => 'match' | 'mismatch' | 'unknown'`
  with a `defaultSignatureProbe` that reads the live process's command line
  (`/proc/<pid>/cmdline` via `node:fs`) and compares against `DAEMON_CMDLINE_MARKERS` /
  the record's stored `signature`; unreadable → `'unknown'`. Introduce a private helper
  `ownerIsLiveDaemon(owner, kill, sigProbe): boolean` = `owner.pid > 0 && isLive(pid,kill)
  && sigProbe(pid, owner.signature) !== 'mismatch'`. Replace the bare `isLive(owner.pid)`
  gate inside `holdLock` (and its bounded-wait poll branch) with `ownerIsLiveDaemon(...)`,
  threading a `sigProbe` parameter (default `defaultSignatureProbe`). A `mismatch` owner
  now flows into the existing stale/reclaim branch unchanged.
- COMMIT: `feat(daemon-lock): pid-reuse defense via signature probe in holdLock (#554)`
**Files:**
- `src/conductor/src/engine/daemon-lock.ts` (SignatureProbe type, defaultSignatureProbe, ownerIsLiveDaemon, holdLock signature threading)
- `src/conductor/test/engine/daemon-lock-signature.test.ts`
**Dependencies:** Task 1

---

### Task 3: Boot refusal names the live holder pid and exits nonzero

**Story:** Story 1.
**Type:** feature (behavioral change: exit code 0 → nonzero on live-holder refusal)
**Steps:**
- RED: update `test/engine/daemon-cli-lock-loser-exit.test.ts` to the new contract —
  when `holdLock` resolves `null` AND the on-disk pidfile records a live holder pid P,
  the injected `exitProcess` is called with a NONZERO code and the log contains
  `another daemon is already running (pid P)` naming P. (This replaces the prior
  exit-code-0 assertion, which encoded the now-superseded silent-loser behavior.)
- GREEN: in `src/daemon-cli.ts`, in the `if (lock === null)` block (~line 455), read the
  current holder via `readPidRecord(projectRoot)` and log
  `another daemon is already running (pid <holder.pid>) for <projectRoot>; exiting`,
  then call `exitProcess` with a dedicated nonzero code (define a named constant, e.g.
  `LOCK_HELD_EXIT_CODE = 3`, so the refusal is distinguishable from a crash). When the
  holder record is unreadable, fall back to the generic message without a pid but still
  exit nonzero.
- COMMIT: `feat(daemon-cli): refuse-and-exit-nonzero naming the live lock holder (#554)`
**Files:**
- `src/conductor/src/daemon-cli.ts` (lock === null branch; import `readPidRecord`; nonzero exit constant)
- `src/conductor/test/engine/daemon-cli-lock-loser-exit.test.ts` (updated contract)
**Dependencies:** Task 2

---

### Task 4: Expose owner uuid on the handle and add an ownsLock() helper

**Story:** Story 3 (foundation).
**Type:** feature
**Steps:**
- RED: add cases to `test/engine/daemon-lock.test.ts`: (a) the handle returned by
  `holdLock` exposes the `uuid` recorded in the pidfile; (b) `ownsLock(repoPath, uuid)`
  returns true when the on-disk record's uuid matches, and false when the record is
  absent, has a different uuid, or is corrupt.
- GREEN: in `src/engine/daemon-lock.ts` add `uuid: string` to `DaemonLockHandle`; thread
  the acquired/reclaimed uuid through `makeLockHandle(repoPath, pid, owned, uuid)` and all
  its call sites in `holdLock`. Export `async function ownsLock(repoPath, uuid):
  Promise<boolean>` that reads `readPidRecord()` and returns `record?.uuid === uuid`
  (absent/corrupt record → false). Unowned/error handles carry `uuid: ''`.
- COMMIT: `feat(daemon-lock): expose owner uuid on handle + ownsLock() helper (#554)`
**Files:**
- `src/conductor/src/engine/daemon-lock.ts` (DaemonLockHandle.uuid, makeLockHandle, holdLock, new ownsLock export)
- `src/conductor/test/engine/daemon-lock.test.ts`
**Dependencies:** none

---

### Task 5: Per-sweep ownership gate in the runDaemon loop

**Story:** Story 3.
**Type:** feature
**Steps:**
- RED: add `test/engine/daemon-sweep-ownership.test.ts` driving `runDaemon` with an
  injected `lockOwnershipLost` dep. Assert: (a) when it resolves true at the top of a
  sweep, `runDaemon` stops with `stoppedReason: 'lock_lost'` and dispatches no further
  feature (using a discoverBacklog that would otherwise yield an item); (b) when it stays
  false, dispatch proceeds normally; (c) an inconclusive/undefined return does NOT stop
  the loop (fail-safe toward continuing to own).
- GREEN: in `src/engine/daemon.ts` add `lockOwnershipLost?: () => Promise<boolean>` to
  `DaemonDeps` (documented: return true ONLY on a definitive not-ours reading — absent or
  different owner; inconclusive/transient → false, mirroring `repoRootMissing`'s
  definitive-only contract). Add `'lock_lost'` to the `DaemonStopReason` union. At the top
  of the `while (true)` loop (beside the existing `repoRootMissing` guard ~line 703),
  `if (await deps.lockOwnershipLost?.()) { log('[daemon] lock no longer held — stopping
  dispatch'); stopReason = 'lock_lost'; break; }`. In-flight drain below is untouched.
- COMMIT: `feat(daemon): stop dispatch when pidfile ownership is lost mid-run (#554)`
**Files:**
- `src/conductor/src/engine/daemon.ts` (DaemonDeps.lockOwnershipLost, DaemonStopReason union, loop-top guard)
- `src/conductor/test/engine/daemon-sweep-ownership.test.ts` (new)
**Dependencies:** Task 4

---

### Task 6: Wire lockOwnershipLost into the production daemon deps

**Story:** Story 3.
**Type:** feature (wiring)
**Steps:**
- RED: extend `test/engine/daemon-sweep-ownership.test.ts` (or add a focused wiring case)
  asserting that `runDaemonMode` passes a `lockOwnershipLost` dep bound to
  `ownsLock(projectRoot, lock.uuid)` — i.e. after the lock handle is obtained, replacing
  the on-disk pidfile with a different-uuid record makes the bound predicate resolve true.
- GREEN: in `src/daemon-cli.ts`, where `runDaemon(...)` deps are assembled (~line 1077,
  beside `repoRootMissing`), add `lockOwnershipLost: async () => !(await
  ownsLock(projectRoot, lock.uuid))`. Import `ownsLock` from `./engine/daemon-lock.js`.
  Uses the `lock.uuid` now exposed by Task 4.
- COMMIT: `feat(daemon-cli): wire per-sweep ownsLock ownership check into runDaemon (#554)`
**Files:**
- `src/conductor/src/daemon-cli.ts` (runDaemon deps: lockOwnershipLost; import ownsLock)
- `src/conductor/test/engine/daemon-sweep-ownership.test.ts`
**Dependencies:** Task 4, Task 5

---

## Task Dependency Graph

```
Task 1 ─→ Task 2 ─→ Task 3
Task 4 ─→ Task 5 ─→ Task 6
Task 4 ─────────────↑
```

- Task 1 → Task 2 → Task 3 form the boot-exclusivity chain (signature field → probe in
  holdLock → refuse-and-exit-nonzero).
- Task 4 → Task 5 → Task 6 form the per-sweep ownership chain (uuid+ownsLock → loop gate →
  production wiring). Task 6 also depends on Task 5's `lock_lost` stop reason.
- The two chains are independent and may proceed in parallel until their respective heads.

## Verification

- `cd src/conductor && npx vitest run test/engine/daemon-lock-signature.test.ts
  test/engine/daemon-lock.test.ts test/engine/daemon-cli-lock-loser-exit.test.ts
  test/engine/daemon-sweep-ownership.test.ts` — all green.
- Full regression: `cd src/conductor && npx vitest run` — no regressions in existing
  daemon-lock / daemon-cli / daemon suites (`daemon-lock.test.ts`,
  `daemon-restart-lock.test.ts`, `daemon-orphan-reconciliation.test.ts`, `daemon.test.ts`).
- Boot-refusal manual check (per #554 desired outcome): start two `daemon --continuous`
  against one repo; observe exactly one logs `holding daemon lock (pid N)` and the other
  logs `another daemon is already running (pid N)` and exits nonzero.
- Dead-holder takeover regression: write a pidfile with a dead pid, boot a daemon, confirm
  it reclaims and proceeds (no nonzero refusal).
- Confirm no orphan-census / `daemon status` surface was added (scope boundary held).

## Coverage Mapping (story → tasks)

- Story 1 (boot refusal names holder, exits nonzero; dead-holder takeover preserved) → Task 3 (with Task 2 supplying the correct live-vs-stale decision).
- Story 2 (reused-pid imposter reclaimed; real daemon still refused; unknown → conservative refuse) → Task 1, Task 2.
- Story 3 (ownership lost → stop dispatch; retained → continue; transient → no false-stop) → Task 4, Task 5, Task 6.
- Story 4 (signature capture additive & back-compatible) → Task 1 (field + tolerant read), Task 2 (unknown-signature fallback).
