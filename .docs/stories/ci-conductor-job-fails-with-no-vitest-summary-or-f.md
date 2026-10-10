**Status:** Accepted

# Stories: CI conductor job names the test files that were running when it fails

Source: jstoup111/ai-conductor#2631. Track: technical (no PRD). Tier: S.

Scope boundary (from `.docs/track/ci-conductor-job-fails-with-no-vitest-summary-or-f.md`): the
sharded `conductor` CI job only. Local `npm test` and the harness `test_suite` gate keep their
current output. Excluded: the `conductor-e2e` job, root-causing the #2555 abort, worker memory
tuning, and the daemon CI-fix log excerpt.

Observed baseline (verified against run 35624876796, attempt 1, job `conductor`): the `npm test`
step printed the Vitest `RUN v4.1.11` banner, fixture git output, and fixture warnings, then ended
with `Process completed with exit code 1` and no dot output, no FAIL line, no summary, and no test
file named. Under `--reporter=dot` on a non-TTY stream, Vitest writes one character per finished
test with no newline (`DotReporter.onTestCaseResult`, `node_modules/vitest/dist/chunks/index.UpGiHP7g.js:3182-3190`)
and prints failures only in the end-of-run summary, so a run that dies before that summary names
nothing.

The progress record prefix used below is the literal `[ci-progress]`.

## Story 1: CI log names each test file as it starts and finishes

**Requirement:** #2631 desired outcome 1

As a maintainer or the daemon reading a failed `conductor` CI log, I want every test file's start
and finish recorded on its own line as it happens, so that the log names the files that were
running or failed even when Vitest never prints its summary.

### Acceptance Criteria

#### Happy Path
- Given the `conductor` CI job runs its Vitest shard, when a worker begins loading a test file, then the step log contains a line `[ci-progress] start <path>` where `<path>` is the file's path relative to `src/conductor`, written before that file's module import completes and before any of its test results are reported.
- Given a test file in the shard finishes with every test passing or skipped, when Vitest reports the file finished, then the step log contains `[ci-progress] done <path> passed <seconds>s` on its own line.
- Given a test file in the shard finishes with at least one failing test, when Vitest reports the file finished, then the step log contains `[ci-progress] done <path> failed <seconds>s` followed by one `[ci-progress] failed test: <full test name>` line per failing test, written at that moment rather than only in the end-of-run summary.

#### Negative Paths
- Given the dot reporter has written result characters without a trailing newline, when a `[ci-progress]` line is written, then that line begins at the start of a new line and is never appended to the run of dot characters.
- Given a test file fails while loading (its module throws during collection, so it has no test results), when Vitest reports the file finished, then the step log contains `[ci-progress] done <path> failed <seconds>s` for that file.

### Done When
- [ ] A real Vitest child run over a fixture with one passing and one failing file, using the CI reporter set, prints a `start` and a `done` line for both files and a `failed test:` line naming the failing test.
- [ ] The `conductor` job's test step in `.github/workflows/ci.yml` passes the progress reporter to Vitest alongside the package script's dot reporter.

## Story 2: A test file that stops making progress is named within a bounded time

**Requirement:** #2631 desired outcome 2

As a maintainer, I want a test file that stops producing results to be named while the job is
still running, so that a hang is diagnosable before the job dies or times out.

### Acceptance Criteria

#### Happy Path
- Given a test file has started and Vitest has reported no progress for it (no collection, hook start or end, test start, or test result) for 90 seconds, when the progress watchdog next checks (at most every 15 seconds), then the step log contains `[ci-progress] stalled <path> no progress for <seconds>s` naming that file.
- Given a file has been reported stalled and still reports no progress, when a further 90 seconds pass without progress, then the stalled line for that file is written again with the larger elapsed time.

#### Negative Paths
- Given a file that is slow overall but reports progress at least every 90 seconds, when the watchdog checks, then no stalled line is written for that file.
- Given a file reported stalled that then finishes, when its `done` line is written, then no further stalled line is written for that file.
- Given the run has ended, when the process remains alive afterwards, then the watchdog writes nothing further and does not by itself keep the Vitest process alive.

### Done When
- [ ] A fake-clock reporter test proves the stalled line appears between 90 and 105 seconds of no progress, repeats after another 90 seconds, and stops after `done`.
- [ ] A fake-clock reporter test proves a file reporting progress every 60 seconds is never reported stalled.

## Story 3: An aborted run names the in-flight files and how Vitest ended

**Requirement:** #2631 desired outcome 1; hypothesis 2 (worker or process exit)

As a maintainer, I want a run that ends without a Vitest summary to leave the names of the files
that were still running and the way the Vitest process ended, so that an abort like #2555's is
attributable from the log alone.

### Acceptance Criteria

#### Happy Path
- Given the Vitest run ends with reason `failed` or `interrupted` while one or more started files have no `done` line, when Vitest reports the run's end, then the step log contains `[ci-progress] still running at run end: <path>` once per such file.
- Given the Vitest process exits before reporting the run's end (for example an unhandled fatal error that calls process exit), when the process is exiting, then the step log contains `[ci-progress] process exiting before Vitest reported run end; in-flight: <paths>` naming every started file with no `done` line, or `none`.
- Given the Vitest child launched by `scripts/run-vitest.mjs` is terminated by a signal, when the launcher observes the exit, then it writes `[run-vitest] vitest terminated by signal <SIGNAL>` to stderr before re-raising that signal.
- Given the Vitest child exits with a non-zero code, when the launcher observes the exit, then it writes `[run-vitest] vitest exited with code <N>` to stderr and exits with that same code.

#### Negative Paths
- Given the Vitest main process is killed with SIGKILL while a test file is loading or running, so no in-process handler can run, when the step log is read, then it still contains that file's `start` line with no matching `done` line and the launcher's `terminated by signal SIGKILL` line.
- Given the run ends with reason `passed`, when Vitest reports the run's end, then no `still running at run end` line is written.

### Done When
- [ ] A real child run whose fixture test SIGKILLs its own Vitest main process shows the killing file's `start` line without a `done` line, plus the launcher's signal line.
- [ ] Launcher tests with a fake Vitest binary prove the signal line, the exit-code line and propagated code, and silence on exit code 0.

## Story 4: Passing runs and local runs keep their output and duration

**Requirement:** #2631 desired outcome 3

As a maintainer, I want the change confined to diagnostics, so that a passing CI shard and every
local or harness `npm test` run look and behave as they do today apart from the added
`[ci-progress]` lines in CI.

### Acceptance Criteria

#### Happy Path
- Given the `conductor` CI job runs a shard whose tests all pass, when the run ends, then the step still ends with the Vitest summary and the `AGGREGATE_TEST_SUITE_PASS` line and exits 0.
- Given an operator or the harness `test_suite` gate runs `npm test` locally, when the run proceeds, then the reporter set is exactly the package script's dot reporter and no `[ci-progress]` line is written.

#### Negative Paths
- Given the launcher's Vitest child exits with code 0, when the launcher finishes, then it writes no `[run-vitest]` diagnostic line.
- Given the CI workflow's test step, when the repository integrity check inspects it, then the step still begins `npm test` so CI keeps running the authoritative suite command.

### Done When
- [ ] `src/conductor/package.json`'s `test` script is byte-identical to its pre-change value.
- [ ] A structural test asserts the `conductor` job runs `npm test -- --shard=` with the progress reporter, and that the package `test` script names no progress reporter.
