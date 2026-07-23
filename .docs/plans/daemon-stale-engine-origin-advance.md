# Implementation Plan: daemon-stale-engine-origin-advance

**Date:** 2026-07-22
**Design:** `.docs/decisions/adr-2026-07-22-origin-refresh-before-engine-rebuild.md` (APPROVED); `.docs/architecture/2026-07-22-daemon-stale-engine-origin-advance.md`
**Stories:** `.docs/stories/daemon-stale-engine-origin-advance.md` (Accepted, TI-1…TI-6)
**Conflict check:** Clean as of 2026-07-22 (`.docs/conflicts/2026-07-22-daemon-stale-engine-origin-advance.md`)
**Tier:** M (`.docs/complexity/daemon-stale-engine-origin-advance.md`)

## Summary

Close the "merged ≠ loaded" engine gap: fast-forward the daemon's own checkout before the
quiescent-boundary rebuild so merged engine fixes self-deploy via the existing restart
transport, with throttled fetches, a source-SHA stamp per published engine version, and
loud deduped staleness warnings on every degraded path. 15 tasks.

## Technical Approach

- **Outcome-reporting fast-forward.** `fastForwardRoot` (`daemon-backlog.ts:149`) currently
  returns `void` and only logs its skip reasons. Extend it to return a structured outcome
  `{ status: 'advanced' | 'current' | 'skipped', cause?: 'no-origin' | 'unknown-default' |
  'not-default-branch' | 'dirty' | 'diverged' | 'fetch-failed', behindOrigin?: boolean,
  originHead?: string }` — backward compatible (all existing callers ignore the return
  value). This is the single source of truth TI-4's warnings key off; no second git probe.
- **New module `engine-refresh.ts`** (`src/conductor/src/engine/`): a throttle
  (injectable clock, config-derived min-interval) and a staleness-warning emitter (dedup
  per cause+originHead SHA, re-arms when originHead changes; message carries the cause
  token and the three reload commands). Pure logic, unit-testable without git.
- **Wiring** (`src/daemon-cli.ts`): a new injected dep `refreshEngineSource` built from
  throttle + `fastForwardRoot` + warning emitter, wired self-host-only alongside
  `rebuildEngine` (:1280). `daemon.ts`'s `rebuildAndMaybeRestartForStaleEngine` awaits it
  first, inside the existing `staleGatesArmed` + `inFlight.size === 0` guards; failures
  are non-fatal (same posture as rebuild failure). Restart trigger stays content-hash.
- **SHA stamp** (`scripts/publish-engine.mjs`): stamp `.engine-source-sha` next to
  `.engine-source-key` when a version finalizes; tolerant of `git rev-parse` failure;
  no churn on either skip path (content-unchanged :340, and #715's source-key cache hit —
  both return before finalize, so stamping only in the finalize path composes with #715
  regardless of merge order).
- **Advisory probe** (non-self-host or flag off — `staleGatesArmed` false): a separate
  quiescent-boundary branch in `daemon.ts` calls an injected `probeEngineStaleness` that,
  under the SAME throttle, fetches origin and compares the loaded engine's stamped SHA to
  `origin/<default>`; determinably behind → same warning emitter, cause
  `self-heal-disabled`. Unknown/no-origin/no-stamp → silence (fail-closed, no false nags).
- **Sequencing:** primitives first (outcome, config, throttle, emitter, stamp), then
  wiring (deps block, gate call, advisory probe), then integration test, boot-log
  surfacing, invariants verify-only, docs.

## Prerequisites

None — all machinery (publish store, checker, restart transport) exists; changes are
additive.

## Tasks

### Task 1: fastForwardRoot returns a structured outcome
**Story:** TI-1 HP1; TI-4 (cause detection for every degraded path)
**Type:** infrastructure

**Steps:**
1. Write failing tests: with a `GitRunner` override, `fastForwardRoot` returns
   `{status:'skipped', cause:'no-origin'}` (no origin remote), `{status:'skipped',
   cause:'not-default-branch'}`, `{status:'skipped', cause:'dirty', behindOrigin:true,
   originHead:<sha>}` (dirty tree, fetch succeeded, origin ahead), `{status:'skipped',
   cause:'diverged', ...}` (merge --ff-only fails), `{status:'skipped',
   cause:'fetch-failed'}`, `{status:'current'}` (up to date), `{status:'advanced',
   originHead:<sha>}` (ff applied).
