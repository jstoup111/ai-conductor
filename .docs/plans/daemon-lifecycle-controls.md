# Implementation Plan: Daemon Lifecycle Controls

**Date:** 2026-07-04
**Design:** `.docs/specs/2026-07-04-daemon-lifecycle-controls.md` (PRD, FR-1–21)
**Stories:** `.docs/stories/2026-07-04-daemon-lifecycle-controls.md` (21 stories, Accepted)
**ADRs:** adr-2026-07-04-versioned-engine-store-atomic-flip · adr-2026-07-04-durable-pause-marker ·
adr-2026-07-04-respawn-in-place-restart · adr-2026-07-04-pending-restart-queue (all APPROVED)
**Conflict check:** Clean as of 2026-07-04 (obligations folded in: T9 bin/setup smoke, T12 rekick
gating, T38 pause-vs-debug docs)

## Summary

38 tasks in three independently shippable phases: (1) versioned engine store — closes #215
standalone; (2) durable pause/resume with fleet selectors; (3) respawn-in-place restart with
durable pending-restart. Plus docs/changelog. Tier L; task count surfaced and approved at plan
review.

## Technical Approach

- **Phase 1 (engine store).** New `src/engine/engine-store.ts` owns the versioned layout:
  `src/conductor/dist-versions/<version-id>/` + `dist` symlink. `npm run build` is rewired from
  raw `tsup` to `node scripts/publish-engine.mjs`: tsup builds into a staging dir (its
  `clean:true` confined there), staging is finalized as `dist-versions/<id>/`, and the `dist`
  symlink is retargeted atomically (symlink-new + `rename`). `bin/conduct-ts` resolves `dist`'s
  realpath before `exec node`, pinning every process to its version dir. The pidfile record
  gains an additive `engineDir`; GC (in the publish script, via engine-store) deletes a version
  only when not-current ∧ unreferenced-by-live-pidfile (registry enumeration) ∧ min-age ∧
  outside keep-last-K, and any read error skips ALL deletion. First publish migrates a real
  `dist/` dir to the store. Test seam: store root / registry env-overridable
  (`AI_CONDUCTOR_ENGINE_STORE` test override; `AI_CONDUCTOR_REGISTRY` exists).
- **Phase 2 (pause).** New `src/engine/pause-marker.ts` (sibling of `halt-marker.ts`):
  `.daemon/PAUSED`, existence-authoritative, JSON metadata informational. Injected
  `isPaused` dep in `runDaemon`, checked before the fill-pool block and re-polled on the idle
  tick; `maybeRekick` also gated. Verbs `pause`/`resume` join `daemon-command.ts` +
  `daemon-supervisor-cli.ts` with `--all`/multi-repo selectors (registry enumeration,
  per-repo outcomes, best-effort). `computeStatusRow` gains an explicit state enum
  (running/paused/stopped/stale, paused×dead composite) + pausedAt/by + engine version.
- **Phase 3 (restart).** `daemon-tmux.ts` restart becomes remain-on-exit + `respawn-pane -k`
  (exact-`=` targeting), with dead-pane revival in `start` and explicit-report fallback to
  kill+recreate. New `src/engine/restart-marker.ts`: `.daemon/RESTART-PENDING`, consume-once
  (cleared on any daemon boot). CLI restart: idle/paused → immediate respawn; busy → write
  marker, report blocking slug. Daemon sweep boundary: idle ∧ marker → self-respawn as final
  act (bare-run: log + clean exit). Pidfile handoff = existing acquire/reclaim.
- **Sequencing rationale:** Phase 1 first because restart-adopts-newest (Phase 3) and the
  #215 smoke depend on the store; Phase 2 before 3 because restart gating treats paused as
  idle and the fleet-selector plumbing is shared.
- **Testing:** vitest `test/engine/…`, injected `TmuxRunner`/fake supervisor/fake daemon deps,
  env kill-switches already global. Two mandatory real-binary smokes: #215 rebuild proof (T8)
  and tmux scrollback/respawn proof (T36).

