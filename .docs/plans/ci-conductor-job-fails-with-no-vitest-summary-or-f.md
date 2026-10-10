# Implementation Plan: CI conductor job names the test files that were running when it fails

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/ci-conductor-job-fails-with-no-vitest-summary-or-f.md`)
**Stories:** .docs/stories/ci-conductor-job-fails-with-no-vitest-summary-or-f.md
**Conflict check:** Not required (Tier S)

## Summary

Give the sharded `conductor` CI job a Vitest progress reporter that names every test file as it
starts and finishes, names failing tests the moment their file finishes, reports a file that stops
making progress, and names in-flight files when the run ends abnormally. The launcher also states
how the Vitest process ended. Six tasks. Local `npm test` and the `test_suite` gate are untouched.

## Technical Approach

- **Why a reporter, not a reporter swap.** In run 35624876796 (attempt 1) the `npm test` step
  printed nothing between the `RUN v4.1.11` banner and `exit code 1` that named a file. With
  `--reporter=dot` on a non-TTY stream, Vitest writes one character per finished test and no
  newline (`DotReporter.onTestCaseResult`, `node_modules/vitest/dist/chunks/index.UpGiHP7g.js:3182-3190`),
  and it reports failures only in the end-of-run summary. Swapping to `default` would name finished
  files (`BaseReporter.onTestModuleEnd`, same file `:2234-2241`) but still never names the file that
  was *running* when the process died. Only a reporter that writes a line when a file starts can do
  that. The filer's hypothesis 1 (`dot` plus `--silent` hides progress) is therefore adopted in a
  narrowed form. The alternatives considered were: (a) `--reporter=default` in CI, rejected because
  it cannot name an in-flight file; (b) `hanging-process`, rejected because it fires only when
  Vitest fails to exit after the run (`HangingProcessReporter.onProcessTimeout`), which this
  failure never reached; (c) running with `--reporter=verbose`, rejected for the same reason as (a)
  plus per-test log volume.
- **New module** `src/conductor/test/reporters/ci-progress-reporter.ts`. Its default export is a
  class, because Vitest instantiates a custom reporter path with `new (default export)(options)`
  (`cli-api.CnMVyzaz.js:11445`). It lives under `test/` (test infrastructure, not shipped `src/`).
  It is type-checked by `tsconfig.test.json` (`include: test/**/*`) and is not collected as a test
  because its name does not end `.test.ts`. Its only runtime imports are `node:fs` and `node:path`;
  Vitest types are `import type` only. The constructor accepts optional injected
  `{ write, writeSync, now, setInterval, clearInterval, stallMs = 90_000, tickMs = 15_000 }` so unit
  tests drive it without real time or real stdout. The default `write` is `process.stdout.write`
  (synchronous for pipes on Linux, so a written line survives a later SIGKILL). The default
  `writeSync` is `fs.writeSync(1, …)`, used only inside the process `exit` handler.
- **Hooks used (all verified in the installed Vitest 4.1.11):**
  - `onTestModuleQueued` → `start`. It fires from the worker's `onCollectStart`, before the file is
    imported (`index.DXx9Dtk7.js:140-143` → `cli-api.CnMVyzaz.js:12624-12628`).
  - `onTestModuleStart` → `start` dedupe. An import-failed file is reported as start and end
    together (`cli-api.CnMVyzaz.js:12713-12717`).
  - `onTestModuleCollected`, `onHookStart`, `onHookEnd`, `onTestCaseReady`, `onTestCaseResult` →
    progress timestamp.
  - `onTestModuleEnd` → `done` + `failed test:` lines.
  - `onTestRunEnd(modules, errors, reason)` → in-flight dump and watchdog stop.

  Paths are written relative to `ctx.config.root` (captured in `onInit`), which is `src/conductor`
  in CI.
- **Line discipline.** Every record is `[ci-progress] …` on its own line. In CI the dot reporter
  runs first in the reporter list (the package script's `--reporter=dot` precedes the workflow's
  added flag). The progress reporter sets an `inlineDirty` flag on every non-pending
  `onTestCaseResult`, which is exactly when the non-TTY dot reporter writes a character. Before its
  next record it writes `\n` if the flag is set, then clears it.
- **Stall watchdog.** An `unref()`'d interval of `tickMs` compares `now()` with each in-flight
  file's last-progress time. When that gap reaches `stallMs` and at least `stallMs` has passed since
  that file's previous stall line, it writes `[ci-progress] stalled <path> no progress for <s>s`.
  The interval starts in `onTestRunStart` and is cleared in `onTestRunEnd`. 90 s is 3× the suite's
  `hookTimeout` of 30 s and 4.5× its `testTimeout` of 20 s (`vitest.config.ts`). Progress is
  measured per file, so a legitimately long file whose tests keep reporting is never flagged. The
  stall line is informational and never fails the run.
- **Abnormal end.**
  - `onTestRunEnd` with reason `failed` or `interrupted` writes `still running at run end: <path>`
    for each started file without `done`.
  - A `process.once('exit')` handler registered in `onInit` writes
    `process exiting before Vitest reported run end; in-flight: <paths|none>` only if
    `onTestRunEnd` never ran.
  - SIGKILL cannot run any handler. The already-written `start` line with no `done` names the file,
    and the launcher names the signal.
- **Launcher** `src/conductor/scripts/run-vitest.mjs`: on `signal !== null`, write
  `[run-vitest] vitest terminated by signal <SIG>` to stderr before the existing re-raise. On a
  non-zero `code`, write `[run-vitest] vitest exited with code <N>` and keep
  `process.exitCode = code`. Exit code 0 writes nothing. This covers hypothesis 2 for the Vitest
  main process. A dying fork worker is already reported by Vitest itself as `Worker exited
  unexpectedly` (`cli-api.CnMVyzaz.js:3089-3092`) and the run then completes normally.
- **Wiring.** Only the `conductor` job's step changes, to
  `npm test -- --shard=${{ matrix.shard }}/4 --reporter=./test/reporters/ci-progress-reporter.ts`.
  Vitest's `reporters` CLI option is `array: true` (`cac.uFydS1Z4.js:703-707`), so the effective set
  is `[dot, ci-progress]`. The step still begins `npm test`, which `test/test_skill_pipeline_contract.sh`
  requires (`- run: (npm test|npx vitest run)`). `src/conductor/package.json` is not edited.
- **Event spine:** not applicable. This is test-runner stdout in the CI step, with no conductor
  occurrence and no consumer (see the track file).
- **Local patterns to follow.**
  - Launcher tests: `src/conductor/test/vitest-startup.test.ts` copies `scripts/run-vitest.mjs` and
    `scripts/vitest-temp.mjs` into a `mkdtemp` fixture root, fakes the Vitest binary on `PATH`, and
    strips inherited Vitest temp env keys before `execa`. Reuse that shape; do not spawn the
    repository's own launcher against the live package root.
  - Workflow assertions: `src/conductor/test/structural/e2e-tier.test.ts` reads
    `.github/workflows/ci.yml` and `package.json` as text.

## Prerequisites

- None.

## Tasks

### Task 1: Progress reporter writes start, done, and failed-test lines on their own lines
**Story:** Story 1 (happy 1–3; negative 1–2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/reporters/ci-progress-reporter.test.ts`. Construct `CiProgressReporter` with an injected `write` that appends to an array. Call `onInit` with a stub `{ config: { root: '/pkg' } }`. Drive the hooks with minimal stub `TestModule` objects (`moduleId`, `state()`, `diagnostic().duration`, `children.allTests()` yielding stub test cases with `fullName` and `result().state`). Assert:
   - `onTestModuleQueued` for `/pkg/test/a.test.ts` writes `[ci-progress] start test/a.test.ts\n`. A subsequent `onTestModuleStart` for the same module writes nothing more.
   - `onTestModuleEnd` on a module with state `passed` writes `[ci-progress] done test/a.test.ts passed 1.2s` (duration 1234 ms, one decimal); a module with state `skipped` (all tests skipped) also writes `passed`.
   - A failed module with two failed tests writes `done … failed …s`, then one `[ci-progress] failed test: <fullName>` per failed test, in order.
   - A module reported only through `onTestModuleStart` + `onTestModuleEnd`, with state `failed` and zero tests (import failure), writes `start` and `done … failed`.
   - After an `onTestCaseResult` with state `passed`, the next record is preceded by exactly one `\n`. After a `pending` result, no `\n` is added.
