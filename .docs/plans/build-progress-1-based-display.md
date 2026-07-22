# Implementation Plan: Build progress display should be 1-based

Status: Accepted
Track: TECHNICAL
Tier: S
Stories: .docs/stories/build-progress-1-based-display.md
Complexity: .docs/complexity/build-progress-1-based-display.md

## Intent

Relabel the build-progress **position indicator** so an in-progress task renders
as a 1-based ordinal (`1/N` .. `N/N`), never `0/N`, and a completed build never
renders `N+1/N`. Display-layer only: the `build_progress` / `build_no_progress`
event payloads, the `BuildProgressWatcher` computation, stall detection,
`build_progress_halt` eligibility, and task-status semantics are untouched.

## Task Dependency Graph

```
T1 (helper: displayBuildPosition) ──┬─▶ T2 (daemon-cli render seams)
                                     ├─▶ T3 (create-renderer render seams)
                                     └─▶ T4 (helper unit tests)
T2 ──▶ T5 (daemon-render-progress test updates)
T3 ──▶ T6 (create-renderer-progress test updates)
T2, T3, T4, T5, T6 ──▶ T7 (CHANGELOG + docs)
T7 ──▶ T8 (harness integrity validation)
```

- T1 is the root (shared helper). T2/T3/T4 depend only on T1 and may proceed in
  parallel after it. T5 depends on T2; T6 depends on T3. T7 aggregates. T8 is the
  final gate.

---

## T1 — Add a pure `displayBuildPosition` helper

Add a small, pure, exported function that computes the 1-based display numerator
from the raw event fields, clamped to the total.

- Signature: `displayBuildPosition(resolved: number, total: number, hasCurrent: boolean): number`
- Body: `return Math.min(resolved + (hasCurrent ? 1 : 0), total);`
- The `hasCurrent` flag (not the raw `resolved`) drives the `+1`, so a terminal
  `resolved === total` with no in-progress task yields `N`, not `N+1`
  (Story 2.1). The `Math.min(..., total)` clamp is the defensive boundary guard
  (Story 2.1/2.2). When `total === 0` it returns `0` harmlessly.
- This helper is display-only and must NOT be imported by the watcher, stall
  detection, or halt-eligibility code.

**Files:**
- `src/conductor/src/engine/format-retry-line.ts` (add the export alongside the
  existing display formatters — do NOT modify `formatProgressDelta`; Story 2.4),
  OR a new sibling `src/conductor/src/engine/format-build-position.ts` if the
  builder prefers a dedicated module. Choose one; keep it a pure function with no
  I/O.

**Dependencies:** none (root task).

---

## T2 — Apply the transform at the daemon-cli render seams

Update `renderDaemonEvent` so both build kinds render the 1-based position via
`displayBuildPosition`, deriving `hasCurrent` locally. Do not mutate `event`.

- `build_progress` (currently line ~1722):
  `` `${dot} ${chalk.cyan('▶')} ${event.step} ${event.resolved}/${event.total}${task}${slug}` ``
  → replace `${event.resolved}/${event.total}` with
  `${displayBuildPosition(event.resolved, event.total, Boolean(event.currentTaskId || event.currentTaskName))}/${event.total}`.
- `build_no_progress` (currently line ~1730):
  `` `${event.step} quiet ${event.quietMinutes}m (${event.resolved}/${event.total})` ``
  → replace `${event.resolved}/${event.total}` with the same
  `displayBuildPosition(event.resolved, event.total, Boolean(event.currentTaskId))/${event.total}`
  (this kind carries only `currentTaskId`).
- Leave `build_stall` (`resolvedBefore → resolvedAfter`) and the `step_retry`
  `formatProgressDelta` line untouched — those are count deltas, not positions
  (Story 2.4).

**Files:**
- `src/conductor/src/daemon-cli.ts` (`renderDaemonEvent`, the `build_progress`
  and `build_no_progress` cases; add the import for the T1 helper).

**Dependencies:** T1.

---

## T3 — Apply the transform at the create-renderer seams

Mirror T2 in the interactive create renderer.

- `build_progress` (currently line ~216):
  `` `⠿ ${event.step} — progress ${event.resolved}/${event.total}${task}` ``
  → `progress ${displayBuildPosition(event.resolved, event.total, Boolean(event.currentTaskId || event.currentTaskName))}/${event.total}`.
- `build_no_progress` (currently line ~225):
  `` `⚠ ${event.step} — no progress for ${event.quietMinutes}m (${event.resolved}/${event.total})` ``
  → same `displayBuildPosition(..., Boolean(event.currentTaskId))/${event.total}`.

