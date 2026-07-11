# Implementation Plan: Stale-engine restart respawns in place; relink precedes every handoff (#353)

**Date:** 2026-07-06
**Design:** .docs/decisions/adr-2026-07-06-stale-engine-respawn-in-place.md (APPROVED)
**Stories:** .docs/stories/daemon-restart-leaves-the-daemon-stopped-when-orig.md (Accepted, TR-1…TR-5)
**Conflict check:** Clean as of 2026-07-06 (.docs/conflicts/2026-07-06-daemon-restart-leaves-the-daemon-stopped-when-orig.md)
**Complexity:** M (.docs/complexity/daemon-restart-leaves-the-daemon-stopped-when-orig.md)

## Summary

Fixes the three verified defects behind #353 in 17 tasks: the broken `setRemainOnExit` tmux
invocation, the stale-engine RestartRequester that exits without respawning, and the missing
skill relink on restart handoffs — plus the end-to-end real-tmux acceptance test whose absence
let this ship.

## Technical Approach

- **`daemon-tmux.ts`:** correct `setRemainOnExit` to `set-option -w -t '=<name>:'` (window
  option needs `-w` + pane-qualified target; verified live on tmux 3.2a) and log non-zero
  exits with tmux stderr (still non-fatal). Arm it in `Supervisor.start`'s fresh-session
  branch (immediately after `newDetachedSession`); the restart (:474) and dead-pane revival
  (:450-453) branches already call it.
