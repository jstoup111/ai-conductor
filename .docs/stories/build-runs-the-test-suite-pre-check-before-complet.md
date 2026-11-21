**Status:** Accepted

# Stories: BUILD runs the configured test_suite pre-check before completing

Technical track; no PRD. Acceptance criteria derive from the operator-directed outcome (cheap static
failures kept reaching `test_suite` and `build_review` laps) and
`adr-2026-08-01-engine-owned-scoped-test-invocation` D11. "The pre-check" is the configured
`test_suite.pre_check` command list. "Resolved" means every plan task in scope is resolved and the
worktree has no uncommitted paths.

## Story 1: BUILD does not complete while the configured pre-check fails

As the daemon, I want BUILD to run the project's configured pre-check before it hands off, so that format and type errors return to the builder instead of costing a `test_suite` or `build_review` lap.

### Acceptance Criteria

#### Happy Path
- Given a resolved build and a pre-check whose commands all exit zero, when the build completion check runs, then it reports done.
- Given a resolved build and a pre-check whose second command exits non-zero, when the build completion check runs, then it reports not done with a reason that starts `test_suite pre-check failed:` and contains that command and the last lines of its output.
- Given a resolved build whose pre-check passed at the current HEAD, when the build completion check runs again at the same HEAD, then it reports done without running the pre-check again.

#### Negative Paths
- Given a resolved build and no `test_suite.pre_check` configured, when the build completion check runs, then it reports done and no pre-check command runs.
- Given a build with an unresolved plan task and a configured pre-check, when the build completion check runs, then the reason names the unresolved task and no pre-check command runs.
- Given a build with uncommitted paths and a configured pre-check, when the build completion check runs, then the reason names the uncommitted paths and no pre-check command runs.
- Given a pre-check that passed at one HEAD, when HEAD moves to a new commit and the build completion check runs, then the pre-check runs again at the new HEAD.

### Done When
- [ ] Completion tests cover pass, fail with output, same-HEAD reuse, new-HEAD re-run, unconfigured, unresolved-task, and uncommitted-path cases with the stated results.

## Story 2: The retries-exhausted escape cannot bypass the pre-check

As the operator, I want a commit-moving build that exhausts its budget while the pre-check fails to halt naming that failure, so that the escape that routes such builds forward never skips it.

### Acceptance Criteria

#### Happy Path
- Given a BUILD whose attempts moved HEAD, whose tree is clean, and whose configured pre-check passes, when its retry budget is exhausted with plan tasks still unresolved, then the run routes forward and dispatches `build_review`.

#### Negative Paths
- Given a BUILD whose attempts moved HEAD, whose tree is clean, and whose configured pre-check fails, when its retry budget is exhausted, then `build_review` is not dispatched and `.pipeline/HALT` is written with a reason containing `test_suite pre-check failed:`.

### Done When
- [ ] Conductor tests with commit movement and a clean tree observe routing with a passing pre-check and a HALT naming the pre-check with a failing one.

## Story 3: A pre-check miss is steered, not stalled

As the builder, I want the retry after a pre-check failure to show me the failing output and not be killed as a no-progress stall, so that I can fix and commit the repair.

### Acceptance Criteria

#### Happy Path
- Given a build completion miss whose reason starts `test_suite pre-check failed:`, when the retry hint is built, then it carries that reason's output and directs the builder to fix the failure, commit, and complete BUILD without running the aggregate suite.
- Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason starts `test_suite pre-check failed:`, then the attempt is not classified as a no-task-progress stall.

#### Negative Paths
- Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason names pending tasks, then the attempt is still classified as a no-task-progress stall.

### Done When
- [ ] `buildRetryHint` returns the pre-check instruction with the failure output, and `isNoTaskProgressBuildStall` exempts only the pre-check reason.

## Story 4: The pre-check configuration is validated

As a project maintainer, I want a malformed `test_suite.pre_check` rejected when config loads, so that a typo never silently disables the check.

### Acceptance Criteria

#### Happy Path
- Given `test_suite.pre_check` is a list of entries each with a non-empty `command`, when the config loads, then it loads with that list unchanged.

#### Negative Paths
- Given `test_suite.pre_check` is an empty list, when the config loads, then it fails with `test_suite.pre_check must be a non-empty array`.
- Given a `test_suite.pre_check` entry whose `command` is empty or which carries an unknown key, when the config loads, then it fails naming `test_suite.pre_check[<index>]`.

### Done When
- [ ] Config validation tests cover the valid list, the empty list, the empty command, and the unknown key.
