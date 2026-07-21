# Implementation plan: status hides completed features unless an option is passed

Source issue: jstoup111/ai-conductor#241
Track: technical · Tier: S

## Summary

Make the daemon's startup inherited-state dashboard omit the completed (PROCESSED)
group by default, include it on the console only under a new `--completed`/`--all`
flag, and never write the completed set to `.daemon/daemon.log`. The one non-trivial
piece is splitting the tee'd emit at `daemon-cli.ts:1292` so the log sink always gets
the completed-excluding render.

## Design

- **`renderDashboard` gains an options param.** In
  `src/conductor/src/engine/daemon-dashboard.ts:461`, change the signature to
  `renderDashboard(state, opts?: { includeCompleted?: boolean }, priorityResolution?)`
  (or fold into an options object) and gate the PROCESSED push (lines 552–554) behind
  `opts?.includeCompleted`. Default (absent/false) omits the group.
- **Sink split at the emit.** In `src/conductor/src/daemon-cli.ts`, replace the single
  tee'd `log(...)` at line 1292 with two explicit writes:
  - Always write the completed-**excluding** render to the persisted log sink
    (`logSink.write`).
  - Write the completed-**including** render to the console (`console.log`) only when
    the new flag is set; otherwise write the same excluding render to the console.
  Reuse the existing sink handles inside the `log` closure region (`daemon-cli.ts:466-510`)
  rather than the combined `log()` helper for this one call.
- **New flag.** Add a boolean field (e.g. `showCompleted`) to `DaemonCommandOptions`
  (`src/conductor/src/engine/daemon-command.ts:14`) and parse `--completed`/`--all` in
  `detectDaemonCommand` (`daemon-command.ts:164`, mirroring an existing boolean flag
  such as `--continuous`). Thread it through `buildDaemonModeOptions`
  (`src/conductor/src/index.ts:143`) → `runDaemonMode` → the startup emit.
- **No change** to `conduct daemon status` (`daemon-observe-cli.ts`), which already does
  not render PROCESSED.

## Prerequisites

- None. All seams (`renderDashboard`, the startup emit, `DaemonCommandOptions`) exist.

## Tasks

### Task 1: Gate the PROCESSED group behind an option in `renderDashboard`
**Story:** Story 1
**Type:** happy-path
**Steps:**
1. In `daemon-dashboard.test.ts`, add a failing test: `renderDashboard(state)` (default) output does NOT contain `PROCESSED`; `renderDashboard(state, { includeCompleted: true })` DOES.
2. Verify RED.
3. Edit `renderDashboard` (`daemon-dashboard.ts:461`) to accept an `includeCompleted` option and wrap the PROCESSED push (lines 552–554) in `if (opts?.includeCompleted) { … }`. Preserve existing call sites (option absent → omit).
4. Verify GREEN.
**Files:** `src/conductor/src/engine/daemon-dashboard.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** none

### Task 2: Add and parse the `--completed`/`--all` flag
**Story:** Story 2a
**Type:** happy-path
**Steps:**
1. Add a failing test (in `src/conductor/test/engine/daemon-command.test.ts` if it exists, else co-locate with existing daemon-command coverage) asserting `detectDaemonCommand(['daemon','--completed'])` sets the new boolean field true and a plain invocation leaves it false/undefined.
2. Verify RED.
3. Add the boolean field to `DaemonCommandOptions` (`daemon-command.ts:14`) and parse the flag in `detectDaemonCommand` (`daemon-command.ts:164`, mirroring `--continuous`).
4. Verify GREEN.
**Files:** `src/conductor/src/engine/daemon-command.ts`
**Wired-into:** `src/conductor/src/index.ts#buildDaemonModeOptions`
**Dependencies:** none

### Task 3: Split the startup emit sink + thread the flag
**Story:** Story 2b + Story 3
**Type:** happy-path
**Steps:**
1. Add a failing test asserting: with the flag set, the console emit includes PROCESSED but the persisted log sink render does NOT; without the flag, neither includes PROCESSED. (Drive `runDaemonMode`/the startup-dashboard closure with fake console + logSink, or unit-test the emit helper if extracted.)
2. Verify RED.
3. Thread the flag from `DaemonCommandOptions` through `buildDaemonModeOptions` (`index.ts:143`) → `runDaemonMode` to the startup dashboard region. Replace the single tee'd `log(...)` at `daemon-cli.ts:1292` with: always `logSink.write(renderDashboard({...state, parked}))` (completed-excluding), and `console.log(renderDashboard({...state, parked}, { includeCompleted: flag }))` for the console.
4. Verify GREEN.
**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/index.ts`
**Wired-into:** `src/conductor/src/engine/daemon-dashboard.ts#renderDashboard`
**Dependencies:** 1, 2

### Task 4: Regression — active groups unchanged, log never leaks completed
**Story:** Story 1b + Story 3b
**Type:** negative-path
**Steps:**
1. Extend `daemon-dashboard.test.ts` to assert the active groups render identically to before for a fixed state; add an emit-level assertion that the log sink content never contains `PROCESSED` even when the console flag is set.
2. Verify GREEN against Tasks 1–3.
**Files:** `src/conductor/test/engine/daemon-dashboard.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 5: Docs
**Story:** Story 2
**Type:** docs
**Steps:**
1. Document the new flag in the inherited-state dashboard sections of `README.md` and `src/conductor/README.md` (default hides completed; flag shows them; daemon.log never shows them).
**Files:** `README.md`, `src/conductor/README.md`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 6: GREEN + full-suite check
**Story:** all
**Type:** verification
**Steps:**
1. Run `rtk proxy npx vitest run test/engine/daemon-dashboard.test.ts test/engine/daemon-command.test.ts` in `src/conductor` (each worktree needs its own `npm install`); run the broader daemon suite if quick.
2. Keep diffs minimal.
**Files:** none (verification-only, no production code changed)
**Wired-into:** none (no new production surface)
**Dependencies:** 4, 5

## Files likely touched

- `src/conductor/src/engine/daemon-dashboard.ts` — `renderDashboard` options param + PROCESSED gate.
- `src/conductor/src/daemon-cli.ts` — sink split at the startup emit (line 1292 region).
- `src/conductor/src/engine/daemon-command.ts` — `DaemonCommandOptions` field + flag parse.
- `src/conductor/src/index.ts` — thread the flag through `buildDaemonModeOptions`.
- `src/conductor/test/engine/daemon-dashboard.test.ts` — render + emit tests.
- `README.md`, `src/conductor/README.md` — flag docs.

## Verification

- [ ] Default status output omits the PROCESSED/completed group; active groups unchanged.
- [ ] `--completed`/`--all` includes PROCESSED on the console.
- [ ] `.daemon/daemon.log` never contains the completed set, with or without the flag.
- [ ] `conduct daemon status` behavior unchanged (never rendered PROCESSED).
- [ ] daemon-dashboard + daemon-command suites green; harness integrity suite green.

## Out of scope

- Any change to `conduct daemon status` (`daemon-observe-cli.ts`) output.
- The "show status once before starting new work" behavior (#242) — a separate,
  dependent enhancement about WHEN the dashboard is shown, not WHAT it contains.
- Changing which features count as processed/shipped.
