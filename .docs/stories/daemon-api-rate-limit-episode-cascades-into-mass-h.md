**Status:** Accepted

# Stories: Daemon rate-limit episode coordinator

Technical track (no PRD). Acceptance criteria derive from the technical intent of
`jstoup111/ai-conductor#270` and the APPROVED ADR
`adr-2026-07-05-daemon-rate-limit-episode-coordinator.md`. L tier ⇒ full per-criterion negative
paths. All timers/`now`/signals are dependency-injected so scenarios are deterministic.

---

## Story: RateLimitEpisode coordinator tracks an active episode

**Requirement:** ADR change 1 (coordinator module)

As the daemon process, I want a single in-process object that knows whether an API rate-limit
episode is active and until when, so that all features and the dispatch loop share one source of
truth instead of each sleeping in isolation.

### Acceptance Criteria

#### Happy Path
- Given a fresh coordinator, when `enter(untilMs)` is called, then `active(now)` returns true for
  every `now < untilMs` and false once `now >= untilMs`.
- Given an active episode with deadline `T1`, when `enter(T2)` arrives with `T2 > T1`, then the
  episode deadline extends to `T2` (the later deadline wins; a second concurrent limit does not
  shorten the wait).
- Given an active episode, when `clear(signal)` is awaited, then the returned promise resolves once
  the deadline passes (using the injected timer, not a wall-clock read inside the module).

#### Negative Paths
- Given an active episode with deadline `T1`, when `enter(T0)` arrives with `T0 < T1`, then the
  deadline does NOT move earlier (a stale/shorter deadline never truncates an in-progress wait).
- Given an active episode, when `clear(signal)` is awaited and `signal` aborts before the deadline,
  then the promise rejects/resolves promptly with an abort outcome and no timer is left pending.
- Given `enter` is called with a non-finite or non-positive wait, when `active(now)` is queried,
  then it never throws and treats the episode as already-cleared (no negative/NaN deadline).
- Given waiters pending at deadline `T1`, when `enter()` extends the deadline to `T2 > T1` at or
  just before the `T1` timer fires, then `clear()` does NOT resolve at `T1` — it re-checks
  `active()` at wake time and re-arms to `T2` (ADR change 9; no resume into a known-live limit,
  including an `enter()` landing between timer-fire and waiter resumption).
- Given `clear()` has resolved and all waiters resumed, when a later `enter()` opens a new
  episode, then new `clear()` callers get a fresh promise (no lost-wakeup on a settled promise).

### Done When
- [ ] `src/conductor/src/engine/rate-limit-episode.ts` exports `createRateLimitEpisode({ now?, setTimer? })`
      returning `{ enter({ waitSeconds }), active(now?), clear(signal?) }`; pure (no direct
      `Date.now`/`setTimeout`); the module computes the deadline with its OWN injected `now()`
      (single clock — ADR change 10; callers pass `waitSeconds`, never a foreign-clock timestamp).
