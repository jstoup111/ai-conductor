# Plan: daemon lock exclusivity — pidfile boot refusal and per-sweep ownership check (#554 descoped S)

Tier: S. Track: technical. Anchor: ADR-010 (1-per-repo pidfile mutex).

All paths are relative to `src/conductor/`. Tests live under `test/…`, never beside source.

Design key (the load-bearing #554 finding): the identity this work needs ALREADY exists
on disk. `PidRecord` (`src/engine/daemon-lock.ts:54`) carries a per-boot `uuid: string`
(`:56`, `randomUUID()` at `:163`, immune to pid reuse) and an additive `engineDir`. So
there is **no new pidfile field** and **no `/proc` signature probe**. The per-sweep
ownership decision compares this daemon's own boot `uuid` (exposed on its lock handle) to
the on-disk record's `uuid` — deterministic, and strictly better than the current bare
`isLive(owner.pid)` (`process.kill(pid,0)` at `:240`), which cannot distinguish a reused
pid or a genuine second daemon.

Binding detection ban (issue #554, 2026-07-11 investigation): NO code added here — boot
or sweep — may inspect a foreign process's command line (`/proc/<pid>/cmdline`,
`pgrep -f`, `ps | grep`). That substring match self-matches the operator's own diagnostic
shells and is a proven false-positive source. Detection uses only the pidfile record's
own fields plus `isLive(pid)`.

Scope boundary: NO orphan census, NO `daemon status` surface (deferred post-v1 per the
#554 operator descope). This plan touches only the boot-exclusivity refusal and the
per-sweep ownership gate.

---

### Task 1: Boot refusal names the live holder pid and exits nonzero

**Story:** Story 1 (refusal names holder, nonzero exit; dead-holder takeover preserved),
Story 2 (decision reads only the record + liveness), Story 4 (legacy record tolerated).
**Type:** feature (behavioral change: exit code 0 → nonzero on live-holder refusal)
**Steps:**
- RED: update `test/engine/daemon-cli-lock-loser-exit.test.ts` to the new contract —
  when `holdLock` resolves `null` AND the on-disk pidfile records a live holder pid P,
  the injected `exitProcess` is called with a NONZERO code and the log contains
  `another daemon is already running (pid P)` naming P (plus its `engineDir` when the
  record carries one). Add cases: (a) a legacy record with no `engineDir` → pid-only
  message, still nonzero; (b) an unreadable/corrupt holder record → generic message
  without a pid, still nonzero. Assert the refusal path reads the holder via
  `readPidRecord` only — it spawns no child process and performs no cmdline/`pgrep`
  lookup. (This replaces the prior exit-code-0 assertion, which encoded the now-superseded
  silent-loser behavior.)
- GREEN: in `src/daemon-cli.ts`, in the `if (lock === null)` block (~line 454), read the
  current holder via `readPidRecord(projectRoot)` and log
  `another daemon is already running (pid <holder.pid>[, engineDir <holder.engineDir>]) for <projectRoot>; exiting`,
  then call `exitProcess` with a dedicated nonzero code (define a named constant, e.g.
  `LOCK_HELD_EXIT_CODE = 3`, so the refusal is distinguishable from a crash). When the
  holder record is unreadable/absent, fall back to the generic message without a pid but
  still exit nonzero. Do NOT change `holdLock`'s live-vs-dead decision — dead-holder
  takeover is unchanged.
- COMMIT: `feat(daemon-cli): refuse-and-exit-nonzero naming the live lock holder (#554)`
**Files:**
- `src/conductor/src/daemon-cli.ts` (lock === null branch; import `readPidRecord`; nonzero exit constant)
- `src/conductor/test/engine/daemon-cli-lock-loser-exit.test.ts` (updated contract)
**Dependencies:** none

---

### Task 2: Expose owner uuid on the handle and add an ownsLock() helper

**Story:** Story 3 (foundation), Story 4 (reuses the already-written uuid; tolerant read).
**Type:** feature
**Steps:**
- RED: add cases to `test/engine/daemon-lock.test.ts`: (a) the handle returned by
  `holdLock` exposes the `uuid` recorded in the pidfile — on the fresh-acquire path AND
  the dead-holder reclaim path; (b) `ownsLock(repoPath, uuid)` returns true when the
  on-disk record's uuid matches, and false when the record is absent, has a different
  uuid, or is corrupt (never throws).
- GREEN: in `src/engine/daemon-lock.ts` add `uuid: string` to `DaemonLockHandle`; change
  `makeLockHandle(repoPath, pid, owned)` to `makeLockHandle(repoPath, pid, owned, uuid)`
  and thread the uuid at every call site in `holdLock` — `result.uuid`
  (`AcquireSuccess.uuid`, `:87`), `pollResult.uuid` (bounded-wait acquire success), and
  `r.uuid` (`ReclaimSuccess.uuid`, `:118`). Unowned/error handles carry `uuid: ''`.
  Export `async function ownsLock(repoPath, uuid): Promise<boolean>` that reads
  `readPidRecord()` and returns `record?.uuid === uuid` (absent/corrupt record → false).
- COMMIT: `feat(daemon-lock): expose owner uuid on handle + ownsLock() helper (#554)`
**Files:**
- `src/conductor/src/engine/daemon-lock.ts` (DaemonLockHandle.uuid, makeLockHandle, holdLock uuid threading, new ownsLock export)
- `src/conductor/test/engine/daemon-lock.test.ts`
**Dependencies:** none

---

### Task 3: Per-sweep ownership gate in the runDaemon loop

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
  `DaemonDeps` (documented: return true ONLY on a definitive not-ours reading — absent,
  corrupt, or different-uuid owner; inconclusive/transient → false, mirroring
  `repoRootMissing`'s definitive-only contract). Add `'lock_lost'` to the
  `DaemonStopReason` union (`:409`). At the top of the `while (true)` loop (beside the
  existing `repoRootMissing` guard ~line 703),
  `if (await deps.lockOwnershipLost?.()) { log('[daemon] lock no longer held — stopping
  dispatch'); stopReason = 'lock_lost'; break; }`. In-flight drain below is untouched.
- COMMIT: `feat(daemon): stop dispatch when pidfile ownership is lost mid-run (#554)`
**Files:**
- `src/conductor/src/engine/daemon.ts` (DaemonDeps.lockOwnershipLost, DaemonStopReason union, loop-top guard)
- `src/conductor/test/engine/daemon-sweep-ownership.test.ts` (new)
**Dependencies:** Task 2

---

### Task 4: Wire lockOwnershipLost into the production daemon deps

**Story:** Story 3.
**Type:** feature (wiring)
**Steps:**
- RED: extend `test/engine/daemon-sweep-ownership.test.ts` (or add a focused wiring case)
  asserting that `runDaemonMode` passes a `lockOwnershipLost` dep bound to
  `ownsLock(projectRoot, lock.uuid)` — i.e. after the lock handle is obtained, replacing
  the on-disk pidfile with a different-uuid record makes the bound predicate resolve true.
- GREEN: in `src/daemon-cli.ts`, where `runDaemon(...)` deps are assembled (~line 1410,
  beside `repoRootMissing`), add `lockOwnershipLost: async () => !(await
  ownsLock(projectRoot, lock.uuid))`. Import `ownsLock` from `./engine/daemon-lock.js`.
  Uses the `lock.uuid` now exposed by Task 2.
- COMMIT: `feat(daemon-cli): wire per-sweep ownsLock ownership check into runDaemon (#554)`
**Files:**
- `src/conductor/src/daemon-cli.ts` (runDaemon deps: lockOwnershipLost; import ownsLock)
- `src/conductor/test/engine/daemon-sweep-ownership.test.ts`
**Dependencies:** Task 2, Task 3

---

## Task Dependency Graph

```
Task 1  (boot refusal — independent)

Task 2 ─→ Task 3 ─→ Task 4
Task 2 ─────────────↑
```

- Task 1 is the boot-exclusivity refusal and stands alone (daemon-cli only; no dependency
  on the uuid handle).
- Task 2 → Task 3 → Task 4 form the per-sweep ownership chain (uuid on handle + `ownsLock`
  → loop gate → production wiring). Task 4 depends on both Task 2 (for `lock.uuid` and
  `ownsLock`) and Task 3 (for the `lockOwnershipLost` dep + `lock_lost` stop reason).

## Verification

- `cd src/conductor && npx vitest run test/engine/daemon-cli-lock-loser-exit.test.ts
  test/engine/daemon-lock.test.ts test/engine/daemon-sweep-ownership.test.ts` — all green.
- Full regression: `cd src/conductor && npx vitest run` — no regressions in existing
  daemon-lock / daemon-cli / daemon suites (`daemon-lock.test.ts`,
  `daemon-restart-lock.test.ts`, `daemon-orphan-reconciliation.test.ts`, `daemon.test.ts`).
- Boot-refusal manual check (per #554 desired outcome): start two `daemon --continuous`
  against one repo; observe exactly one logs `holding daemon lock (pid N)` and the other
  logs `another daemon is already running (pid N)` and exits nonzero.
- Dead-holder takeover regression: write a pidfile with a dead pid, boot a daemon, confirm
  it reclaims and proceeds (no nonzero refusal).
- Per-sweep ownership manual check: with a daemon running, overwrite `.daemon/daemon.pid`
  with a record carrying a DIFFERENT uuid; confirm the daemon stops dispatching with
  `lock_lost` on its next sweep (in-flight work drains).
- Confirm no orphan-census / `daemon status` surface was added (scope boundary held).
- Confirm NO added code reads `/proc/<pid>/cmdline` or runs `pgrep -f` / `ps | grep`
  (detection ban held): `git grep -nE 'proc/.*cmdline|pgrep|ps .*grep' src/` shows no new
  hits from this change.

## Coverage Mapping (story → tasks)

- Story 1 (boot refusal names holder, exits nonzero; dead-holder takeover preserved) → Task 1.
- Story 2 (boot decision keys on the record + liveness, never cmdline; reused-pid refusal
  is loud/recoverable; pid-reuse double-dispatch closed at the sweep) → Task 1 (record-only
  refusal, no cmdline probe) + Tasks 3, 4 (the sweep uuid check that closes the pid-reuse
  double-dispatch hazard).
- Story 3 (ownership lost → stop dispatch; retained → continue; transient → no false-stop)
  → Task 2, Task 3, Task 4.
- Story 4 (identity already-present; no new field; legacy/corrupt tolerated) → Task 2
  (reuses the already-written uuid; tolerant `ownsLock`) + Task 1 (legacy engineDir-absent
  / corrupt record tolerated at boot refusal).
