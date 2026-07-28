**Status:** Accepted

# Stories: CI daemon end-to-end smoke step (deterministic per-PR tier)

Track: technical (no PRD — acceptance criteria live here). Tier: S.
Source: jstoup111/ai-conductor#630 (deterministic per-PR half). The live-agent
nightly tier is explicitly out of scope — tracked separately as
jstoup111/ai-conductor#1124. See `.memory/decisions/daemon-e2e-smoke-step-630.md`
for the split rationale.

## Story: a fixture feature exercises real header and evidence-harvesting conventions

**Requirement:** #630 regression coverage for #578/#615/#620/#548/#636

As a harness maintainer, I want a committed fixture feature (stories + plan)
whose plan uses the real heading grammar the daemon parses in production, so
that a future regression in `plan-task-parse.ts` is caught by a full pipeline
run instead of only by unit tests exercising the parser in isolation.

### Acceptance Criteria

#### Happy Path
- Given a fixture plan file, when it is authored, then it contains at least
  one `### Task N — Title` heading, at least one `### T0 — Title` heading, and
  a `## Task Dependency Graph` section (not `## Task Graph`).
- Given the fixture plan's task evidence, when it is authored, then it
  contains one prose sentence with an inline `` `token` `` that is NOT a
  declared corroboration path, and at least one real `- \`path\`` bullet
  list item naming a file the fixture's own commit actually touches.
- Given the fixture plan is parsed by `plan-task-parse.ts`, when task ids are
  extracted, then the task count matches the number of real `### Task N —` /
  `### T0 —` headings only — the `## Task Dependency Graph` heading does not
  produce a phantom task id.

#### Negative Paths
- Given the fixture plan's inline-prose backtick token, when evidence
  corroboration runs, then that token is never treated as a required
  corroboration path (a fixture commit that omits it still satisfies
  corroboration for that task).
- Given the fixture plan's `- \`path\`` bullet declares a path the fixture's
  commit does NOT touch, when corroboration runs, then that task's evidence
  is correctly rejected as unsatisfied (proves the harvester still enforces
  real bullet-declared paths, not just that it ignores prose).

### Done When
- [ ] A fixture plan/stories pair exists under a project-fixtures path (e.g.
      `test/fixtures/daemon-e2e/`) containing the three heading shapes above.
- [ ] A unit-level assertion (or the E2E test itself) confirms
      `plan-task-parse.ts` extracts exactly the expected task ids from the
      fixture plan, with no phantom id from the `## Task Dependency Graph`
      heading.
- [ ] A unit-level assertion confirms the inline-prose backtick token is
      absent from the harvested corroboration path set for its task.

## Story: the fixture runs the full claim-through-finish pipeline via the injected provider fake

**Requirement:** #630 primary acceptance signal

As a harness maintainer, I want the fixture feature driven through the real
daemon dispatch code (claim → worktree setup/engine publish → build dispatch
→ evidence stamping/corroboration → completion gate/park-halt policy →
finish) with the existing injected `LLMProvider` fake standing in for the
agent, so that the SAME dispatch code path real builds use is exercised
end-to-end without spending real LLM tokens.

### Acceptance Criteria

#### Happy Path
- Given the fixture feature and a scripted `LLMProvider` fake (extending the
  existing `codex-provider-fake.ts` pattern) that makes real git commits with
  real trailers satisfying the fixture's declared evidence, when the E2E test
  runs the pipeline from claim through finish, then the pipeline reaches a
  finished/mergeable state (or local-merge equivalent) — never a halt and
  never a park.
- Given the fixture's build dispatch completes all tasks, when the completion
  gate evaluates, then it reports full task completion (no `pending` tasks)
  on the first evaluation, without requiring a re-kick.

#### Negative Paths
- Given the scripted fake's commit is missing an evidence trailer the gate
  requires, when the completion gate evaluates, then the pipeline halts (not
  silently completes) — proving the E2E test's happy-path pass is a genuine
  signal and not a gate that always passes regardless of evidence.