2. Verify RED.
3. Implement: change the return type from `Promise<void>` to the outcome object; populate
   `behindOrigin`/`originHead` from `git rev-list --count HEAD..origin/<default>` /
   `git rev-parse origin/<default>` after a successful fetch; keep every existing guard,
   log line, and heal path byte-compatible.
4. Verify GREEN (including existing `daemon-backlog.test.ts` suite untouched-green).
5. Commit: "feat(engine): fastForwardRoot reports structured outcome"

**Files likely touched:**
- src/conductor/src/engine/daemon-backlog.ts — return type + outcome population
- src/conductor/test/engine/daemon-backlog.test.ts — outcome assertions

**Wired-into:** none (no new production surface) — return-value extension of an
already-wired function; new consumers arrive in Tasks 6–7.
**Dependencies:** none

### Task 2: Config key `engine_refresh_min_interval_seconds`
**Story:** TI-2 (default when unset; invalid values rejected/coerced)
**Type:** infrastructure

**Steps:**
1. Write failing tests: config validation accepts a positive number; coerces
   negative/non-numeric to the default (300); default applies when unset; value surfaces
   on the resolved config object.
2. Verify RED.
3. Implement: add the key beside `auto_restart_on_stale_engine` (config.ts:192 allowlist,
   validation block near :641), default 300 seconds, same coercion posture as existing
   numeric keys.
4. Verify GREEN.
5. Commit: "feat(config): engine_refresh_min_interval_seconds (default 300)"

**Files likely touched:**
- src/conductor/src/engine/config.ts — key + validation + default
- src/conductor/test/engine/daemon-backlog.test.ts — none; config tests live in the config suite
- src/conductor/test/config-validation.test.ts — validation cases (create if absent under src/conductor/test/)

**Wired-into:** src/conductor/src/daemon-cli.ts#dispatchDaemon (read once at startup,
passed into the deps block — Task 6)
**Dependencies:** none

### Task 3: Fetch throttle helper (engine-refresh.ts)
**Story:** TI-2 HP1/HP2, NP3 (delay never permanently suppresses)
**Type:** happy-path

**Steps:**
1. Write failing tests with an injectable clock: first call runs; second call inside the
   window skips (reports `throttled`); call after expiry runs; throttled skip produces no
   warning-emitter invocation.
2. Verify RED.
3. Implement: `createRefreshThrottle(minIntervalMs, now)` returning
   `shouldRun(): boolean` + `markRan()`; pure, no I/O.
4. Verify GREEN.
5. Commit: "feat(engine): refresh throttle for origin fetches"

**Files likely touched:**
- src/conductor/src/engine/engine-refresh.ts — new module (throttle)
- src/conductor/test/engine/engine-refresh.test.ts — new test file

**Wired-into:** src/conductor/src/daemon-cli.ts#dispatchDaemon (composed into
`refreshEngineSource`/`probeEngineStaleness`, Tasks 6 and 9)
**Dependencies:** none

### Task 4: Staleness warning emitter with cause+SHA dedup
**Story:** TI-4 HP1-3, NP1 (dedup), NP2 (re-arm on new SHA), NP4 (no warn when current)
**Type:** happy-path

**Steps:**
1. Write failing tests: emitter output contains the cause token and all three reload
   commands (`git pull --ff-only origin <default>`, `npm run build` in `src/conductor`,
   `conduct daemon restart`); same cause+originHead → emitted exactly once; new
   originHead → emitted again; distinct causes tracked independently.
2. Verify RED.
3. Implement: `createStalenessWarner(log)` with `warn(cause, originHead, defaultBranch)`;
   prominent prefix (e.g. `⚠️ [daemon] ENGINE STALE …`) consistent with existing daemon
   log style.
4. Verify GREEN.
5. Commit: "feat(engine): deduped loud staleness warnings"

**Files likely touched:**
- src/conductor/src/engine/engine-refresh.ts — warner
- src/conductor/test/engine/engine-refresh.test.ts — warner cases

**Wired-into:** same as Task 3
**Dependencies:** none

### Task 5: publish-engine stamps `.engine-source-sha` on finalize
**Story:** TI-3 HP1, NP1 (rev-parse failure tolerated), NP3 (skip-path no-churn)
**Type:** happy-path

