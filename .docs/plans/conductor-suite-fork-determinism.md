# Implementation Plan: Conductor suite fork determinism (#573)

Stem: conductor-suite-fork-determinism
Track: technical
Tier: M

## Goal

Make the `src/conductor` vitest suite pass deterministically under its configured
`pool: forks, maxForks: 3` by hardening the two confirmed flake seams — (A) replace the
`BuildProgressWatcher` timer tests' reliance on fake-timer flushing settling real fs/git
I/O with an injected clock driven by direct awaited ticks; (B) make real-git tests write
durable, non-repacking object stores via a shared hardened helper, with a serialized
project config as defense-in-depth — **without** any flake-masking (no `test.retry`, no
timeout inflation).

## Files (surface touched)

- `src/conductor/src/engine/build-progress-watcher.ts` — add optional injectable clock.
- `src/conductor/test/build-progress-watcher.test.ts` — rewrite heartbeat + quiet-episode
  blocks to the injected-clock / direct-tick pattern; add construction-default regression.
- `src/conductor/test/engine/conductor.test.ts` — audit/convert rate-limit spy assertions
  to injected-seam + awaited-result form.
- `src/conductor/test/fixtures/git-repo.ts` — NEW shared `initTestRepo` helper.
- Object-heavy real-git test files (migration subset) — e.g.
  `test/engine/task-progress.test.ts`, `test/engine/daemon-rekick.test.ts`,
  `test/engine/push-evidence.test.ts`, `test/engine/rebase-*.test.ts` and peers that create
  many commits/trees in a loop (final list chosen in Task 5 by object-churn).
- `src/conductor/vitest.config.ts` (+ NEW `src/conductor/vitest.git.config.ts` if the
  isolation belt is needed) — second project reusing the same `setupFiles`/`globalSetup`.
- `src/conductor/package.json` — `test` script runs both projects if the belt is added.
- `CHANGELOG.md` — `## [Unreleased]` entry (added in the BUILD/implementation PR, not the
  spec PR; the engineer `land` stages only `.docs`).

## Non-goals

- Migrating all 53 inline-`git init` files — only object-heavy ones (Story 4 scope guard).
- Any change to production runtime behavior of `BuildProgressWatcher` (clock defaults to
  `Date.now`; no call site changes).
- Any `test.retry`, widened `testTimeout`, or tolerance threshold (Story 6 anti-goal).
- Re-introducing the deleted `attribution-corpus.test.ts` as product code (only an optional
  throwaway stress harness may be used to *verify* Family B, per Task 8).

## Task Dependency Graph

```
Task 1 (clock seam) ──┬─▶ Task 2 (rewrite heartbeat/quiet tests) ──┐
                      └─▶ Task 3 (construction-default regression) ─┤
Task 4 (rate-limit spy audit) ────────────────────────────────────┤
Task 5 (shared git helper) ──▶ Task 6 (migrate heavy files) ──┬────┤
                                                              └─▶ Task 7 (isolation belt, conditional)
                                                                   │
All of the above ─────────────────────────────────────────────────┴─▶ Task 8 (determinism verification ×N)
```

## Tasks

### Task 1 — Add an injectable clock to BuildProgressWatcher

Add `now?: () => number` to `BuildProgressWatcherOptions`; store `private readonly now`
defaulting to `Date.now`. Replace every internal `Date.now()` read (quiet-episode elapsed,
heartbeat elapsed, `lastChangeAt`/`lastEmitAt` stamps — lines ~304/325/326/368/374) with
`this.now()`. The `setInterval` scheduling is unchanged (real interval still `unref`-ed);
only the *time source for decisions* becomes injectable.

- **Files:** `src/conductor/src/engine/build-progress-watcher.ts`
- **Dependencies:** none
- Est: 8 min

### Task 2 — Rewrite heartbeat + quiet-episode test blocks to injected-clock / direct-tick

In `build-progress-watcher.test.ts`, change the `BuildProgressWatcher heartbeat
re-emission` and `BuildProgressWatcher quiet-episode build_no_progress` blocks to construct
the watcher with an injected mutable-clock (`let clock = 0; now: () => clock`), advance
`clock` by the desired delta, and `await tick(watcher)` directly. Remove every
`vi.advanceTimersByTimeAsync(...)` that gates an emission assertion in these blocks. Keep
`vi.useFakeTimers()` only if still needed to guard the `unref`-ed interval from leaking; it
must never be the emission clock. Assertions (emit counts, `quietMinutes`, resolved/total)
stay identical.

- **Files:** `src/conductor/test/build-progress-watcher.test.ts`
- **Dependencies:** Task 1
- Est: 15 min

