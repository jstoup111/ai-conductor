# Implementation Plan: Daemon Event-Driven Wake for Parked (HALTED) Features

**Date:** 2026-07-04
**Design:** `.docs/decisions/adr-2026-07-04-event-driven-halt-clear-wake.md` (APPROVED);
architecture review `.docs/decisions/architecture-review-2026-07-04-daemon-event-driven-wake.md`
(APPROVED); diagram `.docs/architecture/daemon-event-driven-wake-for-parked-halted-feature.md`
**Stories:** `.docs/stories/daemon-event-driven-wake-for-parked-halted-feature.md` (Accepted)
**Conflict check:** Clean as of 2026-07-04 (one accepted degrading overlap: rekick base-advance
detection latency ≤60s)
**Source:** intake issue jstoup111/ai-conductor#111

## Summary

Replace the daemon's 5s idle-poll dependence with an event-driven HALT-clear wake (chokidar seam +
latched Waker racing the injected sleep), raise the poll to a 60s correctness backstop, add
`--no-watch`, and make idle logging transition-only and status-preserving. 18 tasks.

## Technical Approach

- **Waker** (`src/conductor/src/engine/waker.ts`, new): `createWaker()` → `{ wake(): void,
  armed(): Promise<void> }`. Latched single-shot: a `wake()` with no waiter is held and consumed
  by the next `armed()`; multiple wakes coalesce. Pure, no timers.
- **Core loop** (`src/conductor/src/engine/daemon.ts`): `DaemonDeps` gains optional
  `watchHaltCleared?: (slug: string, onCleared: () => void) => () => void` (pre-bound by the CLI,
  mirroring the `sweepMergeableLabels` binding pattern and the `isHalted?`/`sleep?` optionality).
  The idle wait (currently `await sleep(idlePollMs)` at the bottom of the empty-pool branch,
  `daemon.ts:394`) becomes `await Promise.race([sleep(idlePollMs), waker.armed()])` — `sleep` is
  still **called** once per idle cycle so existing sleep-count tests stay green. Track which arm
  resolved: a **wake-arm** iteration runs only the existing local `discoverBacklog({refresh:false})`
  scan (`daemon.ts:363`) and **skips** the `refresh:true` fallback branch (`daemon.ts:367`) — a
  cleared HALT is found locally (halted ≠ processed, still in backlog), and a spurious wake can
  never cause network I/O. A **timeout-arm** iteration behaves exactly as today (local scan →
  full `refresh:true` sweep + `maybeRekick` + label sweep).
- **Watcher lifecycle** (in `runDaemon`): register `watchHaltCleared(slug, () => waker.wake())`
  where a feature parks (`parked.add(slug)`, `daemon.ts:291` in `collectOne`); dispose in
  `dispatch()` where it un-parks (`parked.delete(item.slug)`, `daemon.ts:264`) — before
  `runFeature` can tear down the worktree; dispose all remaining before the final return.
  A `Map<slug, dispose>` guarantees at most one live watcher per slug.
- **Watcher impl** (`src/conductor/src/engine/daemon-deps.ts`):
  `watchHaltCleared(worktreeBase, slug, onCleared)` on
  `chokidar.watch(join(worktreeBase, slug, HALT_MARKER), { ignoreInitial: true })`, firing
  `onCleared` on `unlink` after re-verifying with the existing `exists` helper (`isHalted` is
  `daemon-deps.ts:204`). Covers operator `rm` and the rekick rename to `HALT.cleared`
  (`daemon-rekick.ts:34`) — both emit `unlink`. All watcher errors swallowed; dispose is
  idempotent and safe on a missing directory. Default (un-injected) `sleep` timer gets
  `.unref()` so a pending 60s wait never delays process exit.
- **CLI** (`daemon-command.ts`, `daemon-cli.ts`, `index.ts`): `--no-watch` → `watch: false`
  (default true) on `DaemonCommandOptions`/`DaemonModeOptions`; `--idle-poll` default 5 → 60
  (`intFlag(argv, '--idle-poll', 60)`); `daemon-cli` wires the pre-bound `watchHaltCleared`
  only when `watch !== false`. `index.ts` already spreads the command options.
- **Transition-only logging** (`daemon-cli.ts` + `daemon-backlog.ts`): a small per-slug
  last-status map in the CLI's log layer — emit per-feature lines only on change; never reset
  the map on idle cycles. Core `dispatch()` distinguishes resume (slug was in `parked`) from
  first start and emits `↻ resume <slug>` instead of `▶ start`; the CLI layer appends
  `(was: <last step>)` from its status map. Fetch/discovery failure logging becomes
  onset+recovery-only via a transition-aware logger passed into the discovery/refresh path in
  `daemon-backlog.ts` (`resolveDiscoveryRef` call site in `daemon-cli.ts`).