## Prerequisites

- Node 20 toolchain + existing vitest setup (present).
- No schema/infra changes. All new state files live under the target repo's `.daemon/`.

## Tasks

### Phase 1 — Versioned engine store (FR-13–16; closes #215)

### Task 1: engine-store module — layout + version-id + listing
**Story:** FR-13/FR-14 (foundations)
**Type:** infrastructure
**Steps:** 1. Failing tests: store root resolution (`AI_CONDUCTOR_ENGINE_STORE` override, else
`<conductor>/dist-versions`), version-id format (timestamp+content-stamp, unique on dirty
trees), `listVersions()`, `currentTarget()` (readlink). 2. RED. 3. Implement
`src/engine/engine-store.ts` (typed `EngineVersionId`, no bare strings). 4. GREEN. 5. Commit
"feat(engine-store): versioned layout primitives".
**Files:** `src/conductor/src/engine/engine-store.ts`, `test/engine/engine-store.test.ts`
**Dependencies:** none

### Task 2: publish script — staging build + finalize
**Story:** FR-13 happy ("publish flow is staging → finalize")
**Type:** infrastructure
**Steps:** 1. Failing test (execa, tsup stubbed via env/flag): publish builds into a staging
dir, finalized dir appears under `dist-versions/<id>/`, staging removed. 2. RED. 3. Implement
`scripts/publish-engine.mjs` (staging outDir passed to tsup; finalize = `rename`). 4. GREEN.
5. Commit.
**Files:** `src/conductor/scripts/publish-engine.mjs`, `test/engine/publish-engine.test.ts`
**Dependencies:** Task 1

### Task 3: atomic current flip — never in-place
**Story:** FR-13 neg (mid-load publish → wholly-old or wholly-new)
**Type:** happy-path
**Steps:** 1. Failing test: after publish, `dist` is a symlink to the new dir; flip is
symlink-tmp + rename (assert no window where `dist` is absent — stat loop during publish in a
child proc, or assert implementation uses rename not unlink+symlink). Published dirs never
rewritten (mtime snapshot). 2. RED. 3. Implement flip in engine-store, used by publish. 4.
GREEN. 5. Commit.
**Files:** `engine-store.ts`, `publish-engine.mjs`, tests
**Dependencies:** Task 2

### Task 4: migration + legacy-build guard
**Story:** FR-13 neg (raw build fails loudly; habit path)
**Type:** negative-path
**Steps:** 1. Failing tests: (a) publish over a real `dist/` dir migrates it to
`dist-versions/<bootstrap-id>/` + symlink; (b) tsup invoked directly against live layout is
refused — `npm run build` now points at the wrapper, and the wrapper errors with actionable
guidance if `dist` is a plain dir in any non-migration invocation; `grep` guard test that
`package.json` build script is the wrapper. 2. RED. 3. Implement migration + guard; rewire
`package.json` `"build"`. 4. GREEN. 5. Commit.
**Files:** `publish-engine.mjs`, `src/conductor/package.json`, tests
**Dependencies:** Task 3

### Task 5: launcher realpath pinning + broken-current error
**Story:** FR-13 happy (pinning), FR-16 neg (dangling/incomplete current)
**Type:** happy-path + negative-path
**Steps:** 1. Failing bash-level test (`test/test_conduct_ts_launcher.sh` or vitest execa):
launcher execs the RESOLVED realpath (`node <store>/dist-versions/<id>/index.js` — assert via
a stub index.js echoing its own `import.meta.url`); dangling symlink → exit non-zero +
message naming rebuild/republish fix. 2. RED. 3. Edit `bin/conduct-ts`: `DIST_REAL=$(readlink
-f "$CONDUCTOR_DIR/dist")/index.js`, error branch. `bash -n` passes. 4. GREEN. 5. Commit.
**Files:** `bin/conduct-ts`, launcher test
**Dependencies:** Task 3

