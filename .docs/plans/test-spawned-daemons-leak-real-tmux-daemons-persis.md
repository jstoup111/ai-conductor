# Implementation Plan: test-spawned daemons leak — deep-seam guard + repo-root self-termination

**Date:** 2026-07-04
**Track:** technical (no PRD) — Tier S
**Stories:** .docs/stories/test-spawned-daemons-leak-real-tmux-daemons-persis.md (Status: Accepted)
**Conflict check:** skipped (Tier S)
**Source:** issue jstoup111/ai-conductor#257
**Decision:** .memory/decisions/daemon-leak-deep-seam-guard.md (Approach A)

## Summary

Two defense layers against leaked test daemons, in 11 tasks: (TS-1) the real tmux
runner refuses to create `cc-daemon-*` sessions under the test kill-switch, closing
every current and future launch path; (TS-2) a daemon whose repo root disappears
self-terminates with a new `repo_root_missing` stop reason.

## Technical Approach

- **TS-1 (deep-seam guard)** lives entirely in `src/conductor/src/engine/daemon-tmux.ts`.
  `defaultTmuxRunner` (line ~51) gains a pre-exec check: when
  `process.env.AI_CONDUCTOR_NO_REAL_EXEC === '1'` AND `args[0] === 'new-session'`
  AND the `-s` value starts with `SESSION_PREFIX` (`cc-daemon-`), throw a
  descriptive `Error` naming both the env var and the refused session name —
  before `spawnSync` runs. All other subcommands (`has-session`, `kill-session`,
  `capture-pane`, `send-keys`, `ls`) and non-daemon session names pass through
  untouched, so observation/cleanup helpers and fixture sessions keep working.
  Injected runners bypass the guard by construction (it is inside
  `defaultTmuxRunner` only), preserving every existing spy/delegation test.
  The existing `launchDaemon` kill-switch (`AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH`,
  daemon-launch.ts:60) is retained unchanged as the operational suppressor.
  Fire-and-forget callers already tolerate a throwing launch: `handoff-step.ts`
  catches and prints "daemon was not started" (lines 117–133), so a refused
  launch never fails a handoff.

- **TS-2 (self-termination)** extends the pure daemon core
  (`src/conductor/src/engine/daemon.ts`) with an injectable dep so the core
  stays fs-free:
  - `DaemonDeps.repoRootMissing?: () => string | null` — returns the missing
    repo-root path when the root is definitively absent, else `null`. Absent
    dep = never missing (pure unit tests unaffected).
  - `DaemonStopReason` union (line 198) gains `'repo_root_missing'`.
  - The check runs at the top of every `while (true)` iteration (next to
    `ceilingHit()`, line ~351), so it covers dispatch ticks, idle-poll ticks,
    and identity-fail-closed passes (where `discoverBacklog` returns empty).
    On a hit: log one line `[daemon] repo root missing: <path> — stopping`,
    break; the existing drain loop still awaits in-flight workers (they settle
    on their own — their outcomes are collected as usual), then return
    `stoppedReason: 'repo_root_missing'`.
  - Production wiring in `src/conductor/src/daemon-cli.ts` (~line 496) binds
    `repoRootMissing: () => existsSync(projectRoot) ? null : projectRoot`.

- **Sequencing:** TS-1 first (pure guard, isolated), then TS-2 core → wiring →
  docs. Tests use the project's vitest conventions; real-tmux tests follow the
  existing real-binary-smoke pattern and must clean up their own scratch
  sessions in `finally`.

## Prerequisites

- `npm install` inside `src/conductor` (worktree-local node_modules).
- tmux present on the dev host (real-binary smoke tasks; guard with the
  existing `tmuxInstalled()` probe / skip pattern if absent).

## Tasks

### Task 1: RED — defaultTmuxRunner refuses cc-daemon new-session under kill-switch
**Story:** TS-1, happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test in `test/engine/daemon-tmux.test.ts`: with
   `AI_CONDUCTOR_NO_REAL_EXEC='1'` (already set by global setup), calling
   `defaultTmuxRunner(['new-session','-d','-s','cc-daemon-guardtest-abc123','-c','/tmp','sleep 1'], {inherit:false})`
   throws an Error whose message contains both `AI_CONDUCTOR_NO_REAL_EXEC` and
   `cc-daemon-guardtest-abc123`; then assert via real
   `hasSession('cc-daemon-guardtest-abc123')` that no session exists.