- [ ] Unit tests (pattern: pure factory, injected `now`/`setTimer` — NOTE: `waker.ts`/`waker.test.ts`
      do not exist on this branch, they are unmerged PR #329; do not hunt for them) cover:
      enter→active window, later-deadline-wins, earlier-deadline-ignored, clear-resolves-at-deadline,
      wake-recheck-re-arm on extension, fresh-promise-after-resolve, abort-before-deadline,
      non-finite input.
- [ ] No pending timer remains after `clear` resolves or aborts (assert via injected timer spy).

---

## Story: Dispatch loop pauses NEW feature dispatch during an active episode

**Requirement:** ADR change 2 (dispatch gate)

As the daemon dispatch loop, I want to stop picking up new features while a rate-limit episode is
active, so that a transient account-level limit is not burned into one HALT per backlog item.

### Acceptance Criteria

#### Happy Path
- Given an injected episode reporting `active()===true` and an eligible backlog, when the dispatch
  loop reaches the pre-dispatch gate (beside `checkPaused`), then it does NOT call `pickEligible`
  / dispatch a new feature that cycle.
- Given the episode transitions to `active()===false`, when the loop next evaluates the gate, then
  normal `pickEligible`/dispatch resumes for the still-eligible backlog.
- Given no episode dep is injected (`episode===undefined`), when the loop runs, then behavior is
  byte-identical to today (optimization-never-authority).

#### Negative Paths
- Given an episode goes active while a feature is already in-flight, when the gate suppresses new
  picks, then the in-flight feature is NOT cancelled or re-dispatched (only new picks are gated).
- Given the episode is active and the operator PAUSE marker is also present, when the loop runs,
  then neither gate dispatches and clearing the episode alone (PAUSE still set) still does not
  dispatch (gates compose; PAUSE remains authoritative).
- Given the episode clears in the same tick a feature completes, when the loop re-evaluates, then at
  most one dispatch occurs for a given eligible slug (no double-dispatch race).
- Given the episode is active and the pool has drained to idle, when the idle-boundary restart
  triggers evaluate (`hasRestartPending` → `triggerSelfRestart`; stale-engine → `requestRestart`),
  then the restart is DEFERRED to a later tick (`!episode.active()` gate — ADR change 11), because
  an autonomous restart mid-episode respawns a daemon with no episode memory that immediately
  re-dispatches the backlog into the still-active limit. The deferral re-checks every tick — the
  restart fires promptly once the episode clears.

### Done When
- [ ] `DaemonDeps` gains an optional `rateLimitEpisode?` (or `isRateLimited?()`) seam with
      optimization-never-authority JSDoc, mirroring `isHalted?`/`watchHaltCleared?`.
- [ ] The pre-dispatch gate in `daemon.ts` (beside `checkPaused`, ~line 574) skips new picks when active.
- [ ] Idle-boundary self-restart triggers are gated on `!episode.active()` (defer, not drop).
- [ ] Tests: active→no-dispatch, clear→resume, undefined-dep→unchanged, in-flight-untouched,
      compose-with-PAUSE, no-double-dispatch-on-clear-tick, restart-deferred-while-active +
      restart-fires-after-clear.

---

## Story: In-flight rate-limit wait is interruptible and SIGTERM-responsive

**Requirement:** ADR change 3 (signal-responsive wait)

As the daemon process, I want the in-step rate-limit wait to exit promptly on SIGTERM and be
cancellable, so that a `kill` (default TERM) during a wait shuts down gracefully instead of
requiring SIGKILL + pane respawn.

### Acceptance Criteria

#### Happy Path
- Given a step receives a `rateLimited` result, when the conductor waits, then it awaits an
  `AbortSignal`-driven wait (shared with the episode deadline) rather than a bare non-cancellable
  `setTimeout`.
- Given a SIGTERM arrives during the wait, when the handler fires, then conductor state is saved and
  the process exits promptly (matching the existing SIGINT save-then-exit behavior).

#### Negative Paths
- Given the wait completes normally, when the conductor moves on, then the SIGTERM handler is
  `off()`-ed at that exit site (as SIGINT already is) — no accumulated listeners across steps.
- Given many sequential rate-limit waits in one run, when the run finishes, then the process has no
  leaked SIGTERM/SIGINT listeners (assert listener count returns to baseline).
- Given SIGTERM arrives when NO wait is in progress, when the handler runs, then it still saves
  state and exits cleanly (handler is safe outside the wait window).

#### Negative Paths (Fable amendment — ADR change 12: process-level coordination at N>1)
- Given TWO in-flight conductors in one daemon process, when SIGTERM arrives, then BOTH features'
  state files are written before the process exits — the first handler's `process.exit` must not
  race the sibling's `writeState` (today each `new Conductor` installs its own process-global
  handler; N handlers all fire and the first exit silently loses N−1 saves).
- Given the daemon path, when the SIGTERM handler is installed, then it lives in **daemon-cli**
  (one per process: abort shared episode/wait signals → await all in-flight state saves → exit);
  the per-conductor handler remains only for interactive `conduct` (N=1 by construction).

### Done When
- [ ] The conductor rate-limit branch (`conductor.ts:1163-1171`) awaits an abortable wait bound to
      the episode/`AbortSignal`, not a bare `setTimeout`.