### Task 6: pidfile engineDir field
**Story:** FR-14 happy + neg (legacy record → version-unknown)
**Type:** happy-path
**Steps:** 1. Failing tests: `writePidfileExcl`/`holdLock` records `engineDir` (from
`import.meta.url`-derived running dir); `readPidRecord` tolerates records WITHOUT the field
(returns undefined engineDir, no throw). 2. RED. 3. Additive field in `daemon-lock.ts`. 4.
GREEN. 5. Commit.
**Files:** `src/engine/daemon-lock.ts`, `test/engine/daemon-lock.test.ts`
**Dependencies:** Task 1

### Task 7: GC — four-condition fail-closed policy
**Story:** FR-15 happy + all four negs
**Type:** negative-path (safety-critical)
**Steps:** 1. Failing tests, one per condition independently blocking deletion (current;
live-pidfile-referenced even if ancient; min-age; keep-last-K), plus: registry enumeration
error → zero deletions + publish still exit 0 + warning; one unreadable pidfile → zero
deletions. 2. RED. 3. Implement `gcVersions()` in engine-store; call from publish after flip.
4. GREEN. 5. Commit.
**Files:** `engine-store.ts`, `publish-engine.mjs`, `test/engine/engine-store-gc.test.ts`
**Dependencies:** Tasks 3, 6

### Task 8: real-binary #215 smoke
**Story:** FR-13 Done-When (the acceptance proof)
**Type:** integration (real-binary smoke)
**Steps:** 1. Failing smoke (guarded so CI without tmux still runs it — no tmux needed here):
in a temp store, start a long-lived node process from version A via the real launcher, run a
real publish creating version B, then have the process perform a first-time dynamic import →
succeeds from A, no ENOENT; a fresh launcher invocation resolves B. 2. RED. 3. (Wiring only —
behavior comes from T1–T7.) 4. GREEN. 5. Commit.
**Files:** `test/engine/engine-store-smoke.test.ts` (or `test/test_engine_store_smoke.sh`)
**Dependencies:** Tasks 4, 5, 7

### Task 9: interrupted publish + bin/setup compatibility
**Story:** FR-13 neg (partial publish); conflict-report obligation
**Type:** negative-path
**Steps:** 1. Failing tests: kill publish between staging and flip → `current` untouched,
next publish cleans the orphaned staging; run `bin/setup` in a temp worktree → worktree-local
`dist/index.js` resolves (symlink) and primary checkout untouched (harness-daemon-profile
assertions stay green). 2. RED. 3. Fix as needed. 4. GREEN. 5. Commit.
**Files:** `publish-engine.mjs`, `bin/setup` (assert-only), tests
**Dependencies:** Task 4

### Phase 2 — Pause / resume (FR-1–7, 17–19)

### Task 10: pause-marker module
**Story:** FR-1/FR-4 foundations
**Type:** infrastructure
**Steps:** 1. Failing tests: single-source path `.daemon/PAUSED`; `isPaused` ENOENT→false,
exists→true; write is idempotent + records `{pausedAt, pausedBy}`; remove idempotent; read
of corrupt JSON → paused=true + metadata undefined. 2. RED. 3. Implement
`src/engine/pause-marker.ts` mirroring `halt-marker.ts`. 4. GREEN. 5. Commit.
**Files:** `src/engine/pause-marker.ts`, `test/engine/pause-marker.test.ts`
**Dependencies:** none (parallel with Phase 1)

### Task 11: loop gating at the dispatch boundary
**Story:** FR-1 happy (no dispatch while paused; drain continues)
**Type:** happy-path
**Steps:** 1. Failing daemon-loop tests (fake deps): `isPaused` dep true → zero dispatch
across ticks while `discoverBacklog` returns eligible items; in-flight injected before pause
completes/parks normally; idle tick re-polls the predicate (pause lifted mid-run → dispatch
resumes next boundary, at-most-once per item). 2. RED. 3. Add `isPaused` to `DaemonDeps`,
guard fill-pool block, re-poll in idle tick; wire real predicate in `daemon-cli.ts`. 4.
GREEN. 5. Commit.
**Files:** `src/engine/daemon.ts`, `src/daemon-cli.ts`, `test/engine/daemon-pause.test.ts`
**Dependencies:** Task 10