**Files:**
- `src/conductor/src/ui/create-renderer.ts` (the `build_progress` and
  `build_no_progress` cases; add the import for the T1 helper).

**Dependencies:** T1.

---

## T4 — Unit tests for `displayBuildPosition`

Test the helper directly across the boundary matrix:

- `(0, N, true) === 1` (first task in progress → 1-based).
- `(k, N, true) === k+1` for `0 < k < N`.
- `(N-1, N, true) === N` (last task in progress).
- `(N, N, false) === N` (all done → N/N, NOT N+1).
- `(N, N, true) === N` (clamp guard: never N+1 even in the impossible transient).
- `(k, N, false) === k` (no in-progress task → completed count, not count+1).
- `(0, 0, false) === 0` (empty/no-data).

**Files:**
- `src/conductor/test/format-build-position.test.ts` (new), or add a `describe`
  block to the existing `src/conductor/test/format-retry-line.test.ts` if T1
  colocated the helper there.

**Dependencies:** T1.

---

## T5 — Update daemon-render-progress tests to assert 1-based output

The existing `daemon-render-progress.test.ts` asserts the raw `resolved/total`
(e.g. `resolved:20, total:21, currentTaskId:'21'` expects `20/21`). Under the fix
that becomes `21/21`. Update these assertions and add boundary cases:

- `build_progress {resolved:20, total:21, currentTaskId:'21'}` → line contains
  `21/21` (was `20/21`).
- Add: `{resolved:0, total:18, currentTaskId:'1'}` → contains `1/18`, never
  `0/18` (Story 1.1).
- Add: `{resolved:18, total:18}` (no current) → contains `18/18`, never `19/18`
  (Story 2.1).
- Add: minimal `{resolved:5, total:21}` (no current) → contains `5/21` (Story
  2.2 — count, not incremented).
- `build_no_progress` with a `currentTaskId` → parenthetical is 1-based
  (Story 1.4).
- Assert (Story 2.3) the event object passed in is not mutated: its `resolved`
  still equals the input after rendering.

**Files:**
- `src/conductor/test/daemon-render-progress.test.ts`.

**Dependencies:** T2.

---

## T6 — Update create-renderer-progress tests to assert 1-based output

Mirror T5 for the interactive renderer test (which asserts `progress r/total`).

- Update the existing `build_progress` count assertion to the 1-based value.
- Add first-task (`1/N`), last-task (`N/N`), all-done (`N/N` not `N+1/N`), and
  no-current (`k/N`) cases, plus the `build_no_progress` 1-based parenthetical.

**Files:**
- `src/conductor/test/create-renderer-progress.test.ts`.

**Dependencies:** T3.

---

## T7 — CHANGELOG + documentation upkeep

- Add a `## [Unreleased] → Fixed` entry in `CHANGELOG.md`: build-progress display
  is now 1-based (first in-progress task shows `1/N`, completed build reads
  `N/N`); accounting/gate logic unchanged. (Do NOT bump `VERSION` — version is
  locked pre-v1; `[Unreleased]` only.)
- Grep `README.md` and `src/conductor/README.md` for any documented example of
  the `▶ build N/total` / `progress N/total` line; if present, update the example
  to the 1-based form. If neither documents the counter format, no README change
  is needed (note that in the PR body).
- No `## Migration` block: no `settings.json` schema, hook wiring, skill symlink,
  or `bin/conduct` CLI surface changes (display string only). If the self-host
  release gate's path classifier flags a breaking surface, this is internal-only
  → add a `.docs/release-waivers/build-progress-1-based-display.md` waiver in the
  same diff per CLAUDE.md; otherwise no waiver.

**Files:**
- `CHANGELOG.md`; possibly `README.md` and/or `src/conductor/README.md`;
  possibly `.docs/release-waivers/build-progress-1-based-display.md`.

**Dependencies:** T2, T3, T4, T5, T6.

---

## T8 — Validate harness integrity + full conductor test suite

- Run `test/test_harness_integrity.sh` and fix any failure before commit.
- Run the conductor package test suite (vitest) so T4/T5/T6 and all existing
  build-progress tests pass green.

**Files:** none (validation only).

**Dependencies:** T7.

---

## Out of scope (explicit)

- `BuildProgressWatcher` `resolved`/`total` computation and event emission —
  unchanged (accounting).
- `build_stall` `resolvedBefore → resolvedAfter` and `step_retry`
  `formatProgressDelta` (`X→Y tasks`) — count deltas, left 1-off-free by design
  and NOT 1-based (Story 2.4).
- `build_progress_halt` eligibility, quiet-episode state machine, task-status
  semantics — unchanged.
