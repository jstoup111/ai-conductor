# Implementation Plan: Daemon rate-limit episode coordinator

**Date:** 2026-07-05
**Design:** `.docs/decisions/adr-2026-07-05-daemon-rate-limit-episode-coordinator.md` (APPROVED);
architecture review `.docs/decisions/architecture-review-2026-07-05-daemon-rate-limit-episode.md`;
diagram `.docs/architecture/daemon-api-rate-limit-episode-cascades-into-mass-h.md`
**Stories:** `.docs/stories/daemon-api-rate-limit-episode-cascades-into-mass-h.md` (Accepted)
**Conflict check:** Clean as of 2026-07-05 (one accepted degrading overlap: shared daemon
dispatch-loop region + `DaemonDeps` seam with event-driven-wake #111/PR #329 — orthogonal, land-order
reconciled by whichever merges second)
**Source:** intake issue jstoup111/ai-conductor#270

## Summary
Introduce an in-process `RateLimitEpisode` coordinator that turns a rate-limit episode into a
daemon-level coordinated pause: it gates new dispatch, gives in-flight features one shared
escalating (capped) interruptible wait, and makes the wait SIGTERM-responsive. **Fable review
(2026-07-05, from the actual daemon log):** the observed cascade was a CLASSIFIER miss
(`You've hit your session limit · resets 3:20pm (America/New_York)` doesn't match
`RATE_LIMIT_RE`) at ordinary steps — NOT the prelude (which the daemon path never runs) — so
classification hardening (T17) + deadline-first parsing (T18) are the primary fixes, with jitter
(T19), episode-caused HALT self-heal (T20), restart deferral (T21), and process-level SIGTERM
(T22) closing the remaining gaps. 22 tasks.

