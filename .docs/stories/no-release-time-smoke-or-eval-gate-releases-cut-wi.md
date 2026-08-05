**Status:** Accepted

# Stories: Release-Time Smoke and Eval Gate

**Feature:** no-release-time-smoke-or-eval-gate-releases-cut-wi (jstoup111/ai-conductor#1259)
**Tier:** M · **Track:** technical (no PRD — acceptance criteria live here)
**Approved ADRs:** `adr-2026-08-04-classify-before-spend-release-smoke-gate`,
`adr-2026-08-04-smoke-capability-declaration-and-single-entry-point`

Requirement tags reference the issue's stated desired outcomes:

| Tag | Desired outcome |
|---|---|
| DO-1 | One documented command runs the entire smoke tier |
| DO-2 | A release cannot be cut while the smoke tier is failing |
| DO-3 | A newly added smoke file is picked up without editing any list |
| DO-4 | A signal exercises the pipeline against a real agent, not a provider fake |
| DO-5 | Gate failures are attributable — which case failed, where its evidence lives |
| DO-6 | Unavailable credentials report explicitly rather than passing an empty run |

---

## Story 1: One command runs the whole smoke tier, discovered by glob

**Requirement:** DO-1, DO-3

As a maintainer, I want a single documented command that runs every smoke test, so that I do not
have to know nine filenames or their individual conventions.

### Acceptance Criteria

#### Happy Path
- Given a checkout with the nine existing smoke files, when I run `npm run smoke` from
  `src/conductor`, then all nine are discovered and reported — none silently omitted.
- Given `npm run smoke` completes, when I read its output, then every discovered file appears
  exactly once with an outcome of ran, skipped, or failed.
- Given a contributor adds `test/whatever/new-thing.smoke.test.ts`, when they run `npm run smoke`
  with no other edit to any config, script, workflow, or documentation table, then the new file is
  discovered and reported.
- Given a contributor adds `test/smoke/another-thing.test.ts`, when they run `npm run smoke`, then
  it is discovered by the `test/smoke/**` glob.

#### Negative Paths
- Given the smoke config is present, when I run `npm test`, then no smoke file executes — the
  default run's isolation is unchanged.
- Given someone removes either smoke exclusion glob from `vitest.config.ts`, when the suite runs,
  then `test/structural/test-execution-policy.test.ts` fails with
  `vitest.config.ts: default run includes smoke tests`.
- Given `vitest.smoke.config.ts` is authored by extending the default config rather than declaring
  `exclude: []`, when `npm run smoke` runs, then zero tests are selected — this must be caught by a
  test asserting a non-empty discovered set, not left to reviewer vigilance.
- Given no smoke file matches either include glob, when `npm run smoke` runs, then it exits
  non-zero reporting an empty discovery rather than exiting 0 on a vacuous pass.

### Done When
- [ ] `npm run smoke` exists in `src/conductor/package.json` `scripts`.
- [ ] `src/conductor/vitest.smoke.config.ts` exists with `include` globs `test/smoke/**` and
      `**/*.smoke.test.ts` and literal `exclude: []`.
- [ ] `src/conductor/vitest.config.ts` still contains both exclusion globs, byte-identical in
      effect; `test/structural/test-execution-policy.test.ts` passes unchanged.
- [ ] A test asserts the smoke config discovers all nine known files by count and by name.
- [ ] A test asserts an empty discovery set exits non-zero.
- [ ] `docs/contributing/testing.md` documents `npm run smoke` and no longer states that no such
      command exists.

---

## Story 2: Every smoke file declares the capability it requires

**Requirement:** DO-5, DO-6

As a maintainer, I want each smoke test to declare what it needs rather than carry a bespoke env
switch, so that a run tells me truthfully what executed and what could not.

### Acceptance Criteria

#### Happy Path
- Given all nine smoke files, when I inspect them, then each declares exactly one capability from
  the closed set `hermetic`, `toolchain`, `credentialed`.
- Given a machine with no `codex` binary and no provider credential, when I run `npm run smoke` in
  advisory mode, then the `hermetic` files run, and the `toolchain` and `credentialed` files are
  reported skipped, each naming the specific capability that was unmet.
- Given a run completes, when I read the ledger, then every file appears with its declared
  capability and its outcome, and every failure carries the path to its evidence.
- Given `publish-interrupted.smoke.test.ts`, when I inspect its declaration, then it is
  `toolchain` — it execs `bin/setup`, which runs `npm install` — not `hermetic`.

#### Negative Paths
- Given gate mode is active and the provider credential is absent, when the tier runs, then the run
  **fails** and names `CLAUDE_CODE_OAUTH_TOKEN` as the missing credential — it does not skip and
  does not report success.
- Given gate mode is active and every credentialed file skips, when the run finishes, then it exits
  non-zero; a run in which no credentialed test executed can never report a pass.
- Given a new smoke file declares no capability, when the tier runs, then it is rejected with an
  error naming the file — an undeclared file is never treated as `hermetic` by default.
- Given a smoke file declares a capability outside the closed set, when the tier runs, then it
  fails with an error naming the file and the invalid value.
- Given a `toolchain` file's required binary is absent in advisory mode, when the tier runs, then
  that file is reported skipped with the binary named, and the run's other files still execute and
  report independently.
- Given a smoke test fails on assertion (not on capability), when the tier runs, then the ledger
  distinguishes `failed` from `skipped`, so a genuine regression is never presented as an
  environmental skip.
- Given an operator force-skips a `credentialed` capability while gate mode is active, when the
  tier runs, then the run **fails** — an override is never a path to a passing release.
- Given an operator force-skips a capability in advisory mode, when the tier runs, then the
  affected files report `skipped (operator override)`, distinguishable in the ledger from a skip
  caused by a genuinely unavailable capability.

### Done When
- [ ] A shared helper module exposes the capability declaration and the closed capability enum.
- [ ] All nine smoke files declare a capability; the per-file env vars `AUTORESOLVE_SMOKE_TEST`,
      `CODEX_CLI_SMOKE_TEST`, `PRIORITY_GH_SMOKE`, `MODEL_UNAVAILABLE_SMOKE`, `AUTH_FAILURE_SMOKE`,
      `BUILD_TOKEN_AUTH_SMOKE`, `DAEMON_E2E_LIVE_SMOKE` no longer gate execution.

      > **Amended 2026-08-04 by #1259:** the nine bespoke variable *spellings* are retired, but the
      > operator-override *capability* they provided is retained behind one uniform mechanism
      > recognized by the capability helper (force-skip by capability or by file). Retiring the
      > concept outright would remove an affordance that accepted specs depend on —
      > `DAEMON_E2E_LIVE_SMOKE=0` is the documented way to disable an otherwise credentialed local
      > run (`docs/contributing/testing.md:85`, ST-1124-5), and `CODEX_CLI_SMOKE_TEST=1` is cited by
      > #927's stories and architecture review. In advisory mode a forced skip reports as
      > `skipped (operator override)`; in gate mode a forced skip of a `credentialed` capability is a
      > **failure**, so an override can never be why a release passes. See
      > `.docs/conflicts/2026-08-04-no-release-time-smoke-or-eval-gate-releases-cut-wi.md`, Conflict 2.
- [ ] The run emits a per-file ledger of file, capability, outcome, unmet capability (on skip), and
      evidence path (on failure).
- [ ] Advisory mode skips on unmet capability; gate mode fails on unmet capability. Both covered by
      tests.
- [ ] A test proves gate mode exits non-zero when all credentialed files skip.
- [ ] A test proves an undeclared or invalidly-declared file is rejected.
- [ ] `docs/contributing/testing.md`'s per-file gate table is replaced by capability documentation.

---

## Story 3: Classifying a release is free and mutates nothing

**Requirement:** DO-2

As the release workflow, I want to learn whether a push would publish without performing or
authorizing any publication, so that I can decide whether spending money on the smoke tier is
warranted.

### Acceptance Criteria

#### Happy Path
- Given a push to `main` that is the designated bot release-PR merge with complete head-bound audit
  evidence and an approved `VERSION`/`CHANGELOG.md`, when `classifyReleasePublication` runs, then
  it returns `publishable` with the resolved version.
- Given a push to `main` that is an ordinary feature-PR merge, when
  `classifyReleasePublication` runs, then it returns `ignored`.
- Given a push to a branch other than `main`, when `classifyReleasePublication` runs, then it
  returns `ignored`.
- Given any classification outcome, when the call completes, then no annotated tag and no GitHub
  Release has been created — the injected git/github seams record zero mutating calls.

#### Negative Paths
- Given the designated release PR lacks a `release-candidate-audit` check, when classify runs, then
  it returns `rejected` naming missing audit evidence.
- Given the audit check exists but is bound to a different head commit than the PR's head, when
  classify runs, then it returns `rejected` — stale audit evidence never classifies as publishable.
- Given the merge commit's `VERSION` is absent or not valid semver, when classify runs, then it
  returns `rejected`.
- Given `CHANGELOG.md` has no matching `## [X.Y.Z] - YYYY-MM-DD` section, or that section's body is
  empty, when classify runs, then it returns `rejected`.
- Given a PR authored by an account other than the release app, or with a head branch other than
  `automation/release-pr`, when classify runs, then it returns `ignored` — provenance is not
  assumed from the merge commit alone.
- Given classify returned `publishable` and the candidate then changes before publish runs, when
  `runReleasePublisherAction` executes, then it re-derives every condition from GitHub and returns
  `rejected` rather than tagging on the stale classification.

### Done When
- [ ] `classifyReleasePublication` is exported from
      `src/conductor/src/engine/release-publisher-action.ts` and re-exported from `src/index.ts`.
- [ ] It returns a discriminated result covering `ignored`, `rejected` (with reason), and
      `publishable` (with version).
- [ ] A test asserts zero mutating seam calls across all classification outcomes.
- [ ] `runReleasePublisherAction`'s existing behavior is unchanged — its current tests pass without
      modification, and it still derives publication authority itself rather than from a classify
      result.

---

## Story 4: A release cannot be tagged while the smoke tier is failing

**Requirement:** DO-2, DO-4, DO-6

As the operator, I want the smoke tier to run automatically right after the release PR merges and
block tagging when it fails, so that no release publishes without a real end-to-end signal.

### Acceptance Criteria

#### Happy Path
- Given the release PR merge lands on `main`, when `release.yml` runs, then the classify job runs
  first, the smoke job runs only because classify reported `publishable`, and the publish job runs
  only after smoke passes.
- Given classify reports `publishable` and the full smoke tier passes, when publish runs, then the
  annotated tag and the GitHub Release are created for the resolved version.
- Given the smoke job runs, when it invokes the live tier, then it calls
  `.github/workflows/live-daemon-e2e.yml` with `require_credentials: true` and `secrets: inherit`,
  exercising the pipeline against a real agent rather than a provider fake.

#### Negative Paths
- Given an ordinary feature-PR merge to `main`, when `release.yml` runs, then classify reports
  `ignored`, the smoke job does **not** run, no LLM tokens are spent, and the workflow concludes
  successfully.
- Given classify reports `publishable` and any smoke case fails, when the workflow runs, then the
  publish job does not execute, no tag is created, and no GitHub Release is created.
- Given `CLAUDE_CODE_OAUTH_TOKEN` is not provisioned, when the smoke job runs in gate mode, then it
  fails with a message naming that exact secret, and no tag is created.
- Given `secrets: inherit` is omitted from the reusable-workflow call, when the smoke job runs, then
  the credential resolves empty and gate mode fails loudly — it never proceeds to publish on an
  empty run.
- Given the smoke job fails, when the operator reads the failed run, then the output identifies the
  specific failing smoke case and its evidence path without needing to reproduce the run locally.
- Given the smoke job is cancelled or times out, when the workflow concludes, then publish does not
  run — the gate is fail-closed on any non-success conclusion, not only on explicit failure.

### Done When
- [ ] `.github/workflows/release.yml` contains three ordered jobs: classify, smoke, publish.
- [ ] The smoke and publish jobs carry `needs` plus an `if` predicate on classify's `publishable`
      output; neither runs when classify reports `ignored`.
- [ ] The publish job's gating admits only a successful smoke conclusion (cancelled and timed-out
      both block).
