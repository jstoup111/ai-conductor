# Implementation Plan: Global dispatch circuit-breaker

Issue: jstoup111/ai-conductor#714. Tier: M. Track: technical.

Seam: `runDaemon` in `src/conductor/src/engine/daemon.ts` (count at
`collectOne`), tripping via `writeAutoPark` (`park-marker.ts`), config in
`src/conductor/src/engine/config.ts`, wiring in `src/conductor/src/daemon-cli.ts`.

All paths below are repo-relative. Follow TDD (RED → GREEN → COMMIT) per task.

## Task Dependency Graph

```
T1 (config defaults+validate+resolve)
      │
      ├────────────┐
      ▼            ▼
T2 (core: counter  T3 (core: DaemonDeps
    in collectOne)     fields + options)
      │            │
      └─────┬──────┘
            ▼
T4 (wire trip → writeAutoPark in daemon-cli)
            │
            ▼
T5 (wire madeForwardProgress + ceiling in daemon-cli)
            │
            ▼
T6 (dashboard/log reason surfacing)     T7 (docs: README + src README + CHANGELOG)
            │                                  │
            └──────────────┬───────────────────┘
                           ▼
              T8 (acceptance test: end-to-end trip + durability)
```

---

## T1 — Config block `circuit_breaker`

Add `CIRCUIT_BREAKER_DEFAULTS = { enabled: true, consecutive_failure_ceiling: 5 }`,
`validateCircuitBreakerBlock` (positive-integer ceiling; boolean enabled; unknown
key rejected — copy the `build_progress_halt` validator), and
`resolveCircuitBreakerBlock`. Register the block in the top-level config
validate/resolve switch (near the `build_progress_halt` registration ~line 200 /
745). No `max_retries` floor coupling (counts whole dispatches, not in-step
retries).

- **Files:** `src/conductor/src/engine/config.ts`,
  `src/conductor/src/types/config.ts` (type for the resolved block),
  `src/conductor/test/` (new `circuit-breaker-config.test.ts`).
- **Dependencies:** none.

## T2 — Pure core: consecutive-failure counter in `runDaemon`

In `daemon.ts`: add `const consecutiveFailures = new Map<string, number>()`
alongside `parked`/`started`. In `collectOne`, **after** the existing outcome
recording (`parked.add`, `onHaltWritten`): if breaker disabled → skip. Else
compute progress via injected `madeForwardProgress?.(slug)`; if `done` OR
progress → `consecutiveFailures.delete(slug)`; else increment; when the new value
`>= ceiling`, call `tripCircuitBreaker?.(slug, reason)` once and pin the entry at
the ceiling. `reason` = `circuit-breaker: <count> consecutive failed
dispatch/resume attempts — last: <outcome.reason ?? status>`.

- **Files:** `src/conductor/src/engine/daemon.ts`,
  `src/conductor/test/engine/daemon.test.ts` (or a new
  `daemon-circuit-breaker.test.ts`).
- **Dependencies:** T1 (ceiling value shape), T3 (dep fields) — implement T2/T3
  together; both edit `daemon.ts`.

## T3 — Core seam: `DaemonDeps` + `DaemonOptions` fields

Add to `DaemonDeps`: `tripCircuitBreaker?: (slug: string, reason: string) =>
Promise<void>` and `madeForwardProgress?: (slug: string) => Promise<boolean>`.
Add the resolved ceiling either as `DaemonDeps.consecutiveFailureCeiling?: number`
(mirrors `progressReKickDispatchCeiling`) plus a `circuitBreakerEnabled?: boolean`
(default true). Document each with the same rigor as neighbors. Pure-core default:
absent trip/progress deps ⇒ breaker inert (backward-compatible).

- **Files:** `src/conductor/src/engine/daemon.ts`.
- **Dependencies:** none structurally; co-implemented with T2.

## T4 — Wire the trip to `writeAutoPark`