**Steps:**
1. Write failing tests in the existing publish-engine suite (tsup test seam): a finalizing
   publish writes `.engine-source-sha` containing the source repo HEAD SHA next to
   `.engine-source-key`; a publish where `git rev-parse` fails still succeeds with no
   sidecar; the content-unchanged skip path leaves existing sidecars untouched.
2. Verify RED.
3. Implement: in the finalize path of `publish()` (after version rename, beside the
   `.engine-source-key` stamp), best-effort `git rev-parse HEAD` in the conductor
   package's repo; write sidecar only on success. No reads of this file anywhere in
   publish.
4. Verify GREEN (existing publish-engine tests untouched-green; composes with #715's
   source-key cache since both skip paths return before finalize).
5. Commit: "feat(publish-engine): stamp source commit SHA per published version"

**Files likely touched:**
- src/conductor/scripts/publish-engine.mjs — finalize-path stamp
- src/conductor/test/engine/publish-engine.test.ts — stamp/failure/no-churn cases

**Wired-into:** none (inert until src/conductor/src/daemon-cli.ts) — written by the
existing publish flow; first readers arrive in Tasks 8–9.
**Dependencies:** none

### Task 6: `refreshEngineSource` dep wired self-host-only
**Story:** TI-1 HP1 (refresh precedes rebuild), NP4 (non-self-host: no fetch via this
path); TI-2 (throttle applied); TI-4 HP1/HP2 (degraded outcomes → warner)
**Type:** happy-path

**Steps:**
1. Write failing wiring tests (pattern: existing `daemon-deps`/`daemon-cli-*-wiring`
   suites): with `isSelfHost:true` the deps block carries a `refreshEngineSource` that
   (a) consults the throttle, (b) invokes `fastForwardRoot`, (c) routes outcome causes
   `dirty`/`diverged`/`fetch-failed` with `behindOrigin` knowledge into the warner;
   with `isSelfHost:false` the dep is `undefined`.
2. Verify RED.
3. Implement in `src/daemon-cli.ts` beside `rebuildEngine:` (:1280): compose
   throttle (Task 3, interval from Task 2 config) + `fastForwardRoot` (Task 1 outcome) +
   warner (Task 4).
4. Verify GREEN.
5. Commit: "feat(daemon): wire refreshEngineSource (self-host only)"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — deps block + config read
- src/conductor/test/engine/daemon-deps.test.ts — wiring assertions

**Wired-into:** src/conductor/src/engine/daemon.ts#rebuildAndMaybeRestartForStaleEngine
(Task 7 call site)
**Dependencies:** 1, 2, 3, 4

### Task 7: Quiescent gate calls refresh before rebuild (non-fatal)
**Story:** TI-1 HP1 (order), NP1 (never mid-build), NP2 (fetch failure non-fatal), NP3
(rebuild failure unchanged), NP5 (suppression unchanged)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing daemon-loop tests (existing fake-deps pattern): `refreshEngineSource` is
   awaited before `rebuildEngine` when `staleGatesArmed` and `inFlight.size === 0`; not
   called when a build is in flight; not called when gates unarmed; a throwing
   `refreshEngineSource` is logged and the flow continues into `rebuildEngine`/`check()`
   (no crash, no restart from the throw itself); suppression path still short-circuits.
2. Verify RED.
3. Implement in `rebuildAndMaybeRestartForStaleEngine` (`daemon.ts` ~:917): optional dep,
   try/catch mirroring the rebuild error posture.
4. Verify GREEN.
5. Commit: "feat(daemon): fast-forward source before quiescent engine rebuild"

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — gate body + DaemonDeps type
- src/conductor/test/engine/daemon-stale-respawn-e2e.test.ts — loop-level order/guard cases

**Wired-into:** same as Task 6 (call sites are the existing pre-dispatch :1045 and
drained-idle invocations of `rebuildAndMaybeRestartForStaleEngine`)
**Dependencies:** 6

