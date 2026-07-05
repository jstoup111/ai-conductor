# Implementation Plan: CI test-suite workflow

**Date:** 2026-07-04
**Track:** technical (Small)
**Complexity:** `.docs/complexity/ci-test-suite-workflow.md` (Tier: S)
**Stories:** `.docs/stories/ci-test-suite-workflow.md`
**Conflict check:** Skipped (Small tier)
**Intake:** `jstoup111/ai-conductor#223` — part of v1.0 cutover program (#228); land
before cutover PR #226 so it merges under CI.

## Summary
Add a single PR-triggered GitHub Actions workflow (`.github/workflows/ci.yml`) that enforces
the two existing test entrypoints — `test/test_harness_integrity.sh` and the `src/conductor/`
build+vitest suite — on every pull request to `main`, plus a CHANGELOG `[Unreleased]` entry.
~5 tasks.

## Technical Approach
One new workflow file, `.github/workflows/ci.yml`, distinct in `name:` from the existing
`release` workflow so both surface as separate checks. Trigger is scoped to
`on: pull_request` with `branches: [main]` only — deliberately **no** `push` trigger, so it
neither double-runs nor collides with `release.yml` (which owns `push` to `main`).

Two jobs run in parallel (independent, both must pass — natural required-check granularity):

- **`integrity`** — `ubuntu-latest`, `actions/checkout@v4`, then a single `run` step invoking
  `bash test/test_harness_integrity.sh` from the repo root. The script is already
  `set -euo pipefail` and exits non-zero on any structural violation, so a broken harness fails
  the job with no extra wiring.
- **`conductor`** — `ubuntu-latest`, `actions/checkout@v4`, `actions/setup-node@v4` with
  `node-version-file: src/conductor/.tool-versions` (pins Node 20.19.2 from the single source of
  truth — no hardcoded duplicate) and `cache: npm` keyed on `src/conductor/package-lock.json`.
  Then, with `working-directory: src/conductor`, run `npm ci` → `npm run build` → `npm test` as
  three ordered steps so a failure is attributable to the right phase. `npm ci` enforces the
  committed lockfile.

`permissions: contents: read` at the workflow level (least privilege — CI only reads the repo;
unlike `release.yml` it needs no write). No secrets are added; the default `GITHUB_TOKEN` scope
is sufficient.

Making the checks **required** on the `main` ruleset is a one-time repo-settings action the
operator performs in GitHub after the workflow is green once (it cannot be done from the workflow
file itself); the plan notes it but does not gate the PR on it.

## Prerequisites
- None. `src/conductor/package-lock.json` and `src/conductor/.tool-versions` already exist;
  both test entrypoints already pass locally.

## Tasks

### Task 1: Create the workflow skeleton with the correct trigger
**Story:** "Workflow triggers only on pull requests to main" (happy + negative)
**Type:** infrastructure

**Steps:**
1. Create `.github/workflows/ci.yml` with `name: ci`, `on: pull_request:` scoped to
   `branches: [main]`, and top-level `permissions: contents: read`.
2. Verify the YAML parses (e.g. `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`).
3. Confirm there is no `push` trigger and the `name` differs from `release`.
4. Commit: "ci: add PR-triggered workflow skeleton scoped to main".

**Files likely touched:**
- `.github/workflows/ci.yml` — new file (trigger + permissions only so far).

**Dependencies:** none

### Task 2: Add the harness-integrity job
**Story:** "Harness-integrity check runs on every PR" (happy path)
**Type:** happy-path

**Steps:**
1. Add job `integrity` on `ubuntu-latest`: `actions/checkout@v4`, then
   `run: bash test/test_harness_integrity.sh`.
2. Re-validate YAML parses.
3. Confirm the step invokes the script from the repo root (no stray `working-directory`).
4. Commit: "ci: run harness integrity script on PRs".

**Files likely touched:**
- `.github/workflows/ci.yml` — add `integrity` job.

**Dependencies:** Task 1

### Task 3: Add the conductor build+test job with pinned Node
**Story:** "Conductor build + vitest suite runs on every PR" (happy path)
**Type:** happy-path

**Steps:**
1. Add job `conductor` on `ubuntu-latest`: `actions/checkout@v4`, then
   `actions/setup-node@v4` with `node-version-file: src/conductor/.tool-versions` and
   `cache: npm`, `cache-dependency-path: src/conductor/package-lock.json`.
2. Add three ordered steps with `working-directory: src/conductor`: `npm ci`, `npm run build`,
   `npm test`.
3. Re-validate YAML parses.
4. Commit: "ci: build and vitest src/conductor on PRs with pinned node".

**Files likely touched:**
- `.github/workflows/ci.yml` — add `conductor` job.

**Dependencies:** Task 1

### Task 4: Verify negative paths fail the job (by construction)
**Story:** integrity-failure + conductor-failure negative paths
**Type:** negative-path

**Steps:**
1. Confirm `test/test_harness_integrity.sh` is `set -e`/`set -o pipefail` and exits non-zero on
   a violation (so job `integrity` fails) — record the evidence in the PR / manual-test notes.
2. Confirm `npm ci`, `npm run build`, and `npm test` each propagate non-zero exit (Actions fails
   a job on any non-zero `run` step by default) — no `continue-on-error`, no `|| true` anywhere in
   the file.
3. Grep the workflow to assert absence of `continue-on-error` and `|| true`.
4. Commit only if a change was needed; otherwise document the verification.

**Files likely touched:**
- `.github/workflows/ci.yml` — only if a guard against swallowed failures is needed.

**Dependencies:** Task 2, Task 3

### Task 5: CHANGELOG entry
**Story:** repo convention (every PR adds an `[Unreleased]` entry — CI enforces it)
**Type:** infrastructure

**Steps:**
1. Add under `## [Unreleased]` → `### Added`: a line describing the new PR-triggered CI workflow
   that runs harness integrity + conductor build/vitest.
2. Confirm `test/test_harness_integrity.sh` still passes locally (it validates CHANGELOG structure).
3. Commit: "docs(changelog): note CI test-suite workflow".

**Files likely touched:**
- `CHANGELOG.md` — one `### Added` line under `[Unreleased]`.

**Dependencies:** none (can land alongside Task 1)

## Task Dependency Graph
```
Task 1 ──┬─▶ Task 2 ──┐
         └─▶ Task 3 ──┴─▶ Task 4
Task 5 (independent)
```

## Integration Points
- After Task 3: the full workflow can be exercised by opening a draft PR against `main` and
  observing both `integrity` and `conductor` checks run and pass.
- After merge (operator action): mark `integrity` and `conductor` as required checks on the
  `main` ruleset — completes the intake's "make it required once green" requirement.

## Verification
- [ ] All happy-path criteria covered (Tasks 1–3).
- [ ] Both negative-path criteria (integrity failure, conductor failure) covered (Task 4).
- [ ] Trigger-scoping negative paths (no push double-run, distinct from release) covered (Task 1).
- [ ] No task exceeds ~5 minutes.
- [ ] Dependencies explicit and acyclic.
- [ ] CHANGELOG `[Unreleased]` updated (Task 5) so the release workflow's non-empty check passes.
