**Status:** Accepted

# Stories: Mid-loop `.pipeline` wipe / kickback crash fix (ai-conductor#549)

Technical track — acceptance criteria derived from the technical intent and the APPROVED
`adr-2026-07-11-pipeline-state-durability` (guarantees D1/D2/D3). Each story maps to a
guarantee and/or an issue outcome. All assertions are engine-level and system-testable
against the conductor in `src/conductor`.

---

## Story 1: Bookkeeping marker write survives a missing `.pipeline` root (D1)

**Requirement:** ADR D1 · issue outcome #2

As the conductor, I want the `session-created` / `conduct-session-id` marker persists to
tolerate a missing `.pipeline` directory so that a mid-run wipe cannot crash the loop.

### Acceptance Criteria

#### Happy Path
- Given a running conductor whose `.pipeline` root has been removed after the run started,
  when the step runner persists the success marker (`step-runners.ts:423` interactive /
  `:498` autonomous), then it ensures the `.pipeline` directory exists and writes
  `session-created` and `conduct-session-id` successfully, returning `{ success: true }`
  without throwing.
- Given `.pipeline` is present and writable, when the marker is persisted, then behavior is
  byte-for-byte unchanged from today (marker + session-id written, no extra side effects).

#### Negative Paths
- Given the `.pipeline` root is absent because it was **never provisioned** (not a mid-run
  wipe), when the marker write runs, then the directory is created AND a loud greppable
  WARNING is emitted (per Story 6) — the write never silently swallows the anomaly.
- Given the `.pipeline` parent path exists but is **not writable** (permission error, not
  ENOENT), when the marker write runs, then the error is surfaced (logged) and does not
  masquerade as success — the ensure-dir guard is scoped to ENOENT/missing-dir, not a
  blanket catch that hides EACCES.

### Done When
- [ ] `runAutonomous` and the interactive `run` path both ensure `.pipeline` before writing
      `session-created`/`conduct-session-id`; a unit test with the dir pre-deleted returns
      `success:true` and both files exist afterward.
- [ ] A test asserting an EACCES (non-ENOENT) write error is NOT swallowed as success.
- [ ] No `writeFile(join(pipelineDir, 'session-created'), …)` remains that can throw ENOENT
      uncaught (grep + test).

---

## Story 2: Crash handler flushes state before recreating `.pipeline` (D1 ordering fix)

**Requirement:** ADR D1 (crash-handler reorder) · issue outcome #3

As the conductor, I want the outer-catch crash handler to recreate `.pipeline` **before**
flushing `conduct-state.json` so that a dir-wipe crash preserves in-memory run state instead
of silently dropping it.

### Acceptance Criteria

#### Happy Path
- Given an unexpected throw inside `Conductor.run()` while `.pipeline` is absent, when the
  outer catch (`conductor.ts:3211-3226`) runs, then it `mkdir`s `.pipeline` (recursive)
  **before** calling `writeState(this.stateFilePath, state)`, so `conduct-state.json` is
  written from memory AND the `HALT` marker is written — both survive.
- Given the same throw, when the handler completes, then the emitted `loop_halt` event and
  `HALT` marker reason still read `conductor error: <message>` exactly as today.

#### Negative Paths
- Given an unexpected throw while `.pipeline` **is present** (the normal crash path), when
  the handler runs, then state + HALT are written exactly as before the reorder — the fix is
  a strict superset, no regression to the common path.
- Given `writeState` itself fails for a reason other than a missing dir (e.g. serialization
  error), when the handler runs, then the failure is still swallowed by its `.catch` (HALT is
  the guaranteed terminal marker) — the reorder does not make a secondary failure fatal.

### Done When
- [ ] `conductor.ts` outer catch calls `mkdir('.pipeline',{recursive})` before `writeState`.
- [ ] A test that removes `.pipeline`, forces a throw in `run()`, and asserts both
      `conduct-state.json` (matching the in-memory state) AND `HALT` exist afterward.