## Prerequisites

- `npm install` in `src/conductor` after adding chokidar (per-worktree install; run tests via
  `rtk proxy npx vitest run`).
- Do NOT rebuild the shared dist while other repos' daemons run (issue #215 hazard) — build
  only for verification, coordinate before merging.

## Tasks

### Task 1: Add chokidar dependency and build config
**Story:** infrastructure (ADR D1)
**Type:** infrastructure
**Steps:**
1. Add `chokidar` (prefer v4) to `src/conductor/package.json` dependencies; `npm install`.
2. If v3 (fsevents optional dep): add `external: ['fsevents']` to `tsup.config.ts`.
3. Verify: `npm run typecheck && npm run build` pass.
**Files likely touched:** `src/conductor/package.json`, `src/conductor/tsup.config.ts`
**Dependencies:** none

### Task 2: Waker latch module (RED)
**Story:** "Latched single-shot Waker" — all criteria
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests `src/conductor/test/waker.test.ts`: (a) `wake()` then `armed()` resolves
   immediately; (b) three `wake()`s then one `armed()` resolves once, next `armed()` blocks;
   (c) `armed()` without wake stays pending (assert via race with a resolved sentinel).
2. Verify RED.
**Files likely touched:** `src/conductor/test/waker.test.ts`
**Dependencies:** none

### Task 3: Waker latch module (GREEN)
**Story:** "Latched single-shot Waker"
**Type:** happy-path
**Steps:**
1. Implement `src/conductor/src/engine/waker.ts` (`createWaker`).
2. Verify Task 2 tests pass; commit.
**Files likely touched:** `src/conductor/src/engine/waker.ts`
**Dependencies:** Task 2

### Task 4: `watchHaltCleared` seam type on DaemonDeps
**Story:** "Event-driven re-dispatch on HALT clear" (seam)
**Type:** infrastructure
**Steps:**
1. Add optional `watchHaltCleared?: (slug: string, onCleared: () => void) => () => void` to
   `DaemonDeps` with JSDoc (optimization-never-authority contract, pre-bound by CLI).
2. Typecheck passes; no behavior change (all existing tests green).
**Files likely touched:** `src/conductor/src/engine/daemon.ts`
**Dependencies:** none

### Task 5: Wake re-dispatches a cleared feature without a sleep tick (RED)
**Story:** "Event-driven re-dispatch on HALT clear" — happy paths
**Type:** happy-path
**Steps:**
1. In `daemon.test.ts`: inject a fake `watchHaltCleared` capturing `onCleared` per slug, a
   controllable `isHalted`, and a `sleep` that returns a never-resolving promise once idle.
   Park a feature (runFeature → halted), flip `isHalted` to false, fire `onCleared`; assert
   the feature re-dispatches (runFeature called again) though `sleep` never resolved.
2. Verify RED.
**Files likely touched:** `src/conductor/test/daemon.test.ts`
**Dependencies:** Task 4

### Task 6: Race sleep vs waker + watcher registration on park (GREEN)
**Story:** "Event-driven re-dispatch on HALT clear"; "Watcher lifecycle" (register)
**Type:** happy-path
**Steps:**
1. In `runDaemon`: create a waker; on park (`parked.add`, both `collectOne` outcomes) register
   `watchHaltCleared(slug, () => waker.wake())` into a `Map<slug, dispose>` (skip if already
   registered); replace the idle wait with `await Promise.race([sleep(idlePollMs), waker.armed()])`.
2. Verify Task 5 green AND the full existing daemon.test.ts suite green (sleep still called
   once per idle cycle).
**Files likely touched:** `src/conductor/src/engine/daemon.ts`
**Dependencies:** Tasks 3, 4, 5

### Task 7: Wake-arm iteration is local-only (RED then GREEN)
**Story:** "Poll backstop and shared discovery timer" — wake arm no-network; spurious wake
**Type:** happy-path + negative-path
**Steps:**
1. Failing test: after a **spurious** wake (fire `onCleared` with `isHalted` still true, backlog
   unchanged), assert `discoverBacklog` was called with `{refresh:false}` only — never
   `{refresh:true}` — on that iteration, and no dispatch occurred, no throw.
2. Implement: record which race arm resolved; wake-arm iterations skip the
   `refresh:true` fallback branch (and its `maybeRekick`/sweep). Timeout-arm unchanged.
3. Verify green + existing refresh-behavior tests unchanged.
**Files likely touched:** `src/conductor/src/engine/daemon.ts`, `src/conductor/test/daemon.test.ts`
**Dependencies:** Task 6

