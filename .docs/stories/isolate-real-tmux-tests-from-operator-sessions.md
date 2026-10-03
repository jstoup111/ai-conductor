**Status:** Accepted

# Stories: Isolate real-tmux tests from operator sessions (#2476)

Track: technical

Tier: M

Scope boundary (from `.docs/track/isolate-real-tmux-tests-from-operator-sessions.md`): comprehensive.
A run-level isolation floor for every tmux client in the test process tree, a fixture-owned
private-server runner with owned teardown and interrupted-run recovery, migration of every real-tmux
test onto it, a static rule rejecting unsafe tmux access in tests, and retained real-tmux coverage.
Out of scope: production daemon tmux behavior and the production `AI_CONDUCTOR_NO_REAL_EXEC`
kill-switch semantics.

Governing design: `.docs/architecture/isolate-real-tmux-tests-from-operator-sessions.md` and
`.docs/decisions/architecture-review-2026-10-03-isolate-real-tmux-tests-from-operator-sessions.md`
(APPROVED WITH CONDITIONS).

"Operator tmux server" below means the server a tmux client reaches from the operator's shell
environment: the one named by an inherited `TMUX` variable, or else the default socket under the
operator's own tmux socket directory.

## Story 1: No tmux client in a test run can reach the operator tmux server

As the operator, I want every tmux command issued anywhere in a Vitest run to land on a server that
run owns, so that a test can never observe, replace, or terminate my live daemon sessions, even when
a fixture forgets isolation or the production kill-switch is bypassed.

### Acceptance Criteria

#### Happy Path
- Given an operator tmux server holding a session named `cc-daemon-operator-probe`, and a Vitest run started from a shell whose environment has `TMUX` set to that server's socket, when a test in the default, e2e, or smoke tier runs `tmux list-sessions` through the production default tmux runner with no `-L` or `-S`, then the listing does not contain `cc-daemon-operator-probe`.
- Given the same operator server and run, when a test spawns a child process that inherits the test process environment and the child runs `tmux new-session -d -s cc-daemon-floor-child`, then that session exists on a server whose socket lies under the run's own tmux socket root, and the operator server gains no session.
- Given the same run, when the suite-level tmux leak guard takes its baseline and teardown snapshots, then both snapshots are taken against the run's own server and never list `cc-daemon-operator-probe`.

#### Negative Paths
- Given a test that deletes `AI_CONDUCTOR_NO_REAL_EXEC` and calls `kill-session -t =cc-daemon-operator-probe` through the production default runner, when the call completes, then `cc-daemon-operator-probe` is still running on the operator server.
- Given the run's tmux socket root cannot be created, when Vitest setup runs, then the run fails before any test executes, with an error naming the socket root path, and no tmux command is issued against the operator server.
- Given two Vitest runs started concurrently from two worktrees, when each run creates a session with the same name `cc-daemon-same-name`, then each run's listing shows exactly its own session, and ending one run leaves the other run's session running.

### Done When
- [ ] A test in each tier proves a sentinel session on a stand-in "operator" server (created by the test on a socket it controls, and addressed through an inherited `TMUX`) is invisible to, and survives, default-runner `list-sessions` and `kill-session` calls.
- [ ] A test proves a spawned child's tmux session lands under the run's socket root.
- [ ] Setup fails closed with the socket root named when the root cannot be created.
- [ ] No production module under `src/` changes behavior; with the test environment absent, tmux resolution is unchanged.

## Story 2: Each real-tmux fixture runs on its own private server

As a test author, I want a shared fixture that gives each real-tmux test its own tmux server, so that
concurrent fixtures in the same run cannot see or affect one another.

### Acceptance Criteria

#### Happy Path
- Given two real-tmux fixtures created in the same Vitest worker, when each creates a session named `cc-daemon-fixture-x`, then each fixture's `list-sessions` shows exactly one session, and killing it in one fixture leaves the other fixture's session running.
- Given a fixture runner, when it is passed to the production tmux helpers (create session, respawn pane, has-session, capture pane, kill session), then each helper's command reaches only that fixture's server.
- Given a fixture, when the test inspects its socket path, then the path is short enough to bind as a Unix socket even when the run's temporary root lies inside a deep checkout path.

