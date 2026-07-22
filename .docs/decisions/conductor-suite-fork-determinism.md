# Architecture Review (lightweight, Medium): Conductor suite fork determinism (#573)

Scope: feasibility + alignment for hardening two flake families in the `src/conductor`
vitest suite. No new services, no data model, no external surface. Reviewed against the
repo Design Principle ("deterministic where possible; LLM only where necessary") and the
issue's explicit anti-goal (no flake-masking retry).

## Feasibility

- **Family A (clock seam).** `BuildProgressWatcher` already localizes all wall-clock reads
  to `Date.now()` and all scheduling to one `setInterval`. Introducing an injectable
  `now: () => number` (default `Date.now`) is a mechanical, backward-compatible change: no
  call site outside tests passes the option, so production behavior is byte-identical. The
  existing `change-driven emission` block already proves the target test pattern (drive the
  private `tick()` directly, never fire the interval) works and is stable. FEASIBLE.
- **Family B (git hardening + isolation).** `git config gc.auto 0`,
  `maintenance.auto false`, and `core.fsync loose-object` are standard, universally
  supported git knobs; wrapping them in a shared `initTestRepo` helper is a pure additive
  refactor. Vitest supports multiple project configs and `poolOptions.forks.singleFork`,
  so serializing the heaviest real-git files behind a second config is a known-supported
  path. FEASIBLE.

## Alignment

- **Deterministic-first (Design Principle).** Both legs replace a timing/OS-scheduling race
  with a deterministic seam (injected clock; fsync'd, gc-frozen, optionally serialized git)
  — machinery at the point of the flake, not prompt/discipline. ALIGNED.
- **No flake-masking (issue anti-goal).** The design forbids `test.retry`, timeout
  inflation, or tolerance thresholds; a genuinely broken assertion still fails every run.
  Acceptance requires a deliberately-broken control to fail ×N. ALIGNED.
- **Blast radius.** The clock seam is additive with a `Date.now` default; the git helper is
  opt-in per migrated test. No production runtime path changes. Low risk.

## Risks / mitigations

- **Clock seam mis-wiring** could change real heartbeat/quiet timing. Mitigation: default
  strictly `Date.now`; a regression test asserts production construction (no `now` option)
  still arms the interval and emits on real ticks.
- **`core.fsync` token support** varies by git version. Mitigation: helper uses the
  broadly-supported `core.fsync=loose-object` and also sets the legacy
  `core.fsyncObjectFiles=true`; both are advisory and harmless if one is a no-op on a given
  version.
- **Partial migration** of the 53 inline-`git init` files. Mitigation: full migration is a
  non-goal; scope to object-heavy files, and the isolation belt covers any straggler.

## Verdict

APPROVED for build. Proceed to stories.

---

## ADR-2026-07-22: Injectable clock seam for BuildProgressWatcher over fake-timer clock advance

Status: APPROVED

### Context

The watcher's quiet-episode and heartbeat tests cross time thresholds with
`vi.advanceTimersByTimeAsync`, which fires the watcher's real `unref`-ed interval and
starts an un-awaited `tick()` doing real fs/git I/O. Vitest's fake-timer microtask flush
does not wait for that real I/O, so emission counts are nondeterministic under fork load
(#573, Family A).

### Options considered

1. **Inject a `now: () => number` clock; drive `tick()` directly in tests** (default
   `Date.now`). Tests advance a mutable clock value and `await tick()` — emissions become a
   pure function of awaited ticks; the real interval is never the assertion's timing source.
2. **Keep fake timers, add `settle()`/`runAllTimersAsync` barriers.** `settle()` already
   exists but only awaits an in-flight tick; it cannot make fake-timer flushing wait on
   threadpool fs/git I/O in general — the race can still surface. Rejected: does not remove
   the root cause.
3. **`test.retry` on the flaky files.** Rejected outright — flake-masking, violates the
   issue anti-goal and the repo Design Principle; hides real regressions.

### Decision

Adopt Option 1. Add an optional injectable clock to `BuildProgressWatcher` and rewrite the
threshold tests to advance the injected clock and await `tick()` directly, never using
`advanceTimersByTimeAsync` to gate an emission assertion. Fake timers, if retained, only
guard the `unref`-ed interval from leaking past the test — never as the emission clock.

### Consequences

- Production behavior unchanged (default `Date.now`).
- The three timer test blocks become deterministic regardless of fork contention.
- A one-line construction-default regression test guards against future accidental
  reliance on the injected seam in production.