In `daemon-cli.ts` `runDaemon({...})` deps, add
`tripCircuitBreaker: async (slug, reason) => { await writeAutoPark(projectRoot,
slug, reason); log(...); events.emit({type:'circuit_breaker_tripped', slug,
reason}); }`. Reuse the already-imported `writeAutoPark`
(`park-marker.js`)/`isOperatorParked`. Emit a distinct event type (add to the
events union) for observability.

- **Files:** `src/conductor/src/daemon-cli.ts`,
  `src/conductor/src/engine/park-marker.ts` (no change; import only),
  `src/conductor/src/types/events.ts` (new `circuit_breaker_tripped` event),
  `src/conductor/test/engine/` (wiring test asserting the marker is written).
- **Dependencies:** T2, T3.

## T5 — Wire `madeForwardProgress` + ceiling from config

In `daemon-cli.ts`, thread `config.circuit_breaker.consecutive_failure_ceiling`
and `.enabled` into the `runDaemon` call. Wire `madeForwardProgress(slug)` to the
same resolved-task-count-delta signal the existing progress-gated re-kick uses
(reuse the TaskEvidence sidecar read behind `buildProgressReKickDeps` /
`isProgressReKickEligible` — extract a shared "did resolved-task count advance
since last dispatch" helper if needed rather than duplicating the read).

- **Files:** `src/conductor/src/daemon-cli.ts`,
  possibly `src/conductor/src/engine/task-evidence.ts` /
  `daemon-deps.ts` (shared progress-delta helper),
  `src/conductor/test/`.
- **Dependencies:** T4.

## T6 — Dashboard / log reason surfacing

Confirm the breaker park renders in the startup dashboard's auto-park section
with its reason (the extraction at `daemon-cli.ts` ~line 1306 already handles
`auto-parked:` bodies — verify the circuit-breaker reason string is surfaced
verbatim; add a test). Ensure the `collectOne` trip also logs a single
operator-facing line.

- **Files:** `src/conductor/src/daemon-cli.ts` (verify/extend),
  `src/conductor/test/` (dashboard-render assertion).
- **Dependencies:** T4.

## T7 — Documentation

- `README.md` and `src/conductor/README.md`: document the `circuit_breaker`
  config block (`enabled`, `consecutive_failure_ceiling`, default 5) and the
  daemon behavior (park after N consecutive failed dispatch/resume attempts).
- `CHANGELOG.md`: add an entry under `## [Unreleased]` → **Added** (new daemon
  safety bound + config). No VERSION bump (repo is version-locked pre-v1 per
  MEMORY).
- Note the new `settings.json`/config key is additive (no migration; default-on
  but bounded, no breaking change to existing configs).

- **Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`.
- **Dependencies:** T1 (final key names).

## T8 — Acceptance test: end-to-end trip + durability

Drive `runDaemon` (pure core, injected deps) with a `runFeature` that always
returns `error` with no progress; assert: (a) exactly `ceiling` attempts then a
trip call; (b) no further dispatch after trip; (c) `N-1` failures do **not**
trip; (d) an interleaved forward-progress dispatch resets the count; (e)
`enabled:false` never trips. Add one higher-level test that the wired trip writes
`.daemon/parked/<slug>` and that a subsequent `pickEligible` excludes the slug.

- **Files:** `src/conductor/test/acceptance/` (new
  `daemon-dispatch-circuit-breaker.acceptance.test.ts`).
- **Dependencies:** T2, T3, T4, T5.

---

## Validation (this repo)

Before committing on the implementation branch, run
`test/test_harness_integrity.sh` and the conductor unit/acceptance suites
(`npm test` in `src/conductor`). Fix any failure before commit. Honor the
Changelog-on-every-PR gate (T7).

## Out of scope (documented in ADR / stories)

- Durable cross-restart *counter* (rejected — #286 hazard; the trip *marker* is
  durable, which is what closes the spin-across-restart hole).
- Exponential backoff (a hard park is required, not a slower loop).
- Fixing the specific `createWorktree` stale-cache bug (#681 owns that); the
  breaker is the error-class-agnostic backstop.
