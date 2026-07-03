# Implementation Plan: Daemon auto-restart on stale engine code

**Date:** 2026-07-03
**Design:** .docs/decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md (APPROVED) + .docs/architecture/2026-07-03-daemon-auto-restart-stale-engine.md
**Stories:** .docs/stories/2026-07-03-daemon-auto-restart-stale-engine.md (Accepted)
**Conflict check:** Clean as of 2026-07-03
**Source:** jstoup111/ai-conductor#256 — blocked_by #215 (build held in WAITING until #215 closes)

## Summary

Adds fail-closed stale-engine detection at the daemon idle boundary and an exit-to-respawn
restart request, self-host + config gated. 17 tasks.

## Technical Approach

Two new small modules plus wiring — no changes to dispatch, gates, or non-self-host behavior:

- **`src/conductor/src/engine/engine-identity.ts` (new).** `captureEngineIdentity(entryPath)`
  → sha256 content hash of the resolved `dist/index.js`, or `null` on any read error.
  `createStaleEngineChecker(captured)` → `check(): 'stale' | 'current' | 'indeterminate'`;
  a `null` capture yields a permanently disabled checker (always `'current'`, no fs access).
  Warn-once semantics live in the checker, not the caller.
- **`src/conductor/src/engine/restart-intent.ts` (new).** Read/write/clear of
  `.daemon/RESTART_PENDING` (`{ reason, fromIdentity, targetIdentity, at }`) + the
  suppression record derived at boot (`{ suppressedTarget }` persisted alongside, cleared
  when the on-disk identity moves past it). Corrupt file ⇒ treat-as-absent + warn + remove.
- **Config.** New optional boolean `auto_restart_on_stale_engine` in `types/config.ts` /
  `engine/config.ts`, default `false`; unparseable ⇒ `false` + one warning (loader never throws
  for this key).
- **Startup wiring (`daemon-cli.ts`).** After `holdLock`/`loadConfig`/`classifySelfHost`:
  capture identity, run the handshake (read/log/clear marker, derive suppression), log one
  ARMED/DISARMED line. All existing startup behavior (dashboard scan, dispatch decisions)
  untouched — the parity guard story pins this.
- **Idle-branch hook (`engine/daemon.ts`).** In the existing idle branch only
  (`inFlight.size === 0` && nothing eligible), evaluate the gate chain
  (continuous && selfHost && flag && checker-armed && !suppressed); on `'stale'`, re-verify
  `inFlight.size === 0`, then call the injected `requestRestart` dep: write marker → release
  lock → `exit(0)`. The requester is a **dep** (like `sleep`/`log`) so unit tests inject a
  fake; the real one is wired in `daemon-cli.ts` where lock + exit already live, keeping the
  exit backstop on the path.

Sequencing: pure modules first (identity, marker, config), then startup wiring, then the
idle-branch hook, then acceptance specs against a real rebuilt dist, then docs.

## Prerequisites

- None beyond the repo toolchain (`bin/setup` provides `src/conductor` npm install/build in
  daemon worktrees). Runtime dependency on #215's respawn transport is a *deploy*
  precondition, enforced by the native blocked_by link — not a build precondition.

## Tasks

### Task 1: EngineIdentity — capture happy path
**Story:** Capture engine identity / happy path
**Type:** happy-path
**Steps:**
1. Write failing test: `captureEngineIdentity(tmpFile)` returns the sha256 of the file's bytes; two identical files → equal identities.
2. RED. 3. Implement `engine-identity.ts` capture. 4. GREEN. 5. Commit "feat(engine): capture engine build identity".
**Files:** src/conductor/src/engine/engine-identity.ts (new), test file (new)
**Dependencies:** none

### Task 2: EngineIdentity — capture failure disables checker
**Story:** Capture engine identity / negative paths (unreadable entry; sticky disable)
**Type:** negative-path
**Steps:**
1. Failing test: capture of a missing path returns `null`; `createStaleEngineChecker(null)` always returns `'current'`, performs zero fs reads (spy), and the warn callback fires exactly once.
2. RED. 3. Implement disabled-checker branch. 4. GREEN. 5. Commit.
**Files:** engine-identity.ts, its test
**Dependencies:** Task 1

### Task 3: StaleEngineChecker — stale vs current verdicts
**Story:** Detect stale engine / happy paths (differs ⇒ stale; equal incl. byte-identical rebuild ⇒ current)
**Type:** happy-path
**Steps:**
1. Failing test: checker with captured hash H over a file now hashing H' returns `'stale'`; unchanged file returns `'current'`.
2. RED. 3. Implement re-hash + compare. 4. GREEN. 5. Commit.
**Files:** engine-identity.ts, test
**Dependencies:** Task 1