#### Negative Paths
- Given tmux is not installed on PATH, when a real-tmux test requests a fixture, then the test is reported as skipped with a reason naming tmux, rather than passing or failing.
- Given a fixture's server has been stopped out from under it, when the test issues a command through the fixture runner, then the runner returns a non-zero result within the existing tmux command timeout instead of hanging, and the command never reaches any other server.
- Given a fixture runner, when a caller passes its own `-S` or `-L` argument, then the runner refuses the call with an error naming the forbidden flag before tmux is started.

### Done When
- [ ] One shared fixture module exists in test support and every real-tmux test obtains its server from it, except tests of the isolation machinery itself, which must start stand-in servers outside it and are covered by the Story 5 justified allowlist.
- [ ] A test proves two fixtures in one worker with identical session names stay independent.
- [ ] A test proves the forbidden-flag refusal and the no-tmux skip.

## Story 3: Fixture cleanup touches only fixture-owned resources

As the operator, I want each fixture's cleanup to stop only its own server and remove only its own
files, whether the test passed, failed, or threw, so that cleanup can never take down my sessions or
another run's.

### Acceptance Criteria

#### Happy Path
- Given a fixture whose test passes, when the test's teardown runs, then the fixture's server is no longer running and its socket root no longer exists.
- Given a fixture whose test fails an assertion, when the test's teardown runs, then the fixture's server is no longer running and its socket root no longer exists.
- Given a fixture whose test throws before reaching any assertion, when the test's teardown runs, then the fixture's server is no longer running and its socket root no longer exists.

#### Negative Paths
- Given a stand-in "operator" server and a second fixture both running sessions named identically to the first fixture's session, when the first fixture's teardown runs, then both other servers and their sessions are still running.
- Given a fixture whose server already exited before teardown, when teardown runs, then teardown completes without error and still removes the fixture's socket root.
- Given a fixture whose socket root was already removed before teardown, when teardown runs, then teardown completes without error and issues no command to any other server.

### Done When
- [ ] Tests cover teardown after pass, failed assertion, and thrown error.
- [ ] A test proves teardown leaves a same-named session on two other servers running.
- [ ] Teardown is idempotent against an already-exited server and an already-removed root.

## Story 4: An interrupted run's tmux servers are reclaimed by the next run

As the operator, I want tmux servers and socket roots left behind by a killed or crashed test run to
be cleaned up when the next run starts, so that interrupted runs never accumulate resident servers.

### Acceptance Criteria

#### Happy Path
- Given a previous run was killed before teardown, leaving its run-level server and a fixture server running with their socket roots present, when the next run's setup sweep executes, then both servers are stopped and both socket roots are removed.
- Given the sweep has run, when the next run's leak guard takes its baseline, then the baseline is taken after the sweep.

#### Negative Paths
- Given another run is still active (its run root is live, not stale) and owns running tmux servers, when a new run's sweep executes, then the active run's servers and socket roots are left untouched.
- Given a stale socket root whose server is unresponsive, when the sweep tries to stop it, then the sweep gives up within the existing tmux command timeout, reports the root by path in a failure message, and leaves the root in place rather than blocking the run.
- Given the operator tmux server is running sessions with temporary-directory pane working directories, when the sweep executes, then the operator server and all of its sessions are left untouched.

### Done When
- [ ] A test plants a stale run's servers and roots and proves the sweep stops and removes them.
- [ ] A test proves a live run's servers survive another run's sweep.
- [ ] A test proves an unresponsive stale server is reported by path and does not block setup.
- [ ] No sweep or leak-guard path issues any command to the operator tmux server.

## Story 5: Unsafe tmux access in tests is rejected by validation

As a test author, I want the default test suite to fail when any test file reaches tmux outside the
private-server fixture, so that a new unsafe fixture is caught before it can run against operator
sessions.