2. Verify test fails (RED — currently a real session would be created; kill it
   in the test's `finally` during the RED run).
3. No implementation in this task.

**Files likely touched:**
- `src/conductor/test/engine/daemon-tmux.test.ts` — new describe block

**Dependencies:** none

### Task 2: GREEN — implement the guard in defaultTmuxRunner
**Story:** TS-1, happy path 1 + 3
**Type:** happy-path

**Steps:**
1. In `daemon-tmux.ts` `defaultTmuxRunner`, before `spawnSync`: if
   `process.env.AI_CONDUCTOR_NO_REAL_EXEC === '1'` and `args[0] === 'new-session'`
   and the value following `-s` starts with `SESSION_PREFIX`, throw
   `Error` naming env var + session name.
2. Verify Task 1 test passes (GREEN).
3. Run the full daemon-tmux + daemon-launch suites to confirm no regression
   (production path untouched when env unset — existing tests cover argv).
4. Commit: "feat(daemon): deep-seam tmux guard — refuse cc-daemon new-session under test kill-switch (#257)"

**Files likely touched:**
- `src/conductor/src/engine/daemon-tmux.ts` — guard in defaultTmuxRunner

**Dependencies:** Task 1

### Task 3: Guard scoping — non-create subcommands and non-daemon sessions pass through
**Story:** TS-1, negative paths 1 + 2
**Type:** negative-path

**Steps:**
1. Write test (real tmux, skip when not installed): under the kill-switch,
   (a) `defaultTmuxRunner` `new-session` for `guardtest-scratch-<pid>` (no
   cc-daemon prefix) succeeds — session exists via `hasSession`; (b)
   `kill-session` on it succeeds; (c) `has-session` for a nonexistent name
   returns code≠0 without throwing. Clean up in `finally`.
2. Verify pass (guard already scoped by Task 2; if any case fails, fix scoping).
3. Commit: "test(daemon): guard scoping — observation/cleanup and non-daemon sessions unaffected (#257)"

**Files likely touched:**
- `src/conductor/test/engine/daemon-tmux.test.ts`

**Dependencies:** Task 2

### Task 4: End-to-end — un-injected handoff path leaks zero sessions and still succeeds
**Story:** TS-1, happy path 2
**Type:** happy-path (integration)

**Steps:**
1. Write failing-capable test in `test/engine/engineer/handoff-step.test.ts`
   (or a new file): save/restore `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH`, then
   DELETE it for the test so the flow reaches the deep guard (this simulates
   exactly the historical leak: a path the launchDaemon switch didn't cover);
   `AI_CONDUCTOR_NO_REAL_EXEC='1'` stays. Run `runHandoff` with NO `launchFn`
   against a temp git repo target. Assert: handoff returns an entry (success),
   the printed output contains the "daemon was not started" warning, and
   `hasSession(sessionNameForRepo(tempRepo))` is false.
2. Verify (RED would only occur pre-Task-2; with guard in place this is the
   pinning regression test — must pass and must FAIL if the guard is removed:
   verify by temporarily commenting the guard once, locally).
3. Commit: "test(engineer): un-injected handoff cannot leak a real daemon under test env (#257)"

**Files likely touched:**
- `src/conductor/test/engine/engineer/handoff-step.test.ts`

**Dependencies:** Task 2

### Task 5: Injected-runner delegation unaffected by the guard
**Story:** TS-1, negative path 3
**Type:** negative-path

**Steps:**
1. Write test: under the kill-switch, `makeTmuxSupervisor(spyRunner).start(repo)`
   still forwards `new-session` argv for a `cc-daemon-*` name to the injected
   spy (guard must NOT be consulted for injected runners).
2. Verify pass; if existing supervised-hosting acceptance tests already assert
   this exact contract, extend rather than duplicate.
3. Commit: "test(daemon): injected TmuxRunner bypasses deep-seam guard (#257)"

**Files likely touched:**
- `src/conductor/test/engine/daemon-tmux.test.ts` or `test/acceptance/daemon-supervised-hosting.test.ts`

**Dependencies:** Task 2

### Task 6: RED — repo_root_missing stop reason, immediate stop, no dispatch
**Story:** TS-2, happy path
**Type:** happy-path

**Steps:**
1. Write failing test in `test/engine/daemon.test.ts` (existing pure-core
   suite): `runDaemon` with `repoRootMissing: () => '/gone/repo'`, a
   `discoverBacklog` that would yield one item, and a `runFeature` spy →
   resolves `{ processed: [], stoppedReason: 'repo_root_missing' }`,
   `runFeature` never called, log received one line containing
   `repo root missing` and `/gone/repo`.
2. Verify test fails (RED — type error on the union is part of RED).
3. No implementation in this task.

**Files likely touched:**
- `src/conductor/test/engine/daemon.test.ts`

**Dependencies:** none (parallel to TS-1 tasks)

### Task 7: GREEN — implement repoRootMissing dep + loop check
**Story:** TS-2, happy path
**Type:** happy-path

**Steps:**
1. Add `'repo_root_missing'` to `DaemonStopReason`; add
   `repoRootMissing?: () => string | null` to `DaemonDeps` (documented:
   "definitive absence only — return null on doubt/transient errors").
2. At the top of the `while (true)` loop (before `ceilingHit()`), call the dep
   (when present); on a non-null path: `log('[daemon] repo root missing: <path> — stopping')`,
   set `stopReason = 'repo_root_missing'`, break.
3. Verify Task 6 passes (GREEN); run the full daemon.test.ts suite.
4. Commit: "feat(daemon): self-terminate with repo_root_missing when the repo root vanishes (#257)"

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — union, dep, loop check

**Dependencies:** Task 6

### Task 8: Negative — no false positive when the root exists throughout
**Story:** TS-2, negative path 1
**Type:** negative-path

**Steps:**
1. Write test: `repoRootMissing: () => null` throughout a run that processes
   one backlog item then drains (`once: true`) → `stoppedReason:
   'backlog_drained'`, item processed, no `repo root missing` log line.
2. Verify pass.
3. Commit: "test(daemon): repo-root check never false-positives while root exists (#257)"

**Files likely touched:**
- `src/conductor/test/engine/daemon.test.ts`

**Dependencies:** Task 7

### Task 9: Negative — identity-parked/idle daemon still self-terminates; bounded shutdown with in-flight worker
**Story:** TS-2, negative paths 2 + 3
**Type:** negative-path

**Steps:**
1. Write test (idle/identity-parked): `discoverBacklog` always returns `[]`
   (the identity-fail-closed shape), `repoRootMissing` returns null for the
   first 2 calls then `'/gone/repo'` (mutable closure), `idlePollMs: 1`,
   injected `sleep` → daemon stops with `repo_root_missing` (not
   `idle_timeout`), within a bounded number of ticks.
2. Write test (in-flight drain): dispatch one slow `runFeature` (deferred
   promise), flip `repoRootMissing` while it is in flight, then resolve the
   worker → `runDaemon` returns `repo_root_missing` with the worker's outcome
   collected; no second dispatch occurred after the flip.
3. Verify both pass (loop-top placement from Task 7 should satisfy; fix if not).
4. Commit: "test(daemon): identity-parked + in-flight paths still self-terminate on missing root (#257)"

**Files likely touched:**
- `src/conductor/test/engine/daemon.test.ts`

**Dependencies:** Task 7

### Task 10: Production wiring — daemon-cli binds existsSync(projectRoot)
**Story:** TS-2 "Done When" (wiring; orphaned-primitive guard)
**Type:** infrastructure

**Steps:**
1. In `src/daemon-cli.ts` runDaemon deps (~line 496), add
   `repoRootMissing: () => (existsSync(projectRoot) ? null : projectRoot)`.
2. Write/extend a wiring test if a daemon-cli deps test exists; otherwise grep
   proves the binding exists and typecheck covers the shape
   (`rtk proxy npx tsc --noEmit`).
3. Verify: full suite green, `tmux ls` unchanged before/after the run
   (TS-1 "Done When" suite-level check).
4. Commit: "feat(daemon-cli): wire repoRootMissing to existsSync(projectRoot) (#257)"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts`

**Dependencies:** Task 7

### Task 11: Docs + changelog
**Story:** TS-1/TS-2 "Done When" (docs track features)
**Type:** infrastructure

**Steps:**
1. `src/conductor/README.md`: document the `repo_root_missing` stop reason and
   the deep-seam test guard (one short subsection under daemon lifecycle).
2. `CHANGELOG.md` `[Unreleased]`: Added — deep-seam tmux guard; Added — daemon
   self-termination on missing repo root (refs #257).
3. Run `test/test_harness_integrity.sh` (repo validation gate).
4. Commit: "docs: daemon leak guard + repo_root_missing stop reason (#257)"

**Files likely touched:**
- `src/conductor/README.md`, `CHANGELOG.md`

**Dependencies:** Tasks 2, 7, 10

## Task Dependency Graph

```
TS-1: 1 → 2 → {3, 4, 5}
TS-2: 6 → 7 → {8, 9, 10}
docs: {2, 7, 10} → 11
(TS-1 and TS-2 chains are independent and parallelizable)
```

## Integration Points

- After Task 4: the historical leak scenario (un-guarded launch path reaching
  real tmux from a test) is provably closed end-to-end.
- After Task 10: a production daemon started against a repo that later
  disappears exits cleanly — verifiable manually by starting a daemon in a
  scratch repo and deleting the repo.

## Verification

- [x] All happy path criteria covered: TS-1 HP1→T1/T2, HP2→T4, HP3→T2(step 3); TS-2 HP→T6/T7/T10
- [x] All negative path criteria covered: TS-1 NP1/NP2→T3, NP3→T5; TS-2 NP1→T8, NP2/NP3→T9
- [x] No task exceeds ~5 minutes
- [x] Dependencies explicit and acyclic
- [x] Docs task included (repo "docs track features" gate)