- Given a worktree/engine-publish step fails during setup (e.g. the fake
  interrupts before publish completes), when the pipeline retries, then it
  does not gate the retry on a stale pre-fix engine version (regression
  coverage for #625's sequencing bug).

### Done When
- [ ] A new E2E test file drives the fixture feature through the real
      dispatch code (not a reimplementation of dispatch logic) using the
      injected provider fake.
- [ ] The test asserts a finished/mergeable terminal state and explicitly
      asserts the absence of a halt marker and park marker.
- [ ] A second assertion (or a paired negative-path test) proves the gate
      still halts when the scripted fake omits required evidence, so the
      happy-path assertion can't pass vacuously.
- [ ] Wall-clock runtime for this test is bounded (documented budget, e.g.
      under a few minutes) since it invokes no real LLM.

## Story: the CI job actually runs the new test, not silently excluded

**Requirement:** #630 "runtime and cost... predictable enough to run per-PR"
plus the discovered gap that `test/smoke/**` and `*.smoke.test.ts` are
currently excluded from CI entirely

As a harness maintainer, I want the new fixture E2E test wired into
`.github/workflows/ci.yml` as a job feeding `ci-gate`, and named/pathed so it
does NOT fall under the existing `test/smoke/**` / `*.smoke.test.ts` vitest
exclusion, so that this coverage actually executes on every PR instead of
silently joining the already-excluded, never-run smoke suite.

### Acceptance Criteria

#### Happy Path
- Given the new E2E test file, when `vitest.config.ts`'s include/exclude
  patterns are evaluated, then the new test file is included in the default
  `npm test` run (or an explicitly new, non-excluded npm script that
  `ci.yml` invokes).
- Given `.github/workflows/ci.yml`, when the new job is added, then it is
  gated off the same `changes` job as `integrity`/`conductor`, and `ci-gate`
  lists it as a required dependency (its failure blocks the gate).

#### Negative Paths
- Given a future contributor adds a new smoke test file under
  `test/smoke/**` without reading this test's placement rationale, when CI
  runs, then the new E2E test's own job is unaffected (its inclusion is not
  contingent on the general smoke exclusion being lifted repo-wide) — proving
  the fix is scoped to this one test's visibility, not a silent blanket
  un-exclusion that could pull in other untriaged smoke tests.
- Given the new CI job fails, when `ci-gate`'s aggregate check evaluates,
  then the overall PR check fails (this job is required, not merely
  advisory).

### Done When
- [ ] `git grep` for the new test file's path against `vitest.config.ts`'s
      exclude patterns shows it is NOT matched by `test/smoke/**` or
      `*.smoke.test.ts`.
- [ ] `.github/workflows/ci.yml` contains a new job running this test,
      gated off `changes`, and listed in `ci-gate`'s `needs`.
- [ ] A deliberately-broken fixture commit (in a scratch/manual check, not
      committed) demonstrates the new CI job fails when the pipeline halts —
      confirms the job is exercised, not vacuously green.

## Story: a failure prints the daemon log and pipeline state, not a generic test failure

**Requirement:** #630 "A failure prints the daemon log excerpt + pipeline
state so the seam that broke is identifiable from CI output alone"

As a harness maintainer, I want the E2E test's failure path to print the
relevant daemon log excerpt and pipeline state (task statuses, halt/park
marker contents if present) to CI output on failure, so that a broken seam is
diagnosable from the CI log alone, without re-running locally.

### Acceptance Criteria

#### Happy Path
- Given the E2E test fails (assertion failure or the pipeline halts/parks
  unexpectedly), when the test's failure handler runs, then it prints the
  worktree's daemon log tail and the current task-status/evidence sidecar
  contents to stdout/stderr before the test framework reports failure.

#### Negative Paths
- Given the pipeline halts with a halt marker present, when the failure
  handler runs, then it prints the halt marker's reason/content (not just
  "test failed"), so the specific gate that halted is nameable from CI output.
- Given the daemon log file does not exist at the expected path (e.g. an
  earlier setup failure prevented it from being created), when the failure
  handler runs, then it reports that absence explicitly (e.g. "daemon log not
  found at <path>") rather than throwing an unrelated file-not-found error
  that obscures the real failure.

### Done When
- [ ] The E2E test has an `afterEach`/try-catch failure path that dumps the
      daemon log tail and pipeline state on any test failure.
- [ ] A manual/local run of the test with an intentionally broken fixture
      (e.g. a missing evidence bullet) shows the printed daemon log excerpt
      and halt reason in the test's failure output.
