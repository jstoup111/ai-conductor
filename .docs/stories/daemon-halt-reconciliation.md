# Stories: Daemon Halt-Reconciliation

**Status:** Accepted

**Source PRD:** `.docs/specs/2026-06-28-daemon-halt-reconciliation.md`
**Complexity:** MEDIUM

These stories describe daemon behavior (dispatch, HALT markers, base-SHA tracking) in the
harness's TypeScript conductor (`src/conductor`). They are not HTTP-facing. Primitives
(SHA resolution, worktree scan, marker clear) are injected, mirroring the existing
`DaemonDeps`/`FeatureRunnerDeps` seams, so every scenario is unit-testable without git or a
real worktree.

---

## Story: Render the inherited-state dashboard at startup

**Requirement:** FR-1, FR-2

As the daemon operator, I want a grouped dashboard of inherited state printed before any
dispatch, so that on restart I immediately see what is parked, half-built, eligible, and done.

### Acceptance Criteria

#### Happy Path
- Given two worktrees with a live `.pipeline/HALT`, one worktree with a `conduct-state.json`
  and no HALT, three eligible merged specs, and nine `.daemon/processed/` entries, when the
  daemon starts, then it prints a dashboard with four groups — `HALTED (2)`, `IN-PROGRESS (1)`,
  `ELIGIBLE (3)`, `PROCESSED (9)` — **before** the first `▶ start` dispatch line.
- Given a halted worktree, when the dashboard renders, then its line shows the slug and the
  first line / summary of the reason read from `.pipeline/HALT`.
- Given an in-progress worktree whose `conduct-state.json` has `build: in_progress`, when the
  dashboard renders, then its line shows the slug and last meaningful step `build`.
- Given the dashboard is rendered, when it is emitted, then the identical content reaches both
  stdout and `daemon.log` via the existing `log()` sink.

#### Negative Paths
- Given the dashboard is rendering, when a worktree is BOTH in the processed ledger AND has a
  `conduct-state.json`, then it is NOT listed under IN-PROGRESS (processed wins; in-progress is
  "has state, no HALT, not processed").
- Given a worktree has both a live `.pipeline/HALT` and a `conduct-state.json`, when the
  dashboard renders, then it appears under HALTED only, never double-counted under IN-PROGRESS.
- Given `discoverBacklog` returns a slug that is also halted or processed, when ELIGIBLE is
  computed, then that slug is excluded from ELIGIBLE.

### Done When
- [ ] Startup emits a four-group dashboard with correct per-group counts and member lines.
- [ ] Dashboard is printed before any dispatch occurs (ordering asserted in a test).
- [ ] Each group's membership rule (halted > processed > in-progress > eligible precedence) is
      covered by a test with an overlapping slug.
- [ ] Dashboard text appears on both stdout and the log sink.

---

## Story: Dashboard tolerates empty, missing, and malformed state

**Requirement:** FR-3

As the daemon operator, I want the dashboard to render even when state is absent or corrupt, so
that startup never crashes on bad on-disk data.

### Acceptance Criteria

#### Happy Path
- Given no worktrees and an empty `.daemon/processed/`, when the daemon starts, then it prints
  the dashboard with all four groups at count `0` and proceeds to normal polling.

#### Negative Paths
- Given a halted worktree whose `.pipeline/HALT` file is empty, when the dashboard renders, then
  its reason is shown as `unknown` (no crash).
- Given an in-progress worktree whose `conduct-state.json` is malformed JSON, when the dashboard
  renders, then its last step is shown as `unknown` and it still appears under IN-PROGRESS.
- Given one worktree raises a filesystem error during the scan, when the dashboard renders, then
  that worktree is skipped (logged), the other groups still render, and startup continues.
- Given the `.worktrees/` directory does not exist, when the daemon starts, then the scan yields
  zero worktrees rather than throwing.

