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
- **The cascade came from rate-limit errors at call sites *outside* the step retry loop.**
  `project-prelude.ts:invokeSkill` (~line 135) returns `result.success` and **drops
  `result.rateLimited`** — a rate limit during a freshly-dispatched feature's prelude collapses to
  `success=false` and fast-HALTs the feature before it ever reaches the in-step wait (verified by
  reading the call site; ~85% confidence this is the 2026-07-03 root cause — the raw log was not
  in hand, but the code path matches the observed "5 fresh features HALT in ~15s, 1 in-step feature
  waits" signature exactly). `model-availability.invokeWithLadder` by contrast correctly
  *propagates* the rate-limited result upward (verified) — so the fix is call-site-specific, not
  a blanket rewrite.
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

4. **Rate-limit classification at pre-step call sites**: `project-prelude.ts:invokeSkill` (and any
   sibling pre-step invoke that today drops `rateLimited`) must propagate/honor `result.rateLimited`
   — routing into the episode + wait — instead of collapsing it to `success=false`. This closes the
   actual cascade path. (`model-availability.invokeWithLadder` already propagates and needs no
   change.)

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
- [ ] Implement `rate-limit-episode.ts` (pure, timer-injected) with unit tests (mirror `waker.test.ts`).
- [ ] Wire the coordinator in `daemon-cli.ts` next to `events`; add the dispatch gate + `DaemonDeps` seam.
- [ ] Replace the conductor rate-limit sleep with the AbortSignal wait; add + tear down the SIGTERM handler.
- [ ] Propagate `rateLimited` from `project-prelude.ts:invokeSkill`; audit sibling pre-step invokes.
- [ ] Docs: README + src/conductor/README daemon lifecycle; CHANGELOG [Unreleased].
