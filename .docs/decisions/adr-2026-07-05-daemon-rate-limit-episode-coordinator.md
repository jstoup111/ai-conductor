# ADR: Daemon rate-limit episode is a coordinated in-process pause, not a per-feature failure

**Date:** 2026-07-05
**Status:** APPROVED
**Deciders:** James (operator), engineer (design)

<!-- Filename convention: adr-2026-07-05-<kebab-slug>.md (no sequential numbers). -->

## Context

Source: `jstoup111/ai-conductor#270`. On 2026-07-03 (JSA daemon, 18:04–19:25 UTC) a transient
account-level API rate-limit episode cascaded into five per-feature HALTs plus needs-remediation
PR noise, and the one resumed feature sat in `⏳ rate limited: waiting 300s` for ~80 minutes (16
consecutive fixed waits) while ignoring SIGTERM (required SIGKILL + pane respawn).

Grounded facts from the current code:

- **The in-step wait already does NOT burn the retry budget.** `conductor.ts:1163-1171` does
  `attempt--; continue;` on `result.rateLimited`, structurally separating a rate-limit from
  "retries exhausted" (verified). So the mass-HALT cascade did **not** come from that path.
- **The cascade came from a CLASSIFIER miss on the ordinary step path** *(corrected 2026-07-05 by
  the Fable design review, from the actual daemon log — `.daemon/daemon.log`, 18:01–18:06 UTC)*:
  every one of the five HALTs failed with **`You've hit your session limit · resets 3:20pm
  (America/New_York)`** at a normal step (`build` ×2, `finish` ×2, `acceptance_specs` ×1). That
  message does **not** match `RATE_LIMIT_RE = /rate limit|429|overloaded|usage limit/i`
  (`claude-provider.ts:4`), so `rateLimited` was never set, the in-step wait never engaged, and
  the ordinary retry loop burned to "retries exhausted" in seconds. The original draft attributed
  this to `project-prelude.ts:invokeSkill` dropping `rateLimited` (~85% confidence, log not in
  hand) — the log falsifies that: **the daemon path never runs the prelude at all**
  (`runProjectPrelude` is called only from `index.ts:774`, the interactive path;
  `daemon-cli.ts:runConductorInWorktree` constructs the Conductor directly). The prelude hole is
  real but interactive-only. `model-availability.invokeWithLadder` propagates correctly, and
  `runSelfBuildDispatch` delegates to `stepRunner.run` (propagates) — verified.
- **The 80-minute wedge ignored a deadline the API had already supplied.** The failing message
  carried `resets 3:20pm (America/New_York)` (= 19:20 UTC), and `parseRateLimitWaitSeconds`
  already has a `resets <time>` branch — yet the resumed feature logged 16 × `waiting 300s`
  (18:05→19:20, the default), so the observed message shape (session-limit wording + timezone
  suffix) fails today's parse. One deadline-derived wait would have replaced all 16 probes.
- **No daemon-global rate-limit backoff exists.** The dispatch loop (`daemon.ts:568-621`) gates
  only on operator PAUSED (`checkPaused`, 574) and stale-engine rebuild; nothing stops it from
  dispatching *new* features into an active episode (verified).
- **The wait is a bare, non-cancellable `setTimeout` and there is no SIGTERM handler.** The
  conductor installs only a SIGINT handler (`conductor.ts:863-868`, state-save + exit 130); the
  rate-limit sleep (`conductor.ts:1168`, default `setTimeout` at 325-329) has no `AbortSignal`, so
  SIGTERM mid-wait hard-kills with no drain (verified).
- **Features run in-process.** `daemon-cli.ts:413 runConductorInWorktree` does `new Conductor({…})`
  at line 468 and awaits it; N features run as concurrent async tasks in one Node process, and a
  shared `ConductorEventEmitter` is already injected into every `new Conductor` (daemon-cli.ts:388,
  471) — a proven precedent for injecting a shared in-process object (verified). We run one daemon
  per repo ([[project_daemon_multi_operator_gap]]).

Constraints: must compose with the in-flight **event-driven-wake** feature (issue #111, PR #329,
stalled in needs-remediation) rather than duplicate it; must not regress the daemon's
"sleep called once per idle cycle" test invariants; must keep the core daemon loop pure
(deps injected).

## Options Considered