### Done When
- [ ] Empty-everything startup renders a zero-count dashboard without error.
- [ ] Empty HALT → reason `unknown`; malformed conduct-state → step `unknown`.
- [ ] A per-worktree scan error is isolated (logged + skipped), never aborts the dashboard.
- [ ] Missing `.worktrees/` is handled as zero worktrees.

---

## Story: Resolve and persist the base-branch SHA

**Requirement:** FR-4

As the daemon, I want to read the base-branch tip SHA from the resolved discovery ref and
persist it, so that base advances can be detected across polls and restarts.

### Acceptance Criteria

#### Happy Path
- Given `resolveDiscoveryRef` returns `origin/main`, when the daemon reads the base SHA, then it
  runs `git rev-parse origin/main` and uses that SHA as the current base.
- Given a base SHA is resolved, when the daemon records it, then `.daemon/last-base-sha` contains
  exactly that SHA.

#### Negative Paths
- Given `resolveDiscoveryRef` degrades to the local base (no origin), when the daemon reads the
  base SHA, then it resolves the local base ref's SHA, not a hardcoded `main`.
- Given `git rev-parse` fails to resolve any SHA, when the daemon reads the base, then it
  treats the base SHA as unresolved (no advance this tick) and does not throw.
- Given `.daemon/last-base-sha` write fails, when the daemon persists, then the error is logged
  and the poll loop continues (detection degrades, daemon does not crash).

### Done When
- [ ] Base SHA derives from the ref `resolveDiscoveryRef` returns (origin or local), never a
      hardcoded branch name.
- [ ] `.daemon/last-base-sha` holds the last-seen SHA after a successful read.
- [ ] Unresolvable SHA and failed persistence both degrade without throwing.

---

## Story: First run initializes the SHA without re-kicking

**Requirement:** FR-5 (first-run path)

As the daemon operator, I want the very first startup to just record the SHA, so that a fresh
daemon does not treat its first poll as an advance.

### Acceptance Criteria

#### Happy Path
- Given `.daemon/last-base-sha` is absent, when the daemon starts, then it writes the current
  base SHA to `.daemon/last-base-sha` and performs **no** re-kick sweep.
- Given the first run completes, when a halted worktree exists, then its `.pipeline/HALT` marker
  is left intact (honored, not cleared).

#### Negative Paths
- Given `.daemon/last-base-sha` exists but is empty or unreadable, when the daemon starts, then
  it is treated as absent (first-run path): record current SHA, no re-kick (FR-11).
- Given the current base SHA is unresolved on first run, when the daemon starts, then no SHA is
  persisted and no re-kick occurs (waits for a resolvable base next tick).

### Done When
- [ ] Absent `last-base-sha` → initialized, zero re-kicks, markers intact.
- [ ] Empty/unreadable `last-base-sha` is treated identically to absent.
- [ ] Unresolved base on first run → no persistence, no re-kick, no crash.

---

## Story: A base advance during downtime re-kicks halted work on restart

**Requirement:** FR-5 (downtime-advance path), FR-7

As the daemon operator, I want a base advance that happened while the daemon was down to re-kick
halted work on the next startup, so that a fix or spec I merged offline retries parked features
without manual marker clearance.

### Acceptance Criteria

#### Happy Path
- Given `.daemon/last-base-sha` holds SHA `A` and the current resolved base SHA is `B` (`B ≠ A`),
  when the daemon starts, then after printing the dashboard it runs a re-kick sweep (FR-7) over
  every halted worktree.
- Given the downtime sweep runs, when it finishes, then `.daemon/last-base-sha` is updated to `B`
  so the same advance does not re-kick on a subsequent restart.

