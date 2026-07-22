# Stories: Build progress display should be 1-based

Status: Accepted
Track: TECHNICAL
Tier: S
Plan-stem: build-progress-1-based-display

## Story 1 — Operator sees a 1-based build-progress position

**As** an operator watching a running build in `.daemon/daemon.log` (and in the
interactive create renderer),
**I want** the build-progress counter to read as a 1-based ordinal of the task
being worked,
**so that** the first in-progress task shows `1/N` instead of the off-by-one
`0/N`, and the total is unchanged.

### Scenario 1.1 (happy) — first task in progress shows 1/N, not 0/N

- **Given** a build of `N` tasks (`total = N`, `N ≥ 1`) whose first task is
  `in_progress` and none are yet completed (`resolved = 0`, `currentTaskId` set),
- **When** a `build_progress` event is rendered to `daemon.log`
  (`renderDaemonEvent`) and to the interactive create renderer,
- **Then** the position reads `1/N` (never `0/N`), and the total shown is exactly
  `N`.

### Scenario 1.2 (happy) — mid-build position is 1-based

- **Given** a build where `k` tasks are completed and the `(k+1)`-th task is
  `in_progress` (`resolved = k`, `0 < k < N`, `currentTaskId` set),
- **When** the `build_progress` event is rendered,
- **Then** the position reads `(k+1)/N`.

### Scenario 1.3 (happy) — last task in progress shows N/N

- **Given** a build where the final task is `in_progress` (`resolved = N-1`,
  `currentTaskId` set),
- **When** the `build_progress` event is rendered,
- **Then** the position reads `N/N`.

### Scenario 1.4 (happy) — quiet-episode warning is also 1-based

- **Given** a `build_no_progress` (quiet) event for a build whose current task is
  `in_progress` (`resolved = r`, `currentTaskId` set, `quietMinutes` = m),
- **When** it is rendered to `daemon.log` and the create renderer,
- **Then** the parenthetical position reads `(r+1)/N` (consistent with the
  `build_progress` line), the `quietMinutes` value is unchanged, and the warning
  styling (glyph/color) is unchanged.

## Story 2 — Boundary correctness (no off-by-one at the ends)

**As** an operator,
**I want** the 1-based relabelling to be exact at the boundaries,
**so that** a fully completed build reads `N/N` and never `N+1/N`, and the change
alters only the displayed label — not accounting or gate behaviour.

### Scenario 2.1 (negative) — all tasks completed reads N/N, not N+1/N

- **Given** a build where every task is completed/skipped and none is in progress
  (`resolved = N`, no `currentTaskId`),
- **When** the `build_progress` event is rendered,
- **Then** the position reads `N/N` — never `N+1/N`.

### Scenario 2.2 (negative) — no in-progress task shows the completed count, not count+1

- **Given** a transient `build_progress` tick with `resolved = k` and no
  `currentTaskId`/`currentTaskName` (`0 ≤ k ≤ N`),
- **When** the event is rendered,
- **Then** the position reads `k/N` (the completed count is not incremented when
  no task is in progress), and the numerator never exceeds `N`.

### Scenario 2.3 (negative) — accounting/gate payload is untouched

- **Given** any `build_progress` / `build_no_progress` event,
- **When** the display transform is applied,
- **Then** the event object's `resolved` and `total` fields are unchanged (the
  transform derives a display-only numerator and never mutates the payload), so
  stall detection, `build_progress_halt` eligibility, and the quiet-episode state
  machine observe the same raw values as before.

### Scenario 2.4 (negative) — the retry-line count delta is NOT 1-based

- **Given** a `step_retry` event whose `formatProgressDelta(before, after)`
  renders `0→1 tasks`,
- **When** the retry line is rendered,
- **Then** it still reads `0→1 tasks` (a cardinal completed-count delta is left
  as-is; the 1-based change applies only to the `resolved/total` position
  indicator).
