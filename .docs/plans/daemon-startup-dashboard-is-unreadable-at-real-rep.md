# Implementation Plan: Daemon startup dashboard readable at real repo scale (#1332)

**Date:** 2026-10-24
**Design:** `.docs/architecture/daemon-startup-dashboard-is-unreadable-at-real-rep.md` (technical track, no PRD)
**Stories:** .docs/stories/daemon-startup-dashboard-is-unreadable-at-real-rep.md
**Conflict check:** Clean as of 2026-10-24 (`.docs/conflicts/2026-10-24-daemon-startup-dashboard-is-unreadable-at-real-rep.md`)
**Architecture review:** `.docs/decisions/architecture-review-2026-10-24-daemon-startup-dashboard-is-unreadable-at-real-rep.md` (APPROVED WITH CONDITIONS)

## Summary

This plan restructures the daemon's startup inherited-state dashboard. Changes:

- A first-line attention summary.
- Groups in actionable-first display order.
- A BLOCKED group.
- WAITING and GATED restored at startup.
- A compact console render: inert groups collapse, and rows are clipped to the terminal width.
- `daemon.log` keeps the full render.

It has 14 tasks.

## Technical Approach

- **One renderer, two modes.** `renderDashboard` in `src/conductor/src/engine/daemon-dashboard.ts`
  gains an options field `mode` (a closed string union of `full` and `compact`, default `full`) and
  a `rowBudget` number (default 80). Default `full` keeps every existing caller (golden suite, unit
  tests, `daemon status` helpers) on the full shape, changed only by the new attention line,
  display order, and BLOCKED group. Only the startup binding asks for `compact`.
- **Display order is not precedence.** The precedence filter sets keep their current form, extended
  by one rung. A slug lands in exactly one bucket in this order: PARKED, HALTED, IN-PROGRESS,
  RETAINED WORKTREES, PROCESSED, BLOCKED, GATED, WAITING, ELIGIBLE. The render then emits groups
  in a fixed display order: HALTED, BLOCKED, GATED, IN-PROGRESS, WAITING, ELIGIBLE, PARKED,
  RETAINED WORKTREES, NEVER-STARTED, PROCESSED. The amended `adr-2026-07-04-operator-park-marker`
  D5 and `adr-2026-07-03-owner-gate-gated-channel` D3 govern this split. Precedence is computed
  once, into a classification, before any line is emitted, so the attention line and both modes
  read the same membership.
- **Partitions reach startup from the same pass.** `WorkSource` (`src/conductor/src/engine/daemon-work-source.ts`)
  gains an optional `partitions?()` accessor. It follows the existing optional `snapshot?` method,
  which reads the adapter's per-pass `latestStates` and returns `undefined` before the first pass.
  `createStartupDashboardBinding` (`src/conductor/src/daemon-cli.ts`) captures the partitions at
  the moment it caches the first startup discovery result. Its dashboard `discover()` then returns
  `{ items, waiting, blocked, gated }` from that one pass. When no pass completed, it throws, and
  `scanInheritedState`'s existing catch marks discovery as unavailable.
- **Discovery availability is a closed state.** `InheritedState` gains `discovery`, a closed union
  of `complete` and `unavailable` (default `complete`). It is set to `unavailable` in the existing
  discovery-failure catch in `scanInheritedState`. On `unavailable`, the renderer prints
  `<GROUP>: unknown — discovery did not complete` for BLOCKED, WAITING, GATED, and ELIGIBLE, and
  the attention line gains `· discovery state unknown`.
- **Width.** A pure `resolveRowBudget({ isTTY, columns })` returns `columns` on a TTY, otherwise
  80, with a floor of 40. The binding resolves it from `process.stdout` through an injectable
  option. Compact clipping joins newlines with single spaces and clips free text with a trailing
  `…`. It never clips the `  • <slug>` prefix, the tier tag, or the step.
- **Sinks.** The binding's existing `writeDashboard(persisted, console)` call stays.
  `persisted` = full render; `console` = compact render, or the full render with
  `includeCompleted` when `showCompleted` (`--all`/`--completed`) is set.
- Sequencing: state and precedence (Tasks 1–2) come before rendering (Tasks 3–8). The work-source
  accessor and binding wiring (Tasks 9–10) follow. The golden and acceptance-test refresh (Task 11)
  and the cross-mode invariant (Task 12) come last.

## Prerequisites

- None. No package, schema, persisted format, or CLI flag is added (`--all`/`--completed` already
  parse to `showCompleted` in `src/conductor/src/engine/daemon-command.ts`).

## Tasks