### Task 8: Wake while still halted / while inFlight — no double dispatch (RED then GREEN)
**Story:** "Event-driven re-dispatch on HALT clear" — negative paths
**Type:** negative-path
**Steps:**
1. Failing tests: (a) wake with `isHalted(slug)` still true → zero new dispatches, slug stays
   parked; (b) wake for a slug already re-dispatched and `inFlight` → exactly one active run.
2. Verify these pass with the Task 6/7 implementation (pickEligible gate); if not, fix.
**Files likely touched:** `src/conductor/test/daemon.test.ts`
**Dependencies:** Task 7

### Task 9: Watcher disposal lifecycle (RED)
**Story:** "Watcher lifecycle" — dispose on re-dispatch, on exit, no accumulation
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests with a spy `watchHaltCleared` returning spy disposes: (a) re-dispatch of a
   cleared slug calls its dispose before `runFeature` resolves for it; (b) daemon return
   disposes all outstanding watchers; (c) park → unpark → park again yields exactly one live
   watcher (second registration only after first dispose).
2. Verify RED.
**Files likely touched:** `src/conductor/test/daemon.test.ts`
**Dependencies:** Task 6

### Task 10: Watcher disposal lifecycle (GREEN)
**Story:** "Watcher lifecycle"
**Type:** happy-path
**Steps:**
1. Dispose in `dispatch()` next to `parked.delete` (`daemon.ts:264` region); dispose-all before
   the final return; delete map entries on dispose.
2. Verify Task 9 green; commit.
**Files likely touched:** `src/conductor/src/engine/daemon.ts`
**Dependencies:** Task 9

### Task 11: `.unref()` the default sleep timer
**Story:** "Latched single-shot Waker" — process-exit negative path
**Type:** negative-path
**Steps:**
1. Change the default (un-injected) sleep to `setTimeout(...).unref()` form.
2. Test: `runDaemon` with real default sleep and `once:false`+`maxIdlePolls:0`-style exit (or a
   short-lived integration) returns without the process being held by a pending timer — assert
   via `process._getActiveHandles()`-free approach: simplest is a unit on the default-sleep
   helper (extracted) asserting the returned timer is unref'd.
3. Verify green; commit.
**Files likely touched:** `src/conductor/src/engine/daemon.ts`
**Dependencies:** Task 6

### Task 12: Real-fs `watchHaltCleared` in daemon-deps (RED then GREEN)
**Story:** "Watcher lifecycle" negative paths; "Event-driven re-dispatch" (rekick rename)
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests `daemon-deps.test.ts` (real fs via `mkdtemp`, generous-timeout async waits):
   (a) create then `rm` `.pipeline/HALT` → `onCleared` fires; (b) rename `HALT` →
   `HALT.cleared` → fires; (c) after `dispose()`, subsequent create/rm fires nothing;
   (d) non-existent worktree dir → returns no-op dispose, no throw; (e) `onCleared` NOT fired
   when HALT still exists (guard re-verification).
2. Implement `watchHaltCleared(worktreeBase, slug, onCleared)` with chokidar
   (`ignoreInitial:true`, `unlink` handler re-verifying via `exists`), errors swallowed.
3. Verify green; commit. (Real-binary/fs smoke per harness lesson — no injected-only coverage.)
**Files likely touched:** `src/conductor/src/engine/daemon-deps.ts`,
`src/conductor/test/daemon-deps.test.ts`
**Dependencies:** Task 1

### Task 13: `--no-watch` flag + `idle-poll` default 60 (RED then GREEN)
**Story:** "`--no-watch` flag and `idle-poll` default change" — parse criteria
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests in `daemon-command.test.ts`: default → `watch: true`, `idlePollSeconds: 60`;
   `--no-watch` → `watch: false`; existing invalid `--idle-poll` handling still applies
   (non-numeric falls back to default, no NaN).
2. Implement in `daemon-command.ts` (`DaemonCommandOptions.watch`, boolean flag parse,
   `intFlag(argv, '--idle-poll', 60)`, JSDoc "fallback interval").
3. Verify green; commit.
**Files likely touched:** `src/conductor/src/engine/daemon-command.ts`,
`src/conductor/test/daemon-command.test.ts`
**Dependencies:** none

### Task 14: Wire watcher + flag in daemon-cli
**Story:** "`--no-watch`" — wiring criterion; "Event-driven re-dispatch" (production path)
**Type:** infrastructure
**Steps:**
1. In `daemon-cli.ts` (next to the `isHalted` wiring): when `watch !== false`, pass
   `watchHaltCleared: (slug, onCleared) => watchHaltCleared(worktreeBase, slug, onCleared)`;
   thread `watch` through `DaemonModeOptions`.