#### Negative Paths
- Given the persisted SHA equals the current SHA (`B == A`), when the daemon starts, then it
  prints the dashboard and performs **no** re-kick — every `.pipeline/HALT` marker is left intact
  (PR #109 restart behavior preserved).
- Given a downtime advance is detected but there are zero halted worktrees, when the sweep runs,
  then it clears nothing, logs no spurious clears, and still updates `last-base-sha` to `B`.

### Done When
- [ ] Persisted ≠ current at startup → dashboard then re-kick sweep.
- [ ] Persisted == current at startup → dashboard, no sweep, all markers intact.
- [ ] `last-base-sha` is advanced to the current SHA after the startup sweep.

---

## Story: A live base advance during a run re-kicks halted work

**Requirement:** FR-6, FR-7

As the daemon operator, I want a base advance observed while the daemon is running to re-kick
halted work, so that merging a commit during a run retries parked features automatically.

### Acceptance Criteria

#### Happy Path
- Given the daemon is idle-polling and a refresh resolves a base SHA that advanced versus the
  last-seen value, when the tick is processed, then a re-kick sweep (FR-7) runs over every halted
  worktree and `last-base-sha` is updated to the new SHA.
- Given a halted feature's marker is cleared by the sweep, when the next discovery poll runs,
  then the feature is re-dispatched through the existing un-park path (FR-8) — no direct dispatch
  call is made by the sweep.

#### Negative Paths
- Given consecutive refreshes return the **same** base SHA, when the ticks are processed, then no
  re-kick sweep runs after the first observation (advance fires once per SHA change).
- Given a refresh fails to resolve a SHA (offline mid-run), when the tick is processed, then it
  is treated as "no advance" — no sweep, markers intact, poll loop continues (FR-10).

### Done When
- [ ] A live SHA advance triggers exactly one sweep and updates `last-base-sha`.
- [ ] Re-dispatch happens via the un-park path, not a sweep-issued dispatch.
- [ ] Repeated identical SHAs trigger no further sweeps.
- [ ] A failed mid-run resolution is a no-op, not a crash.

---

## Story: Re-kick sweep clears every halted marker and preserves its reason

**Requirement:** FR-7

As the daemon operator, I want the sweep to clear all HALT markers non-destructively, so that
parked work retries while the original halt reason is preserved for post-mortem and the next
dashboard.

### Acceptance Criteria

#### Happy Path
- Given three worktrees with live `.pipeline/HALT` markers and a triggering advance, when the
  sweep runs, then for each it logs `slug` + reason, renames `.pipeline/HALT` to
  `.pipeline/HALT.cleared`, removes `.pipeline/HALT`, and records the triggering SHA as that
  feature's last-rekick SHA.
- Given a worktree already has a stale `.pipeline/HALT.cleared` from a prior sweep, when the
  sweep clears it again, then the new reason overwrites the old `.cleared` file.
- Given a worktree halted on a 9.0 rebase conflict — its `.pipeline/HALT` is present **and** an
  in-progress rebase exists (`.git/rebase-merge` or `.git/rebase-apply`) — when the sweep runs,
  then it runs `git rebase --abort` in the worktree (logged) returning it to a clean checkout of
  its branch tip **before** removing `.pipeline/HALT`, so re-dispatch runs 9.0's rebase step fresh
  against the advanced base rather than re-entering the paused rebase.

#### Negative Paths
- Given a halted worktree with **no** in-progress rebase, when the sweep runs, then the rebase
  abort is a no-op (no error) and the marker is cleared normally.
- Given `git rebase --abort` itself fails in a worktree, when the sweep runs, then the failure is
  logged and that worktree is skipped (marker left intact, not half-cleared) so a corrupt rebase
  state is never re-dispatched; the sweep continues with the remaining worktrees.
- Given a worktree without a live `.pipeline/HALT`, when the sweep runs, then it is not touched
  (no rebase abort, no spurious `.cleared` file, no last-rekick SHA recorded).
- Given clearing one worktree's marker raises a filesystem error, when the sweep runs, then that
  worktree is logged and skipped and the sweep continues clearing the remaining worktrees.
- Given a feature halted in-flight is concurrently being torn down, when the sweep clears its
  marker, then clearing a now-absent marker is a no-op (not an error).

### Done When
- [ ] Every live-HALT worktree is cleared: reason logged, `.cleared` written, `HALT` removed,
      last-rekick SHA recorded.
- [ ] A worktree with an in-progress rebase gets `git rebase --abort` BEFORE the marker is
      removed; a worktree with no rebase gets a no-op abort.
- [ ] A failed `git rebase --abort` leaves the marker intact (no half-clear) and is isolated.
- [ ] Re-clearing overwrites a prior `.cleared`.
- [ ] Non-halted worktrees are untouched.
- [ ] A per-worktree clear failure is isolated; the sweep completes the rest.

---

## Story: Re-kick is bounded — a feature re-halting at the same SHA is not re-kicked again

**Requirement:** FR-9

As the daemon operator, I want a feature that re-halts at the same base SHA to stay parked, so
that the aggressive all-halts policy cannot become a tight re-build loop.

### Acceptance Criteria

#### Happy Path
- Given a feature was re-kicked at SHA `B` and immediately re-halts (writes a new
  `.pipeline/HALT`) while the base is still `B`, when subsequent ticks are processed, then it is
  NOT re-kicked again at SHA `B` — guarded by its recorded last-rekick SHA.
- Given that same feature is still halted and the base later advances to SHA `C`, when the
  advance is processed, then the feature IS re-kicked again (a new SHA clears the guard).

#### Negative Paths
- Given the guard keys off the recorded last-rekick SHA (not mere presence of a marker), when a
  feature is first seen halted at SHA `B`, then it IS swept exactly once at `B` and is NOT swept
  again on any later tick while the base remains `B`.
- Given the in-memory re-kick guard is lost on restart, when the daemon restarts with the base
  still at `B` and `last-base-sha == B`, then no re-kick occurs (no advance), so the loop bound
  holds across restarts without needing per-feature SHA persistence.

### Done When
- [ ] Same-SHA re-halt is not re-kicked again at that SHA.
- [ ] A later SHA advance does re-kick the still-halted feature.
- [ ] The bound holds across a restart (no advance → no sweep), independent of in-memory guard
      state.

---

## Story: SHA detection degrades gracefully and never crashes the poll loop

**Requirement:** FR-10

As the daemon operator, I want base-SHA detection to be crash-safe offline, so that a daemon with
no network keeps polling and never falsely re-kicks.

### Acceptance Criteria

#### Happy Path
- Given there is no `origin` remote, when the daemon resolves the base, then it uses the local
  base SHA and detects advances only against the local base — no spurious advance from a missing
  remote.

#### Negative Paths
- Given the daemon is offline and `resolveDiscoveryRef` falls back to the local base, when ticks
  are processed, then the base SHA is stable and no re-kick occurs until the local base actually
  moves.
- Given base-SHA resolution throws, when the tick is processed, then the error is caught, treated
  as "no advance," logged, and the poll loop continues to the next tick.
- Given a single worktree clear throws inside an otherwise valid sweep, when the sweep runs, then
  the loop is not aborted (covered with FR-7) — the daemon keeps running.

### Done When
- [ ] No-origin startup: dashboard renders, base resolves locally, no spurious re-kick.
- [ ] A throwing SHA resolution is caught and treated as no-advance.
- [ ] The poll loop survives detection and sweep failures (never propagates out of the loop).

---

## Story: Corrupt last-base-sha is treated as absent, never a spurious advance

**Requirement:** FR-11

As the daemon operator, I want a half-written `last-base-sha` to be safe, so that a crash mid-write
cannot wedge detection or trigger a phantom re-kick.

### Acceptance Criteria

#### Happy Path
- Given `.daemon/last-base-sha` is written, when it is read back, then the persisted value equals
  the SHA that was written (round-trip integrity).

#### Negative Paths
- Given `.daemon/last-base-sha` is empty, when the daemon reads it, then it is treated as absent
  (first-run path: record current SHA, no re-kick), not as SHA `""` differing from current.
- Given `.daemon/last-base-sha` contains whitespace/garbage that is not a 40-hex SHA, when the
  daemon reads it, then it is treated as absent rather than as a real differing SHA that would
  trigger a spurious sweep.
- Given the file is unreadable (permissions), when the daemon reads it, then it degrades to the
  first-run path and logs, never throwing.

### Done When
- [ ] Round-trip write/read of `last-base-sha` is exact.
- [ ] Empty/garbage/unreadable `last-base-sha` → treated as absent (no spurious advance).
- [ ] No corrupt-file case triggers a re-kick or crashes startup.

---

## Story: A re-kicked feature plays forward — rebase-onto-latest precedes the pending gate

**Requirement:** FR-12

As the daemon operator, I want a re-kicked feature to integrate the advanced base before
re-running the gate it halted on, so that the merged commit that should unblock it is actually
present when that gate re-verifies — otherwise re-kick is a no-op that just re-halts.

### Acceptance Criteria

#### Happy Path
- Given a feature halted at a gate (e.g. prd-audit) on base SHA `A`, when the base advances to `B`
  and re-kick clears its marker, then on re-dispatch the conductor runs 9.0's rebase-onto-latest
  (worktree branch rebased onto `B`) **before** re-verifying the pending gate, so the gate runs
  against `B`'s content.
- Given a rebase-conflict halt is re-kicked, when it re-dispatches, then the aborted rebase is the
  first step re-run (rebase-onto-latest), satisfying rebase-first inherently.

#### Negative Paths
- Given the rebase-onto-latest re-conflicts on the new base `B`, when re-dispatch runs, then the
  feature re-halts via 9.0's existing conflict→HALT path (not a re-kick-specific path) and is NOT
  re-kicked again at `B` (FR-9 bound); a further advance to `C` re-kicks it.
- Given a re-kicked gate-failure halt whose resume point was at the failed gate, when re-kick
  resets the resume point, then the rebase step is not skipped — a test asserts the gate does NOT
  re-run before the rebase (no stale-base re-verification).
- Given re-kick hands back a rebased-forward worktree with a residual blocking gap, when the gate
  re-fails, then routing is delegated to the normal gate loop / `/remediate` — the re-kick code
  itself performs no gap routing.

### Done When
- [ ] On re-kick, rebase-onto-latest runs before the pending gate re-verifies (asserted ordering).
- [ ] Rebase-conflict halts satisfy rebase-first inherently (abort → rebase re-runs first).
- [ ] A re-conflict on the new base re-halts via 9.0's path, bounded by FR-9.
- [ ] Re-kick performs no gap routing; residual gaps flow to the gate loop / `/remediate`.

---

## Story: Restart with no base advance preserves all markers (PR #109 invariant)

**Requirement:** FR-5, FR-8 (regression guard)

As the daemon operator, I want a plain restart to honor parked work exactly as PR #109 does, so
that adding re-kick never reintroduces the blind-re-dispatch bug.

### Acceptance Criteria

#### Happy Path
- Given halted worktrees and `last-base-sha == current base SHA`, when the daemon restarts, then
  it prints the dashboard, clears no markers, and dispatches none of the halted features.
- Given a human later clears one `.pipeline/HALT` by hand, when the next poll runs, then only
  that feature is un-parked and re-dispatched (existing PR #109 path), the others stay parked.

#### Negative Paths
- Given a restart with no advance, when discovery runs, then no halted feature receives a
  `▶ start` line (no re-dispatch) — asserted against the daemon log.
- Given the re-kick feature is entirely disabled/absent of advances, when the daemon runs, then
  behavior is byte-for-byte the PR #109 baseline for halted features.

### Done When
- [ ] No-advance restart: dashboard only, zero marker clears, zero halted dispatches.
- [ ] Manual single-marker clear still re-dispatches exactly that one feature.
- [ ] A regression test pins the PR #109 invariant under the new code path.
