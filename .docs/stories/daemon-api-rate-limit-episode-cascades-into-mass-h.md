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
- Given `enter` is called with a non-finite or past `untilMs`, when `active(now)` is queried, then
  it never throws and treats the episode as already-cleared (no negative/NaN deadline).

### Done When
- [ ] `src/conductor/src/engine/rate-limit-episode.ts` exports `createRateLimitEpisode({ now?, setTimer? })`
      returning `{ enter(untilMs), active(now?), clear(signal?) }`; pure (no direct `Date.now`/`setTimeout`).
- [ ] Unit tests (mirroring `waker.test.ts`) cover: enter→active window, later-deadline-wins,
      earlier-deadline-ignored, clear-resolves-at-deadline, abort-before-deadline, non-finite input.
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

### Done When
- [ ] `DaemonDeps` gains an optional `rateLimitEpisode?` (or `isRateLimited?()`) seam with
      optimization-never-authority JSDoc, mirroring `isHalted?`/`watchHaltCleared?`.
- [ ] The pre-dispatch gate in `daemon.ts` (beside `checkPaused`, ~line 574) skips new picks when active.
- [ ] Tests: active→no-dispatch, clear→resume, undefined-dep→unchanged, in-flight-untouched,
      compose-with-PAUSE, no-double-dispatch-on-clear-tick.

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

### Done When
- [ ] The conductor rate-limit branch (`conductor.ts:1163-1171`) awaits an abortable wait bound to
      the episode/`AbortSignal`, not a bare `setTimeout`.
- [ ] A SIGTERM handler is installed alongside SIGINT (`conductor.ts:863-868`) and `off()`-ed at all
      conductor exit sites; a leak test asserts baseline listener count after the run.
- [ ] Test drives a SIGTERM mid-wait and asserts state is written before exit (injected exit spy).

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
- Given the limit lifts after N probes, when the next call succeeds, then the coordinator clears and
  the escalation state resets (a later, unrelated episode starts from the base interval, not the cap).
- Given a probe would compute a non-positive or NaN interval, when scheduling, then it falls back to
  a safe positive default (never waits 0 / never busy-loops).
- Given each re-probe is a real retry, when it runs, then it does NOT consume the step retry budget
  (`attempt--` preserved) so a lifting limit always makes progress.

### Done When
- [ ] Re-probe interval escalates with a documented cap; unit test asserts monotone-up-to-cap and
      reset-after-clear.
- [ ] First probe still honors provider `waitSeconds`; non-positive/NaN → safe default (>0).
- [ ] Test asserts the retry budget (`attempt`) is unchanged across multiple coordinated re-probes.

---

## Story: Pre-step call sites route a rate limit to the wait, not to a HALT

**Requirement:** ADR change 4 (classification at call sites) — the confirmed cascade path

As the daemon, I want provider calls that run *before* the step retry loop (feature setup) to treat
a rate-limited result as "the API said wait", so that a limit during setup does not fast-fail a
freshly-dispatched feature into a HALT.

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
