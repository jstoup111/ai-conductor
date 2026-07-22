# Track: Conductor test suite determinism under parallel forks (#573)

Track: technical

Internal test-infrastructure reliability fix — no user-facing product behavior, no
functional requirements to spec, so no PRD. Acceptance criteria live in stories and are
framed as **observable determinism** (N consecutive full-suite runs pass; a deliberately
broken control still fails all N).

## Problem (from #573, reframed as PROBLEM + DESIRED OUTCOMES)

The `conductor` vitest suite (`src/conductor`, `pool: forks, maxForks: 3`) fails
nondeterministically on commits whose diff cannot have caused the failure — proven on
PR #553 where a docs-only commit reddened while its identical-code parent passed the same
workflow. Three runs produced three different failing tests. Every PR's CI is a coin-flip,
which both blocks clean PRs and masks real regressions.

Desired outcomes:
- The suite passes deterministically under its configured parallelism — same commit, same
  result on repeated runs (verifiable: run the full suite N times, get N passes).
- Real regressions are **not** masked — the fix hardens the flaky seams (deterministic
  clock/IO; durable/isolated git) rather than adding blanket flake-tolerance.
- Negative path preserved — a genuinely failing test still fails deterministically (no
  retry-count that greens a real break).

## Two flake families (confirmed by reading the code)

### Family A — fake-timer + async-fs/spy tests (PRIMARY; still present on main)

Named in the issue: `build-progress-watcher.test.ts`, `conductor.test.ts` rate-limit,
`conductor-build-progress.test.ts`.

Confirmed root cause by reading `src/engine/build-progress-watcher.ts` +
`test/build-progress-watcher.test.ts`:
- `BuildProgressWatcher` reads wall-clock via `Date.now()` (lines ~304/325/326/368/374)
  and schedules ticks with a real, `unref`-ed `setInterval` (line ~206) whose callback
  starts an **un-awaited** async `tick()` doing real fs/git I/O
  (`this.pending = this.tick()`).
- The `heartbeat re-emission` and `quiet-episode` describe blocks cross time thresholds
  with `vi.advanceTimersByTimeAsync(...)`. That call fires the interval callback, which
  kicks off a background `tick()`; vitest's fake-timer microtask flush does **not** wait
  for that tick's real (threadpool) fs/git I/O to settle. Whether its emission has landed
  by assertion time is a race → the issue's "re-arms; expected [] to have length 1 but
  got 0."
- The `change-driven emission` block (same file) already sidesteps this: it calls the
  private `tick()` directly and never advances far enough to fire the interval. Its own
  header comment (lines ~138–145) documents the fake-timer/real-I/O race as a known,
  pre-existing hazard "not something to route around here" — i.e. the fix belongs at the
  seam, which is what this spec does.
- `conductor.test.ts` rate-limit already injects a `sleepFn` spy and asserts on
  `sleepFn`/emitted `rate_limit` events (not wall-clock), so its remaining exposure is
  only residual coupling to fake-timer advance elsewhere; the fix is to assert purely on
  injected-seam calls and awaited results.

### Family B — git loose-object durability (SECONDARY; original trigger test deleted)

Named in the issue: `attribution-corpus.test.ts:1087` ("invalid object / Error building
trees", #492 bundle-split) failing under heavy parallel git load.

Finding: that file **no longer exists on main** — deleted in `59e21fd5` and `b5c1a4ca`
(attribution citation-judge removal). So the exact reproduction is gone. But **53 test
files still `git init` a real repo inline**, each without durability or gc guards, so the
flake class remains latent for the object-heavy ones (many commits/trees in a loop under
fork pressure).

Attributed mechanism (issue + standard git behavior): under `maxForks: 3` machine-wide
process pressure, (a) loose objects are not fsync'd by default (`core.fsync=none`), and
(b) `gc.auto`/`maintenance.auto` can fire a mid-test repack — a later `git` read then hits
"invalid object … Error building trees."

## Load-bearing assumption (recorded per HALT-and-report protocol)

**Assumption:** Family B's durability failures are caused by unflushed loose objects and/or
a mid-test auto-gc/repack race, not by cross-repo tmpdir/`$HOME` sharing (the issue already
ruled out env/`GIT_*`/`TMPDIR`/global-config leaks).

**Confidence:** Medium. The env-leak hypotheses were empirically excluded in the issue; the
remaining unflushed-fsync + auto-gc mechanisms are the standard causes of this exact git
error under load and are the ones the fix targets.

**Why NOT a HALT:** the fix design is robust across the plausible mechanisms — `gc.auto=0`
+ `maintenance.auto=false` + `core.fsync=loose-object` are each independently safe and
justified, and the isolation belt (serialize object-heavy files) neutralizes any residual
cross-fork contention regardless of the precise kernel-level cause. The design does not
branch on which mechanism dominates, so no unconfirmed assumption is load-bearing on the
*shape* of the fix. The original trigger test is deleted, so re-running it to settle the
mechanism is impossible.

**How to confirm (deferred to BUILD):** reintroduce a small object-heavy real-git stress
test (N commits/trees in a loop) and run the full suite ×N with and without the hardened
helper; the guarded variant must be green ×N.