### Task 8: Boot log reports loaded engine source SHA
**Story:** TI-3 HP1 (startup surface reports loaded engine's source SHA)
**Type:** happy-path

**Steps:**
1. Write failing test: daemon boot logging includes the loaded engine's stamped source SHA
   when the pinned version's `.engine-source-sha` exists, and `unknown` (no crash) when
   absent (pre-feature versions).
2. Verify RED.
3. Implement: read the sidecar for the resolved pinned `dist-versions/<id>` during boot
   identity capture in `src/daemon-cli.ts`; append to the existing engine-identity boot
   log line.
4. Verify GREEN.
5. Commit: "feat(daemon): boot log carries engine source SHA"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — boot log
- src/conductor/test/engine/daemon-cli-engine-entrypath.test.ts — boot log cases

**Wired-into:** src/conductor/src/daemon-cli.ts#dispatchDaemon (existing boot sequence)
**Dependencies:** 5

### Task 9: Advisory staleness probe when self-heal is disabled
**Story:** TI-4 HP3 (`self-heal-disabled` warning), NP3 (unknown/no-origin → silence),
NP4 (current → silence); TI-2 (shares the throttle — conflict-report note)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing tests: with `staleGatesArmed` false (non-self-host or flag off), the
   quiescent boundary invokes an injected `probeEngineStaleness` under the same throttle;
   probe with stamped SHA determinably behind fetched `origin/<default>` → warner fires
   with cause `self-heal-disabled`; missing stamp, fetch failure with no prior origin
   knowledge, or no origin remote → no warning; up-to-date → no warning.
2. Verify RED.
3. Implement: probe composed in `src/daemon-cli.ts` (fetch via GitRunner + ancestor check
   `git merge-base --is-ancestor <originHead> <stampedSha>`; stamped SHA read once at
   boot from Task 8's sidecar read); advisory branch added where the armed gate declines
   in `daemon.ts` — quiescent-only, never restarts, never rebuilds.
4. Verify GREEN.
5. Commit: "feat(daemon): advisory engine-staleness probe when self-heal disabled"

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — probe composition + wiring
- src/conductor/src/engine/daemon.ts — advisory branch call site
- src/conductor/test/engine/daemon-deps.test.ts — probe wiring + silence cases

**Wired-into:** src/conductor/src/engine/daemon.ts#rebuildAndMaybeRestartForStaleEngine
(advisory branch at the same quiescent boundary)
**Dependencies:** 3, 4, 5, 7

### Task 10: Integration test — merged fix propagates end to end
**Story:** TI-1 HP1/HP2 (behind-origin engine change → restart onto ≥ merge commit);
TI-1 HP3 (docs-only advance → no restart)
**Type:** happy-path

**Steps:**
1. Write failing integration test (existing e2e seams: temp git repo with origin, fake
   build command seam): behind-origin engine-source advance → quiescent boundary →
   ff outcome `advanced` → publish flips to a new version stamped with the merge SHA →
   checker `stale` → `requestRestart` invoked; docs-only advance → publish
   content-unchanged → no restart.
2. Verify RED.
3. Wire any missing test seams only (no production changes expected).
4. Verify GREEN.
5. Commit: "test(daemon): stale-engine origin-advance e2e propagation"

**Files likely touched:**
- src/conductor/test/engine/daemon-stale-respawn-e2e.test.ts — e2e scenarios

**Wired-into:** none (no new production surface)
**Dependencies:** 5, 7

### Task 11: Restart decision provably ignores the SHA stamp
**Story:** TI-3 NP2 + Done-When ("restart remains content-hash keyed"); TI-1 NP5
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Assert via test/grep evidence: no production read of `.engine-source-sha` exists in
   `engine-identity.ts`, `restart-intent.ts`, or the restart path of `daemon.ts`; the
   checker's inputs are unchanged (content hash only); suppression tests still green.
2. If already satisfied (expected), complete with an empty commit carrying
   `Task:` + `Evidence: skipped restart-path-unchanged-verified` trailers.

**Files likely touched:**
- none

**Wired-into:** none (no new production surface)
**Dependencies:** 5, 7, 9

### Task 12: Throttled-skip silence + dedup under repeated boundaries (loop-level)
**Story:** TI-2 HP1/NP3 (silent skip; delayed not suppressed); TI-4 NP1 (no spam across
boundaries)
**Type:** negative-path

**Steps:**
1. Write failing loop-level tests: repeated quiescent boundaries inside one throttle
   window → exactly one fetch and zero warnings from throttled skips; window expiry →
   next boundary fetches; persistent dirty condition across many boundaries → exactly one
   warning until originHead changes.
2. Verify RED (any failure indicates composition bugs between Tasks 3/4/6/7).
3. Fix composition if needed.
4. Verify GREEN.
5. Commit: "test(daemon): throttle silence and warning dedup across boundaries"

**Files likely touched:**
- src/conductor/test/engine/engine-refresh.test.ts — composed loop-level cases

**Wired-into:** none (no new production surface)
**Dependencies:** 7, 9

### Task 13: Docs — daemon-operations + conductor README
**Story:** TI-6 HP1/NP1 (pre-#598 rebuild-only wording corrected, not duplicated)
**Type:** infrastructure

**Steps:**
1. Update `docs/daemon-operations.md` (auto-restart section ~:414-428): fetch-before-
   rebuild step, degraded-path warning causes + reload runbook, advisory probe.
2. Update `src/conductor/README.md` (~:3653-3709): same, plus `.engine-source-sha`
   sidecar in the versioned-store description (~:2007).
3. Grep both docs for stale "rebuild is the only trigger"-style claims; correct in place.
4. Commit: "docs: daemon engine origin-refresh behavior"

**Files likely touched:**
- docs/daemon-operations.md — auto-restart section
- src/conductor/README.md — auto-restart + versioned store sections

**Wired-into:** none (no new production surface)
**Dependencies:** 7, 9

### Task 14: Docs — configuration.md + CHANGELOG
**Story:** TI-6 Done-When (throttle key documented; CHANGELOG entry)
**Type:** infrastructure

**Steps:**
1. Document `engine_refresh_min_interval_seconds` (default 300, validation/coercion) in
   `docs/configuration.md`.
2. Add CHANGELOG `## [Unreleased]` → Added entry (daemon self-refreshes engine from
   origin; loud staleness warnings; SHA stamp; throttle key).
3. Commit: "docs(config): engine_refresh_min_interval_seconds + changelog"

**Files likely touched:**
- docs/configuration.md — new key
- CHANGELOG.md — [Unreleased] Added

**Wired-into:** none (no new production surface)
**Dependencies:** 2

### Task 15: Full-suite verification pass
**Story:** all Done-When gates
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Run the conductor test suite + `test/test_harness_integrity.sh`; confirm green.
2. Complete with an empty commit (`Task:` + `Evidence: skipped full-suite-green`) if no
   fixes were needed.

**Files likely touched:**
- none

**Wired-into:** none (no new production surface)
**Dependencies:** 10, 11, 12, 13, 14

## Task Dependency Graph

```
1 (ff outcome) ──┐
2 (config key) ──┤
3 (throttle) ────┼──▶ 6 (wire refreshEngineSource) ──▶ 7 (gate calls refresh) ──▶ 10 (e2e)
4 (warner) ──────┘                                        │                        │
5 (SHA stamp) ──────────▶ 8 (boot log SHA)                │                        │
   │  └────────────────────────────────┐                  │                        │
   └──────────▶ 10, 11 ◀───────────────┴── 9 (advisory probe; deps 3,4,5,7) ◀─────┘
2 ──▶ 14 (config docs)          7,9 ──▶ 12 (silence/dedup), 13 (ops docs)
10,11,12,13,14 ──▶ 15 (full-suite verify)
```

Acyclic; Tasks 1–5 are independent starting points.

## Integration Points

- After Task 7: self-host self-heal chain testable end to end with fakes (refresh →
  rebuild → check → restart request).
- After Task 9: both armed and advisory quiescent branches complete; all TI-4 causes
  reachable.
- After Task 10: real-git e2e proof of intake #598's verifiable signal (loaded engine ≥
  merge commit).

## Coverage Mapping

- TI-1 HP1→T7+T10; HP2→T5+T8+T10; HP3→T10. NP1→T7; NP2→T7; NP3→T7; NP4→T6; NP5→T7+T11.
- TI-2 HP1→T3+T12; HP2→T3. NP-default→T2; NP-invalid→T2; NP-delay-not-suppress→T3+T12.
- TI-3 HP1→T5+T8. NP-rev-parse→T5; NP-pre-feature-version→T8; NP-skip-no-churn→T5.
  Restart-ignores-SHA→T11.
- TI-4 HP-dirty/diverged→T4+T6; HP-advisory→T9. NP-dedup→T4+T12; NP-re-arm→T4;
  NP-unknown-silence→T9; NP-current-silence→T9.
- TI-6 →T13+T14.

## Verification

- [ ] All happy path criteria covered by at least one task (mapping above)
- [ ] All negative path criteria covered by explicit tasks (mapping above)
- [ ] No task exceeds ~5 minutes of implementation work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries Files, Wired-into, Dependencies lines