### Task 3 — Construction-default regression guard

Add a test asserting that a `BuildProgressWatcher` constructed with **no** `now` option
reads real time: e.g. start it, let a real (short) tick fire or call `tick()` and assert an
emission occurs, and assert the option is optional (type-level + runtime default is
`Date.now`, not `undefined`). Guards against future code accidentally depending on an
injected clock in production.

- **Files:** `src/conductor/test/build-progress-watcher.test.ts`
- **Dependencies:** Task 1
- Est: 6 min

### Task 4 — Audit & convert rate-limit / spy assertions to injected-seam form

In `conductor.test.ts` rate-limit describe (`~7485`+), confirm every assertion is on the
injected `sleepFn` spy args and the emitted `rate_limit` event after `await
conductor.run()`, not on wall-clock timing. Convert any residual assertion that depends on
`advanceTimersByTimeAsync` interleaving to an awaited-result + injected-seam assertion.
Sweep the file for other spy-timing couplings flagged by the issue ("expected spy to be
called with [5000]").

- **Files:** `src/conductor/test/engine/conductor.test.ts`
- **Dependencies:** none
- Est: 12 min

### Task 5 — Create shared hardened git-repo test helper

Add `test/fixtures/git-repo.ts` exporting `initTestRepo(dir)` (and a small `commitAll`
convenience). It runs `git init -b main`; sets `user.email`/`user.name`; and applies
durability + no-repack config: `gc.auto=0`, `maintenance.auto=false`,
`core.fsync=loose-object`, `core.fsyncObjectFiles=true`. Config is applied per-tmpdir-repo
only (never global/`$HOME`). Unsupported `core.fsync` tokens must be non-fatal (advisory).

- **Files:** `src/conductor/test/fixtures/git-repo.ts`
- **Dependencies:** none
- Est: 10 min

### Task 6 — Migrate object-heavy real-git tests to the helper

Identify the object-heavy real-git files (those creating many commits/trees in loops) and
replace their inline `git init` + config lines with `initTestRepo`. Scope to object-heavy
files only (Story 4 non-goal bars a full 53-file migration). Verify each migrated file
passes in isolation and in the full suite.

- **Files:** the migration subset under `src/conductor/test/**` (e.g.
  `test/engine/task-progress.test.ts`, `test/engine/daemon-rekick.test.ts`,
  `test/engine/push-evidence.test.ts`, `test/engine/rebase-resolution.test.ts` and peers
  chosen by object-churn), importing `test/fixtures/git-repo.ts`
- **Dependencies:** Task 5
- Est: 20 min

### Task 7 — Isolation belt for any file still flaky after hardening (conditional)

If, after Tasks 5–6, any object-heavy file still shows nondeterminism in the ×N run
(Task 8), add `src/conductor/vitest.git.config.ts` running the tagged files with
`poolOptions.forks.singleFork: true`, reusing the SAME `setupFiles: ['./test/setup.ts']`
and `globalSetup: ['./test/global-setup.ts']` (conflict-check constraint); exclude those
files from the main config's `include`; and update `package.json` `test` to run both
projects. Skip this task if Task 8 is already green ×N after hardening.

- **Files:** `src/conductor/vitest.git.config.ts` (new), `src/conductor/vitest.config.ts`,
  `src/conductor/package.json`
- **Dependencies:** Task 6 (and gated by Task 8's result)
- Est: 15 min (conditional)

### Task 8 — Verify determinism ×N and prove no flake-masking

Run the full `src/conductor` suite N ≥ 10 consecutive times under `pool: forks,
maxForks: 3`; require N green runs. Then run a deliberately-broken control (invert one
assertion / insert a genuine hang) and confirm it fails **every** run. Confirm the diff
introduces no `test.retry`, no widened `testTimeout`, no tolerance threshold. This is the
Story 6 gate. Also add the `CHANGELOG.md [Unreleased]` entry here (implementation PR).

- **Files:** `CHANGELOG.md`; no source changes beyond reverting the throwaway control
- **Dependencies:** Tasks 2, 3, 4, 6 (and Task 7 if it was triggered)
- Est: 12 min (plus N-run wall time)

## Verification (build-exit)

- [ ] Full suite green ×N (N ≥ 10) under `pool: forks, maxForks: 3`.
- [ ] Deliberately-broken control fails every run (deterministic red).
- [ ] No `test.retry`, no timeout inflation, no tolerance threshold anywhere in the diff.
- [ ] `BuildProgressWatcher` production construction (no `now`) behaves byte-identically.
- [ ] `CHANGELOG.md [Unreleased]` entry present (Fixed).
