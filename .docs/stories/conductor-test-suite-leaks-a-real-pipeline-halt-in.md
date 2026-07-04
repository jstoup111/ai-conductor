**Status:** Accepted

# Stories: conductor test suite must not leak .pipeline artifacts into the process cwd

Technical track (no PRD). Source: jstoup111/ai-conductor#252. Approved approach: make
`projectRoot` a required `ConductorOptions` field, isolate all test pipeline writes into
tmpdirs, and guard the suite against future cwd leaks.

## Story: Conductor requires an explicit projectRoot

**Requirement:** TECH-1 (remove the implicit `process.cwd()` pipeline root)

As a harness maintainer, I want `Conductor` to refuse construction without an explicit
`projectRoot` so that no caller — production or test — can silently write `.pipeline/`
artifacts into the ambient working directory.

### Acceptance Criteria

#### Happy Path
- Given a caller passing `projectRoot: <dir>`, when the Conductor runs to any terminal state,
  then every `.pipeline/` artifact it writes (`HALT`, `DONE`, `gates/`, remediation files) is
  created under `<dir>/.pipeline`, never under `process.cwd()`.
- Given the two production call sites (`src/daemon-cli.ts` and `src/index.ts`), when the
  package is compiled, then both already satisfy the required option and their behavior is
  byte-for-byte unchanged.

#### Negative Paths
- Given TypeScript compilation, when any code constructs `new Conductor({...})` without a
  `projectRoot`, then the build fails with a type error (the option is required, not optional).
- Given a runtime caller that evades the type system (e.g. `projectRoot: undefined as any` or
  an empty string), when the constructor executes, then it throws a descriptive error naming
  `projectRoot` before any filesystem write occurs — no `.pipeline/` path is ever derived from
  `process.cwd()`.

### Done When
- [ ] `ConductorOptions.projectRoot` is a required (non-optional) field; the `?? process.cwd()`
      fallback at the constructor is deleted.
- [ ] Constructor throws on missing/empty `projectRoot` at runtime, covered by a unit test.
- [ ] `npx tsc --noEmit` (or the package build) passes with zero Conductor construction sites
      lacking `projectRoot`.
- [ ] `grep -n "process.cwd()" src/engine/conductor.ts` shows no pipeline-root usage.

## Story: Conductor tests write pipeline artifacts only inside isolated tmpdirs

**Requirement:** TECH-2 (isolate the offending test constructions)

As a harness maintainer, I want every Conductor test to direct its pipeline writes into the
test's own tmpdir so that running the suite from any directory — including a live feature
worktree — leaves that directory untouched.

### Acceptance Criteria

#### Happy Path
- Given the full vitest suite, when it runs from `src/conductor/` (or any cwd), then it passes
  and no `.pipeline/` directory is created or modified in that cwd.
- Given a failure-path test that drives a step to `failed in auto mode (retries exhausted)`,
  when it runs, then the resulting `HALT` and `gates/` files appear under the test's tmpdir
  `projectRoot` and are removed with it.

#### Negative Paths
- Given the suite running from a directory that already contains a live `.pipeline/` (a real
  feature worktree mid-build), when the suite completes, then that pre-existing `.pipeline/`'s
  contents (`HALT` absent, gate files, `DONE`) are bit-identical to before the run — the suite
  neither parks nor un-parks the feature.

### Done When
- [ ] All Conductor constructions in `test/engine/conductor.test.ts`,
      `test/engine/when-parallel.test.ts`, and `test/integration/config-flow.test.ts` pass an
      isolated tmpdir `projectRoot` (compiler-enforced by TECH-1).
- [ ] `rtk proxy npx vitest run` from `src/conductor/` exits green with no `src/conductor/.pipeline`
      left behind (verified by `test -e src/conductor/.pipeline; echo $?` → `1`).

## Story: Suite-level guard fails the run on any cwd .pipeline leak

**Requirement:** TECH-3 (defense in depth against future leak vectors)

As a harness maintainer, I want the test suite itself to fail loudly if any test leaks a
`.pipeline/` artifact into the suite's cwd so that leak regressions from *other* code paths
(not just the Conductor constructor) are caught in CI, not in a poisoned daemon worktree.

### Acceptance Criteria

#### Happy Path
- Given a clean suite run with fully isolated tests, when global teardown executes, then the
  guard passes silently and the suite's exit code reflects only the tests themselves.

#### Negative Paths
- Given a test that (re)introduces a cwd-relative pipeline write, when the suite finishes, then
  global teardown fails the run with an error naming the leaked path(s) (e.g.
  `.pipeline/HALT appeared in <cwd> during the test run`), so CI goes red instead of silently
  shipping the leak.
- Given a cwd that legitimately contained a `.pipeline/` directory BEFORE the suite started (a
  live feature worktree), when the suite finishes without any test modifying it, then the guard
  does NOT false-positive — it compares against the pre-run snapshot taken in global setup and
  only fails on files the suite created or changed.

### Done When
- [ ] Global setup snapshots the cwd `.pipeline/` state (existence + entry list + mtimes or
      hashes); global teardown diffs against it and throws on any addition/modification.
- [ ] The guard's trip case and its no-false-positive case are each covered by a test (or a
      scripted self-check documented in the test file).
- [ ] Guard lives with the existing kill-switch setup (`test/setup.ts` / vitest global setup)
      and runs on every `vitest run` invocation without opt-in flags.