## Technical Approach
- **New module** `src/conductor/src/engine/rate-limit-episode.ts` — pure, `now`/`setTimer`/RNG-
  injected (pattern: pure factory, injected clocks — NOTE: the `waker.ts` cited by the draft does
  NOT exist on this branch, it is unmerged PR #329; do not hunt for it):
  `createRateLimitEpisode()` → `{ enter({ waitSeconds }), active(nowMs?), clear(signal?) }`. The
  module computes deadlines with its OWN injected `now()` (single clock). Holds the latest
  deadline (later-wins), an escalation counter with a documented cap and a time-based
  self-contained reset (grace period past last deadline — no external `reset()` caller), and a
  shared `clear()` promise with **wake-recheck** semantics (timer fires → re-check `active()` →
  re-arm if extended; fresh promise after resolve).
- **Dispatch gate** (`daemon.ts` ~line 574, beside `checkPaused`) — read an optional
  `DaemonDeps.rateLimitEpisode?` (optimization-never-authority: absent → today's behavior). When
  `active()`, skip `pickEligible`/dispatch for NEW features this cycle; in-flight untouched.
  Compose after the existing PAUSE check.
- **Conductor wait** (`conductor.ts:1163-1171`) — replace the bare `await this.sleep(...)` with an
  abortable wait bound to an `AbortSignal` and the episode deadline; keep `attempt--` (no budget
  burn) and the `result.waitSeconds ?? 300` first-probe value. On repeated re-entry, escalate the
  interval via the coordinator (capped). Enter the episode on every rate-limited result so the
  dispatch gate sees it.
- **SIGTERM handler** — add alongside the existing SIGINT handler (`conductor.ts:863-868`):
  save-state-then-exit; `off()` it at every conductor exit site (the ~13 sites that already `off()`
  SIGINT). Aborts the in-flight wait signal.
- **Classification hardening (PRIMARY — T17/T18)** — extend the rate-limit family in
  `claude-provider.ts` so session/usage-cap messages set `rateLimited` (regression fixture: the
  exact observed log message), and make `parseRateLimitWaitSeconds` handle the observed
  `resets <time> (<tz>)` shape timezone-aware with a sane clamp; deadline-first (parsed reset =
  episode deadline), escalation only as fallback.
- **Call-site classification (interactive-path hardening)** — `project-prelude.ts:invokeSkill`
  must stop mapping a `rateLimited` result to a bare `success:false`; propagate it so the caller
  routes to the wait. NOTE (Fable review): the prelude runs ONLY on the interactive path
  (`index.ts:774`); the daemon never calls it — this is not the daemon cascade fix. Audit sibling
  non-step `provider.invoke` sites (`model-availability` already propagates — confirm;
  `runSelfBuildDispatch` delegates to `stepRunner.run` — confirmed; `engineer-store`/`engineer/*`
  are the /engineer path, not daemon build — document).
- **Wiring** (`daemon-cli.ts`) — construct one `RateLimitEpisode` next to `events` (line 388), pass
  it into every `new Conductor` (line 468) and into `DaemonDeps` for the dispatch gate.

## Prerequisites
- `npm install` already satisfied (no new deps). Run tests via `rtk proxy npx vitest run` in
  `src/conductor` (per-worktree). Do NOT rebuild the shared dist while other daemons run (#215).

## Tasks

### Task 1: RateLimitEpisode — enter/active window (RED)
**Story:** "RateLimitEpisode coordinator tracks an active episode" — happy path 1
**Type:** happy-path
**Steps:**
1. Failing test `test/rate-limit-episode.test.ts`: `enter(untilMs)` then `active(now)` true before,
   false at/after deadline (injected `now`).
2. Verify RED.
**Files likely touched:** `src/conductor/test/rate-limit-episode.test.ts`
**Dependencies:** none

### Task 2: RateLimitEpisode — enter/active + later-deadline-wins + guards (GREEN)
**Story:** same — happy 2, negatives (earlier ignored, non-finite)
**Type:** happy-path + negative-path
**Steps:**
1. Add failing tests: `enter(T2>T1)` extends; `enter(T0<T1)` does not truncate; non-finite/past
   `untilMs` → treated as cleared, no throw.
2. Implement `createRateLimitEpisode({ now?, setTimer? })` with `enter`/`active`.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/rate-limit-episode.ts`, test
**Dependencies:** Task 1

### Task 3: RateLimitEpisode — clear() resolves at deadline + abort (RED then GREEN)
**Story:** same — happy 3, negative (abort before deadline, no pending timer)
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: `clear()` resolves when injected timer fires; `clear(signal)` with pre/mid abort
   settles promptly; assert no pending timer remains (timer spy).
2. Implement `clear(signal?)` using injected `setTimer`; clean up on abort.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/rate-limit-episode.ts`, test
**Dependencies:** Task 2

### Task 4: RateLimitEpisode — escalating re-probe with cap + reset (RED then GREEN)
**Story:** "Adaptive escalating re-probe replaces the fixed 300s-forever wait" — all criteria
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: first probe uses supplied `waitSeconds`; immediate re-entry escalates interval;
   escalation clamps at cap; `reset()` (or clear-after-success) returns to base; non-positive/NaN
   interval → safe positive default.
2. Implement escalation counter + cap + reset in the module.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/rate-limit-episode.ts`, test
**Dependencies:** Task 3

### Task 5: DaemonDeps seam for the episode (infrastructure)
**Story:** "Dispatch loop pauses NEW feature dispatch" — seam
**Type:** infrastructure
**Steps:**
1. Add optional `rateLimitEpisode?` (or `isRateLimited?(): boolean`) to `DaemonDeps` with
   optimization-never-authority JSDoc (mirror `isHalted?`/`watchHaltCleared?`).
2. Typecheck passes; no behavior change (existing tests green).
**Files likely touched:** `src/conductor/src/engine/daemon.ts`
**Dependencies:** none

### Task 6: Dispatch gate suppresses new picks when active (RED)
**Story:** "Dispatch loop pauses NEW feature dispatch" — happy 1
**Type:** happy-path
**Steps:**
1. Failing test in `daemon.test.ts`: inject episode `active()===true` + eligible backlog; assert no
   `runFeature` dispatch that cycle; `sleep` still called once (idle-cycle invariant preserved).
2. Verify RED.
**Files likely touched:** `src/conductor/test/daemon.test.ts`
**Dependencies:** Task 5

### Task 7: Dispatch gate GREEN + resume + undefined-dep parity
**Story:** same — happy 2/3
**Type:** happy-path + negative-path
**Steps:**
1. Implement the gate beside `checkPaused` (~daemon.ts:574): active → skip pick; inactive → normal.
2. Tests: clear→resume dispatch; `episode===undefined` → byte-identical to today.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/daemon.ts`, test
**Dependencies:** Task 6

### Task 8: Dispatch gate negatives — in-flight untouched, compose-with-PAUSE, no double-dispatch (RED then GREEN)
**Story:** "Dispatch loop pauses NEW feature dispatch" — negatives
**Type:** negative-path
**Steps:**
1. Failing tests: episode active mid-run does not cancel/re-dispatch in-flight; episode+PAUSE both
   set → no dispatch, clearing episode with PAUSE still set → no dispatch; episode clears on a
   feature-complete tick → at most one dispatch per eligible slug.
2. Implement/adjust as needed (gate ordering); verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/daemon.ts`, test
**Dependencies:** Task 7

### Task 9: Conductor enters episode + abortable wait (RED)
**Story:** "In-flight rate-limit wait is interruptible" — happy 1; coordination
**Type:** happy-path
**Steps:**
1. Failing test in `conductor.test.ts`: on a `rateLimited` result, conductor calls
   `episode.enter(...)` and awaits an abortable wait (injected episode + abort), NOT a bare sleep;
   `attempt` unchanged; first wait uses `result.waitSeconds ?? 300`.
2. Verify RED.
**Files likely touched:** `src/conductor/test/conductor.test.ts`
**Dependencies:** Task 4

### Task 10: Conductor abortable wait GREEN
**Story:** same — happy path; "share ONE coordinated backoff"
**Type:** happy-path
**Steps:**
1. Replace `conductor.ts:1168` sleep with an episode/`AbortSignal`-bound abortable wait; inject the
   episode into `Conductor` (constructor dep). Keep `attempt--`/`continue`.
2. Verify Task 9 green + existing rate-limit tests green (budget still not burned).
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, test
**Dependencies:** Task 9

### Task 11: SIGTERM handler add + teardown, no listener leak (RED then GREEN)
**Story:** "In-flight rate-limit wait is SIGTERM-responsive" — happy 2, negatives
**Type:** negative-path
**Steps:**
1. Failing tests: SIGTERM mid-wait saves state then exits (injected exit spy); handler `off()`-ed at
   exit sites; after many sequential waits, listener count returns to baseline; SIGTERM with no wait
   in progress still saves + exits.
2. Implement SIGTERM handler beside SIGINT (`conductor.ts:863-868`); abort the wait signal in it;
   `off()` at all conductor exit sites (mirror the SIGINT `off()` sites).
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, test
**Dependencies:** Task 10

### Task 12: Coordinated shared backoff across two in-flight features (RED then GREEN)
**Story:** "In-flight features share ONE coordinated backoff" — all criteria
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests (two injected concurrent conductors sharing one episode): shared deadline
   (later-wins) + joint resume; re-entry extends the shared wait (no early resume into a live
   limit); N=1 unchanged.
2. Implement any coordination glue needed (mostly emergent from the shared module); verify GREEN.
**Files likely touched:** `src/conductor/test/`, `rate-limit-episode.ts` if needed
**Dependencies:** Task 10

### Task 13: project-prelude propagates rateLimited, not success:false (RED then GREEN)
**Story:** "Pre-step call sites route a rate limit to the wait" — happy 1, negatives
**Type:** negative-path
**Steps:**
1. Failing tests in `project-prelude.test.ts`: a `rateLimited` invoke result is propagated/honored
   (routes to wait / no HALT), NOT collapsed to `success:false`; a genuine non-rate-limit failure
   STILL fails the feature.
2. Implement: change `invokeSkill` return to carry `rateLimited` (richer return or route into
   episode) and have the caller wait; preserve real-failure behavior.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/project-prelude.ts`, test
**Dependencies:** Task 10

### Task 14: Audit + document all non-step invoke sites (RED then GREEN)
**Story:** "Pre-step call sites…" — happy 2, model-availability regression guard
**Type:** negative-path
**Steps:**
1. Enumerate every non-step `provider.invoke` site (grep); for each, assert it propagates or routes
   `rateLimited`. Add a test confirming `model-availability.invokeWithLadder` still propagates
   (no ladder-walk on rate limit).
2. Record the audit + dispositions in the PR body / a short note.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/test/model-availability.test.ts`, audit note
**Dependencies:** Task 13

### Task 15: Wire the episode in daemon-cli (infrastructure)
**Story:** production path for gate + wait
**Type:** infrastructure
**Steps:**
1. In `daemon-cli.ts`: construct one `createRateLimitEpisode()` next to `events` (line 388); pass it
   into every `new Conductor` (line 468) and into `DaemonDeps` (dispatch gate).
2. Test: daemon-cli wiring asserts the episode dep is present; a real-binary-ish smoke that a
   rate-limited prelude does not HALT and gates dispatch.
3. Verify green; commit.
**Files likely touched:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/index.ts` (only if
option threading requires), tests
**Dependencies:** Tasks 7, 10, 13

## Fable review additions (2026-07-05)

### Task 17: Classification hardening — session-limit family → rateLimited (RED then GREEN)
**Story:** "Session-limit messages classify as rate-limit-family waits" — all criteria (PRIMARY fix)
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests in `claude-provider.test.ts`: the LITERAL observed message
   `You've hit your session limit · resets 3:20pm (America/New_York)` → `rateLimited: true`;
   variant family (`usage limit`, `session limit reached`, 5-hour wordings) → true; genuine
   failure fixtures → false; exit-0 session-limit → not `success` (mirror `outOfCredits`);
   precedence vs `AUTH_FAILURE_RE`/`STALE_SESSION_RE` pinned.
2. Implement the family regex (extend `RATE_LIMIT_RE` or sibling folded into `rateLimited`).
3. Integration test: session-limit failure at a step → wait + episode entry, retry budget intact.
4. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/execution/claude-provider.ts`, tests
**Dependencies:** none (independent; unblocks the observed scenario end-to-end with T10)

### Task 18: Deadline-first — timezone-aware reset parse with clamp (RED then GREEN)
**Story:** "A parseable reset time becomes the episode deadline" — all criteria
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: exact observed message + injected `now=2026-07-03T18:05:54Z` → ≈4446s
   (computed in America/New_York, not host zone); parsed deadline becomes the episode deadline
   with exactly ONE timer arm (no re-probe before it); >cap clamps; past/negative → safe default;
   unknown zone → default; midnight rollover future-safe.
2. Implement in `parseRateLimitWaitSeconds` + episode wiring (deadline-first, escalation fallback).
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/execution/claude-provider.ts`,
`rate-limit-episode.ts`, `conductor.ts`, tests
**Dependencies:** Tasks 4, 17

### Task 19: Jittered resume (RED then GREEN)
**Story:** "Episode end resumes with jitter" — all criteria
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests (injected RNG): N waiters resume staggered within the documented range; dispatch
   reopen jittered relative to waiters; N=1 overhead bounded.
2. Implement injected-RNG jitter in the coordinator's resume + gate reopen.
3. Verify GREEN; commit.
**Files likely touched:** `rate-limit-episode.ts`, `daemon.ts`, tests
**Dependencies:** Tasks 3, 7

### Task 20: Episode-caused HALT stamp + episode-end self-heal sweep (RED then GREEN)
**Story:** "HALTs written during an active episode self-heal when it ends" — all criteria
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: HALT during active episode carries the stamp; episode end clears stamped HALTs
   via the EXISTING rekick path (operator-park respected; unstamped HALTs untouched); restart-
   between → stamped HALT still recovered by the ordinary sweep later.
2. Implement stamp-at-write (episode injected where the HALT reason is composed) + episode-end
   sweep hook in the daemon loop.
3. Verify GREEN; commit.
**Files likely touched:** `daemon-cli.ts`/`daemon.ts` (halt write + episode-end hook),
`daemon-rekick.ts` (reuse), tests
**Dependencies:** Tasks 7, 15

### Task 21: Defer autonomous self-restarts during an active episode (RED then GREEN)
**Story:** "Dispatch loop pauses NEW feature dispatch" — restart-deferral negative path (ADR 11)
**Type:** negative-path
**Steps:**
1. Failing tests: episode active + restart-pending marker at idle boundary → NO
   `triggerSelfRestart` this tick; stale-engine verdict → NO `requestRestart`; episode clears →
   restart fires on the next tick (defer, not drop).
2. Gate the idle-boundary triggers on `!episode.active()`.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/engine/daemon.ts`, tests
**Dependencies:** Task 7

### Task 22: Process-level SIGTERM in daemon-cli; per-conductor stays interactive-only (RED then GREEN)
**Story:** "In-flight rate-limit wait is interruptible + SIGTERM-responsive" — N>1 negative paths (ADR 12)
**Type:** negative-path
**Steps:**
1. Failing tests: TWO concurrent conductors + SIGTERM → BOTH state files written before exit
   (injected exit spy); daemon path installs ONE process-level handler (abort shared signals →
   await all saves → exit); interactive path keeps the per-conductor handler; listener count
   baseline preserved.
2. Implement the daemon-cli handler; scope T11's per-conductor SIGTERM to interactive mode.
3. Verify GREEN; commit.
**Files likely touched:** `src/conductor/src/daemon-cli.ts`, `conductor.ts` (mode scoping), tests
**Dependencies:** Tasks 11, 15

### Task 16: Docs, CHANGELOG, full verification
**Story:** "Docs and CHANGELOG reflect the new daemon rate-limit behavior"
**Type:** infrastructure
**Steps:**
1. Update `README.md` + `src/conductor/README.md`: episode-gated dispatch pause, coordinated
   escalating wait, SIGTERM responsiveness, pre-step rate-limit handling.
2. `CHANGELOG.md [Unreleased]`: Added — RateLimitEpisode coordinator, dispatch gate; Changed —
   interruptible escalating rate-limit wait + SIGTERM handling, pre-step rate-limit propagation.
3. Run `cd src/conductor && npm run typecheck && rtk proxy npx vitest run && npm run build`; then
   `test/test_harness_integrity.sh`. All green.
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Tasks 1–15, 17–22 (T16 runs LAST despite its number — ids are stable, order is
the graph)

## Task Dependency Graph
```
T1 ► T2 ► T3 ► T4 ─────────────► T9 ► T10 ─┬► T11 ► T22 (needs T15)
T5 ► T6 ► T7 ► T8                          ├► T12
T7 ► T21                                   ├► T13 ► T14
T3, T7 ► T19                               │
T7, T15 ► T20                              │
T17 (independent) ► T18 (needs T4)         │
T7, T10, T13 ─────────────► T15            │
T1..T15, T17..T22 ────────► T16 ◄──────────┘
```

## Integration Points
- After Task 8: dispatch gate works end-to-end in the daemon unit harness (injected episode).
- After Task 11: the in-flight wait is fully signal-safe and interruptible.
- After Task 15: production path complete — manual check: run daemon, simulate a rate-limited
  prelude → feature waits (no HALT) and new dispatch is paused; SIGTERM during a wait exits promptly.

## Coverage Mapping
| Story | Tasks |
|---|---|
| RateLimitEpisode coordinator tracks an active episode (incl. wake-recheck, fresh promise, single clock) | T1, T2, T3 |
| Dispatch loop pauses NEW feature dispatch (incl. restart deferral) | T5, T6, T7, T8, T21 |
| In-flight wait interruptible + SIGTERM-responsive (incl. N>1 process-level) | T9, T10, T11, T22 |
| Adaptive escalating re-probe with cap (incl. time-based reset, shared escalation) | T4 |
| Session-limit messages classify as rate-limit-family waits (PRIMARY) | T17 |
| A parseable reset time becomes the episode deadline | T18 |
| Episode end resumes with jitter | T19 |
| HALTs written during an active episode self-heal | T20 |
| Pre-step call sites route a rate limit to the wait (interactive-path) | T13, T14 |
| In-flight features share ONE coordinated backoff | T12 |
| Docs and CHANGELOG | T16 |

## Verification
- [ ] All happy path criteria covered by at least one task (mapping above)
- [ ] All negative path criteria covered by explicit tasks (T2, T3, T4, T8, T11, T12, T13, T14,
      T17–T22)
- [ ] No task exceeds ~5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] `cd src/conductor && npm run typecheck && npm test && npm run build` green
- [ ] `test/test_harness_integrity.sh` green