### Task 12: rekick gated while paused
**Story:** FR-1 neg (re-kick is a dispatch path — conflict-check addition)
**Type:** negative-path
**Steps:** 1. Failing test: paused daemon + HALT-parked item + base-SHA advance → no re-kick
dispatch; resume → re-kick eligible again. 2. RED. 3. Gate `maybeRekick` on the pause
predicate. 4. GREEN. 5. Commit.
**Files:** `src/engine/daemon.ts` (rekick call site), tests
**Dependencies:** Task 11

### Task 13: unreadable marker fails closed
**Story:** FR-1 neg (EACCES → paused + warning)
**Type:** negative-path
**Steps:** 1. Failing test: injected `isPaused` raising a non-ENOENT error at the loop
boundary → treated paused, zero dispatch, warning logged once per transition (not per tick).
2. RED. 3. Implement error-to-paused mapping in the predicate wiring. 4. GREEN. 5. Commit.
**Files:** `pause-marker.ts` / `daemon-cli.ts` wiring, tests
**Dependencies:** Task 11

### Task 14: boot honors pause + logs it
**Story:** FR-4 happy (start paused), FR-7 (advance pause)
**Type:** happy-path
**Steps:** 1. Failing test: `runDaemonMode` boot in a repo with the marker → startup log line
states paused; zero dispatch. Marker set while stopped → later boot honors it (FR-7); resume
while stopped → later boot dispatches. 2. RED. 3. Boot-time check + log in `daemon-cli.ts`.
4. GREEN. 5. Commit.
**Files:** `src/daemon-cli.ts`, tests
**Dependencies:** Task 11

### Task 15: automation cannot override pause
**Story:** FR-4 neg (ensureRunning launches a paused daemon; never removes marker)
**Type:** negative-path
**Steps:** 1. Failing test: `ensureRunning` in a paused repo (autolaunch kill-switch honored
via injected launcher) → launch attempted, marker untouched; launched loop (fake) dispatches
nothing; repeated ensure calls never remove/modify the marker. 2. RED. 3. (Assert-only —
no `ensureRunning` change expected.) 4. GREEN. 5. Commit.
**Files:** `test/engine/daemon-lock-ensure-pause.test.ts`
**Dependencies:** Tasks 10, 14

### Task 16: pause/resume verbs — single repo
**Story:** FR-1/FR-2 CLI surface; FR-6 no-ops
**Type:** happy-path
**Steps:** 1. Failing tests: `detectDaemonSupervisorCommand`/verb table accepts
`pause`/`resume`; dispatch writes/removes the marker for the cwd repo; pause-when-paused →
exit 0 "already paused"; resume-when-not-paused → exit 0 "not paused"; alternation converges.
2. RED. 3. Add verbs to `daemon-command.ts` + `daemon-supervisor-cli.ts` (marker ops, not
supervisor methods). 4. GREEN. 5. Commit.
**Files:** `src/engine/daemon-command.ts`, `src/engine/daemon-supervisor-cli.ts`, tests
**Dependencies:** Task 10

### Task 17: fleet selectors — multi-repo + --all + per-repo outcomes
**Story:** FR-3 happy/neg, FR-17 (pause/resume call sites), FR-18
**Type:** happy-path + negative-path
**Steps:** 1. Failing tests: named subset pauses exactly those repos (third untouched);
`--all` iterates registry, one outcome line per repo; one repo missing-path → per-repo error,
others succeed, partial-failure exit distinct from success; unknown name reported verbatim,
valid names still acted on; all-unknown → non-zero, zero side effects; empty registry `--all`
→ "no registered repos", exit 0. 2. RED. 3. Implement fleet iterator (registry enumeration →
per-repo action → outcome report) shared by pause/resume (and restart in T32). 4. GREEN. 5.
Commit.
**Files:** `daemon-supervisor-cli.ts` (or new `daemon-fleet.ts`), tests
**Dependencies:** Task 16