2. Verify RED.
3. Implement the class (default export) with the injectable options listed in Technical Approach, the in-flight map keyed by `moduleId`, and the `inlineDirty` newline guard.
4. Verify GREEN; commit "test(ci): add Vitest progress reporter naming files as they start and finish".

**Done when:**
- [test] `ci-progress-reporter.test.ts` asserts `onTestModuleQueued` writes `[ci-progress] start <path relative to the Vitest root>` as the first record for that module, before any of its test-result records, and a following `onTestModuleStart` for the same module writes no second start line.
- [test] The same test file asserts `onTestModuleEnd` writes `[ci-progress] done <path> passed <s>s` for a module whose state is `passed` or `skipped` and `done <path> failed <s>s` followed by one `[ci-progress] failed test: <fullName>` line per failing test, in order, for a failed module, each record on its own line.
- [test] The same test file asserts an import-failed module (start and end with zero tests, state `failed`) yields both a `start` line and a `done <path> failed <s>s` line.
- [test] The same test file asserts a `[ci-progress]` record written after a non-pending `onTestCaseResult` is preceded by exactly one `\n`, so it begins a new line and is never appended to dot characters, and no `\n` is added after a `pending` result.

**Files likely touched:**
- `src/conductor/test/reporters/ci-progress-reporter.ts` — new reporter class
- `src/conductor/test/reporters/ci-progress-reporter.test.ts` — unit tests

