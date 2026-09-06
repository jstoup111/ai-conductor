**Status:** Accepted

# Stories: Root the vitest run temp state on a disk-backed parent (#2224)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the parent directory the per-run temp root is created in, an explicit override for that parent, and keeping the operator's real tmpdir observable to the guards defined against it. The redirect itself, the run-root prefix, the stray-entry verdict, and teardown reap behavior are unchanged.

## Story 1: Create the run root under a disk-backed parent instead of the process tmpdir

**Requirement:** #2224 — default the run root's parent to a disk-backed, user-scoped location, overridable by an explicit environment variable.

As a developer running the suite, I want the run-scoped temp root created on a disk-backed filesystem so that hundreds of megabytes of fixture churn no longer consume the machine's RAM-backed tmpfs and self-DoS the run with EDQUOT.

### Acceptance Criteria

#### Happy Path
- Given no cache-home and no parent-override variable are set in the environment, when the suite resolves the run root's parent, then the resolved parent is the `ai-conductor/vitest-tmp` directory under the home cache directory, it exists after resolution, and the created run root is inside it.
- Given the environment sets an absolute cache-home directory, when the suite resolves the run root's parent, then the resolved parent is the `ai-conductor/vitest-tmp` directory under that cache home rather than under the home cache directory.
- Given the environment sets the parent-override variable to a writable absolute directory, when the suite resolves the run root's parent, then the resolved parent is exactly that directory, the run root is created inside it, and the redirect still points `TMPDIR` and the run-root variable at the created run root.

#### Negative Paths
- Given no parent-override is set and the default cache parent cannot be created, when the suite resolves the run root's parent, then it returns the process tmpdir it was given, emits one diagnostic naming the rejected default parent and the underlying reason, and the run proceeds.
- Given the parent-override variable is set to a path that cannot be created, when the suite resolves the run root's parent, then it throws an error naming the override variable and its value, and never silently falls back to the process tmpdir.

### Done When
- [ ] Resolver unit cases cover the home-cache default, an absolute cache-home, and an explicit override, each asserting the returned parent and that the directory exists.
- [ ] A resolver unit case with an uncreatable default parent returns the given process tmpdir and records exactly one diagnostic naming that parent.
- [ ] A resolver unit case with an uncreatable override throws an error whose message contains the override variable name and the rejected value.

## Story 2: Keep the real tmpdir observable to the guards defined against it

**Requirement:** #2224 — keep the existing `TMPDIR` redirect and teardown behavior unchanged.

As a maintainer of the suite's leak guards, I want the operator's real tmpdir recorded independently of the run root's location so that the stray-entry guard and the tmux sweep keep watching the actual tmpdir once the run root no longer lives inside it.

### Acceptance Criteria

#### Happy Path
- Given the run root was created under a parent that is not the process tmpdir, when the suite resolves the real tmpdir for its guards, then it returns the tmpdir recorded at parent resolution rather than the run root's parent directory.

#### Negative Paths
- Given no recorded real tmpdir is present in the environment, when the suite resolves the real tmpdir for its guards, then it returns the run root's parent directory and does not throw.

### Done When
- [ ] A unit case with a recorded real tmpdir and a run root under a different parent returns the recorded tmpdir, not the run root's parent.
- [ ] A unit case with the recording absent returns the run root's parent directory without throwing.
- [ ] Global setup obtains its real tmpdir through that accessor, and the teardown that clears the run-root variable clears the recording alongside it.

## Story 3: Route every run-root entry point through the resolved parent

**Requirement:** #2224 — the change must reach the run root the suite actually uses.

As a developer running the suite by any of its supported entry points, I want each one to create its run root under the resolved parent so that the RAM-backed tmpdir is not reinstated by whichever entry point I happened to use.

### Acceptance Criteria

#### Happy Path
- Given the parent-override variable names a writable directory and no run root is installed, when the package test runner starts and spawns its child, then the run root it created is inside that directory and the child environment carries the run root, a `TMPDIR` equal to it, and the recorded real tmpdir.
- Given the parent-override variable names a writable directory and no run root is installed, when either vitest config module is evaluated, then the installed run root is inside that directory.

#### Negative Paths
- Given a run root is already installed in the environment, when a vitest config module is evaluated, then it reuses the installed run root and creates no second directory under the resolved parent.

### Done When
- [ ] An entry-point test spawns the package test runner against a stub vitest executable and asserts the observed child environment's run root, `TMPDIR`, and recorded real tmpdir.
- [ ] An entry-point test evaluates each vitest config module in a child process and asserts the installed run root is inside the overridden parent.
- [ ] An entry-point test evaluating a config module with a run root already installed observes the same run root and exactly one entry under the overridden parent.

## Negative-category review

Resource exhaustion is the originating category and is answered by the disk-backed default itself. Dependency unavailability and partial failure are covered by the uncreatable default parent (fail open, diagnosed) and the uncreatable explicit override (fail closed, named) — the two ways the new filesystem dependency can be absent. Data integrity is covered by Story 2: relocating the run root must not blind the guards that watch the real tmpdir. Concurrent access is covered by Story 3's idempotency criterion, which is the existing protection against a config reload creating a second root. Invalid input beyond an uncreatable path is inapplicable: the override is a directory path and the only meaningful invalidity is that it cannot be created. Auth, timeouts, network, queues, uploads, deletions, and transactions are inapplicable — no external service, no persistent record, and no new deletion path is introduced; teardown reap is reused unchanged.