### Task 4: StaleEngineChecker — indeterminate + warn-once
**Story:** Detect stale engine / negative path (re-hash failure ⇒ not stale, no warning spam)
**Type:** negative-path
**Steps:**
1. Failing test: entry removed between capture and check ⇒ `'indeterminate'`; caller-visible verdict never `'stale'`; two consecutive identical failures ⇒ one warning.
2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** engine-identity.ts, test
**Dependencies:** Task 3

### Task 5: Restart-intent marker — schema round-trip
**Story:** Detect stale engine / Done When (marker schema)
**Type:** infrastructure
**Steps:**
1. Failing test: write `{reason, fromIdentity, targetIdentity, at}` to a tmp `.daemon/RESTART_PENDING`, read it back losslessly.
2. RED. 3. Implement `restart-intent.ts` write/read/clear. 4. GREEN. 5. Commit.
**Files:** src/conductor/src/engine/restart-intent.ts (new), test (new)
**Dependencies:** none

### Task 6: Restart-intent marker — corrupt ⇒ absent + warn + remove
**Story:** Startup restart handshake / negative path (corrupt marker)
**Type:** negative-path
**Steps:**
1. Failing test: garbage bytes in the marker ⇒ read yields `absent-corrupt`, file removed, one warning; boot-style read of a missing marker yields `absent` silently.
2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** restart-intent.ts, test
**Dependencies:** Task 5

### Task 7: Config key `auto_restart_on_stale_engine`
**Story:** Config flag / all paths (true, false, absent, invalid ⇒ false + warn, never throws)
**Type:** infrastructure + negative-path
**Steps:**
1. Failing tests: loader resolves true/false/absent/`"banana"` to true/false/false/false; invalid emits one warning naming the key; load never throws.
2. RED. 3. Add key to `types/config.ts` + `engine/config.ts` resolution. 4. GREEN. 5. Commit.
**Files:** src/conductor/src/types/config.ts, src/conductor/src/engine/config.ts, config tests
**Dependencies:** none

### Task 8: Startup wiring — capture + ARMED/DISARMED line
**Story:** Capture engine identity / happy path; Config flag / happy paths (observable state)
**Type:** happy-path
**Steps:**
1. Failing test (daemon-cli seam or extracted `initStaleEngineState(deps)` helper): healthy start logs exactly one identity line and one ARMED (flag on + self-host) or DISARMED line.
2. RED. 3. Wire capture + status line into `runDaemonMode` after config/self-host classification. 4. GREEN. 5. Commit.
**Files:** src/conductor/src/daemon-cli.ts (or new engine/stale-engine-init.ts consumed by it), tests
**Dependencies:** Tasks 1, 7

### Task 9: Startup handshake — marker present / absent
**Story:** Startup restart handshake / happy path + no-noise negative
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: marker present ⇒ "restarted for engine refresh" log with from/target/fresh identities and marker removed before loop entry; no marker ⇒ no handshake line.
2. RED. 3. Implement handshake in the startup wiring. 4. GREEN. 5. Commit.
**Files:** stale-engine-init/daemon-cli.ts, restart-intent.ts, tests
**Dependencies:** Tasks 5, 6, 8

### Task 10: Suppression — non-convergence detected at boot
**Story:** Restart-loop suppression / happy path (suppress) 
**Type:** happy-path (of the guard)
**Steps:**
1. Failing test: marker target T, fresh identity F ≠ T ⇒ suppression recorded for T's *actual current on-disk* identity, one warning naming both.
2. RED. 3. Implement suppression derivation + persistence. 4. GREEN. 5. Commit.
**Files:** restart-intent.ts, stale-engine-init, tests
**Dependencies:** Task 9

### Task 11: Suppression — hold, re-arm, log-once, lost-state bound
**Story:** Restart-loop suppression / negative paths + re-arm happy path
**Type:** negative-path
**Steps:**
1. Failing tests: while suppressed, repeated stale verdicts of the suppressed identity ⇒ no marker write, no exit, exactly one suppression warning across passes; identity moves to a new value ⇒ suppression clears and normal flow resumes; corrupt/missing suppression record ⇒ treated absent (handshake re-derives next boot).
2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** restart-intent.ts, engine-identity.ts glue, tests
**Dependencies:** Task 10

### Task 12: Idle-branch gate chain
**Story:** Detect stale engine / negative paths (once-mode, non-self-host, flag off)
**Type:** negative-path
**Steps:**
1. Failing unit tests on `runDaemon` with injected deps: stale checker + (once-mode | selfHost=false | flag=false) ⇒ `requestRestart` dep never called, idle behavior identical to today (sleep/sweep invoked as before); selfHost=false additionally never invokes the checker at all.
2. RED. 3. Add the gate chain to the idle branch reading pre-resolved state (no config re-read). 4. GREEN. 5. Commit.
**Files:** src/conductor/src/engine/daemon.ts, daemon tests
**Dependencies:** Tasks 3, 7, 8

