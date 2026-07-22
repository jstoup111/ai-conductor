# Stories: skip full CI when a change is docs-only (`.docs/**` paths)

Status: Accepted

Source issue: jstoup111/ai-conductor#802

These stories specify the behavior of the restructured PR CI workflow
(`.github/workflows/ci.yml`) and its extracted classification predicate
(`.github/scripts/ci-detect-docs-only.sh`). Acceptance criteria are Given/When/Then and
are the authority for this technical-track fix (no PRD). "Heavy jobs" = `integrity`,
`typecheck`, `conductor`.

---

## Story 1 — A docs-only PR skips the heavy CI jobs (happy path)

**As** a maintainer opening a PR whose changes are confined to `.docs/**` (e.g. every
`/engineer` spec PR)
**I want** the heavy CI jobs to be skipped
**So that** CI minutes and merge latency are not spent on a suite that a `.docs/**` diff
cannot affect.

### Scenario 1a: predicate classifies an all-`.docs` file list as docs-only

- **Given** a changed-file list where **every** line matches `^\.docs/`
  (e.g. `.docs/stories/x.md`, `.docs/plans/x.md`, `.docs/decisions/x.md`),
- **When** `.github/scripts/ci-detect-docs-only.sh` reads that list on stdin,
- **Then** it prints `docs_only=true` and exits 0.

### Scenario 1b: heavy jobs are skipped on a docs-only diff

- **Given** a PR to `main` whose `git diff --name-only base..head` is entirely under
  `.docs/`,
- **When** the `ci` workflow runs and the `changes` job sets `docs_only=true`,
- **Then** `integrity`, `typecheck`, and `conductor` each evaluate
  `if: needs.changes.outputs.docs_only != 'true'` to false and are **skipped** (no
  `npm ci`, no vitest, no integrity script runs).

---

## Story 2 — The required check still resolves green for docs-only PRs (negative path b)

**As** a maintainer merging a docs-only PR
**I want** the required status check to resolve to **success**, not sit at "Expected —
Waiting for status to be reported"
**So that** docs-only PRs stay mergeable and are never wedged by the skip.

### Scenario 2a: `ci-gate` always runs and reports a status

- **Given** a docs-only PR where the three heavy jobs are `skipped`,
- **When** the workflow runs,
- **Then** the `ci-gate` job (`if: always()`, `needs: [changes, integrity, typecheck,
  conductor]`) **still runs** and reports a concrete `success` status — GitHub never sees
  a "no status reported" for `ci-gate`.

### Scenario 2b: `ci-gate` passes when heavy jobs were skipped

- **Given** `integrity`/`typecheck`/`conductor` results are all `skipped` (docs-only),
- **When** `ci-gate` evaluates them,
- **Then** it treats `skipped` (and `success`) as passing and **succeeds** (exit 0), so a
  ruleset that requires `ci-gate` resolves green and the PR is mergeable.

### Scenario 2c: `ci-gate` is the designated required check, not the heavy jobs

- **Given** the operator marks a required status check for `main`,
- **When** they follow the documented guidance,
- **Then** the required check named is **`ci-gate`** (always-present), never an
  individually-skippable heavy job — so requiring it never wedges a docs-only PR.

---

## Story 3 — A mixed diff still runs the full suite (negative path a)

**As** a maintainer
**I want** any PR that touches even one non-doc path to run the full CI suite
**So that** no code/`bin/`/hook/workflow/`VERSION` change ever slips through unverified on
a mixed diff.

### Scenario 3a: predicate rejects a mixed file list

- **Given** a changed-file list containing at least one line **not** matching `^\.docs/`
  (e.g. `.docs/plans/x.md` **and** `src/conductor/src/index.ts`),
- **When** the predicate reads it on stdin,
- **Then** it prints `docs_only=false`.

### Scenario 3b: heavy jobs run on a mixed diff

- **Given** a PR whose diff includes any non-`.docs/` file,
- **When** the `changes` job sets `docs_only=false`,
- **Then** `integrity`, `typecheck`, and `conductor` all **run** (the `if:` guard is true).

### Scenario 3c: slash-anchored — a lookalike path is not docs-only

- **Given** a file list whose only "doc-ish" entry is a lookalike such as `.docsaurus/x`
  or a bare file named `.docs`,
- **When** the predicate reads it,
- **Then** it prints `docs_only=false` (the `^\.docs/` anchor requires the trailing slash;
  lookalikes fall through to full CI).

---

## Story 4 — An undeterminable change set fails safe toward running CI (negative path c)

**As** a maintainer
**I want** any case where the changed-file set cannot be determined to run the full suite
**So that** the skip can never hide an unverified change.

### Scenario 4a: empty file list runs full CI

- **Given** an **empty** stdin (no changed files resolved),
- **When** the predicate reads it,
- **Then** it prints `docs_only=false` (empty ⇒ undeterminable ⇒ do not skip).

### Scenario 4b: a git-diff failure runs full CI

- **Given** the `changes` job's `git diff` cannot compute a file list (non-zero exit /
  missing SHA),
- **When** the job resolves `docs_only`,
- **Then** the output is `false` and the heavy jobs run — the failure path defaults to
  running CI, never to skipping it.

---

## Story 5 — A real heavy-job failure still fails the gate (negative path)

**As** a maintainer
**I want** `ci-gate` to fail whenever a heavy job that actually ran failed
**So that** the aggregate gate is not a rubber stamp that masks genuine CI failures.

### Scenario 5a: gate fails on a heavy-job failure

- **Given** a mixed diff (`docs_only=false`) where, say, `conductor` ends in `failure`
  (or any heavy job is `cancelled`),
- **When** `ci-gate` (`if: always()`) evaluates the `needs.*.result` values,
- **Then** it detects the `failure`/`cancelled` and **fails** (exit non-zero), so the PR
  is correctly blocked.

### Scenario 5b: gate passes on all-success

- **Given** a mixed diff where all three heavy jobs end `success`,
- **When** `ci-gate` evaluates,
- **Then** it **passes** (exit 0).
