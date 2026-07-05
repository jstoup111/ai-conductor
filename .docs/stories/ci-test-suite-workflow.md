**Status:** Accepted

# Stories: CI test-suite workflow

Technical track, Small complexity. Acceptance criteria derive from the technical
intent: a PR-triggered GitHub Actions workflow that enforces the two existing test
entrypoints (`test/test_harness_integrity.sh` and the `src/conductor/` vitest suite)
on every pull request to `main`.

Negative paths are required per story (Small tier): each story carries at least the
highest-risk failure mode. The whole point of the feature is that failures fail the
check, so the negative paths are first-class.

---

## Story: Harness-integrity check runs on every PR

**Requirement:** Technical intent — enforce `test/test_harness_integrity.sh` in CI.

As the harness maintainer, I want `test/test_harness_integrity.sh` to run automatically
on every pull request to `main`, so that structural regressions (bad SKILL.md frontmatter,
dangling agent/template references, broken model table, invalid VERSION/CHANGELOG) cannot
merge.

### Acceptance Criteria

#### Happy Path
- Given a pull request targeting `main` whose harness structure is valid, when the workflow
  runs, then the integrity job executes `test/test_harness_integrity.sh` and the job
  concludes with a success (exit code 0) status check.

#### Negative Paths
- Given a pull request that breaks harness integrity (e.g. a SKILL.md missing a required
  frontmatter field, or a `vX.Y.Z` tag with no matching CHANGELOG section), when the
  workflow runs `test/test_harness_integrity.sh`, then the script exits non-zero, the job
  is marked failed, and the failing check blocks merge (the failure is surfaced on the PR,
  not swallowed).

### Done When
- [ ] The workflow file exists under `.github/workflows/` and declares `on: pull_request` with
      `branches: [main]`.
- [ ] A job step runs `test/test_harness_integrity.sh` (via bash) from the repo root.
- [ ] A deliberately-broken harness change causes that step to exit non-zero and the job to
      report failure (verified by construction / a demonstrable failing input).
- [ ] A valid harness change causes the step to exit 0 and the job to report success.

---

## Story: Conductor build + vitest suite runs on every PR

**Requirement:** Technical intent — enforce `src/conductor/` build + vitest in CI.

As the harness maintainer, I want the conductor package to be installed, built, and tested
on every pull request to `main` using the pinned Node version, so that TypeScript/build
breakage and failing vitest specs cannot merge.

### Acceptance Criteria

#### Happy Path
- Given a pull request targeting `main`, when the workflow runs, then it selects the Node
  version pinned in `src/conductor/.tool-versions` (currently `20.19.2`), runs `npm ci`,
  `npm run build`, and `npm test` within `src/conductor/`, and the job concludes successfully
  when all pass.

#### Negative Paths
- Given a pull request that introduces a failing vitest spec or a build/typecheck break in
  `src/conductor/`, when the workflow runs `npm run build` / `npm test`, then the failing
  command exits non-zero, the job is marked failed, and the failing check blocks merge.

### Done When
- [ ] The workflow pins Node from `src/conductor/.tool-versions` (not a hardcoded, divergent
      version) — e.g. `actions/setup-node` reading `node-version-file: src/conductor/.tool-versions`.
- [ ] Steps run, in order, `npm ci`, `npm run build`, then `npm test` with
      `working-directory: src/conductor`.
- [ ] `npm ci` uses the committed `src/conductor/package-lock.json` (fails if the lockfile is
      out of sync, rather than silently resolving fresh).
- [ ] A failing conductor test causes `npm test` to exit non-zero and the job to report failure.
- [ ] An all-green conductor package causes every step to exit 0 and the job to report success.

---

## Story: Workflow triggers only on pull requests to main

**Requirement:** Technical intent — scope the trigger correctly.

As the harness maintainer, I want the CI workflow to run on pull requests to `main` (and not
to spuriously fire elsewhere), so that CI signal maps to the merge gate without wasting runs
or colliding with the existing `release.yml` push-to-main workflow.

### Acceptance Criteria

#### Happy Path
- Given a pull request opened, synchronized, or reopened against `main`, when GitHub evaluates
  workflow triggers, then this CI workflow is dispatched.

#### Negative Paths
- Given a direct push to `main` (the event that drives `release.yml`), when GitHub evaluates
  triggers, then this test workflow does NOT run its release logic — i.e. the test workflow and
  the release workflow remain independent and neither triggers the other's job.
- Given a branch push that is not associated with a pull request to `main`, when GitHub evaluates
  triggers, then the workflow does not spuriously run (no `push`-to-arbitrary-branch trigger).

### Done When
- [ ] The workflow's `on:` block is scoped to `pull_request` with `branches: [main]` and does
      not add a broad `push` trigger that would double-run or conflict with `release.yml`.
- [ ] The workflow name is distinct from `release` so both appear as separate checks.
- [ ] Manual verification (or documented reasoning) confirms the workflow appears as a required-
      eligible check on PRs to `main` and does not fire on unrelated branch pushes.