- [ ] The smoke job calls `./.github/workflows/live-daemon-e2e.yml` with `require_credentials: true`
      and `secrets: inherit`.
- [ ] The smoke job runs the tier in gate mode.
- [ ] `docs/contributing/releases.md` documents that a smoke failure blocks the tag and Release.

---

## Story 5: A blocked release is recoverable by re-running the same commit

**Requirement:** DO-2

As the operator, I want a smoke-blocked release to be resumable without manual cleanup, so that a
transient failure does not strand the release.

### Acceptance Criteria

#### Happy Path
- Given a smoke failure blocked publication, when I re-run the workflow on the same commit after
  the cause is resolved, then classify re-reports `publishable`, smoke passes, and the tag and
  Release are created.
- Given a smoke failure blocked publication, when I inspect repository state, then no tag, no
  Release, and no partial artifact exists — there is nothing to clean up before retrying.
- Given publication already completed for a version, when the workflow is re-run on that same
  commit, then it completes successfully without creating a duplicate tag or a second Release.

#### Negative Paths
- Given a tag for the resolved version already exists but points at a different commit, when
  publish runs, then it returns `rejected` naming both commits and does not move or overwrite the
  tag.
- Given a GitHub Release for the tag exists but its body or target does not match the approved
  artifact, when publish runs, then it returns `rejected` rather than overwriting the existing
  Release.
- Given the fix for a smoke failure requires a code change, when that change merges normally, then
  the release-PR candidate refreshes and the next release-PR merge re-enters classify → smoke →
  publish with no manual intervention.
- Given re-running a push-triggered run did not preserve the original commit SHA, when recovery is
  attempted, then this is surfaced as a defect against assumption A-1 and remedied by an additive
  dispatch trigger — recovery must not require force-pushing or re-merging.

### Done When
- [ ] A test proves publish is idempotent on a completed release: re-running creates no duplicate
      tag and no second Release.
- [ ] A test proves a tag-commit mismatch and a Release-content mismatch each yield `rejected`
      without mutation.
- [ ] A test proves no tag and no Release exist after a smoke-blocked run.
- [ ] `docs/contributing/releases.md` documents the recovery path for a smoke-blocked release.