- **`daemon-cli.ts` `createRestartRequester` (:212, constructed :754):** gains two optional
  injected deps — `relink: () => Promise<void>` and `triggerSelfRestart?: () => Promise<void>`
  (already produced by `buildDaemonModeOptions`, `index.ts:125-143`, available as
  `opts.triggerSelfRestart` in the same flow). New ordering: **relink → write underscore
  marker → respawn (session-hosted) | release + exit 0 (headless)**. Fail-safe rules:
  relink throw → abort attempt, stay alive; marker-write failure while session-hosted →
  abort-alive (headless keeps today's release+exit(1) backstop); respawn throw → log, stay
  alive, marker remains for the next boot's consume-once. The respawn path does NOT release
  the pidfile — mirrors the tested T28 transport; `daemon-lock` reclaims dead-pid locks
  (verified: ESRCH → unlink + recreate).
- **`daemon.ts` idle-boundary hyphen block (:646-665):** additive only (per conflict note,
  to minimize contention with unmerged #329): run the injected relink before
  `triggerSelfRestart`; relink failure → log, do NOT fire, marker stays for retry.
- **`daemon-supervisor-cli.ts` `case 'restart'` (:301-347):** run the #363-guarded
  `relinkSkillsForSelfBuild` after the busy-check and before `supervisor.restart`; throw →
  abort with the existing loud message, no tmux mutation. Busy path (queue marker + return)
  untouched.
- **Tests:** every injected-runner assertion is backed by a real-tmux / real-binary
  counterpart (harness lesson: injected-runner tests pass on wrong argv). The capstone is a
  new end-to-end test: session-hosted daemon + forced stale dist → same session, new pid,
  marker consumed, never `stopped`.
- **Sequencing:** tmux primitive first (everything downstream relies on remain-on-exit
  actually working), then requester rewiring + negatives, then CLI/loop relink, then the
  end-to-end test, then docs.

## Prerequisites

- `src/conductor` has its own `npm install` in this worktree (RTK memory: each worktree needs it).
- Real tmux available (3.2a in dev env); smoke tests use isolated session names.
- Run vitest as `rtk proxy npx vitest run …` (plain output is swallowed by RTK).

## Tasks

### Task 1: Fix `setRemainOnExit` argv + loud failure logging
**Story:** TR-1 (negative: swallowed failure; happy: corrected form)
**Type:** infrastructure
**Steps:**
1. Write failing test (injected runner): asserts argv exactly
   `['set-option', '-w', '-t', '=<name>:', 'remain-on-exit', 'on']`, and that a non-zero
   runner result logs a message containing the tmux stderr text.
2. Verify RED (current argv lacks `-w` and pane-qualified target; failures silent).
3. Implement in `daemon-tmux.ts:226-233` (add optional log sink param or reuse module logger).
4. Verify GREEN.
5. Commit: "fix(daemon-tmux): setRemainOnExit uses -w + pane-qualified target; loud failure"
**Files:** `src/conductor/src/engine/daemon-tmux.ts`, `src/conductor/test/engine/daemon-tmux-unit.test.ts` (or existing unit file)
**Dependencies:** none

### Task 2: Arm remain-on-exit in `Supervisor.start` fresh-session path
**Story:** TR-1 (happy: armed on every creation path; negative: revival path)
**Type:** happy-path
**Steps:**
1. Failing test (injected runner): `start` on no-session issues `new-session` then the
   corrected `set-option` for the same session.
2. RED → implement after `newDetachedSession` in `daemon-tmux.ts:443-457` → GREEN.
3. Commit: "feat(daemon-tmux): arm remain-on-exit at session creation"
**Files:** `src/conductor/src/engine/daemon-tmux.ts`, unit test file
**Dependencies:** Task 1

### Task 3: Real-tmux smoke upgrades (the assertions that would have caught the bug)
**Story:** TR-1 (all three happy criteria + legacy-form regression negative)
**Type:** happy-path + negative-path (real tmux)
**Steps:**
1. Extend `daemon-tmux-smoke.test.ts`: (a) after `start`, `show-options -w` reports
   `remain-on-exit on`; (b) a pane whose process exits NATURALLY leaves session alive with
   `pane_dead=1`; (c) option still reported after `respawn-pane -k`; (d) regression guard:
   the legacy argv form (`set-option` without `-w`, bare `=name` target) exits non-zero
   against real tmux — documents why the corrected form is load-bearing.
2. Assert (a),(b) fail against pre-fix code (recorded RED evidence), pass post-fix.
3. Commit: "test(daemon-tmux): smoke asserts remain-on-exit is set and survives own exit"
**Files:** `src/conductor/test/engine/daemon-tmux-smoke.test.ts`
**Dependencies:** Tasks 1–2

### Task 4: RestartRequester accepts injected relink + trigger; session-hosted happy ordering
**Story:** TR-2 (happy), TR-3 (happy ordering)
**Type:** happy-path
**Steps:**
1. Failing test in `daemon-cli-restart-requester.test.ts`: with both deps injected, a stale
   request runs relink → writes marker → fires trigger; asserts call order, NO
   `lock.releaseSync()`, NO `process.exit`.
2. RED → extend `createRestartRequester(daemonDir, log, lock, process, deps?)` → GREEN.
3. Commit: "feat(daemon): stale-engine requester respawns in place when session-hosted"
**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/daemon-cli-restart-requester.test.ts`
**Dependencies:** none (parallel with 1–3)

### Task 5: Requester negative — relink throws → abort-alive
**Story:** TR-3 (negative)
**Type:** negative-path
**Steps:** failing test: relink rejects (InstallStaleError) → no marker written, no trigger,
no exit, no release; log names the relink failure → implement → commit
"fix(daemon): relink failure aborts stale-restart attempt (stale-but-alive)".
**Files:** same as Task 4
**Dependencies:** Task 4

### Task 6: Requester negative — marker-write failure while session-hosted → abort-alive
**Story:** TR-2 (negative; operator-approved refinement)
**Type:** negative-path
**Steps:** failing test: marker write rejects with trigger injected → no exit(1), no release,
no trigger fire, logged; AND headless (no trigger) keeps release+exit(1) backstop (existing
assert stays green) → implement → commit.
**Files:** same as Task 4
**Dependencies:** Task 4

### Task 7: Requester negative — respawn throws → stay alive, marker remains
**Story:** TR-2 (negative)
**Type:** negative-path
**Steps:** failing test: trigger rejects → logged, no exit, marker file still present
(consume-once at next boot preserved) → implement → commit.
**Files:** same as Task 4
**Dependencies:** Task 4

### Task 8: Headless contract byte-identical (regression suite)
**Story:** TR-2 (negative: bare-run unchanged)
**Type:** negative-path
**Steps:** run existing `daemon-cli-restart-requester.test.ts` +
`daemon-bare-run-restart.test.ts` (T30); update only constructor call sites for the new
optional deps; assert marker→release→exit(0) ordering unchanged when no trigger injected.
Commit only if edits were needed.
**Files:** existing test files
**Dependencies:** Tasks 4–7

### Task 9: Wire the deps at the construction site
**Story:** TR-2/TR-3 (happy — production wiring, not just seams; orphaned-primitive guard)
**Type:** infrastructure
**Steps:**
1. Failing wiring test (mirror `daemon-restart-wiring.test.ts` pattern):
   `runDaemonMode` threads `opts.triggerSelfRestart` and a real-default relink
   (`relinkSkillsForSelfBuild` with the daemon log) into `createRestartRequester` at
   `daemon-cli.ts:754`.
2. RED → wire → GREEN. Grep confirms no other construction site remains unwired.
3. Commit: "feat(daemon): thread respawn trigger + relink into stale-engine requester"
**Files:** `src/conductor/src/daemon-cli.ts`, wiring test
**Dependencies:** Tasks 4–8

### Task 10: Hyphen marker never touched by the stale path
**Story:** TR-2 (negative: non-autonomy clause)
**Type:** negative-path
**Steps:** failing test: across a full session-hosted stale restart (requester unit level),
`.daemon/RESTART-PENDING` is never created/modified; add the same assert to the Task 15 e2e →
implement (should already hold) → commit test.
**Files:** requester test file
**Dependencies:** Task 9

### Task 11: CLI `daemon restart` relinks before respawn
**Story:** TR-4 (happy)
**Type:** happy-path
**Steps:**
1. Failing test (injected supervisor + relink): `restart` on an idle daemon calls relink
   BEFORE `supervisor.restart`.
2. RED → implement in `daemon-supervisor-cli.ts:301-347` (after busy/pause checks, before
   `clearStaleLockForRestart`) → GREEN.
3. Commit: "feat(daemon): restart relinks skills before respawning"
**Files:** `src/conductor/src/engine/daemon-supervisor-cli.ts`, its test file
**Dependencies:** none (parallel track)

### Task 12: CLI restart negatives — relink failure aborts; busy path unchanged
**Story:** TR-4 (negatives)
**Type:** negative-path
**Steps:** failing tests: (a) relink throws → `supervisor.restart` never called, error
surfaced, non-zero exit, daemon untouched; (b) busy probe true → hyphen marker queued,
relink NOT called at request time → implement → commit.
**Files:** same as Task 11
**Dependencies:** Task 11

### Task 13: Queued-restart fire relinks at the idle boundary
**Story:** TR-4 (happy intent at fire time), TR-3
**Type:** happy-path + negative-path
**Steps:**
1. Failing test (extend `daemon-restart-wiring.test.ts` seam): when the hyphen marker fires
   `triggerSelfRestart` at the idle boundary, the injected relink runs first; relink failure
   → logged, trigger NOT fired, marker left for retry.
2. RED → additive edit inside the existing `hasRestartPending` block in `daemon.ts:646-665`
   (do NOT restructure the idle loop — #329 contention note) → GREEN.
3. Commit: "feat(daemon): queued restart relinks before firing at idle boundary"
**Files:** `src/conductor/src/engine/daemon.ts`, `daemon-restart-wiring.test.ts`
**Dependencies:** Task 9
**Integration point:** first place requester wiring + loop behavior meet.

### Task 14: Relink integration test with the real installer
**Story:** TR-3 (Done When: real-binary evidence)
**Type:** happy-path (integration)
**Steps:** test with isolated fake `$HOME` + temp harness root containing a stub-but-real
`bin/install`: after the relink step runs, the new skill symlink exists in
`~/.claude/skills/`; #363 guard path (worktree-resolved root) rejects. Reuse existing
install-freshness test fixtures where possible. Commit.
**Files:** `src/conductor/test/engine/install-freshness*.test.ts`
**Dependencies:** Task 9

### Task 15: End-to-end real-tmux stale-engine acceptance test
**Story:** TR-2 (happy — the capstone; the coverage gap that let #353 ship)
**Type:** happy-path (e2e, real tmux)
**Steps:**
1. Failing test: isolated repo fixture + real tmux session hosting a scripted daemon stand-in
   wired through the REAL `createRestartRequester` + `respawnPane`; force a stale verdict
   (mutate the hashed dist file); assert: same session, new pid, underscore marker consumed
   by successor, `.daemon/RESTART-PENDING` absent, and a status probe never reports
   `stopped`/session-down at any point.
2. RED against pre-wiring code → GREEN after Tasks 1–13.
3. Commit: "test(daemon): e2e — stale engine respawns in place, daemon never stopped"
**Files:** new `src/conductor/test/engine/daemon-stale-respawn-e2e.test.ts`
**Dependencies:** Tasks 3, 9, 13
**Integration point:** full #353 scenario reproducible in CI.

### Task 16: Docs — lifecycle section + suppressed-legacy notes
**Story:** TR-5 (happy + negative: stale guidance removed)
**Type:** infrastructure
**Steps:** update `src/conductor/README.md` daemon lifecycle section (remain-on-exit
semantics, respawn-in-place stale flow, relink-before-handoff, headless fallback); grep docs
for "stays down until nudged"-style legacy text and update. Commit.
**Files:** `src/conductor/README.md`, `README.md` if lifecycle is mentioned
**Dependencies:** Task 15 (document what is proven)

### Task 17: CHANGELOG + full validation
**Story:** TR-5 (Done When)
**Type:** infrastructure
**Steps:** add `[Unreleased]` → Fixed entry for #353; run
`test/test_harness_integrity.sh` + `rtk proxy npx vitest run` (full suite in
`src/conductor`) and fix fallout. Commit.
**Files:** `CHANGELOG.md`
**Dependencies:** Task 16

## Task Dependency Graph

```
T1 → T2 → T3 ──────────────┐
T4 → {T5, T6, T7} → T8 → T9 ├→ T15 → T16 → T17
              T9 → T10      │
              T9 → T13 ─────┤
              T9 → T14      │
T11 → T12 (parallel track) ─┘
```

## Integration Points

- After Task 9: session-hosted stale restart works end-to-end manually (real daemon).
- After Task 13: queued (busy) restart path also relinks — both restart entry points covered.
- After Task 15: the full #353 reproduction is a CI-checked scenario.

## Coverage Map (criterion → task)

- TR-1 H1/H2/H3 → T2/T3; N-swallowed → T1; N-legacy-form → T3(d); N-revival → T3
- TR-2 H-respawn/H-handshake → T4, T9, T15; N-respawn-throw → T7; N-marker-write → T6;
  N-loop-guard → T15 (handshake asserts) + existing suppression suite; N-headless → T8;
  N-hyphen-untouched → T10 + T15; N-gates → existing gate tests (unchanged, re-run in T17)
- TR-3 H-relink/H-noop → T4, T9, T14; N-relink-throw → T5; N-unresolved-root → T14;
  N-successor-still-blocked → T3(b) (revivable dead pane) + T16 docs
- TR-4 H → T11; N-relink-fail → T12(a); N-busy → T12(b); fire-time → T13
- TR-5 H/N → T16, T17

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by explicit tasks (no catch-alls)
- [x] No task exceeds ~5 minutes of focused work
- [x] Dependencies explicit and acyclic