### Acceptance Criteria

#### Happy Path
- Given the repository's test tree after migration, when the default suite runs the tmux-access audit over every test file, then it reports zero findings.
- Given a test source that obtains its tmux server from the shared fixture module, when the audit scans it, then it reports no finding.
- Given a test source whose only tmux use is an installed-version probe that contacts no server (`tmux -V` or the production `tmuxInstalled` helper), when the audit scans it, then it reports no finding.
- Given a test source on the audit's justified allowlist, such as a unit test that replaces the process-spawn boundary with a mock before calling the tmux adapter, when the audit scans it, then it reports no finding, and the allowlist entry carries a written reason.

#### Negative Paths
- Given a test source that spawns `tmux` directly through `spawnSync`, `execFileSync`, `execa`, or a shell string, when the audit scans it, then it reports a finding naming the file, the line, and "direct tmux access outside the private-server fixture".
- Given a test source that passes the production default tmux runner to a tmux helper, when the audit scans it, then it reports a finding naming the file and line.
- Given a test source that assigns or deletes `TMUX`, `TMUX_PANE`, or `TMUX_TMPDIR` in `process.env` or in an env object it passes to a child process, when the audit scans it, then it reports a finding naming the variable, the file, and the line.
- Given a test source that passes `-S` to tmux, when the audit scans it, then it reports a finding naming the file and line.
- Given a test source that spawns a child with an environment built from scratch (not extending the test process environment) and that child runs tmux, when the audit scans it, then it reports a finding naming the file and line.
- Given an allowlist entry whose file no longer exists or no longer needs the exemption, when the audit runs, then it reports the stale entry by path so the allowlist cannot grow silently.

### Done When
- [ ] The audit runs in the default Vitest tier, so suite evidence and `test/test_harness_integrity.sh` carry it.
- [ ] Synthetic sources cover each finding class and each non-finding case above.
- [ ] A whole-tree case asserts zero findings on the shipped test tree.

## Story 6: Real-tmux restart and cleanup coverage is retained

As a maintainer, I want the tests that previously drove the operator tmux server to keep proving real
tmux behavior on a private server, so that isolation does not trade away the coverage they exist for.

### Acceptance Criteria

#### Happy Path
- Given the restart-wiring test on a private fixture server, when a queued self-restart fires against its real session, then it asserts the session still exists after the restart and is gone after cleanup, using a listing taken from the fixture's own server.
- Given the real-tmux smoke test on a private fixture server, when it respawns a session in place beside a near-name sibling, then it asserts exact-`=` targeting acts on the intended session only, the session keeps its scrollback, and the pane's process id changes.
- Given the stale-respawn and exit-witness e2e tests on private fixture servers, when they exercise respawn, exit witnessing, and cleanup, then they assert the same observable outcomes as before migration.
- Given a test that only probes whether tmux is installed (`tmux -V`, which contacts no server), such as the lifecycle e2e test with its mocked runner, when it runs, then it needs no fixture and the audit accepts the probe.
- Given any migrated test, when it runs, then it does not delete or modify `AI_CONDUCTOR_NO_REAL_EXEC`.

#### Negative Paths
- Given tmux is installed, when a migrated test runs, then it executes its real-tmux assertions and is not reported as skipped.
- Given respawn-in-place fails on the private server, when the restart path falls back to kill-and-recreate, then the test asserts the fallback acted on the fixture's server only.
- Given the stale-respawn e2e test plants a stale session, when cleanup runs, then the test asserts only the fixture server's session was removed.

### Done When
- [ ] `daemon-restart-wiring`, `daemon-tmux.smoke`, `daemon-stale-respawn.e2e`, and `daemon-exit-witness-tmux.e2e` all obtain their server from the shared fixture.
- [ ] Each migrated test's pre-migration real-tmux assertions are still present.
- [ ] None of them deletes `AI_CONDUCTOR_NO_REAL_EXEC`.
