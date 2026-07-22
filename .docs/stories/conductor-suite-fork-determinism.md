# Conductor test suite determinism under parallel forks (#573)

Status: Accepted

## Context

The `src/conductor` vitest suite runs under `pool: forks, maxForks: 3` and fails
nondeterministically on commits that cannot have caused the failure (proven: docs-only
commit reddened while its identical-code parent passed — PR #553). Two flake families are
confirmed by reading the code:

- **Family A** — `BuildProgressWatcher`'s quiet-episode/heartbeat tests cross time
  thresholds with `vi.advanceTimersByTimeAsync`, which fires the watcher's real `unref`-ed
  interval and starts an un-awaited `tick()` doing real fs/git I/O that fake-timer flushing
  never waits for → nondeterministic emit counts ("expected [] to have length 1 but got 0").
- **Family B** — 53 test files `git init` a real repo inline with no durability/gc guards;
  the object-heavy ones can hit "invalid object / Error building trees" under parallel fork
  pressure (unflushed loose objects + auto-gc repack race). The original trigger test
  (`attribution-corpus.test.ts`) has since been deleted, so the hardening lands in a shared
  helper as a forward guard for the surviving real-git tests.

Acceptance is framed as **observable determinism**, not "looks fixed": the full suite must
pass on repeated runs, and a deliberately broken control must still fail on every run.

## Story 1 — BuildProgressWatcher exposes an injectable clock; production is unchanged

As the conductor engine, the watcher must read time through an injectable seam so tests can
make time deterministic, while production keeps using the real wall clock unchanged.

### Happy Path

- **Given** `BuildProgressWatcher` constructed with **no** `now` option (production path),
- **When** it is started and real ticks fire,
- **Then** it reads time from `Date.now`, arms its `unref`-ed interval, and emits
  `build_progress` / `build_no_progress` / heartbeat exactly as before this change
  (byte-identical production behavior; existing non-timer tests still pass).

### Happy Path (test seam)

- **Given** the watcher constructed with an injected `now: () => number` returning a
  mutable test-controlled value,
- **When** a test advances that value and calls the private `tick()` directly,
- **Then** all quiet-episode and heartbeat threshold decisions use the injected value, so
  the emission outcome is a pure function of the injected clock + awaited ticks.

### Negative Path

- **Given** a caller passes no clock,
- **When** the watcher needs the current time,
- **Then** it MUST fall back to `Date.now` (never `undefined`/NaN), so omitting the option
  can never change production timing.

## Story 2 — Timer/heartbeat/quiet tests are deterministic under fork load

As the CI suite, the `build-progress-watcher` heartbeat and quiet-episode tests must not
depend on fake-timer flushing settling real fs/git I/O.

### Happy Path

- **Given** the `heartbeat re-emission` and `quiet-episode build_no_progress` describe
  blocks,
- **When** they are rewritten to advance the injected clock and `await tick()` directly
  (never using `vi.advanceTimersByTimeAsync` to gate an emission assertion),
- **Then** each asserted emit count is produced only by awaited ticks, and the file passes
  on every run inside the full suite under `pool: forks, maxForks: 3`.

### Negative Path

- **Given** a test still crosses a threshold with `advanceTimersByTimeAsync` and then
  asserts an emit count,
- **When** the determinism review runs,
- **Then** that pattern MUST be treated as a defect and removed — fake timers may only
  guard the `unref`-ed interval from leaking, never serve as the emission clock for an
  assertion.

## Story 3 — Rate-limit / spy tests assert on injected seams, not wall-clock timing

As the CI suite, `conductor.test.ts` rate-limit handling must assert on injected-seam calls
and awaited results, so spy-call assertions cannot flake under fork scheduling.

### Happy Path

- **Given** the rate-limit tests inject a `sleepFn` spy and listen for the `rate_limit`
  event,
- **When** a rate-limited step result is processed,
- **Then** the test asserts on `sleepFn` call args (e.g. `5000`) and the emitted
  `rate_limit` payload after `await`-ing `conductor.run()` — never on real elapsed time —
  and passes deterministically in the full suite.

### Negative Path

- **Given** any residual coupling where a spy-call assertion depends on
  `advanceTimersByTimeAsync` interleaving,
- **When** the audit runs,
- **Then** it MUST be converted to an injected-seam + awaited-result assertion; a
  wall-clock-timing-dependent spy assertion is not allowed to remain.

## Story 4 — Real-git tests use a shared hardened repo helper (durable, gc-frozen)

As the CI suite, real-git tests must create repos that write durable loose objects and never
auto-gc mid-test, so parallel fork pressure cannot corrupt object reads.

### Happy Path

- **Given** a shared `initTestRepo(dir)` helper that runs `git init -b main`, sets
  `user.email`/`user.name`, and applies `gc.auto=0`, `maintenance.auto=false`,
  `core.fsync=loose-object`, and `core.fsyncObjectFiles=true`,
- **When** the object-heavy real-git test files are migrated to it,
- **Then** those files create repos with durable, non-repacking object stores and pass on
  repeated full-suite runs — no "invalid object / Error building trees."

### Negative Path

- **Given** a git version where a specific `core.fsync` token is unrecognized,
- **When** the helper applies config,
- **Then** the unsupported knob MUST be harmless (advisory config, no hard failure) and the
  helper still succeeds — hardening degrades safely, never breaks repo creation.

### Non-goal (scope guard)

- Migrating **all** 53 inline-`git init` files is explicitly out of scope; only object-heavy
  files are migrated in this change. A non-migrated file continuing to pass is acceptable.

## Story 5 — Object-heavy git files are isolated from fork contention (defense-in-depth)

As the CI suite, any real-git file that remains flaky after config hardening must be
serialized so its loose-object writes never race across forks — without weakening
parallelism for the rest of the suite.

### Happy Path

- **Given** a second vitest project config that runs the tagged object-heavy files with
  `poolOptions.forks.singleFork: true` while the main config excludes them,
- **When** `npm test` runs both projects,
- **Then** the heavy files execute serialized, the rest of the suite keeps
  `maxForks: 3`, and the whole run is green on repeated invocations.

### Negative Path

- **Given** the isolation belt is proposed as the *only* fix,
- **When** the design is reviewed,
- **Then** it MUST NOT replace the git-config hardening (Story 4) — isolation is
  complementary defense-in-depth; the durability guards remain the primary, deterministic
  fix.

## Story 6 — Determinism is verified; no flake-masking is introduced

As a maintainer, the fix must be proven deterministic and must not hide real regressions.

### Happy Path

- **Given** the hardened suite,
- **When** the full `src/conductor` suite is run **N consecutive times** (N ≥ 10) under its
  configured `pool: forks, maxForks: 3`,
- **Then** it passes all N runs with zero nondeterministic failures.

### Negative Path

- **Given** a deliberately broken control (an assertion inverted, or a genuine hang),
- **When** the suite runs N times,
- **Then** that test fails **every** run (deterministic red) — and the change introduces
  **no** `test.retry`, no widened timeout that greens a real hang, and no tolerance
  threshold that suppresses a genuine failure.