- [ ] A regression test asserting the dir-present crash path is unchanged (state + HALT
      written, same reason string).

---

## Story 3: `.pipeline` bookkeeping reads degrade to a default, never crash (D1)

**Requirement:** ADR D1 (reads) · issue outcome #2

As the conductor, I want every `.pipeline` bookkeeping read at a check site to be
existence-guarded so that an absent file/dir yields a default instead of an unhandled ENOENT.

### Acceptance Criteria

#### Happy Path
- Given the `session-created` marker (or `conduct-session-id`, or `finish-choice`) is absent,
  when the conductor checks it (lazy-init `step-runners.ts:353/547`, `SessionManager`,
  completion gate), then the check returns its documented default (`sessionStarted=false`,
  no finish choice) without throwing.
- Given the marker is present, when the conductor reads it, then it returns the real value —
  no behavior change from today.

#### Negative Paths
- Given the entire `.pipeline` **directory** (not just a file) is absent at a read site, when
  the read runs, then it degrades to the default exactly as a missing-file case — a missing
  parent dir is not a distinct crash.
- Given a bookkeeping file is present but empty/corrupt, when it is read, then the reader
  treats it as absent/default (fail-open to "not started"), never throwing a parse crash.

### Done When
- [ ] An audit test enumerates the `.pipeline` read sites and asserts each uses
      `access`/`fileExists`-guarded reads (no bare `readFile`/`open` that can ENOENT-crash).
- [ ] Tests: absent file, absent dir, and empty file each return the documented default.

---

## Story 4: Root-cause regression test pins the finish→build kickback transition (Guard 3)

**Requirement:** issue outcome #1

As a maintainer, I want a regression test that pins the exact finish→build kickback
transition so that a `.pipeline` wipe on that transition is caught and the actual deleter is
identified.

### Acceptance Criteria

#### Happy Path
- Given a finish step that fails its completion gate (no `finish-choice`) and the daemon
  kicks back finish→build (`navigateBack` → build `stale` → re-dispatch), when the build
  re-enters and persists its success marker, then the pre-existing `.pipeline` run-state
  (`conduct-state.json`, `task-status.json`, `task-evidence.json`, `gates/*`) is intact and
  the build re-entry does not crash on a missing marker.
- Given the root-cause investigation, when the actual `.pipeline` deleter is identified, then
  it is named in the test (or its fixture) and the test fails on the pre-fix code and passes
  on the fixed code (true RED→GREEN regression pin).

#### Negative Paths
- Given the pre-fix code (unscoped delete + unguarded write present), when the regression
  test runs, then it reproduces the ENOENT crash / state loss (proving it actually pins the
  bug, not a tautology).
- Given the deleter is confirmed to be the `mutation-gate-probe` cleanup, when that suite
  runs under simulated host load with a live worktree `.pipeline` present, then the test
  asserts the live `.pipeline` is NOT touched (see Story 5); if the deleter is a different
  actor, the regression names that actor instead.

### Done When
- [ ] A test file reproduces finish-fail → kickback → build re-entry and asserts run-state
      survival + no ENOENT crash; it is RED on the current tree and GREEN after the fix.