**Dependencies:** none

### Task 2: Stall watchdog names a file with no progress for 90 seconds
**Story:** Story 2 (happy 1–2; negative 1–3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `ci-progress-reporter.test.ts` using injected `now`, `setInterval`, and `clearInterval` backed by a manual clock (no real timers). Assert:
   - After `onTestRunStart` and a start at t=0 with no further events, nothing is written at t=75 s, and `[ci-progress] stalled test/a.test.ts no progress for 90s` is written at the t=90 s tick. Use whole seconds, rounded down.
   - With still no progress, a second stalled line with `180s` appears at t=180 s, and none between.
   - A file receiving `onTestCaseResult` (or `onHookEnd`) every 60 s through t=300 s never gets a stalled line.
   - After `onTestModuleEnd` for a stalled file, later ticks write nothing for it.
   - `onTestRunEnd` calls the injected `clearInterval` with the handle, and later ticks write nothing. The handle returned by the default `setInterval` has `unref()` called on it (assert via an injected fake handle exposing `unref`).
2. Verify RED.
3. Implement the per-module `lastProgressAt` / `lastStallReportAt` fields, progress updates in `onTestModuleCollected`, `onHookStart`, `onHookEnd`, `onTestCaseReady`, and `onTestCaseResult` (resolved to the module via `testModule` / `entity.module`), and the tick check.
4. Verify GREEN; commit "test(ci): report Vitest test files that stop making progress".

**Done when:**
- [test] `ci-progress-reporter.test.ts` asserts, on a manual clock with a 15 s tick, that a started file with no progress gets no stalled line at 75 s and exactly one `[ci-progress] stalled <path> no progress for 90s` line by the 90 s tick (within 90–105 s).
- [test] The same test file asserts a second stalled line reporting `180s` is written at the 180 s tick with none in between, and none is written after that file's `onTestModuleEnd`.
- [test] The same test file asserts a file receiving a progress event every 60 s through 300 s produces no stalled line.
- [test] The same test file asserts `onTestRunEnd` passes the watchdog handle to `clearInterval`, that no tick writes afterwards, and that `unref()` was called on the interval handle so the watchdog does not keep the process alive.

**Files likely touched:**
- `src/conductor/test/reporters/ci-progress-reporter.ts` — watchdog
- `src/conductor/test/reporters/ci-progress-reporter.test.ts` — watchdog tests

**Dependencies:** Task 1

### Task 3: Reporter names in-flight files at abnormal run end and at premature process exit
**Story:** Story 3 (happy 1–2; negative 2)
**Type:** negative-path

**Steps:**
1. Write failing tests in `ci-progress-reporter.test.ts`:
   - With files A (done) and B (started, not done), `onTestRunEnd([], [], 'failed')` writes exactly one `[ci-progress] still running at run end: test/b.test.ts` and nothing for A. The same holds for `'interrupted'`.
   - `onTestRunEnd(…, 'passed')` with B still in flight writes no `still running` line.
   - The `exit` handler the reporter registered in `onInit` (captured via an injected `onProcessExit` registrar, defaulting to `process.once('exit', …)`), invoked before any `onTestRunEnd`, calls the injected `writeSync` with `[ci-progress] process exiting before Vitest reported run end; in-flight: test/b.test.ts`. Invoked with nothing in flight, it writes `…; in-flight: none`. Invoked after `onTestRunEnd`, it writes nothing.
2. Verify RED.
3. Implement the run-end dump and the guarded exit handler.
4. Verify GREEN; commit "test(ci): name in-flight test files when a Vitest run ends abnormally".

**Done when:**
- [test] `ci-progress-reporter.test.ts` asserts `onTestRunEnd` with reason `failed` and with reason `interrupted` each writes exactly one `[ci-progress] still running at run end: <path>` line per started file lacking `done`, and none for finished files.
- [test] The same test file asserts `onTestRunEnd` with reason `passed` writes no `still running at run end` line even when a started file lacks `done`.
- [test] The same test file asserts the registered process-exit handler, invoked before `onTestRunEnd`, writes via `writeSync` `[ci-progress] process exiting before Vitest reported run end; in-flight: <paths>` naming every started file lacking `done` (or `none` when empty), and writes nothing when invoked after `onTestRunEnd`.

**Files likely touched:**
- `src/conductor/test/reporters/ci-progress-reporter.ts` — run-end and exit handling
- `src/conductor/test/reporters/ci-progress-reporter.test.ts` — abnormal-end tests

**Dependencies:** Task 1

### Task 4: Launcher states how the Vitest process ended
**Story:** Story 3 (happy 3–4); Story 4 (negative 1)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/vitest-startup.test.ts`, following its existing fake-binary pattern: copy `run-vitest.mjs` and `vitest-temp.mjs` into the `mkdtemp` fixture root, put a fake `vitest` on `PATH`, and strip inherited Vitest temp keys. The existing fake honors `FAKE_VITEST_EXIT_CODE`; extend it with `FAKE_VITEST_SIGNAL`, which makes the fake `process.kill(process.pid, <signal>)` itself. Assert:
   - With `FAKE_VITEST_EXIT_CODE=3`, the launcher exits 3 and stderr contains `[run-vitest] vitest exited with code 3`.
   - With `FAKE_VITEST_SIGNAL=SIGKILL`, the launcher's own process ends by `SIGKILL` (execa `signal === 'SIGKILL'`) and stderr contains `[run-vitest] vitest terminated by signal SIGKILL`.
   - With exit code 0, stderr contains no `[run-vitest]` text and the exit code is 0.
2. Verify RED.
3. In `scripts/run-vitest.mjs`, write the stderr line before the existing `process.kill(process.pid, signal)` and on the non-zero `code` branch. Leave the zero branch silent.
4. Verify GREEN; commit "fix(test-launcher): state how the Vitest process ended".

**Done when:**
- [test] `vitest-startup.test.ts` asserts a fake Vitest exiting 3 makes `run-vitest.mjs` exit 3 with stderr containing `[run-vitest] vitest exited with code 3`.
- [test] `vitest-startup.test.ts` asserts a fake Vitest that SIGKILLs itself makes `run-vitest.mjs` write `[run-vitest] vitest terminated by signal SIGKILL` to stderr and then end by `SIGKILL`.
- [test] `vitest-startup.test.ts` asserts a fake Vitest exiting 0 leaves the launcher's stderr free of `[run-vitest]` and its exit code 0.

**Files likely touched:**
- `src/conductor/scripts/run-vitest.mjs` — exit diagnostics
- `src/conductor/test/vitest-startup.test.ts` — launcher exit tests

**Dependencies:** none

### Task 5: Wire the progress reporter into the conductor CI job only
**Story:** Story 1 (wiring); Story 4 (happy 1–2; negative 2)
**Type:** infrastructure

**Steps:**
1. Write a failing structural test `src/conductor/test/structural/ci-progress-wiring.test.ts`, following `test/structural/e2e-tier.test.ts`, which reads `.github/workflows/ci.yml` and `package.json` as text. Assert:
   - The `conductor` job block (text between `  conductor:` and the next top-level job key) contains `- run: npm test -- --shard=${{ matrix.shard }}/4 --reporter=./test/reporters/ci-progress-reporter.ts`, and the following line is `working-directory: src/conductor`.
   - `src/conductor/test/reporters/ci-progress-reporter.ts` exists.
   - The `conductor-e2e` job block contains no `ci-progress-reporter`.
   - `package.json`'s `scripts.test` equals exactly `sh -c 'node scripts/run-vitest.mjs run --reporter=dot --silent --slowTestThreshold=1800000 "$@" && echo "AGGREGATE_TEST_SUITE_PASS"' --` and contains no `ci-progress`.
2. Verify RED.
3. Edit the `conductor` job's test step in `.github/workflows/ci.yml` to add the reporter flag. Update the job's leading comment to say the progress reporter names in-flight files when a shard dies before the summary.
4. Verify GREEN; commit "ci: name in-flight Vitest files in the conductor job log".

**Done when:**
- [test] `ci-progress-wiring.test.ts` asserts the `conductor` job's step is `npm test -- --shard=${{ matrix.shard }}/4 --reporter=./test/reporters/ci-progress-reporter.ts` with `working-directory: src/conductor`, so CI runs `[dot, ci-progress]` with the Vitest root (and every `[ci-progress]` `<path>`) relative to `src/conductor`, and the step still begins `npm test`.
- [test] The same test asserts `package.json` `scripts.test` is byte-identical to the pre-change string (dot reporter only, still ending with the `AGGREGATE_TEST_SUITE_PASS` echo), so local and `test_suite` runs write no `[ci-progress]` line.
- [test] The same test asserts the `conductor-e2e` job does not reference the progress reporter.
- `test/test_skill_pipeline_contract.sh`'s `- run: (npm test|npx vitest run)` CI assertion still passes against the edited `ci.yml`.

**Files likely touched:**
- `.github/workflows/ci.yml` — conductor job test step and comment
- `src/conductor/test/structural/ci-progress-wiring.test.ts` — wiring assertions

**Dependencies:** Task 1

### Task 6: Real Vitest child runs prove the log names finished, failing, and killed files
**Story:** Story 1 (happy 1–3, at the entry point); Story 3 (negative 1); Story 4 (happy 1)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/reporters/ci-progress-reporter.integration.test.ts`. Each case builds a `mkdtemp` fixture root containing:
   - copies of `scripts/run-vitest.mjs`, `scripts/vitest-temp.mjs`, and `test/reporters/ci-progress-reporter.ts` at the same relative paths;
   - a `vitest.config.mjs` with `include: ['cases/**/*.case.mjs']`, `globals: true`, `pool: 'forks'`, `maxWorkers: 1`, no `setupFiles`, and no `globalSetup`;
   - fixture case files written as `.case.mjs`, so the suite's own `test/**/*.test.ts` include never collects them.

   Launch with `execa(process.execPath, [<fixture>/scripts/run-vitest.mjs, 'run', '--config', 'vitest.config.mjs', '--reporter=dot', '--reporter=./test/reporters/ci-progress-reporter.ts'], { cwd: fixture, reject: false })`. The env is the parent env minus every `VITEST*` key, `NODE_OPTIONS`, and the `AI_CONDUCTOR_TEST_*` temp keys. `PATH` is prefixed with `src/conductor/node_modules/.bin` (absolute), because the fixture has no `node_modules`. Cases:
   - (a) `cases/pass.case.mjs` (one passing test) and `cases/fail.case.mjs` (test `breaks` failing). stdout contains `[ci-progress] start cases/pass.case.mjs`, `done cases/pass.case.mjs passed`, `start cases/fail.case.mjs`, `done cases/fail.case.mjs failed`, and `[ci-progress] failed test: breaks`, each at the start of a line. The `start` line for each file precedes its `done` line.
   - (b) Passing-only fixture, launched exactly as CI launches it: run `sh -c <scripts.test string read from src/conductor/package.json> -- --config vitest.config.mjs --reporter=./test/reporters/ci-progress-reporter.ts` with `cwd` the fixture root, mirroring `npm test -- …` appending through `"$@"`. Assert exit code 0, stdout contains Vitest's `Test Files` summary line and two `done … passed` lines, the last non-empty stdout line is `AGGREGATE_TEST_SUITE_PASS`, and no `[ci-progress]` line appears after the `Test Files` summary line.
   - (c) `cases/kill.case.mjs` kills the nested Vitest main process at module top level, during its own import and before any of its tests is collected. It runs `process.kill(process.ppid, 'SIGKILL')` only when `process.env.CI_PROGRESS_KILL_TOKEN` equals the per-test random token and `process.ppid !== Number(process.env.CI_PROGRESS_OUTER_PID)`. The integration test passes its own `process.pid` as `CI_PROGRESS_OUTER_PID`. After the kill, the case kills its own worker after 500 ms so no orphan remains. Assert stdout contains `[ci-progress] start cases/kill.case.mjs` (proving the start line is written before the file's import completes) and no `done cases/kill.case.mjs`, stderr contains `[run-vitest] vitest terminated by signal SIGKILL`, and the result's `signal` is `SIGKILL`.
2. Verify RED (the reporter or launcher lines are absent before Tasks 1, 3, and 4 land).
3. No production change beyond Tasks 1, 3, and 4 is expected. If a hook name or path base differs in the real run, fix it in `ci-progress-reporter.ts`.
4. Verify GREEN; commit "test(ci): prove progress lines from real Vitest child runs".

**Done when:**
- [test] `ci-progress-reporter.integration.test.ts` case (a) asserts a real `run-vitest.mjs` → Vitest child run with `--reporter=dot --reporter=./test/reporters/ci-progress-reporter.ts` writes, each at a line start, `start` before `done … passed` for the passing file, `start` before `done … failed` for the failing file, and `[ci-progress] failed test: breaks` written before Vitest's end-of-run summary, with `<path>` relative to the Vitest root.
- [test] The same test file's case (b) asserts a passing-only real child run launched through the package `scripts.test` command with the CI reporter flag appended exits 0, prints the two `done … passed` lines before Vitest's summary, and ends with the Vitest summary block followed by the `AGGREGATE_TEST_SUITE_PASS` line, with no `[ci-progress]` line after the `Test Files` summary line.
- [test] The same test file's case (c) asserts that after the fixture SIGKILLs the nested Vitest main process from its module top level, before its import completes (guarded by the per-test token and the outer-pid inequality), stdout has `start cases/kill.case.mjs` with no `done cases/kill.case.mjs`, and stderr has `[run-vitest] vitest terminated by signal SIGKILL`.

**Files likely touched:**
- `src/conductor/test/reporters/ci-progress-reporter.integration.test.ts` — real child-run tests

**Dependencies:** Tasks 1, 3, 4

## Task Dependency Graph

```
Task 1 ──┬─> Task 2
         ├─> Task 3 ──┐
         ├─> Task 5   ├─> Task 6
Task 4 ───────────────┘
```

## Integration Points

- After Task 5: the `conductor` CI job (`.github/workflows/ci.yml`, the production entry point for this behavior) runs Vitest with `[dot, ci-progress]`.
- After Task 6: real `run-vitest.mjs` → Vitest child runs prove the start/done/failed-test lines and the SIGKILL trace end to end.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the `conductor` CI job runs its Vitest shard, when a worker begins loading a test file, then the step log contains a line `[ci-progress] start <path>` where `<path>` is the file's path relative to `src/conductor`, written before that file's module import completes and before any of its test results are reported. | 1, 5, 6 | "with the Vitest root (and every `[ci-progress]` `<path>`) relative to `src/conductor`" | diff-local |
| Story 1 happy: Given a test file in the shard finishes with every test passing or skipped, when Vitest reports the file finished, then the step log contains `[ci-progress] done <path> passed <seconds>s` on its own line. | 1, 6 | "writes `[ci-progress] done <path> passed <s>s` for a module whose state is `passed` or `skipped`" | diff-local |
| Story 1 happy: Given a test file in the shard finishes with at least one failing test, when Vitest reports the file finished, then the step log contains `[ci-progress] done <path> failed <seconds>s` followed by one `[ci-progress] failed test: <full test name>` line per failing test, written at that moment rather than only in the end-of-run summary. | 1, 6 | "`done <path> failed <s>s` followed by one `[ci-progress] failed test: <fullName>` line per failing test" | diff-local |
| Story 1 negative: Given the dot reporter has written result characters without a trailing newline, when a `[ci-progress]` line is written, then that line begins at the start of a new line and is never appended to the run of dot characters. | 1 | "a `[ci-progress]` record written after a non-pending `onTestCaseResult` is preceded by exactly one `\n`, so it begins a new line and is never appended to dot characters" | diff-local |
| Story 1 negative: Given a test file fails while loading (its module throws during collection, so it has no test results), when Vitest reports the file finished, then the step log contains `[ci-progress] done <path> failed <seconds>s` for that file. | 1 | "an import-failed module (start and end with zero tests, state `failed`) yields both a `start` line and a `done <path> failed <s>s` line" | diff-local |
| Story 2 happy: Given a test file has started and Vitest has reported no progress for it (no collection, hook start or end, test start, or test result) for 90 seconds, when the progress watchdog next checks (at most every 15 seconds), then the step log contains `[ci-progress] stalled <path> no progress for <seconds>s` naming that file. | 2 | "exactly one `[ci-progress] stalled <path> no progress for 90s` line by the 90 s tick (within 90–105 s)" | diff-local |
| Story 2 happy: Given a file has been reported stalled and still reports no progress, when a further 90 seconds pass without progress, then the stalled line for that file is written again with the larger elapsed time. | 2 | "a second stalled line reporting `180s` is written at the 180 s tick with none in between" | diff-local |
| Story 2 negative: Given a file that is slow overall but reports progress at least every 90 seconds, when the watchdog checks, then no stalled line is written for that file. | 2 | "a file receiving a progress event every 60 s through 300 s produces no stalled line" | diff-local |
| Story 2 negative: Given a file reported stalled that then finishes, when its `done` line is written, then no further stalled line is written for that file. | 2 | "none is written after that file's `onTestModuleEnd`" | diff-local |
| Story 2 negative: Given the run has ended, when the process remains alive afterwards, then the watchdog writes nothing further and does not by itself keep the Vitest process alive. | 2 | "no tick writes afterwards, and that `unref()` was called on the interval handle so the watchdog does not keep the process alive" | diff-local |
| Story 3 happy: Given the Vitest run ends with reason `failed` or `interrupted` while one or more started files have no `done` line, when Vitest reports the run's end, then the step log contains `[ci-progress] still running at run end: <path>` once per such file. | 3 | "each writes exactly one `[ci-progress] still running at run end: <path>` line per started file lacking `done`" | diff-local |
| Story 3 happy: Given the Vitest process exits before reporting the run's end (for example an unhandled fatal error that calls process exit), when the process is exiting, then the step log contains `[ci-progress] process exiting before Vitest reported run end; in-flight: <paths>` naming every started file with no `done` line, or `none`. | 3 | "writes via `writeSync` `[ci-progress] process exiting before Vitest reported run end; in-flight: <paths>` naming every started file lacking `done` (or `none` when empty)" | diff-local |
| Story 3 happy: Given the Vitest child launched by `scripts/run-vitest.mjs` is terminated by a signal, when the launcher observes the exit, then it writes `[run-vitest] vitest terminated by signal <SIGNAL>` to stderr before re-raising that signal. | 4 | "write `[run-vitest] vitest terminated by signal SIGKILL` to stderr and then end by `SIGKILL`" | diff-local |
| Story 3 happy: Given the Vitest child exits with a non-zero code, when the launcher observes the exit, then it writes `[run-vitest] vitest exited with code <N>` to stderr and exits with that same code. | 4 | "makes `run-vitest.mjs` exit 3 with stderr containing `[run-vitest] vitest exited with code 3`" | diff-local |
| Story 3 negative: Given the Vitest main process is killed with SIGKILL while a test file is loading or running, so no in-process handler can run, when the step log is read, then it still contains that file's `start` line with no matching `done` line and the launcher's `terminated by signal SIGKILL` line. | 6 | "stdout has `start cases/kill.case.mjs` with no `done cases/kill.case.mjs`, and stderr has `[run-vitest] vitest terminated by signal SIGKILL`" | diff-local |
| Story 3 negative: Given the run ends with reason `passed`, when Vitest reports the run's end, then no `still running at run end` line is written. | 3 | "`onTestRunEnd` with reason `passed` writes no `still running at run end` line" | diff-local |
| Story 4 happy: Given the `conductor` CI job runs a shard whose tests all pass, when the run ends, then the step still ends with the Vitest summary and the `AGGREGATE_TEST_SUITE_PASS` line and exits 0. | 5, 6 | "ends with the Vitest summary block followed by the `AGGREGATE_TEST_SUITE_PASS` line, with no `[ci-progress]` line after the `Test Files` summary line" | diff-local |
| Story 4 happy: Given an operator or the harness `test_suite` gate runs `npm test` locally, when the run proceeds, then the reporter set is exactly the package script's dot reporter and no `[ci-progress]` line is written. | 5 | "`package.json` `scripts.test` is byte-identical to the pre-change string (dot reporter only, still ending with the `AGGREGATE_TEST_SUITE_PASS` echo), so local and `test_suite` runs write no `[ci-progress]` line" | diff-local |
| Story 4 negative: Given the launcher's Vitest child exits with code 0, when the launcher finishes, then it writes no `[run-vitest]` diagnostic line. | 4 | "a fake Vitest exiting 0 leaves the launcher's stderr free of `[run-vitest]` and its exit code 0" | diff-local |
| Story 4 negative: Given the CI workflow's test step, when the repository integrity check inspects it, then the step still begins `npm test` so CI keeps running the authoritative suite command. | 5 | "and the step still begins `npm test`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
