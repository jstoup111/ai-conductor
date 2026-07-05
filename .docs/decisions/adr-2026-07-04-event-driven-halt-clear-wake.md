# ADR 2026-07-04: Event-Driven HALT-Clear Wake with Poll Backstop

Status: APPROVED
Date: 2026-07-04
Context: issue jstoup111/ai-conductor#111; architecture diagram
`.docs/architecture/daemon-event-driven-wake-for-parked-halted-feature.md`

## Context

The conductor daemon idle-polls every 5s (`idlePollMs`) solely to notice a **local**
`.pipeline/HALT` deletion so a parked feature can re-dispatch. This burns a `git fetch` +
`fs.stat` sweep every 5s, floods `.daemon/daemon.log` with repeated identical lines (an offline
`git fetch` logs a failure per tick), and buries the last-known status of in-flight work.

## Decision

1. **Watcher: `chokidar`** (new runtime dependency of `src/conductor/`). It normalizes
   cross-platform `fs.watch` quirks (atomic replace, `null` filename, event bursts) that a
   hand-rolled `fs.watch` wrapper would have to re-solve per platform. Evidence: chokidar is the
   de-facto watcher used by vite/webpack/tsup themselves precisely for these quirks.
   `@parcel/watcher` remains a viable native drop-in behind the same seam. Prefer chokidar v4
   (minimal dependency tree); if v3 is used, mark the optional `fsevents` dep external in
   `tsup.config.ts`.
2. **Injectable seam, mirroring existing optional deps.** `watchHaltCleared(worktreeBase, slug,
   onCleared) => dispose` lives in `daemon-deps.ts`; `DaemonDeps` gains an optional
   `watchHaltCleared?` field exactly like the existing `isHalted?`/`sleep?` pattern. Absent ⇒
   pure polling (today's behavior). `onCleared` fires on `unlink` of the HALT path,
   re-verified via the existing `exists` helper. This covers BOTH clear paths: an operator
   `rm .pipeline/HALT` and the rekick rename `HALT` → `HALT.cleared`
   (`daemon-rekick.ts:HALT_CLEARED_MARKER`) — a rename emits `unlink` on the watched path.
3. **Watch is an optimization, never dispatch authority.** `isHalted()` plus the
   `inFlight`/`started`/`parked` sets remain the sole re-dispatch gate (`pickEligible`). A
   missed, duplicate, or spurious event can only cause one extra no-op loop iteration.
   Correctness never depends on an event arriving — where the watcher delivers nothing, the
   poll recovers. This preserves the ADR-001 keystone (no new dispatch paths; HALT semantics
   unchanged) and the PR #109 park/unpark model.
4. **Latched single-shot Waker racing the injected sleep.** A wake fired between waits is not
   lost (latch). The idle wait becomes `Promise.race([sleep(idlePollMs), waker.armed()])`; the
   injected `sleep` is still called once per idle cycle, so existing sleep/poll-count tests
   stay byte-identical. The default sleep timer is `.unref()`ed so a pending 60s fallback
   cannot delay process exit.
5. **Single 60s backstop timer serves both concerns.** `idle-poll` default rises 5 → 60s.
   Timeout arm = periodic full sweep (`discoverBacklog({refresh:true})` → `git fetch`, still
   the only way to find newly-merged specs). Wake arm = cheap local `refresh:false` scan — a
   halted feature is not "processed", so it is still in the backlog; **no network on unpark**.
6. **Escape hatch:** new `--no-watch` flag (`DaemonCommandOptions` → `DaemonModeOptions`).
   Event-hostile filesystems pair `--no-watch --idle-poll 5` to restore today's behavior.
7. **Transition-only, status-preserving logging.** Per-slug last status is logged only on
   change; idle backstop ticks emit nothing when nothing changed; fetch failure logs once on
   onset and once on recovery; re-dispatch logs a resume transition carrying prior progress
   (`↻ resume <slug> (was: <last step>)`) instead of a bare start.

## Watcher lifecycle

- Register after `parked.add(slug)`.
- Dispose after `parked.delete(slug)` on re-dispatch, **before** `runFeature` can tear the
  worktree down on `done`.
- Dispose all before `runDaemon` returns.
- Watcher errors are swallowed (best-effort); the poll backstop is the recovery path.

## Alternatives rejected

- **Native `fs.watch`:** zero new deps but re-inherits every cross-platform quirk chokidar
  exists to absorb (atomic-replace misses, `null` filenames, duplicate bursts); higher test
  burden for identical behavior.
- **Polling tune-down only:** fails the goal — either keeps the 5s waste or adds up to 60s of
  unpark latency with no fast path.

## Consequences

- `src/conductor` gains one runtime dependency (chokidar) and one CLI flag (`--no-watch`).
- New-spec discovery latency changes from ≤5s to ≤60s by default (merged specs are found by
  the backstop sweep). Operators wanting the old cadence set `--idle-poll 5`.
- On event-hostile filesystems HALT-clear latency is bounded by the backstop (≤60s) unless
  `--no-watch --idle-poll 5` is used.
- Documentation obligations: `README.md` + `src/conductor/README.md` (daemon lifecycle,
  `--no-watch`, new `idle-poll` semantics), CHANGELOG Added/Changed entries.