2. Test: daemon-cli wiring test asserts dep present by default and absent with `watch:false`.
3. Verify green; commit.
**Files likely touched:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/index.ts` (only
if option threading requires), tests
**Dependencies:** Tasks 12, 13

### Task 15: No-watch unpark regression guard (RED if missing, else confirm)
**Story:** "`--no-watch`" negative path; "Poll backstop" event-hostile FS
**Type:** negative-path
**Steps:**
1. Test (pure core, no `watchHaltCleared` dep): parked feature + `isHalted` flips false →
   re-dispatched on the next poll tick (advance fake sleep once). This is today's behavior —
   assert it survives the refactor.
2. Verify green.
**Files likely touched:** `src/conductor/test/daemon.test.ts`
**Dependencies:** Task 7

### Task 16: Transition-only per-slug status logging + resume line (RED then GREEN)
**Story:** "Transition-only, status-preserving logging" — status criteria
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: (a) unchanged status across N idle ticks emits zero per-feature lines;
   (b) a genuine change IS emitted; (c) re-dispatch of a parked slug emits `↻ resume <slug>
   (was: <last step>)` not `▶ start`; (d) idle cycles never clear the status map.
2. Implement: core `dispatch()` emits resume when the slug was parked; CLI log layer keeps the
   per-slug last-status map and appends `(was: …)`; suppress unchanged repeats.
3. Verify green + existing log-assertion tests updated only where the line format changed.
**Files likely touched:** `src/conductor/src/engine/daemon.ts` (resume emit),
`src/conductor/src/daemon-cli.ts`, tests
**Dependencies:** Task 6

### Task 17: Fetch-failure onset/recovery logging (RED then GREEN)
**Story:** "Transition-only, status-preserving logging" — fetch criteria; "Poll backstop"
offline negative path
**Type:** negative-path
**Steps:**
1. Failing tests: consecutive failing refreshes log exactly one onset line; a subsequent
   success logs exactly one recovery line; daemon loop survives offline fetch (no crash).
2. Implement a transition-aware logger passed into the refresh/`resolveDiscoveryRef` path
   (`daemon-cli.ts` call site; `daemon-backlog.ts` accepts the logger).
3. Verify green; commit.
**Files likely touched:** `src/conductor/src/daemon-cli.ts`,
`src/conductor/src/engine/daemon-backlog.ts`, tests
**Dependencies:** Task 14

### Task 18: Docs, CHANGELOG, full verification
**Story:** "`--no-watch`" Done When (docs); repo gates
**Type:** infrastructure
**Steps:**
1. Update `README.md` + `src/conductor/README.md`: daemon lifecycle, `--no-watch`, `idle-poll`
   fallback semantics (default 60s), event-driven re-dispatch, `--no-watch --idle-poll 5`
   escape hatch, new-spec discovery latency note.
2. `CHANGELOG.md` `[Unreleased]`: Added — `--no-watch`, event-driven unpark; Changed —
   `idle-poll` default 5→60s, transition-only daemon logging.
3. Run: `cd src/conductor && npm run typecheck && rtk proxy npx vitest run && npm run build`;
   then `test/test_harness_integrity.sh`. All green.
**Files likely touched:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Tasks 1–17

## Task Dependency Graph

```
T1 ──────────────► T12 ──┐
T2 ► T3 ─┐               ├─► T14 ► T17 ─┐
T4 ─┬────┴► T6 ► T7 ► T8 │              ├─► T18
T5 ─┘        │       │   │              │
             ├► T9 ► T10 │  T15 ────────┤
             ├► T11      │  T16 ────────┘
T13 ─────────────────────┘
```
(T5 is the RED for T6; T6 additionally requires T3/T4. T15/T16 depend on T7/T6 respectively.)

## Integration Points

- After Task 10: full event-driven unpark works end-to-end in unit harness (fake watcher).
- After Task 14: production path complete — manual check: run daemon on a repo with a halted
  feature; `rm .pipeline/HALT` → re-dispatch ~1s; with `--no-watch` → ≤60s.
- After Task 17: log behavior verifiable by tailing `.daemon/daemon.log` offline.

## Coverage Mapping

| Story | Tasks |
|---|---|
| Event-driven re-dispatch on HALT clear | T4, T5, T6, T8, T12(b) |
| Latched single-shot Waker | T2, T3, T11 |
| Watcher lifecycle bound to park/unpark | T6 (register), T9, T10, T12(c,d) |
| Poll backstop and shared discovery timer | T7, T15, T17 |
| `--no-watch` flag and `idle-poll` default | T13, T14, T15, T18 |
| Transition-only, status-preserving logging | T16, T17 |

## Verification

- [ ] All happy path criteria covered by at least one task (mapping above)
- [ ] All negative path criteria covered by explicit tasks (T7, T8, T9, T11, T12, T15, T16, T17)
- [ ] No task exceeds ~5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] `cd src/conductor && npm run typecheck && npm test && npm run build` green
- [ ] `test/test_harness_integrity.sh` green