### Task 1: Add the BLOCKED partition to the inherited state with one-bucket precedence
**Story:** Story 6 (happy 1–3), Story 5 (negative 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-dashboard.test.ts`: a `scanInheritedState` call whose injected `discover()` returns `{ items, waiting, blocked, gated }` exposes `state.blocked`; a slug that is blocked and eligible renders only under BLOCKED; a slug that is blocked and gated renders only under BLOCKED; a slug that is blocked and halted renders only under HALTED; a slug that is blocked and in the operator-parked list renders only under PARKED.
2. Verify RED.
3. Implement: widen the `discover` return type in `ScanInheritedStateDeps` with an optional `blocked: BlockedSpecItem[]`, and add `blocked?: BlockedSpecItem[]` to `InheritedState`. In `renderDashboard`'s precedence pass, filter blocked slugs out when they are in the parked, halted, in-progress, retained, or processed sets, then exclude surviving blocked slugs from GATED, WAITING, and ELIGIBLE.
4. Verify GREEN; commit.

**Done when:**
- [test] `scanInheritedState` copies the injected discovery `blocked` list into `state.blocked`, asserted by a scan test whose fake discover returns one blocked item.
- [test] `renderDashboard` places a slug present in both `blocked` and `eligible` only under BLOCKED, and one present in both `blocked` and `gated` only under BLOCKED, asserted by counting the slug's occurrences in the output (exactly 1) and its section.
- [test] `renderDashboard` places a slug present in `blocked` and `halted` only under HALTED, and one present in `blocked` and `parked` only under PARKED, asserted by section membership with a total occurrence count of 1.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — `InheritedState.blocked`, `ScanInheritedStateDeps.discover` type, precedence filter
- src/conductor/test/engine/daemon-dashboard.test.ts — new scan and render cases

**Dependencies:** none

### Task 2: Mark discovery unavailable when the startup scan's discovery fails
**Story:** Story 5 (negative 1)
**Type:** negative-path

**Steps:**
1. Write a failing test: `scanInheritedState` with a `discover()` that rejects resolves (does not throw) with `state.discovery === 'unavailable'`; with a resolving discover it yields `state.discovery === 'complete'`.
2. Verify RED.
3. Implement: add `discovery?: 'complete' | 'unavailable'` to `InheritedState`, and set it in the existing discovery try/catch of `scanInheritedState`. Leave the existing worktree-derived groups untouched.
4. Verify GREEN; commit.

**Done when:**
- [test] `scanInheritedState` resolves with `discovery: 'unavailable'` and does not throw when the injected discover rejects, asserted by a scan test with a rejecting fake.
- [test] `scanInheritedState` resolves with `discovery: 'complete'` when the injected discover resolves, asserted by the same test file's resolving case.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — `InheritedState.discovery`, discovery catch
- src/conductor/test/engine/daemon-dashboard.test.ts — rejecting and resolving discover cases

**Dependencies:** none

### Task 3: Render groups in actionable-first display order with the BLOCKED group
**Story:** Story 2 (all criteria), Story 5 (happy 1–3, negative 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-dashboard.test.ts`.
   - With one member in every group and `includeCompleted: true`, the header index order in the
     output is HALTED, BLOCKED, GATED, IN-PROGRESS, WAITING, ELIGIBLE, PARKED, RETAINED WORKTREES,
     NEVER-STARTED, PROCESSED, in both `mode: 'full'` and `mode: 'compact'`.
   - With no members: `HALTED (0)`, `GATED (0)` (when `gated` is defined) and `ELIGIBLE (0)`
     render, while WAITING, BLOCKED, RETAINED WORKTREES, and NEVER-STARTED headers are absent.
   - Full mode without `includeCompleted` lists no PROCESSED rows.
   - A blocked item `{ slug, reason: 'stories-not-approved', remedy }` renders under BLOCKED with
     its reason and remedy text.
   - A waiting item renders `blocked by jstoup111/ai-conductor#900`.
   - An `other-owner` gated item renders its reason, owner, and remedy under a non-zero GATED count.
2. Verify RED.
3. Implement: split `renderDashboard` into a classification pass (existing precedence sets, plus
   BLOCKED from Task 1) and an emit pass that writes groups in the display order above. Add a
   `blockedSpecLine` row (`  • <slug> — <reason> — <remedy>`) mirroring `gatedSpecLine`. Add
   `mode` to the options type, with default `'full'`. Keep each existing group's empty-header
   convention.
4. Verify GREEN; commit.

**Done when:**
- [test] `renderDashboard` emits group headers in the order HALTED, BLOCKED, GATED, IN-PROGRESS, WAITING, ELIGIBLE, PARKED, RETAINED WORKTREES, NEVER-STARTED, PROCESSED in both `full` and `compact` modes, asserted by comparing header line indexes on a one-member-per-group fixture.
- [test] `renderDashboard` emits `HALTED (0)`, `GATED (0)` and `ELIGIBLE (0)` and omits the WAITING, BLOCKED, RETAINED WORKTREES and NEVER-STARTED headers when those groups are empty, in both `full` and `compact` modes, with `HALTED (0)` the first group header after the attention line, asserted on an empty fixture with `gated: []`.
- [test] `renderDashboard` in `full` mode without `includeCompleted` lists no PROCESSED rows, asserted by the absence of a processed slug in the output.
- [test] `renderDashboard` renders a blocked item as a BLOCKED row containing the slug, `stories-not-approved` and its remedy text, a waiting item with `blocked by jstoup111/ai-conductor#900`, and an `other-owner` gated item with its reason, owner and remedy under `GATED (1)`.
- [test] `renderDashboard` renders a slug that is both parked and halted exactly once, under PARKED, while the PARKED header index is greater than the HALTED header index, in both `full` and `compact` modes.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — classification pass, display-order emit, `blockedSpecLine`, `mode` option
- src/conductor/test/engine/daemon-dashboard.test.ts — order, empty-header, BLOCKED/WAITING/GATED row cases

**Dependencies:** Task 1

### Task 4: Emit the attention line as the first content line
**Story:** Story 1 (happy 1–3, negative 1, negative 3)
**Type:** happy-path

**Steps:**
1. Write failing tests.
   - A fixture of 2 halted, 1 blocked, and 55 parked rows (2 annotated `orphan`) yields
     `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review` as output line index 1, in both modes.
   - An all-inert fixture (55 unannotated parked, 30 retained `pr-open-awaiting-main`) yields
     `NEEDS YOU: nothing`.
   - A fixture with only a `kind: 'repo'` `identity-unresolved` gated warning yields
     `NEEDS YOU: 1 gated`.
2. Verify RED.
3. Implement: after classification, count the actionable categories in order: halted, blocked,
   gated (spec and repo entries), parked need review (`orphan` or `merged-ready`), and retained
   need action (reason other than `pr-open-awaiting-main`). Join the non-zero ones with ` · `, or
   use `nothing`. Emit the line directly after the opening rule in both modes.
4. Verify GREEN; commit.

**Done when:**
- [test] `renderDashboard` output line index 1 equals `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review` for the 2-halted/1-blocked/2-orphan fixture in both `full` and `compact` modes.
- [test] `renderDashboard` output line index 1 equals `NEEDS YOU: nothing` for a fixture of 55 unannotated parked rows and 30 retained rows whose reason is `pr-open-awaiting-main`.
- [test] `renderDashboard` output line index 1 equals `NEEDS YOU: 1 gated` for a fixture whose only actionable entry is a `kind: 'repo'` `identity-unresolved` gated warning, so a repo warning counts as one gated entry.
- [test] `renderDashboard` lists attention categories in the order halted, blocked, gated, parked need review, retained need action and omits zero-count categories, asserted on a fixture with every category non-zero and one with only retained need action.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — attention-line computation and emit
- src/conductor/test/engine/daemon-dashboard.test.ts — attention-line cases

**Dependencies:** Task 3

### Task 5: Render discovery-unknown lines and the attention suffix
**Story:** Story 5 (negative 1), Story 1 (negative 2)
**Type:** negative-path

**Steps:**
1. Write a failing test: `renderDashboard` with `discovery: 'unavailable'` and otherwise empty
   discovery partitions emits these four lines in place of their counts:
   - `BLOCKED: unknown — discovery did not complete`
   - `GATED: unknown — discovery did not complete`
   - `WAITING: unknown — discovery did not complete`
   - `ELIGIBLE: unknown — discovery did not complete`

   Its attention line ends with `· discovery state unknown` and does not contain `nothing`.
2. Verify RED.
3. Implement: in the emit pass, when `state.discovery === 'unavailable'`, replace each of the four
   discovery groups with its unknown line. In the attention line, append `· discovery state unknown`,
   writing `NEEDS YOU: no known items · discovery state unknown` when no other category is
   non-zero, so the line always ends in `· discovery state unknown` and never contains `nothing`.
4. Verify GREEN; commit.

**Done when:**
- [test] `renderDashboard` with `discovery: 'unavailable'` emits exactly the four lines `BLOCKED: unknown — discovery did not complete`, `GATED: unknown — discovery did not complete`, `WAITING: unknown — discovery did not complete` and `ELIGIBLE: unknown — discovery did not complete` and no `ELIGIBLE (` or `GATED (` header.
- [test] `renderDashboard` with `discovery: 'unavailable'` emits an attention line ending in `· discovery state unknown` that does not contain `nothing`, asserted on a fixture with no actionable rows.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — unavailable branch in emit and attention line
- src/conductor/test/engine/daemon-dashboard.test.ts — unavailable render case

**Dependencies:** Tasks 2, 4

### Task 6: Resolve the console row budget
**Story:** Story 4 (negative 2, negative 3, happy 2)
**Type:** infrastructure

**Steps:**
1. Write a failing unit test for the exported pure `resolveRowBudget({ isTTY, columns })`:
   - `{ isTTY: false, columns: 200 }` returns 80.
   - `{ isTTY: true, columns: 20 }` returns 40.
   - `{ isTTY: true, columns: 120 }` returns 120.
   - `{ isTTY: true, columns: undefined }` returns 80.
2. Verify RED.
3. Implement `resolveRowBudget` in `daemon-dashboard.ts`, exported for the binding.
4. Verify GREEN; commit.

**Done when:**
- [test] `resolveRowBudget` returns 80 for a non-TTY stream even when it reports 200 columns, and 80 for a TTY with undefined columns.
- [test] `resolveRowBudget` returns 40 for a TTY reporting 20 columns and 120 for a TTY reporting 120 columns.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — `resolveRowBudget`
- src/conductor/test/engine/daemon-dashboard.test.ts — budget resolver cases

**Dependencies:** none

### Task 7: Collapse inert groups in compact mode, keeping remedy-bearing rows
**Story:** Story 3 (all criteria), Story 6 (negative 2)
**Type:** happy-path

**Steps:**
1. Write failing tests on the 55-parked/30-retained fixture.
   - Compact mode renders `PARKED (55)` with no member rows when none is annotated.
   - With 2 `orphan` rows it renders `PARKED (55) — 2 need review` followed by exactly those two
     rows.
   - It renders `RETAINED WORKTREES (30) — 1 needs action` followed by exactly the
     `pr-closed-unmerged` row.
   - It renders `PROCESSED (12)` with no member rows, and `NEVER-STARTED (4)` with no member rows.
   - The full mode of the same fixture lists all 55 parked and 30 retained slugs.
   - The compact output for 55 parked, 30 retained, 2 halted, 4 in progress, and 2 eligible has
     30 lines or fewer at budget 80.
   - A slug that is retained and blocked is counted in `RETAINED WORKTREES (n)` and does not
     appear under BLOCKED.
2. Verify RED.
3. Implement: in compact mode, PARKED, RETAINED WORKTREES, NEVER-STARTED, and PROCESSED emit one
   count line. The ` — N need review` suffix (PARKED) or ` — N needs action` suffix (RETAINED,
   always `needs` per the story text) is added only when N > 0, followed by only the
   remedy-bearing rows. In compact mode, PROCESSED renders its count line even without
   `includeCompleted`. Full mode keeps every row.
4. Verify GREEN; commit.

**Done when:**
- [test] `renderDashboard` in `compact` mode renders exactly one PARKED line `PARKED (55)` with no member rows for 55 unannotated parked entries.
- [test] `renderDashboard` in `compact` mode renders `PARKED (55) — 2 need review` followed by exactly the 2 `orphan`/`merged-ready` rows, and `RETAINED WORKTREES (30) — 1 needs action` followed by exactly the `pr-closed-unmerged` row.
- [test] `renderDashboard` in `compact` mode renders `PROCESSED (12)` and `NEVER-STARTED (4)` as single lines with no member rows, while `full` mode of the same fixture lists all 55 parked slugs and all 30 retained slugs, each parked and retained row line byte-identical to the row line the pre-change `renderDashboard` emitted for the same entry.
- [test] `renderDashboard` in `compact` mode at `rowBudget: 80` returns at most 30 lines for the fixture of 55 parked, 30 retained, 2 halted, 4 in-progress and 2 eligible features.
- [test] `renderDashboard` in `compact` mode counts a slug that is both retained and blocked in `RETAINED WORKTREES (n)` and never prints it under BLOCKED.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — compact inert-group emit
- src/conductor/test/engine/daemon-dashboard.test.ts — compact collapse cases

**Dependencies:** Task 3

### Task 8: Clip compact rows to the budget without clipping slugs
**Story:** Story 4 (happy 1, happy 3, happy 4, negative 1, negative 4, negative 5), Story 7 (negative 1)
**Type:** happy-path

**Steps:**
1. Write failing tests.
   - Budget 80, halted row with a 280-character reason: a slug line `  • <slug> [<tier>] @<step>`,
     then one indented detail line starting with the reason, ending with `…`, of length exactly 80.
   - BLOCKED, GATED, and remedy-bearing PARKED and RETAINED rows each render a slug line plus one
     indented detail line: reason, then remedy, clipped to the budget.
   - IN-PROGRESS, WAITING, and ELIGIBLE rows each render one line, at most the budget, with the
     slug and tier intact.
   - Budget 40 with a 50-character slug: the slug line contains the full slug.
   - A reason containing `\n` yields a detail line with no newline (joined with one space).
   - A short reason yields a detail line with no trailing `…` and no padding.
   - Full mode with a 328-character reason prints it complete with no `…`.
   - At budgets 40, 80, and 120, every member-row line other than a slug line is at most the
     budget. Chrome lines (rules, attention, headers, metrics) are Task 13's.
2. Verify RED.
3. Implement a private `clipToBudget(text, budget)`:
   - It collapses each run of newline characters to a single space.
   - It leaves text unchanged if it already fits.
   - Otherwise it cuts to `budget - 1` characters and appends `…`.

   In compact mode, actionable and remedy-bearing rows render `  • <slug><tier><step><child>` plus
   `      <detail>` clipped. Active rows render one line: an unclippable `  • <slug><tier>` prefix
   plus a clipped remainder. Full mode never calls `clipToBudget`.
4. Verify GREEN; commit.

**Done when:**
- [test] `renderDashboard` in `compact` mode at `rowBudget: 80` renders a halted row with a 280-character reason as the slug line `  • <slug> [<tier>] @<step>` followed by one indented detail line that starts with the reason, ends with `…` and has length exactly 80.
- [test] `renderDashboard` in `compact` mode renders BLOCKED, GATED and remedy-bearing inert rows as a slug line plus one indented detail line containing the reason before the remedy and at most the row budget at budget 80, and renders IN-PROGRESS, WAITING and ELIGIBLE rows as one line each with slug and tier intact whose length is at most the row budget at budget 80.
- [test] `renderDashboard` in `compact` mode at budgets 40, 80 and 120 keeps every member-row line other than slug lines within the budget, keeps every member-row line including slug lines at most 120 characters at budget 120, and shows each 50-character slug in full on its slug line even at budget 40.
- [test] `clipToBudget` joins embedded newlines with single spaces so the detail line has no newline, and returns text that already fits unchanged with no trailing `…` and no padding.
- [test] `renderDashboard` in `full` mode prints a 328-character halt reason complete, with no `…`, asserted by substring match on the full reason.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — `clipToBudget`, compact row shapes
- src/conductor/test/engine/daemon-dashboard.test.ts — width and clipping cases

**Dependencies:** Tasks 6, 7

### Task 9: Expose the last pass's partitions from the local work source
**Story:** Story 5 (happy 4)
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/daemon-work-source.test.ts` (or its existing
   work-source test file):
   - Before any `discover()`, `localWorkSource(deps).partitions?.()` returns `undefined`.
   - After one `discover()` whose injected `discoverBacklog` returned one waiting, one blocked, and
     one gated item, it returns those three lists.
   - It never calls `discoverBacklog` itself.
2. Verify RED.
3. Implement an optional `partitions?(): { waiting; blocked; gated } | undefined` on `WorkSource`,
   returning copies of `latestStates`. Follow the existing `snapshot?` method: it is optional on the
   interface, reads only `latestStates`, returns `undefined` before the first pass, and never
   triggers discovery. The name and its parked-filter placement may vary. Search hints: `WorkSource`,
   `localWorkSource`, `latestStates`, `snapshot`.
4. Verify GREEN; commit.

**Done when:**
- [test] `localWorkSource(...).partitions()` returns `undefined` before the first `discover()` and returns the waiting, blocked and gated lists of the most recent pass after one `discover()`.
- [test] `localWorkSource(...).partitions()` does not invoke the injected `discoverBacklog`, asserted by its call count staying at 1 after one `discover()` and two `partitions()` calls.

**Files likely touched:**
- src/conductor/src/engine/daemon-work-source.ts — `WorkSource.partitions?`, `localWorkSource.partitions`
- src/conductor/test/engine/daemon-work-source.test.ts — partitions cases

**Dependencies:** none

### Task 10: Wire partitions, render modes, and row budget into the startup dashboard binding
**Story:** Story 5 (happy 1–5, negative 1), Story 7 (happy 1, negatives 1–2), Story 4 (negative 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-cli-startup-dashboard-wiring.test.ts`
   against `createStartupDashboardBinding`. Each case injects a `discoverTick` fake, a
   `discoveryPartitions` fake, a `consoleStream` fake (`{ isTTY, columns }`), and a capturing
   `writeDashboard`.
   - After `discoverAndCacheStartup`, `renderStartupDashboard(false)` produces a persisted argument
     containing the waiting, blocked, and gated slugs under WAITING, BLOCKED, and GATED.
   - The persisted argument is the full render: it includes all parked slugs.
   - The console argument is the compact render: it includes `PARKED (n)` without unannotated
     rows, and its lines respect the fake stream's budget.
   - `discoverTick` is called exactly once.
   - With no completed discovery pass (every `discoverTick` call rejected, or none made),
     `renderStartupDashboard` resolves, and both the persisted and console arguments carry the four
     `unknown — discovery did not complete` lines.
   - In `src/conductor/test/engine/daemon-dispatch-first.test.ts`, drive the real production order
     through `runDaemon`. Its `discoverBacklog` dependency is the binding's `discoverAndCacheStartup`
     over a `discoverTick` that rejects `{ refresh: true }` and resolves `{ refresh: false }` with
     one blocked item, and its `renderStartupDashboard` is the binding's. The persisted dashboard
     lists the blocked item under BLOCKED with no unknown line, and the step log records
     `resume-auth` and `halt-prs` after the dashboard.
2. Verify RED.
3. Implement in `src/conductor/src/daemon-cli.ts`:
   - Add `discoveryPartitions?: () => { waiting; blocked; gated } | undefined` and
     `consoleStream?: { isTTY?: boolean; columns?: number }` to `StartupDashboardBindingOptions`.
   - Capture `discoveryPartitions()` in `discoverAndCacheStartup` when the first successful result
     is cached; that is the local fallback pass when the origin-refresh pass failed (`runDaemon`
     retries with `refresh: false`).
   - The dashboard `discover` returns `{ items, waiting, blocked, gated }` from that capture, and
     throws when nothing was cached.
   - Call `renderDashboard(state, { mode: 'full' })` for persisted output.
   - For console output, call `renderDashboard(state, showCompleted ? { mode: 'full', includeCompleted: true } : { mode: 'compact', rowBudget: resolveRowBudget(consoleStream ?? process.stdout) })`.
   - At the production construction site, pass `discoveryPartitions: () => workSource.partitions?.()`.
4. Verify GREEN; commit.

**Done when:**
- [test] `createStartupDashboardBinding().renderStartupDashboard(false)` passes `writeDashboard` a persisted string listing the injected blocked slug with `stories-not-approved` and its remedy under BLOCKED, the waiting slug with `blocked by jstoup111/ai-conductor#900` under WAITING, and the `other-owner` gated slug with its reason, owner and remedy under `GATED (1)`.
- [test] `createStartupDashboardBinding` calls the injected `discoverTick` exactly once across `discoverAndCacheStartup` and `renderStartupDashboard`, and the rendered partitions are the ones captured when the first discovery result was cached.
- [test] `createStartupDashboardBinding` without `showCompleted` passes `writeDashboard` a persisted full render containing every one of 55 parked and 30 retained slugs and a 328-character halt reason complete with no `…`, and a console compact render whose non-slug lines fit the injected stream's resolved budget, with a non-TTY stream yielding budget 80.
- [test] `createStartupDashboardBinding` with no completed discovery pass resolves `renderStartupDashboard` without throwing and passes `writeDashboard` a persisted string and a console string that each contain `BLOCKED: unknown — discovery did not complete`, `GATED: unknown — discovery did not complete`, `WAITING: unknown — discovery did not complete` and `ELIGIBLE: unknown — discovery did not complete` each as a whole line exactly once, and no `BLOCKED (`, `GATED (`, `WAITING (` or `ELIGIBLE (` count header.
- [test] `runDaemon` whose `discoverBacklog` is the binding's `discoverAndCacheStartup` over a `discoverTick` that rejects `refresh: true` and resolves `refresh: false` with one blocked item renders a persisted dashboard listing that item under BLOCKED from the fallback pass with no `unknown — discovery did not complete` line, and its step log records `resume-auth` and `halt-prs` after the dashboard.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — binding options, partition capture, render-mode selection, production `discoveryPartitions` wiring
- src/conductor/test/engine/daemon-cli-startup-dashboard-wiring.test.ts — binding cases
- src/conductor/test/engine/daemon-dispatch-first.test.ts — origin-refresh failure with local fallback, maintenance continues

**Dependencies:** Tasks 5, 8, 9, 13

### Task 11: Refresh the dashboard golden fixtures and the PARKED precedence acceptance test
**Story:** Story 2 (happy 2)
**Type:** refactor

**Steps:**
1. Run `src/conductor/test/engine/n1-golden-renderings.test.ts` and confirm the dashboard goldens
   differ only by the attention line and display order. Re-record the five
   `src/conductor/test/fixtures/n1-golden/*-dashboard.golden` files through the test's existing
   `RECORD` path.
2. In `src/conductor/test/acceptance/operator-park-dashboard-precedence.acceptance.test.ts`, keep
   the single-group membership assertions. Replace any PARKED-first position assumption, including
   the file's header comment, with an assertion that the halted-and-parked slug appears exactly
   once, under PARKED. Cite `adr-2026-07-04-operator-park-marker` D5 (amended 2026-10-24).
3. Verify both files pass; commit.

**Done when:**
- [test] `n1-golden-renderings.test.ts` passes against re-recorded `*-dashboard.golden` fixtures whose diff from the prior fixtures consists only of the added `NEEDS YOU:` line and reordered group headers.
- [test] `operator-park-dashboard-precedence.acceptance.test.ts` asserts the halted-and-parked slug occurs exactly once in the rendered dashboard and inside the PARKED section, and contains no assertion that PARKED is the first group.

**Files likely touched:**
- src/conductor/test/fixtures/n1-golden/flag-off-unsliced-dashboard.golden — re-recorded
- src/conductor/test/fixtures/n1-golden/flag-off-sliced-dashboard.golden — re-recorded
- src/conductor/test/fixtures/n1-golden/flag-on-unsliced-dashboard.golden — re-recorded
- src/conductor/test/fixtures/n1-golden/flag-on-single-slice-dashboard.golden — re-recorded
- src/conductor/test/fixtures/n1-golden/flag-on-ineligible-dashboard.golden — re-recorded
- src/conductor/test/acceptance/operator-park-dashboard-precedence.acceptance.test.ts — membership assertion

**Dependencies:** Tasks 3, 4

### Task 12: Prove one bucket per slug across every partition in both modes
**Story:** Story 6 (happy 1–3, negative 1)
**Type:** negative-path

**Steps:**
1. Write a failing generated-fixture test in `src/conductor/test/engine/daemon-dashboard.test.ts`:
   - Use a seeded pseudo-random generator with a fixed seed. No new dependency.
   - Build 50 slugs, each placed in 2–4 of the partitions parked, halted, inProgress, retained,
     processed, blocked, gated, waiting, eligible.
   - Render in `full` mode with `includeCompleted: true`, and in `compact` mode.
   - For each slug, assert the winning group equals the highest-ranked partition in the chain
     PARKED, HALTED, IN-PROGRESS, RETAINED WORKTREES, PROCESSED, BLOCKED, GATED, WAITING, ELIGIBLE.
   - In full mode, assert the slug occurs exactly once.
   - In compact mode, assert it occurs at most once and only in its winning group, or is counted
     in that group's count line.
2. It is written after Tasks 1, 3, 7, so it passes. Prove it can fail by temporarily removing
   the BLOCKED precedence filter, confirming the test fails, then restoring it.
3. Commit.

**Done when:**
- [test] the generated-fixture test renders 50 slugs each placed in 2 to 4 partitions with a fixed seed and asserts, in `full` mode with `includeCompleted`, that every slug occurs exactly once and inside the group ranked highest by PARKED, HALTED, IN-PROGRESS, RETAINED WORKTREES, PROCESSED, BLOCKED, GATED, WAITING, ELIGIBLE.
- [test] the same generated-fixture test asserts, in `compact` mode, that every slug is either listed as a row only in its highest-ranked group or, when that group is a collapsed inert group, counted in that group's count line whose number equals the slugs assigned to it, and occurs in no other group.
- [test] the generated-fixture test includes the fixed cases blocked-and-eligible, blocked-and-gated and blocked-and-halted, and asserts in both `full` and `compact` modes that each such slug occurs exactly once, under BLOCKED, BLOCKED and HALTED respectively.

**Files likely touched:**
- src/conductor/test/engine/daemon-dashboard.test.ts — generated precedence test

**Dependencies:** Tasks 1, 3, 7

### Task 13: Fit compact chrome to the row budget
**Story:** Story 4 (happy 2, negative 6)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-dashboard.test.ts`.
   - In compact mode at budget 40, the opening and closing rules are exactly 40 characters.
   - Group headers, the `BUILD REVIEW` metric line and its sub-lines, `inapplicable` lines, and
     discovery-unknown lines are each at most 40 characters.
   - The attention line `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review` wraps at its
     ` · ` separators onto lines of at most 40 characters, which together contain every category.
     At budget 80 it stays on one line.
   - At budget 120, no line is longer than 120 characters.
   - In full mode, the rules stay 61 characters and metric lines are unclipped.
2. Verify RED.
3. Implement in `renderDashboard`'s compact emit:
   - Size both rules to `rowBudget`.
   - Route every non-slug line (headers, metrics, `inapplicable`, unknown lines) through
     `clipToBudget`.
   - Break the attention line into ` · `-separated chunks: greedily pack them onto lines of at most
     the budget, indent continuation lines two spaces, and never split or clip a category.

   Full mode is unchanged.
4. Verify GREEN; commit.

**Done when:**
- [test] `renderDashboard` in `compact` mode at `rowBudget: 40` emits opening and closing rules of exactly 40 characters and keeps every group header, `BUILD REVIEW` metric line, `inapplicable` line and discovery-unknown line at most 40 characters.
- [test] `renderDashboard` in `compact` mode at `rowBudget: 40` wraps `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review` at its ` · ` separators onto lines of at most 40 characters that together contain every category, and keeps it on one line at `rowBudget: 80`.
- [test] `renderDashboard` in `compact` mode at `rowBudget: 120` emits no line longer than 120 characters for a fixture with every group, metrics and a 328-character halt reason.
- [test] `renderDashboard` in `full` mode keeps both rules at 61 characters and the `BUILD REVIEW` metric line unclipped regardless of `rowBudget`.

**Files likely touched:**
- src/conductor/src/engine/daemon-dashboard.ts — compact chrome sizing and attention wrapping
- src/conductor/test/engine/daemon-dashboard.test.ts — chrome width cases

**Dependencies:** Tasks 5, 8

### Task 14: Map `--all` and `--completed` to the full console render
**Story:** Story 7 (happy 2, happy 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-cli-startup-dashboard-wiring.test.ts`:
   - `detectDaemonCommand` maps an argv with `--all` and one with `--completed` to
     `showCompleted: true`.
   - Feeding each parsed value into `createStartupDashboardBinding` yields the same console string:
     the full render including PROCESSED rows.
2. Verify RED (the binding half fails until Task 10's mode selection is in place).
3. Implement: no change to `detectDaemonCommand` is expected. Confirm that the binding's
   `showCompleted` branch selects `{ mode: 'full', includeCompleted: true }`, and fix it if not.
4. Verify GREEN; commit.

**Done when:**
- [test] `detectDaemonCommand` maps a daemon argv containing `--all` and one containing `--completed` each to `showCompleted: true`.
- [test] `createStartupDashboardBinding` given the value parsed from `--all` and the value parsed from `--completed` passes `writeDashboard` the identical console string in both cases: the full render including PROCESSED rows.

**Files likely touched:**
- src/conductor/test/engine/daemon-cli-startup-dashboard-wiring.test.ts — flag-mapping cases
- src/conductor/src/daemon-cli.ts — `showCompleted` render-mode branch, only if the test exposes a gap

**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 ─▶ Task 3 ─┬─▶ Task 4 ─┬─▶ Task 5 ─┬─▶ Task 13 ─▶ Task 10 ─▶ Task 14
                  │           └─▶ Task 11 │      ▲          ▲
                  └─▶ Task 7 ─▶ Task 8 ───┴──────┘          │
Task 2 ─▶ Task 5                                            │
Task 6 ─▶ Task 8                                            │
Task 9 ─────────────────────────────────────────────────────┘
Tasks 1, 3, 7 ─▶ Task 12
(Task 10 also depends directly on Tasks 5, 8, 9.)
```

## Integration Points

- After Task 8: `renderDashboard` produces both final shapes from a hand-built `InheritedState`.
- After Tasks 10 and 13: a daemon start writes the full render to `daemon.log` and the compact render to
  the console from the real `localWorkSource` pass. This is the cross-boundary integration owner
  for every Wiring Surface row in the architecture review.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given 2 halted features, 1 blocked spec, 0 gated entries, and 55 parked features of which 2 are annotated `orphan`, when the startup dashboard renders, then the line directly after the opening rule reads `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review`, listing only the non-zero categories in the order halted, blocked, gated, parked need review, retained need action. | 4 | "equals `NEEDS YOU: 2 halted · 1 blocked · 2 parked need review`" | diff-local |
| Story 1 happy: Given 0 halted, 0 blocked, 0 gated, and no remedy-bearing inert rows, when the startup dashboard renders, then the line directly after the opening rule reads `NEEDS YOU: nothing`. | 4 | "equals `NEEDS YOU: nothing`" | diff-local |
| Story 1 happy: Given any inherited state, when the startup dashboard renders, then the same attention line is the first content line of both the persisted `daemon.log` render and the console render. | 4 | "in both `full` and `compact` modes" | diff-local |
| Story 1 negative: Given 55 parked features none of which is annotated, and 30 retained worktrees all with reason `pr-open-awaiting-main`, when the startup dashboard renders, then the attention line reads `NEEDS YOU: nothing` and does not count parked or retained rows. | 4 | "equals `NEEDS YOU: nothing` for a fixture of 55 unannotated parked rows and 30 retained rows whose reason is `pr-open-awaiting-main`" | diff-local |
| Story 1 negative: Given the startup discovery partitions are unavailable (no discovery pass has completed), when the startup dashboard renders, then the attention line ends with `· discovery state unknown` and never reads `NEEDS YOU: nothing`. | 5 | "emits an attention line ending in `· discovery state unknown` that does not contain `nothing`" | diff-local |
| Story 1 negative: Given a GATED repo-scoped warning such as `identity-unresolved` with no slug, when the startup dashboard renders, then the attention line counts it under `gated` exactly as a per-spec gated entry is counted. | 4 | "so a repo warning counts as one gated entry" | diff-local |
| Story 2 happy: Given at least one member in every group, when either render runs, then group headers appear in the order HALTED, BLOCKED, GATED, IN-PROGRESS, WAITING, ELIGIBLE, PARKED, RETAINED WORKTREES, NEVER-STARTED, PROCESSED. | 3 | "emits group headers in the order HALTED, BLOCKED, GATED, IN-PROGRESS, WAITING, ELIGIBLE, PARKED, RETAINED WORKTREES, NEVER-STARTED, PROCESSED in both `full` and `compact` modes" | diff-local |
| Story 2 happy: Given a slug that is both parked and halted, when either render runs, then it appears once, under PARKED, even though PARKED renders after HALTED. | 3 | "renders a slug that is both parked and halted exactly once, under PARKED, while the PARKED header index is greater than the HALTED header index, in both `full` and `compact` modes" | diff-local |
| Story 2 negative: Given HALTED has 0 members, when either render runs, then the HALTED header still renders as `HALTED (0)` in its position, so the actionable block is never silently absent. | 3 | "emits `HALTED (0)`, `GATED (0)` and `ELIGIBLE (0)` and omits the WAITING, BLOCKED, RETAINED WORKTREES and NEVER-STARTED headers when those groups are empty, in both `full` and `compact` modes" | diff-local |
| Story 2 negative: Given WAITING, BLOCKED, RETAINED WORKTREES, or NEVER-STARTED has 0 members, when either render runs, then that group's header is omitted, matching today's empty-group convention for those groups. | 3 | "omits the WAITING, BLOCKED, RETAINED WORKTREES and NEVER-STARTED headers when those groups are empty, in both `full` and `compact` modes" | diff-local |
| Story 2 negative: Given discovery completed with 0 gated entries, when either render runs, then GATED renders its explicit empty header `GATED (0)`, and ELIGIBLE with 0 members renders `ELIGIBLE (0)`. | 3 | "emits `HALTED (0)`, `GATED (0)` and `ELIGIBLE (0)` and omits the WAITING, BLOCKED, RETAINED WORKTREES and NEVER-STARTED headers when those groups are empty, in both `full` and `compact` modes" | diff-local |
| Story 2 negative: Given PROCESSED rows exist and neither `--all` nor `--completed` is given, when the full render for `daemon.log` runs, then no PROCESSED rows are listed, matching today's persisted behavior. | 3 | "in `full` mode without `includeCompleted` lists no PROCESSED rows" | diff-local |
| Story 3 happy: Given 55 unannotated parked features, when the compact render runs, then PARKED renders as exactly one line, `PARKED (55)`, with no member rows. | 7 | "renders exactly one PARKED line `PARKED (55)` with no member rows for 55 unannotated parked entries" | diff-local |
| Story 3 happy: Given 55 parked features of which 2 are annotated `orphan` or `merged-ready`, when the compact render runs, then PARKED renders as `PARKED (55) — 2 need review` followed by exactly those 2 rows. | 7 | "renders `PARKED (55) — 2 need review` followed by exactly the 2 `orphan`/`merged-ready` rows" | diff-local |
| Story 3 happy: Given 30 retained worktrees of which 1 has reason `pr-closed-unmerged`, when the compact render runs, then RETAINED WORKTREES renders as `RETAINED WORKTREES (30) — 1 needs action` followed by exactly that row. | 7 | "`RETAINED WORKTREES (30) — 1 needs action` followed by exactly the `pr-closed-unmerged` row" | diff-local |
| Story 3 happy: Given 12 processed features, when the compact render runs, then PROCESSED renders as the single line `PROCESSED (12)` with no member rows. | 7 | "renders `PROCESSED (12)` and `NEVER-STARTED (4)` as single lines with no member rows" | diff-local |
| Story 3 negative: Given 4 never-started worktrees, when the compact render runs, then NEVER-STARTED renders as the single line `NEVER-STARTED (4)` with no member rows, because those rows carry no operator remedy. | 7 | "renders `PROCESSED (12)` and `NEVER-STARTED (4)` as single lines with no member rows" | diff-local |
| Story 3 negative: Given the same 55 parked and 30 retained features, when the full render for `daemon.log` runs, then every parked row and every retained row is listed, exactly as in today's dashboard. | 7 | "`full` mode of the same fixture lists all 55 parked slugs and all 30 retained slugs, each parked and retained row line byte-identical to the row line the pre-change `renderDashboard` emitted for the same entry" | diff-local |
| Story 3 negative: Given a fixture of 55 parked, 30 retained, 2 halted, 4 in progress, and 2 eligible features, when the compact render runs at an 80-column budget, then it contains at most 30 lines. | 7 | "at `rowBudget: 80` returns at most 30 lines" | diff-local |
| Story 4 happy: Given a row budget of 80 and a halted feature with a 280-character halt reason, when the compact render runs, then the row is a slug line `  • <slug> [<tier>] @<step>` followed by one indented detail line that starts with the halt reason, ends with `…`, and is exactly 80 characters long. | 8 | "renders a halted row with a 280-character reason as the slug line `  • <slug> [<tier>] @<step>` followed by one indented detail line that starts with the reason, ends with `…` and has length exactly 80" | diff-local |
| Story 4 happy: Given a row budget of 120, when the compact render runs, then no line is longer than 120 characters. | 8, 13 | "emits no line longer than 120 characters for a fixture with every group, metrics and a 328-character halt reason" | diff-local |
| Story 4 happy: Given a BLOCKED, GATED, or remedy-bearing inert row, when the compact render runs, then it renders as a slug line plus one indented detail line carrying its reason, then its remedy, clipped to the row budget. | 8 | "renders BLOCKED, GATED and remedy-bearing inert rows as a slug line plus one indented detail line containing the reason before the remedy" | diff-local |
| Story 4 happy: Given an IN-PROGRESS, WAITING, or ELIGIBLE row, when the compact render runs, then it renders as a single line clipped to the row budget, with the slug and tier intact. | 8 | "renders IN-PROGRESS, WAITING and ELIGIBLE rows as one line each with slug and tier intact whose length is at most the row budget at budget 80" | diff-local |
| Story 4 negative: Given a row budget of 40 and a 50-character slug, when the compact render runs, then the slug line contains the full 50-character slug, unclipped, even though that line exceeds the budget. | 8 | "shows each 50-character slug in full on its slug line even at budget 40" | diff-local |
| Story 4 negative: Given stdout is not a TTY, when the compact render runs, then the row budget is 80. | 6 | "returns 80 for a non-TTY stream" | diff-local |
| Story 4 negative: Given `process.stdout.columns` reports 20, when the compact render runs, then the row budget is 40. | 6 | "40 for a TTY reporting 20 columns" | diff-local |
| Story 4 negative: Given a halt reason or remedy that contains a newline, when the compact render runs, then the detail line contains no newline: the text is joined with single spaces before clipping. | 8 | "joins embedded newlines with single spaces so the detail line has no newline" | diff-local |
| Story 4 negative: Given a reason that already fits the budget, when the compact render runs, then the detail line is not padded and carries no trailing `…`. | 8 | "returns text that already fits unchanged with no trailing `…` and no padding" | diff-local |
| Story 4 negative: Given a row budget of 40, when the compact render runs, then the opening and closing rules are exactly 40 characters, every header, metric, and discovery-unknown line is at most 40 characters, and the attention line wraps at its ` · ` separators onto lines of at most 40 characters without dropping any category. | 13 | "emits opening and closing rules of exactly 40 characters and keeps every group header, `BUILD REVIEW` metric line, `inapplicable` line and discovery-unknown line at most 40 characters" | diff-local |
| Story 5 happy: Given startup discovery classified a merged spec as blocked with reason `stories-not-approved` and a remedy, when the startup dashboard renders, then a BLOCKED group lists that slug with `stories-not-approved` and the remedy text. | 10 | "the injected blocked slug with `stories-not-approved` and its remedy under BLOCKED" | diff-local |
| Story 5 happy: Given startup discovery classified a spec as waiting on an open blocker `jstoup111/ai-conductor#900`, when the startup dashboard renders, then a WAITING group lists that slug with `blocked by jstoup111/ai-conductor#900`. | 10 | "the waiting slug with `blocked by jstoup111/ai-conductor#900` under WAITING" | diff-local |
| Story 5 happy: Given startup discovery classified a spec as `other-owner` gated, when the startup dashboard renders, then the GATED group lists that slug with its reason, owner, and remedy, and the count is not `0`. | 10 | "the `other-owner` gated slug with its reason, owner and remedy under `GATED (1)`" | diff-local |
| Story 5 happy: Given startup discovery ran once, when the startup dashboard renders, then the eligible, waiting, blocked, and gated entries all come from that same discovery pass, and no second discovery pass runs. | 10 | "calls the injected `discoverTick` exactly once across `discoverAndCacheStartup` and `renderStartupDashboard`, and the rendered partitions are the ones captured when the first discovery result was cached" | diff-local |
| Story 5 happy: Given the startup origin-refresh discovery pass failed and the daemon's local fallback discovery pass succeeded with one blocked spec, when the startup dashboard renders, then BLOCKED lists that spec from the fallback pass, no `unknown — discovery did not complete` line renders, and the daemon's startup maintenance steps after the dashboard still run. | 10 | "renders a persisted dashboard listing that item under BLOCKED from the fallback pass with no `unknown — discovery did not complete` line, and its step log records `resume-auth` and `halt-prs` after the dashboard" | diff-local |
| Story 5 negative: Given no startup discovery pass has completed, when the startup dashboard renders, then BLOCKED, WAITING, GATED, and ELIGIBLE each render the single line `<GROUP>: unknown — discovery did not complete` instead of a count, and rendering completes without throwing. | 10 | "`createStartupDashboardBinding` with no completed discovery pass resolves `renderStartupDashboard` without throwing and passes `writeDashboard` a persisted string and a console string that each contain `BLOCKED: unknown — discovery did not complete`, `GATED: unknown — discovery did not complete`, `WAITING: unknown — discovery did not complete` and `ELIGIBLE: unknown — discovery did not complete` each as a whole line exactly once, and no `BLOCKED (`, `GATED (`, `WAITING (` or `ELIGIBLE (` count header." | diff-local |
| Story 5 negative: Given a blocked spec slug that is also operator-parked, when the startup dashboard renders, then the slug appears only under PARKED. | 1 | "one present in `blocked` and `parked` only under PARKED" | diff-local |
| Story 5 negative: Given discovery reports 0 blocked specs, when the startup dashboard renders, then no BLOCKED header renders, following the empty-group convention for WAITING. | 3 | "omits the WAITING, BLOCKED, RETAINED WORKTREES and NEVER-STARTED headers when those groups are empty, in both `full` and `compact` modes" | diff-local |
| Story 6 happy: Given a slug that is in both the blocked and the eligible partitions, when either render runs, then it appears only under BLOCKED. | 12 | "asserts in both `full` and `compact` modes that each such slug occurs exactly once, under BLOCKED, BLOCKED and HALTED respectively" | diff-local |
| Story 6 happy: Given a slug that is both blocked and gated, when either render runs, then it appears only under BLOCKED. | 12 | "asserts in both `full` and `compact` modes that each such slug occurs exactly once, under BLOCKED, BLOCKED and HALTED respectively" | diff-local |
| Story 6 happy: Given a slug that is blocked and also has a halted worktree, when either render runs, then it appears only under HALTED. | 12 | "asserts in both `full` and `compact` modes that each such slug occurs exactly once, under BLOCKED, BLOCKED and HALTED respectively" | diff-local |
| Story 6 negative: Given a randomized fixture in which every slug is placed in two to four partitions, when either render runs, then every slug appears in exactly one group, the one the precedence chain PARKED, HALTED, IN-PROGRESS, RETAINED WORKTREES, PROCESSED, BLOCKED, GATED, WAITING, ELIGIBLE ranks highest. | 12 | "counted in that group's count line whose number equals the slugs assigned to it, and occurs in no other group" | diff-local |
| Story 6 negative: Given a slug that is both retained and blocked, when the compact render collapses RETAINED WORKTREES to a count, then the slug is counted in RETAINED WORKTREES and does not reappear under BLOCKED. | 7 | "counts a slug that is both retained and blocked in `RETAINED WORKTREES (n)` and never prints it under BLOCKED" | diff-local |
| Story 7 happy: Given the daemon starts without `--all` or `--completed`, when the startup dashboard is written, then `daemon.log` receives the full render and the console receives the compact render. | 10 | "a persisted full render containing every one of 55 parked and 30 retained slugs" | diff-local |
| Story 7 happy: Given the daemon starts with `--all`, when the startup dashboard is written, then the console receives the full render including PROCESSED rows. | 14 | "given the value parsed from `--all` and the value parsed from `--completed` passes `writeDashboard` the identical console string in both cases: the full render including PROCESSED rows" | diff-local |
| Story 7 happy: Given the daemon starts with `--completed`, when the startup dashboard is written, then the console receives the same full render as with `--all`. | 14 | "passes `writeDashboard` the identical console string in both cases: the full render including PROCESSED rows" | diff-local |
| Story 7 negative: Given a 328-character halt reason, when the full render runs, then the complete reason text appears unclipped and without `…` in `daemon.log`. | 8, 10 | "a 328-character halt reason complete with no `…`, and a console compact render" | diff-local |
| Story 7 negative: Given 55 parked and 30 retained features and the compact render written to the console, when `daemon.log` is read, then it contains every one of the 55 parked and 30 retained slugs. | 10 | "a persisted full render containing every one of 55 parked and 30 retained slugs" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-04-operator-park-marker#D1 | existing | none | `writeOperatorPark`, `isOperatorParked`, and `removeOperatorPark` in `src/conductor/src/engine/park-marker.ts` implement the dedicated operator-owned marker file; this feature reads parked entries only through the existing `listOperatorParkedSlugs` enrichment in `createStartupDashboardBinding` |
| adr-2026-07-04-operator-park-marker#D2 | existing | none | `OPERATOR_PARKED_SUBDIR` and `resolveMainRepoRoot` in `src/conductor/src/engine/park-marker.ts` keep the store at the repo root; the dashboard changes no storage path |
| adr-2026-07-04-operator-park-marker#D3 | existing | none | `discoverBacklog` consults `isOperatorParked` before classification in `src/conductor/src/engine/daemon-backlog.ts`; this feature changes no autonomous decision path |
| adr-2026-07-04-operator-park-marker#D4 | existing | none | `isOperatorParked` in `src/conductor/src/engine/park-marker.ts` owns the fail direction; the dashboard only renders its result |
| adr-2026-07-04-operator-park-marker#D5 | task | task-3, task-12 | renders a slug that is both parked and halted exactly once, under PARKED, while the PARKED header index is greater than the HALTED header index |
| adr-2026-07-04-operator-park-marker#D6 | no-change | none | The canonical marker module `src/conductor/src/engine/park-marker.ts` is untouched; the dashboard keeps importing parked state through the binding's existing helpers |
| adr-2026-07-03-owner-gate-gated-channel#D1 | existing | none | `GatedItem` with per-spec and `kind: 'repo'` entries is already carried by `discoverBacklog` in `src/conductor/src/engine/daemon-backlog.ts` and rendered by `gatedSpecLine`/`gatedRepoLine` |
| adr-2026-07-03-owner-gate-gated-channel#D2 | existing | none | `discoverBacklog` already returns the `identity-unresolved` repo warning in `gated` (`IDENTITY_UNRESOLVED_WARN_KEY` path in `src/conductor/src/engine/daemon-backlog.ts`); Task 10 forwards that list unchanged |
| adr-2026-07-03-owner-gate-gated-channel#D3 | task | task-3, task-12 | emits group headers in the order HALTED, BLOCKED, GATED, IN-PROGRESS, WAITING, ELIGIBLE, PARKED, RETAINED WORKTREES, NEVER-STARTED, PROCESSED in both `full` and `compact` modes |
| adr-2026-07-03-owner-gate-gated-channel#D4 | no-change | none | The dashboard only renders `gated` entries; no gate decision or build outcome is computed or altered by any task in this plan |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions; plan review sweeps this at Medium tier