### Task 13: Idle-branch happy path + in-flight re-verify
**Story:** Detect stale engine / happy path + in-flight negative path
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: all gates pass + stale ⇒ `requestRestart({from, target})` called exactly once with both identities; a `Tagged` added to `inFlight` between verdict and request (simulated via dep hooks) ⇒ request NOT called (re-verify `inFlight.size === 0` immediately before requesting).
2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** engine/daemon.ts, tests
**Dependencies:** Task 12

### Task 14: Real RestartRequester — marker → release → exit ordering
**Story:** Detect stale engine / happy path (marker+release+exit 0) + crash-ordering negative
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests with injected lock/exit fakes: invocation order is exactly write-marker, release lock, exit(0); a throw after marker-write still reaches the existing exit backstop (lock not stranded — assert `releaseSync` called via backstop path).
2. RED. 3. Implement the real requester in daemon-cli wiring (where lock handle + backstop live) and inject into `runDaemon`. 4. GREEN. 5. Commit.
**Files:** daemon-cli.ts, engine/daemon.ts deps type, tests
**Dependencies:** Tasks 5, 13

### Task 15: Acceptance spec — real rebuilt-dist fixture (real-binary smoke)
**Story:** Detect stale engine / Done When (real rebuild flips identity; byte-identical does not)
**Type:** negative-path/system
**Steps:**
1. Failing acceptance spec in the conductor's test framework: build a minimal tsup fixture (or rebuild the real `src/conductor` in an isolated tmp copy), capture identity, rebuild **with a source change** ⇒ checker reports stale and the daemon-shaped harness observes marker content + exit 0 + released pidfile; rebuild **byte-identical** ⇒ no marker, still running. Daemon spawn goes through the env kill-switch-guarded launch path (vitest global setup) — no leaked processes.
2. RED. 3. Wire fixture + spec. 4. GREEN. 5. Commit.
**Files:** src/conductor/test (new spec + fixture helper)
**Dependencies:** Task 14

### Task 16: Acceptance spec — post-restart dispatch parity guard
**Story:** Startup restart handshake / parity negative path (PR #109 class)
**Type:** negative-path/system
**Steps:**
1. Failing spec: a repo state with a processed marker, a HALT-parked feature, and an in-progress worktree booted (a) manually and (b) after an engine-refresh exit produces IDENTICAL dispatch decisions and identical feature state on disk (diff the decision log / dashboard scan output).
2. RED. 3. Fix any divergence (expected: none — wiring adds no dispatch effects). 4. GREEN. 5. Commit.
**Files:** src/conductor/test, possibly daemon-dashboard test helpers
**Dependencies:** Tasks 9, 14

### Task 17: Docs + CHANGELOG
**Story:** Config flag / Done When (README documents key); repo docs-track-features + changelog gates
**Type:** infrastructure
**Steps:**
1. Document `auto_restart_on_stale_engine` (default false, once-at-startup read, self-host-only effect, RESTART_PENDING/suppression semantics, #215 transport dependency) in `src/conductor/README.md` + root README daemon section.
2. Add CHANGELOG `[Unreleased]` **Added** entry.
3. Run `test/test_harness_integrity.sh`; commit.
**Files:** src/conductor/README.md, README.md, CHANGELOG.md
**Dependencies:** Tasks 1–16 (content-wise; can draft alongside)

## Task Dependency Graph

```
T1 ─ T2
 ├── T3 ─ T4
 │         ╲
T7 ─────────╀─ T8 ─ T9 ─ T10 ─ T11
T5 ─ T6 ────┤     ╲
            └─ T12 ─ T13 ─ T14 ─ T15
                   T9,T14 ─ T16
                          all ─ T17
```

## Integration Points

- After Task 8: daemon boots with identity + ARMED/DISARMED observability (no behavior change).
- After Task 14: full exit-to-respawn path exercisable end-to-end with fakes.
- After Task 15: proven against a real rebuild — the feature is demonstrably real, not
  fixture-deep.

## Verification

- [ ] All happy path criteria covered (T1, T3, T5, T8, T9, T10-rearm, T13, T14, T15)
- [ ] All negative path criteria covered (T2, T4, T6, T7, T9-no-noise, T11, T12, T13-inflight, T14-ordering, T15-identical, T16-parity)
- [ ] No task exceeds ~5 minutes
- [ ] Dependencies explicit and acyclic
- [ ] Tier M artifacts present (complexity, architecture, review, conflicts) — daemon resolves complexity by this plan stem