- [ ] Daemon path: ONE process-level SIGTERM handler in daemon-cli (abort signals → await all
      conductors' saves → exit); interactive path: per-conductor handler installed alongside SIGINT
      (`conductor.ts:863-868`) and `off()`-ed at all conductor exit sites; a leak test asserts
      baseline listener count after the run.
- [ ] Test drives a SIGTERM mid-wait and asserts state is written before exit (injected exit spy);
      a second test with 2 concurrent conductors asserts BOTH states are written.

---

## Story: Adaptive escalating re-probe replaces the fixed 300s-forever wait

**Requirement:** ADR change 1 (escalating re-probe + cap) / #270 symptom 2

As the daemon process, I want the rate-limit wait to re-probe at escalating (capped) intervals
instead of a flat 300s repeated indefinitely, so that a long episode does not wedge a feature in 16
identical 300s sleeps with no adaptive behavior.

### Acceptance Criteria

#### Happy Path
- Given a provider-supplied `waitSeconds`, when the first wait is scheduled, then it uses that value
  (today's `result.waitSeconds ?? 300` semantics are preserved for the first probe).
- Given the account is still limited immediately after a probe clears, when the coordinator
  re-enters, then the next probe interval escalates beyond the previous (bounded backoff), not a
  flat repeat.
- Given the escalation reaches the configured cap, when further re-entries occur, then the interval
  stays at the cap (never grows unbounded).

#### Negative Paths
- Given the limit lifts and no `enter()` arrives for more than the documented grace period past the
  last deadline, when a later, unrelated episode opens, then escalation starts from the base
  interval, not the cap (ADR change 10: time-based self-contained reset — no external `reset()`
  caller exists, so reset must not depend on one).
- Given feature A's re-entries escalated the shared counter, when feature B waits, then B shares
  the escalated interval — cross-feature escalation is INTENDED (account-level limit) and pinned
  by a test, not an accident.
- Given a probe would compute a non-positive or NaN interval, when scheduling, then it falls back to
  a safe positive default (never waits 0 / never busy-loops).
- Given each re-probe is a real retry, when it runs, then it does NOT consume the step retry budget
  (`attempt--` preserved) so a lifting limit always makes progress.

### Done When
- [ ] Re-probe interval escalates with a documented cap; unit test asserts monotone-up-to-cap.
- [ ] Time-based escalation reset (grace period past last deadline) asserted; cross-feature shared
      escalation pinned as intended behavior.
- [ ] First probe still honors provider `waitSeconds`; non-positive/NaN → safe default (>0).
- [ ] Test asserts the retry budget (`attempt`) is unchanged across multiple coordinated re-probes.
- [ ] Escalation applies ONLY when no reset deadline was parseable (see the deadline-first story —
      a parsed `resets <time>` deadline replaces probing entirely).

---

## Story: Pre-step call sites route a rate limit to the wait, not to a HALT

**Requirement:** ADR change 4 — *(reframed by the Fable review: this is INTERACTIVE-path
hardening, not the daemon cascade path — `runProjectPrelude` is called only from `index.ts:774`;
the daemon's `runConductorInWorktree` never runs it. The daemon cascade fix is the classification
story below.)*

As the interactive `conduct` host, I want provider calls that run *before* the step retry loop
(project prelude) to treat a rate-limited result as "the API said wait", so that a limit during
setup does not fast-fail the run.

### Acceptance Criteria

#### Happy Path
- Given `project-prelude.ts:invokeSkill` receives an invoke result with `rateLimited===true`, when
  it returns, then the rate-limit is propagated/honored (routes into the episode + wait), NOT
  collapsed to `success===false`.
- Given every non-step `provider.invoke` call site on the daemon build path, when audited, then each
  either propagates `rateLimited` upward or routes it into the coordinator (documented enumeration).

#### Negative Paths
- Given a rate limit hits during a newly-dispatched feature's prelude, when handled, then the
  feature waits (episode active) and does NOT write `.pipeline/HALT` / fast-fail within seconds.
- Given a genuine (non-rate-limit) prelude failure, when it occurs, then it still fails the feature
  as today (the change must not swallow real failures as waits).
- Given `model-availability.invokeWithLadder` (already propagates `rateLimited`), when reviewed,
  then it is confirmed unchanged (no regression to ladder-walking on rate limits).

### Done When
- [ ] `invokeSkill` (and any sibling identified by the audit) no longer maps `rateLimited` to a bare
      `success:false`; a test drives a rate-limited prelude invoke and asserts no HALT + episode entered.
- [ ] A test asserts a genuine prelude failure (non-rate-limit) still fails the feature.
- [ ] The audit of non-step invoke sites is recorded (e.g. in the plan/PR) with each site's disposition.

---

## Story: In-flight features share ONE coordinated backoff, not N independent sleeps

**Requirement:** ADR change 1+2 (coordination) / #270 symptom 1

As the daemon process, I want multiple in-flight features hitting the same episode to converge on a
single shared wait, so that an episode does not multiply into N concurrent 300s sleeps and churn.

### Acceptance Criteria

#### Happy Path
- Given two in-flight features both receive `rateLimited` during the same episode, when they enter
  the coordinator, then they share one deadline (the later of the two) and both resume together when
  it clears — not two independent staggered sleeps.
- Given the episode clears, when both features resume, then each retries its own pending step
  (resume where it left off) without re-running completed steps.

#### Negative Paths
- Given feature A clears and immediately re-enters (still limited) while feature B is mid-wait, when
  the coordinator extends the deadline, then feature B's wait extends to the shared deadline rather
  than resuming early into a still-active limit.
- Given only one feature is in-flight, when it enters an episode, then behavior is identical to the
  single-feature case (coordination adds no overhead/regression for N=1).

### Done When
- [ ] Test with two injected concurrent features asserts a single shared deadline and joint resume.
- [ ] Test asserts a re-entry extends the shared wait for all waiters (no early resume into a live limit).
- [ ] N=1 path is unchanged (regression guard).

---

---

# Fable design-review additions (2026-07-05) — from the log-verified root cause

## Story: Session-limit messages classify as rate-limit-family waits (THE observed root cause)

**Requirement:** ADR change 5 (classification hardening — primary fix)

As the daemon, I want account/session-cap error messages recognized as "the API said wait", so
that the 2026-07-03 failure mode — five features burning retries to HALT in seconds on a message
the classifier didn't know — cannot recur.

### Acceptance Criteria

#### Happy Path
- Given the EXACT observed message `You've hit your session limit · resets 3:20pm
  (America/New_York)` in a failed invoke's output, when the result is classified, then
  `rateLimited === true` (pinned as a literal regression fixture from `.daemon/daemon.log`
  2026-07-03T18:04).
- Given close variants (`You've hit your usage limit`, `session limit reached`, 5-hour-limit
  wordings), when classified, then each maps to `rateLimited` (family regex, documented).
- Given a rate-limited classification at ANY ordinary step (`build`, `finish`,
  `acceptance_specs`, …), when the conductor handles it, then the in-step wait engages and the
  episode is entered — no path-specific gaps.

#### Negative Paths
- Given a genuine step failure (test failure text, gate-miss reason, compile error), when
  classified, then `rateLimited` is NOT set — hardening must not convert real failures into
  silent waits (fixture set includes real failure outputs from the existing test corpus).
- Given the session-limit message rides exit code 0 (informational), when classified, then it is
  still not a `success` (mirror the existing `outOfCredits` exit-0 handling) — no false-green.
- Given a message matching BOTH the session-limit family and `AUTH_FAILURE_RE`/`STALE_SESSION_RE`
  patterns, when classified, then precedence is pinned by a test (documented order), not left to
  regex accident.

### Done When
- [ ] The observed 2026-07-03 message is a literal test fixture asserting `rateLimited: true`.
- [ ] Family regex covers the variants; real-failure fixtures assert no false positives.
- [ ] An integration test drives a session-limit failure at a step and asserts wait + episode
      entry + retry budget unchanged (`attempt--`), not "retries exhausted".

---

## Story: A parseable reset time becomes the episode deadline — one wait, not sixteen probes

**Requirement:** ADR change 6 (deadline-first, escalation-fallback)

As the daemon, I want the wait to honor the reset time the API already told me, so that an
episode with a known end (observed: `resets 3:20pm (America/New_York)` = 19:20 UTC, yet the
daemon blind-probed 16 × 300s) costs one deadline-length wait.

### Acceptance Criteria

#### Happy Path
- Given the observed message shape (12-hour clock + `(America/New_York)` timezone suffix), when
  `parseRateLimitWaitSeconds` runs at a known injected `now`, then it returns the seconds until
  that reset **computed in the stated zone**, not the host's zone (fixture: the exact log
  message, `now = 2026-07-03T18:05:54Z`, expected ≈ 4446s).
- Given a parsed deadline, when the episode is entered, then the episode deadline IS the parsed
  reset and NO escalating re-probe fires before it (deadline-first).
- Given no parseable reset/duration in the message, when the wait is scheduled, then today's
  default + the escalating re-probe (capped) applies (escalation is the fallback, not the
  default).

#### Negative Paths
- Given a reset time that parses to more than the sane cap (e.g. > 6h) or to a past/negative
  duration, when scheduling, then the wait clamps to the cap / a safe positive default — a
  mis-parse can never wedge the daemon longer than the cap.
- Given an unrecognized timezone token, when parsing, then the parser falls back to the default
  rather than silently computing in the wrong zone by more than the clamp allows (pinned: wrong-
  zone risk is bounded by the cap).
- Given DST-boundary and midnight-rollover cases ("resets 12:05am"), when parsed at an
  injected `now` just before midnight, then the deadline lands in the future (never negative).

### Done When
- [ ] Fixture: exact observed message + injected now → correct seconds (timezone-aware).
- [ ] Deadline-first pinned: with a parsed reset, exactly ONE wait spans to the deadline (test
      counts timer arms) and re-probe escalation stays idle.
- [ ] Clamp/fallback negatives covered (cap, past time, unknown zone, midnight rollover).

---

## Story: Episode end resumes with jitter — no thundering herd

**Requirement:** ADR change 7 (issue #270's "global backoff with jitter/cap")

As the daemon, I want waiters and new dispatch to resume staggered after an episode, so that N
features plus the dispatch loop don't all probe a just-cleared account limit in the same instant
and re-trigger it.

### Acceptance Criteria

#### Happy Path
- Given N waiters on one episode, when the deadline passes, then each resumes after an
  independent small jitter (documented range, injected RNG) rather than simultaneously.
- Given the dispatch gate reopens, when the next pick occurs, then it is also jitter-delayed
  relative to the waiters' resumes (dispatch does not race the retries of in-flight features).

#### Negative Paths
- Given N=1 (single waiter, nothing else in flight), when the episode ends, then jitter adds at
  most the documented maximum (bounded overhead; no multi-minute surprise for the solo case).
- Given the injected RNG is deterministic in tests, when two waiters resume, then their spacing
  is asserted (jitter is testable, not `Math.random` sprinkled inline — RNG is injected like
  `now`/`setTimer`).

### Done When
- [ ] Jitter range documented; RNG injected; deterministic test asserts staggered resume order.
- [ ] Dispatch-gate reopen jitter covered; N=1 bounded-overhead test.

---

## Story: HALTs written during an active episode self-heal when it ends

**Requirement:** ADR change 8 (defense in depth; issue #270 want #4)

As a daemon operator, I want features that still HALTed during an episode (an unrecognized limit
message — classification is never exhaustive) to recover when the episode clears, without waiting
for a coincidental main-advance re-kick.

### Acceptance Criteria

#### Happy Path
- Given a feature HALTs while `episode.active()`, when the HALT is written, then it is stamped
  episode-caused (reason suffix or sidecar timestamp — the existing HALT-reason surface, no new
  marker family).
- Given the episode clears, when the daemon processes episode end, then episode-stamped HALTs are
  cleared/re-kicked through the EXISTING sweep machinery (same abort-rebase/clear/sentinel path —
  no parallel mechanism), without requiring a base advance.

#### Negative Paths
- Given a HALT written while NO episode is active, when an episode later starts and ends, then
  that HALT is NOT swept (only episode-window HALTs self-heal; genuine failures stay parked for
  the operator/re-kick as today).
- Given an operator-parked slug (`.daemon/parked/<slug>`) whose HALT is episode-stamped, when the
  episode-end sweep runs, then the park is respected (operator-park precedence is unconditional,
  exactly as in `rekickSweep`).
- Given the daemon restarts between the HALT and the episode end (in-memory episode lost), when
  the next episode ends OR the existing main-advance sweep runs, then the stamped HALT is still
  recoverable by the normal paths (the stamp degrades gracefully; no stranded state).

### Done When
- [ ] Episode-active HALTs carry the episode stamp; test asserts stamp presence/absence by window.
- [ ] Episode-end sweep clears stamped HALTs via the existing rekick path (operator-park
      respected; non-stamped HALTs untouched).
- [ ] Restart-between test: stamped HALT recovered by the ordinary sweep later (no strand).

---

## Story: Docs and CHANGELOG reflect the new daemon rate-limit behavior

**Requirement:** repo docs-track-features gate

As an operator, I want the daemon lifecycle docs to describe episode-based backoff and the
signal-responsive wait, so the behavior is discoverable and the repo gates pass.

### Acceptance Criteria

#### Happy Path
- Given the feature lands, when `README.md` and `src/conductor/README.md` are read, then they
  describe: episode-gated dispatch pause, coordinated escalating wait, and SIGTERM responsiveness.
- Given the PR, when `CHANGELOG.md [Unreleased]` is read, then it carries Added/Changed entries for
  the coordinator, dispatch gate, and wait behavior.

#### Negative Paths
- Given `test/test_harness_integrity.sh` runs, when docs/CHANGELOG are checked, then `[Unreleased]`
  is non-empty and the suite passes (no stale-docs / empty-changelog failure).

### Done When
- [ ] README + src/conductor/README updated; CHANGELOG `[Unreleased]` has the entries; integrity suite green.