### Task 18: resume is ordering-neutral
**Story:** FR-2 happy + neg (queue position intact; race single-dispatch)
**Type:** happy-path
**Steps:** 1. Failing tests: control run vs pause→enqueue→resume run dispatch identical
order; ledger/processed/backlog inputs byte-equal before pause vs after resume; resume racing
a tick → each item dispatched at most once. 2. RED. 3. (Assert-only against T11 —
implementation must not mutate backlog state anywhere in pause/resume.) 4. GREEN. 5. Commit.
**Files:** `test/engine/daemon-pause-resume-order.test.ts`
**Dependencies:** Tasks 11, 16

### Task 19: status — state enum + paused rendering
**Story:** FR-5 happy + negs (paused+dead; corrupt metadata)
**Type:** happy-path + negative-path
**Steps:** 1. Failing tests: `computeStatusRow` returns an explicit state enum; four-state
fleet renders distinctly; paused+dead shows both facts; corrupt metadata → paused shown,
no throw; exhaustive switch (type-level: no default arm). 2. RED. 3. Extend
`daemon-observe-cli.ts` row model + renderer (pausedAt/by columns). 4. GREEN. 5. Commit.
**Files:** `src/engine/daemon-observe-cli.ts`, tests
**Dependencies:** Task 10

### Task 20: status — engine version column
**Story:** FR-14 happy + neg (legacy record → version-unknown; GC'd dir for stopped repo)
**Type:** happy-path
**Steps:** 1. Failing tests: row shows version id from pidfile `engineDir`; record without
field → "version-unknown"; stopped repo with dangling engineDir → no error. 2. RED. 3. Wire
T6 field into status. 4. GREEN. 5. Commit.
**Files:** `daemon-observe-cli.ts`, tests
**Dependencies:** Tasks 6, 19

### Task 21: cross-repo isolation (pause scope)
**Story:** FR-19 happy + neg (same-basename repos)
**Type:** negative-path
**Steps:** 1. Failing tests: pause repo A → repo B's `.daemon/` byte-identical (snapshot);
two registered repos with same basename, pause one by path identity → other untouched. 2.
RED. 3. Fix any leakage. 4. GREEN. 5. Commit.
**Files:** `test/engine/daemon-fleet-isolation.test.ts`
**Dependencies:** Task 17

### Phase 3 — Restart (FR-8–12, 20–21) + docs

### Task 22: tmux adapter — respawn-in-place restart (argv)
**Story:** FR-20 happy (session survives), FR-20 neg (only daemon pane respawned)
**Type:** happy-path
**Steps:** 1. Failing injected-runner tests: `restart` argv = set-option remain-on-exit +
`respawn-pane -k` with exact-`=` session target + window/pane the adapter created; NO
kill-session in the happy path; operator windows untouched (no argv addressing other
windows). 2. RED. 3. Reimplement `makeTmuxSupervisor().restart`. 4. GREEN. 5. Commit.
**Files:** `src/engine/daemon-tmux.ts`, `test/engine/daemon-tmux.test.ts`
**Dependencies:** none (parallel with Phase 2)

### Task 23: dead-pane revival in start
**Story:** FR-12 neg (session exists, process dead → revive in place)
**Type:** negative-path
**Steps:** 1. Failing injected-runner tests: `start` with session up + pane dead → respawn
(not new-session, not no-op); session absent → new-session (existing behavior). 2. RED. 3.
Extend `start`/`isUp` to distinguish session-up vs process-alive. 4. GREEN. 5. Commit.
**Files:** `daemon-tmux.ts`, tests
**Dependencies:** Task 22

### Task 24: respawn fallback — explicit degraded report
**Story:** FR-20 neg (tooling can't respawn → recreate + report loss)
**Type:** negative-path
**Steps:** 1. Failing tests: injected runner failing respawn → fallback kill-session +
new-session AND outcome text reports session-continuity loss; fallback NOT taken on success.
2. RED. 3. Implement guarded fallback. 4. GREEN. 5. Commit.
**Files:** `daemon-tmux.ts`, `daemon-supervisor-cli.ts` (outcome), tests
**Dependencies:** Task 22

### Task 25: restart pidfile handoff + single-owner
**Story:** FR-8 happy + neg (stale reclaim; race with ensureRunning)
**Type:** happy-path + negative-path
**Steps:** 1. Failing tests: restart flow → new holder pid ≠ old, exactly one live lock;
hard-dead old process leaving stale record → reclaim path used; concurrent restart +
ensureRunning (fake supervisor + real lock in temp repo) → exactly one daemon. 2. RED. 3.
Wire restart through existing acquire/reclaim (no new lock semantics). 4. GREEN. 5. Commit.
**Files:** `daemon-supervisor-cli.ts`, `test/engine/daemon-restart-lock.test.ts`
**Dependencies:** Task 22

### Task 26: restart-marker module (consume-once)
**Story:** FR-9 foundations
**Type:** infrastructure
**Steps:** 1. Failing tests: path `.daemon/RESTART-PENDING`; write idempotent (refresh
payload, one logical intent); `consumeOnBoot` removes + returns intent; consume of absent
marker → no-op. 2. RED. 3. Implement `src/engine/restart-marker.ts`. 4. GREEN. 5. Commit.
**Files:** `src/engine/restart-marker.ts`, `test/engine/restart-marker.test.ts`
**Dependencies:** none

### Task 27: restart verb — immediate vs queued
**Story:** FR-9 happy (idle/paused immediate; busy queues + reports blocking feature)
**Type:** happy-path
**Steps:** 1. Failing tests: idle → immediate respawn path; paused → immediate (paused counts
as idle); busy (in-flight detectable via lock/status inputs) → marker written, command exits
0 immediately, output names the blocking slug. 2. RED. 3. Implement in supervisor-cli using
restart-marker + T22 adapter. 4. GREEN. 5. Commit.
**Files:** `daemon-supervisor-cli.ts`, tests
**Dependencies:** Tasks 22, 26

### Task 28: daemon self-fires queued restart at idle
**Story:** FR-9 happy (fires at idle boundary) + neg (failed trigger retries)
**Type:** happy-path + negative-path
**Steps:** 1. Failing daemon-loop tests: busy→idle transition with marker → self-respawn
invoked exactly once as final act; injected trigger failure → logged, daemon continues,
retried next boundary (never exits without successor). 2. RED. 3. Sweep-boundary check in
`daemon.ts` + injected `triggerSelfRestart` dep wired in `daemon-cli.ts`. 4. GREEN. 5.
Commit.
**Files:** `src/engine/daemon.ts`, `src/daemon-cli.ts`, tests
**Dependencies:** Tasks 26, 11

### Task 29: consume-once semantics across boots
**Story:** FR-9 negs (crash-before-fire; double-request single fire)
**Type:** negative-path
**Steps:** 1. Failing tests: marker present at boot → consumed (logged as fulfilled), never
fires later; two writes while busy → one fire at idle. 2. RED. 3. `consumeOnBoot` wired into
daemon boot (before loop). 4. GREEN. 5. Commit.
**Files:** `daemon-cli.ts`, tests
**Dependencies:** Tasks 26, 28

### Task 30: bare-run pending restart — clean exit
**Story:** FR-9 (bare-run variant per ADR)
**Type:** negative-path
**Steps:** 1. Failing test: daemon with no session hosting (no supervisor injected) reaching
idle with marker → logs restart-pending honored, exits cleanly, marker consumed. 2. RED. 3.
Implement bare-run branch. 4. GREEN. 5. Commit.
**Files:** `daemon.ts`/`daemon-cli.ts`, tests
**Dependencies:** Task 28

### Task 31: restart preserves pause
**Story:** FR-11 happy + negs (queued restart on paused daemon; end-to-end compose)
**Type:** happy-path
**Steps:** 1. Failing tests: restart of paused daemon → replacement paused, marker file
unmodified by restart flow; queued-restart-on-paused fires immediately; restart→resume →
dispatch with backlog intact. 2. RED. 3. (Assert-only; fix leaks.) 4. GREEN. 5. Commit.
**Files:** `test/engine/daemon-restart-pause.test.ts`
**Dependencies:** Tasks 27, 11

### Task 32: fleet restart + not-running outcome
**Story:** FR-10 happy/negs, FR-12 happy, FR-17 (restart call site)
**Type:** happy-path + negative-path
**Steps:** 1. Failing tests: mixed fleet (idle, busy, stopped, missing-path) → per-repo
outcomes (restarted / queued / started / error), no early abort, partial-failure exit;
no-daemon+no-session → started + reported; stale pidfile + no session → reclaim + fresh
start, bounded time (no hang). 2. RED. 3. Reuse T17 fleet iterator for restart. 4. GREEN.
5. Commit.
**Files:** `daemon-supervisor-cli.ts`/`daemon-fleet.ts`, tests
**Dependencies:** Tasks 17, 27

### Task 33: status — restart-pending + two-layer liveness
**Story:** FR-9 (visibility), FR-12 neg (dead pane distinguishable)
**Type:** happy-path
**Steps:** 1. Failing tests: status shows `restart-pending (waiting on <slug>)` while marker
present; session-up/process-dead renders distinctly from running and stopped. 2. RED. 3.
Extend status row (uses T19 enum). 4. GREEN. 5. Commit.
**Files:** `daemon-observe-cli.ts`, tests
**Dependencies:** Tasks 19, 26, 23

### Task 34: orphaned-process reconciliation
**Story:** FR-21 neg (session killed externally, process survived)
**Type:** negative-path
**Steps:** 1. Failing tests: restart with live process but no session → orphan terminated,
lock reclaimed, fresh session+daemon, exactly one of each; missing tmux entirely →
established actionable error, bare-run path unaffected. 2. RED. 3. Implement reconciliation
branch. 4. GREEN. 5. Commit.
**Files:** `daemon-supervisor-cli.ts`/`daemon-tmux.ts`, tests
**Dependencies:** Tasks 23, 25

### Task 35: broken current at restart fire-time
**Story:** FR-16 neg (queued restart + broken engine → visible, recoverable)
**Type:** negative-path
**Steps:** 1. Failing test: respawn into a broken current (dangling symlink) → launcher error
lands in session/scrollback (injected runner: command exit non-zero captured), status shows
not-running, subsequent good publish + restart recovers fully. 2. RED. 3. Ensure failure
surfaces + no wedged marker state. 4. GREEN. 5. Commit.
**Files:** tests (+ fixes as surfaced)
**Dependencies:** Tasks 5, 27

### Task 36: real tmux smoke — scrollback + respawn proof
**Story:** FR-20 Done-When (real-binary convention)
**Type:** integration (real-binary smoke)
**Steps:** 1. Failing smoke (skips cleanly when tmux absent): real session + dummy daemon
command → capture scrollback → real respawn-in-place restart → same session name, window
layout, pre-restart scrollback still present above new boot output, new pid; exact-`=`
targeting verified against a near-name session. 2. RED. 3. Wire. 4. GREEN. 5. Commit.
**Files:** `test/engine/daemon-tmux-smoke.test.ts` (pattern: existing real-binary smokes)
**Dependencies:** Tasks 22, 23, 24

### Task 37: end-to-end lifecycle walkthrough test
**Story:** PRD acceptance walkthrough (pause-all → publish → restart-all → resume-all)
**Type:** integration
**Steps:** 1. Failing test (fakes for tmux, real store+markers, two temp repos): pause --all
→ zero dispatch both; publish new version; restart --all → both on new version, still
paused; resume --all → dispatch resumes, backlog intact, per-repo outcomes correct
throughout. 2. RED. 3. Fix integration seams. 4. GREEN. 5. Commit.
**Files:** `test/engine/daemon-lifecycle-e2e.test.ts`
**Dependencies:** Tasks 8, 17, 31, 32

### Task 38: docs + changelog + migration block
**Story:** Harness repo gates (CLAUDE.md); conflict-report obligation (pause vs debug)
**Type:** infrastructure
**Steps:** 1. Update `README.md` + `src/conductor/README.md`: pause/resume/restart verbs,
selectors, PAUSED/RESTART-PENDING markers, versioned store + publish flow, status columns;
disambiguate `pause` verb vs `debug` interrupt. 2. `CHANGELOG.md` `[Unreleased]`: Added
(verbs, store) / Changed (restart semantics, build flow) + `## Migration` runnable block
(one-time dist→store migration via `npm run build`; note one post-merge old-style restart
per daemon for the transition window). 3. Run `test/test_harness_integrity.sh`. 4. Commit.
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** all phases complete

## Task Dependency Graph

```
Phase 1: T1 → T2 → T3 → {T4, T5}; T1 → T6; {T3,T6} → T7; {T4,T5,T7} → T8; T4 → T9
Phase 2: T10 → T11 → {T12, T13, T14, T18}; {T10,T14} → T15; T10 → T16 → T17 → {T21}; T10 → T19 → T20 (needs T6)
Phase 3: T22 → {T23, T24, T25}; T26; {T22,T26} → T27; {T26,T11} → T28 → {T29, T30}
         {T27,T11} → T31; {T17,T27} → T32; {T19,T26,T23} → T33; {T23,T25} → T34
         {T5,T27} → T35; {T22,T23,T24} → T36; {T8,T17,T31,T32} → T37; all → T38
Phases are sequential for shipping; T10/T22/T26 can start any time (no Phase-1 dependency
except T20←T6, T35←T5, T37←T8).
```

## Integration Points

- **After T8:** #215 is provably closed — rebuild-with-running-daemon smoke passes; Phase 1
  is independently shippable.
- **After T17:** fleet pause/resume usable end-to-end from the CLI.
- **After T32:** full lifecycle verbs live; **after T37:** the PRD walkthrough passes.

## Coverage Map (FR → tasks)

| FR | Tasks | | FR | Tasks |
|---|---|---|---|---|
| FR-1 | T11, T12, T13 | | FR-12 | T23, T32 |
| FR-2 | T18 | | FR-13 | T2, T3, T4, T8, T9 |
| FR-3 | T17 | | FR-14 | T6, T20 |
| FR-4 | T14, T15 | | FR-15 | T7 |
| FR-5 | T19 | | FR-16 | T5, T35 |
| FR-6 | T16 | | FR-17 | T17, T32 |
| FR-7 | T14 | | FR-18 | T17 |
| FR-8 | T25 | | FR-19 | T21 |
| FR-9 | T27, T28, T29, T30, T33 | | FR-20 | T22, T24, T36 |
| FR-10 | T32 | | FR-21 | T23, T34 |
| FR-11 | T31 | | E2E | T37; docs T38 |

## Verification

- [ ] All happy path criteria covered by at least one task (map above)
- [ ] All negative path criteria covered by explicit tasks (T4, T7, T9, T12, T13, T15, T21,
      T24, T29, T30, T34, T35 are dedicated negative-path tasks)
- [ ] No task exceeds ~5 minutes of focused work
- [ ] Dependencies explicit and acyclic (graph above)