### Option A: File-marker episode gate (`.daemon/RATE_LIMITED` with an `until` timestamp)
- **Pros:** survives daemon restart; reuses the `checkPaused()` file-gate shape.
- **Cons:** the per-worktree `Conductor` only knows its worktree path, so it needs an injected
  daemon-scoped path (extra plumbing) to write a daemon-level marker; episode-end is noticed only on
  the next dispatch poll tick (latency); each in-flight feature sleeps independently (N concurrent
  300s waits — the exact "16×300s" waste #270 flags stays partly unsolved).

### Option B: In-process `RateLimitEpisode` coordinator (CHOSEN)
- **Pros:** injected next to the existing shared `events` emitter — the wiring channel already
  exists; event-driven resume (no poll latency); **one** coordinated backoff/re-probe shared by all
  in-flight features instead of N; cleanest "resume where it left off." Pure, timer-injected module
  mirroring the existing `waker.ts` shape.
- **Cons:** in-process only (no cross-process/ restart persistence) — acceptable because we run one
  daemon per repo and an episode is transient (the daemon re-discovers backlog on restart).

## Decision

Introduce an in-process **`RateLimitEpisode`** coordinator and treat a rate-limit episode as a
**daemon-level coordinated pause**, not a per-feature failure. Four coupled changes:

1. **`RateLimitEpisode` module** (`src/conductor/src/engine/rate-limit-episode.ts`, new): pure,
   timer/`now`-injected (mirrors `waker.ts`). Surface: `enter(untilMs)` (opens/extends the episode
   to the latest deadline), `active(nowMs?)`, and `clear(signal?)` → a promise resolving when the
   current deadline passes (interruptible via `AbortSignal`). A single shared **escalating re-probe**
   with a cap replaces the fixed 300s-forever loop: on a re-entry immediately after a clear, the
   next probe interval escalates (bounded) rather than sitting at a flat 300s.

2. **Dispatch gate** (`daemon.ts` dispatch loop, beside `checkPaused` at ~574): when
   `episode.active()`, do not `pickEligible`/dispatch **new** features; in-flight features are
   untouched. Injected via `DaemonDeps` (optimization-never-authority: absent dep → today's
   behavior). Composes with event-driven-wake — a feature that never HALTs needs no unpark.

3. **Signal-responsive wait** (`conductor.ts` rate-limit branch): replace the bare `setTimeout`
   with a wait that (a) is driven by an `AbortSignal`, and (b) installs a **SIGTERM** handler
   (alongside the existing SIGINT) that saves state and exits promptly. The in-step wait shares the
   episode deadline via the coordinator, and a rate-limit still does not consume the retry budget
   (`attempt--` preserved).

4. **Rate-limit classification at non-step call sites** *(demoted by the Fable review — this is
   interactive-path hardening, NOT the observed cascade path)*: `project-prelude.ts:invokeSkill`
   (and any sibling non-step invoke that today drops `rateLimited`) must propagate/honor
   `result.rateLimited` — routing into the episode + wait — instead of collapsing it to
   `success=false`. (`model-availability.invokeWithLadder` already propagates;
   `runSelfBuildDispatch` delegates to `stepRunner.run` — both verified, no change.)

Fable design-review amendments (2026-07-05) — these close the gaps between the draft and the
log-verified failure, and are binding:

5. **Classification hardening is the PRIMARY fix (the log-verified root cause).** Extend the
   rate-limit-family classification so account/session-cap messages are waits, not failures:
   `RATE_LIMIT_RE` (or a sibling `SESSION_LIMIT_RE` folded into `rateLimited`) must match the
   session/usage-cap family — at minimum the observed literal **`You've hit your session limit ·
   resets 3:20pm (America/New_York)`**, which is pinned as a regression fixture — while genuine
   failures (compile errors, gate misses) never classify as waits. Without this change every other
   mechanism in this ADR is unreachable in the observed scenario.
6. **Deadline-first, escalation-fallback.** When the classified message carries a parseable reset
   time, the episode deadline IS the parsed reset (one wait to the deadline — not N probes);
   `parseRateLimitWaitSeconds`'s `resets <time>` branch must handle the observed shape (12-hour
   clock + `(America/New_York)`-style timezone suffix; compute in that zone, not the host's).
   The escalating re-probe (change 1) applies ONLY when no deadline is parseable. A parsed
   deadline caps at a sane maximum (e.g. 6h) so a mis-parse can't wedge the daemon.
7. **Jittered resume — no thundering herd.** On episode end, waiters and the dispatch gate resume
   with a small per-waiter random jitter/stagger (issue #270 asked for "global backoff with
   jitter/cap"; the draft dropped the jitter). N features + fresh dispatch all probing in the same
   instant against a just-cleared account limit is a re-trigger risk.
8. **Episode-caused HALT self-heal (defense in depth).** Classification will never be exhaustive:
   an unrecognized limit message still HALTs a feature. Any HALT written **while the episode is
   active** is stamped episode-caused (in the HALT reason or a sidecar timestamp); when the
   episode clears, the daemon clears/re-kicks those HALTs through the existing sweep machinery
   WITHOUT waiting for a main advance — closing issue #270's want #4 ("self-heal without a
   main-advance sweep") against residual classifier misses.
9. **Wake-recheck loop in `clear()`.** `clear()` resolves only when `active(now) === false` **at
   wake time**: timer fires → re-check → re-arm to the latest deadline if `enter()` extended it
   meanwhile (including an `enter()` landing between timer-fire and waiter resumption). A
   post-resolve `enter()` creates a fresh promise — no lost-wakeup for late waiters, no resume
   into a deadline the coordinator already knows is live.
10. **Escalation reset is self-contained and cross-feature escalation is intended.** The module
    surface gains no external `reset()` caller: an `enter()` arriving while the episode is
    inactive AND more than a grace period past the last deadline starts escalation from the base
    interval (time-based reset — no call-site coupling); an `enter()` immediately after a clear
    escalates. The escalation counter is deliberately shared across features — the limit is
    account-level, so feature A's re-entries correctly extend feature B's expectations. The
    module's surface takes `enter({ waitSeconds })` and computes the deadline with its OWN
    injected `now()` (single clock — no conductor/module skew).
11. **Autonomous self-restarts defer during an active episode.** The idle-boundary restart
    triggers (`hasRestartPending` → `triggerSelfRestart`, stale-engine → `requestRestart`) are
    gated on `!episode.active()` — deferred to the next tick, not dropped. During an episode the
    gate drains the pool, the loop sits exactly in that idle branch, and an ungated restart
    respawns a daemon with no episode memory that immediately re-dispatches the backlog into the
    still-active limit — the cascade reintroduced by our own lifecycle machinery. Deferral keeps
    the accepted "in-memory episode" trade-off honest (only OPERATOR restarts lose the episode).
12. **SIGTERM coordination is process-level in the daemon.** Each `new Conductor` today installs
    its own process-global SIGINT handler that does `writeState` then `process.exit(130)`; with
    N in-flight conductors the first handler's `exit` races the siblings' state writes (N−1
    silent state losses). The daemon's SIGTERM handler therefore lives in **daemon-cli** (one per
    process): abort the shared episode/wait signals, await ALL in-flight conductors' state saves,
    then exit. The per-conductor handler remains for interactive `conduct` (N=1 by construction).

*Spec hygiene (Fable review):* the draft cites `waker.ts`/`waker.test.ts` as the module pattern to
mirror — that module does not exist on this branch (it lives on unmerged PR #329). The pattern,
inlined: pure factory, injected `now`/`setTimer`, no wall-clock reads inside the module.

We chose B over A because the in-process execution model and the pre-existing shared-`events`
injection make B *lower* plumbing than A, while additionally delivering event-driven resume and a
single coordinated backoff — two of the three things #270 actually complained about — which A leaves
partly unsolved. B's only cost (no restart persistence) is immaterial for a transient, one-daemon
episode.

## Consequences

### Positive
- A transient episode no longer cascades into mass HALTs: new dispatch pauses; in-flight features
  share one bounded, escalating, interruptible wait; SIGTERM exits promptly.
- Fewer needs-remediation PRs and no reliance on a coincidental main-advance re-kick to recover.
- Composes cleanly with event-driven-wake (#111) — the better fix is to not HALT in the first place.

### Negative
- One more injected dep threaded into `new Conductor` and `DaemonDeps` (mitigated: mirrors the
  existing `events`/`waker` patterns).
- Episode state is lost on daemon restart (accepted; transient + re-discovery on startup).
- A new SIGTERM handler must be `off()`-ed at every conductor exit site (as SIGINT already is) to
  avoid listener leaks.

### Follow-up Actions
- [ ] **Harden classification (change 5, primary):** session-limit family → `rateLimited`; pin the
      observed 2026-07-03 message as a regression fixture; genuine failures never classify as waits.
- [ ] **Deadline-first parse (change 6):** `resets <time> (<tz>)` incl. 12-hour + timezone suffix →
      episode deadline; escalation only when unparseable; sane deadline cap.
- [ ] Implement `rate-limit-episode.ts` (pure, timer-injected) with unit tests (mirror `waker.test.ts`).
- [ ] Wire the coordinator in `daemon-cli.ts` next to `events`; add the dispatch gate + `DaemonDeps` seam.
- [ ] Replace the conductor rate-limit sleep with the AbortSignal wait; add + tear down the SIGTERM handler.
- [ ] **Jittered resume (change 7)** for waiters + dispatch on episode end.
- [ ] **Episode-caused HALT stamping + self-heal sweep on episode end (change 8).**
- [ ] Propagate `rateLimited` from `project-prelude.ts:invokeSkill` (interactive-path hardening);
      audit sibling non-step invokes.
- [ ] Docs: README + src/conductor/README daemon lifecycle; CHANGELOG [Unreleased].