- [ ] The actual deleter is documented (in the test and/or the ADR's known-unknown resolved)
      with file:line evidence.

---

## Story 5: No cleanup removes the shared `.pipeline` root (D2)

**Requirement:** ADR D2 · issue outcome #3 · root of the bug

As the engine and its test suite, I want every cleanup/teardown scoped to its own artifacts
so that no actor `rm -rf`s the shared `.pipeline` root of a live run.

### Acceptance Criteria

#### Happy Path
- Given any cleanup that runs at finish-failure kickback, session teardown, or test teardown,
  when it removes its artifacts, then it deletes only its own named files/subpaths and the
  `.pipeline` root (and sibling run-state it does not own) remains.
- Given the `mutation-gate-probe` test cleanup, when it tears down its temp fixture, then the
  path it deletes is anchored to an `mkdtemp`-created directory and can never resolve to a
  live worktree's `.pipeline`.

#### Negative Paths
- Given the test runs from a shifted/relative cwd under host load, when its cleanup computes
  the delete path, then the path is absolute and mkdtemp-rooted — a relative path that could
  resolve to the repo's real `.pipeline` is rejected/impossible (asserted by test).
- Given a cleanup helper is passed a path equal to (or a parent of) a live `.pipeline` root,
  when it runs, then it refuses / no-ops on the shared root rather than recursively removing
  it.

### Done When
- [ ] The `mutation-gate-probe` test/helper deletes only an mkdtemp path; a test asserts a
      sentinel file in the real worktree `.pipeline` survives a full probe run.
- [ ] A grep/audit test confirms no cleanup path issues `rm -rf` (or `worktree remove`) on a
      `.pipeline` root belonging to an in-progress run.

---

## Story 6: Loud recreate on a mid-run missing root — never silent (D3)

**Requirement:** ADR D3 · issue outcome #2

As an operator, I want a mid-run `.pipeline` recreate to be loud so that a wipe leaves a
forensic trail instead of a silent empty-state run.

### Acceptance Criteria

#### Happy Path
- Given a write choke point finds `.pipeline` absent **mid-run** (the run already started —
  distinguishable from first-provision), when it recreates the dir to avoid the crash, then
  it emits a single greppable `WARNING: .pipeline root was missing mid-run at <site> —
  recreated; run-state may be degraded` and continues.
- Given the loud recreate happened and run-state is genuinely gone, when the next gate
  (evidence/completion) evaluates, then it fails closed on the absent state (the run does not
  silently converge green on empty state).

#### Negative Paths
- Given the legitimate **first provision** of `.pipeline` (run start, dir expected absent),
  when the dir is created, then NO mid-run WARNING is emitted (the loud path is scoped to
  mid-run, not startup) — no false alarms.
- Given a legitimate **post-ship teardown** removed `.pipeline` at end of feature, when no
  further write choke point runs, then no spurious recreate/WARNING is produced.

### Done When
- [ ] A test asserts the WARNING is emitted exactly once on a mid-run recreate and its text
      is stable/greppable.
- [ ] A test asserts NO WARNING on first-provision and on post-ship teardown.
- [ ] A test asserts a fail-closed gate still blocks when state is truly absent after recreate.

---

## Story 7: Legitimate post-ship cleanup still clears what it should (outcome #4 negative)

**Requirement:** issue outcome #4

As the daemon, I want the D1/D2/D3 guards to leave legitimate end-of-feature cleanup intact
so that hardening does not leak worktrees or stale markers.

### Acceptance Criteria

#### Happy Path
- Given a feature reaches a `done` (not `keep`) outcome, when `teardownWorktree`
  (`daemon-deps.ts`) runs, then it still `git worktree remove --force`s the whole worktree
  (including its `.pipeline`) exactly as today.
- Given a worktree is re-dispatched on a later daemon cycle, when the daemon-cli pre-run
  sweep (`daemon-cli.ts:621-627`) runs, then it still removes the 2 stale session markers
  (`session-created`, `conduct-session-id`) so the new run starts clean.

#### Negative Paths
- Given a `halt`/`error` outcome with `keep=true`, when teardown is consulted, then the
  worktree (and its `.pipeline`) is preserved for inspection — the guards do not force a
  removal that should not happen.
- Given the pre-run sweep runs against a worktree with an active mid-run `.pipeline` from a
  crashed prior cycle, when it sweeps, then it removes only the 2 named session markers and
  leaves `conduct-state.json`/`task-status.json`/`gates/*` for the resume (no over-reach).

### Done When
- [ ] Existing `teardownWorktree` done+!keep removal and keep=true preservation tests still
      pass unchanged.
- [ ] Existing daemon-cli pre-run sweep tests (removes exactly the 2 markers) still pass;
      a test asserts the sweep does not touch other `.pipeline` state.
