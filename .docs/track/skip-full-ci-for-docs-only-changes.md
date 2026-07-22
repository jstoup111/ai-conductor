# Track: skip full CI when a change is docs-only (`.docs/**` paths)

Track: technical

Source issue: jstoup111/ai-conductor#802

## Why technical

This changes CI/workflow tooling (`.github/workflows/ci.yml`) plus a small pure-bash
classification helper. There is no product domain, no data model, no user-facing feature.
Acceptance criteria are mechanical (a diff confined to `.docs/**` skips the heavy jobs;
any non-doc file runs full CI; the required check still resolves green; an undeterminable
change set fails safe toward running CI). Acceptance lives in the stories, not a PRD.

## Context (verified against `main`, 2026-07-22)

### The current CI workflow

`.github/workflows/ci.yml` triggers on `pull_request: branches: [main]` and runs **three
heavy jobs unconditionally**, every one of which is inert to a diff confined to `.docs/**`:

- `integrity` — `bash test/test_harness_integrity.sh`
- `typecheck` — `npm ci` + `npm run typecheck` in `src/conductor`
- `conductor` — `npm ci` + `npm run build` + `npx vitest run` in `src/conductor`

`.github/workflows/release.yml` triggers on `push: branches: [main]` (post-merge) and
carries the CHANGELOG `[Unreleased]`-non-empty gate + tag/release. `intake-label-sync.yml`
triggers on `issues`. **Only `ci.yml` runs on PRs**, so this change is scoped to `ci.yml`
(+ a helper script + its test). `release.yml` and `intake-label-sync.yml` are untouched.

### The branch-protection reality — the load-bearing risk, grounded

The issue's key risk is the classic trap: a **required** status check skipped via
`paths-ignore` reports **no status** and wedges the PR as un-mergeable ("Expected —
Waiting for status to be reported") rather than green. I verified the actual config:

- `GET repos/jstoup111/ai-conductor/branches/main/protection` → `404 Branch not protected`
  (no legacy branch protection).
- The repo instead uses a **ruleset** ("disable main", id 15933604, enforcement `active`).
  `GET repos/jstoup111/ai-conductor/rules/branches/main` shows its rules:
  `creation`, `update`, `deletion`, `non_fast_forward`, and a `pull_request` rule
  (`required_approving_review_count: 1`, `require_code_owner_review: true`,
  `allowed_merge_methods: ["squash"]`).
- **There is NO `required_status_checks` rule.** No CI job is a *required* check today.

**Consequence for the design.** Because no status check is required today, even a naive
`paths-ignore` would not wedge *right now*. But the issue's desired outcome ("required
status checks still resolve to success for doc-only PRs; remain mergeable, not stuck
waiting") must hold **durably** — the moment the operator adds a required status check,
`paths-ignore` would start wedging doc-only PRs. So the design must NOT rely on
`paths-ignore`. The robust, future-proof mechanism is a **single always-running aggregate
gate job** that is safe to designate as the required check: it always reports a status
(never "no status"), and it resolves green whether the heavy jobs ran-and-passed OR were
skipped for a doc-only diff.

### The CHANGELOG `[Unreleased]` gate — settled, no guess

The issue asks DECIDE to settle whether the `[Unreleased]` CHANGELOG gate must still apply
to doc-only PRs. Grounded answer: **it is untouched and continues to apply.** That gate
lives in `release.yml`'s `Verify [Unreleased] has content` step, which runs on
`push: branches: [main]` (post-merge), NOT in the PR `ci` workflow. This change edits only
the PR-time `ci` workflow, so the changelog/release gate is entirely out of the skip's
blast radius. We deliberately do **not** exempt doc-only PRs from it — exempting would be a
behavior change to a different workflow (its own migration concern) with no benefit. The
skip is scoped to the three heavy PR jobs and nothing else.

## Chosen mechanism

Restructure `ci.yml` into a **changes-detection + gated-jobs + aggregate-gate** shape:

1. **`changes` job** — checks out with `fetch-depth: 0`, computes the PR's changed-file
   list (`git diff --name-only <base.sha> <head.sha>`), pipes it to a pure-bash predicate,
   and exposes `docs_only` (`true`/`false`) as a job output.
2. **`integrity` / `typecheck` / `conductor`** — each gains `needs: changes` and
   `if: needs.changes.outputs.docs_only != 'true'`. On a doc-only diff they are **skipped**.
3. **`ci-gate` aggregate job** — `needs: [changes, integrity, typecheck, conductor]`,
   `if: always()` (so it ALWAYS runs and ALWAYS reports a status). It **fails** if any heavy
   job's result is `failure`/`cancelled`, and **passes** when they `success` OR are
   `skipped`. This is the single stable status name the operator can designate as the
   required check; it stays green for doc-only PRs and correctly propagates real failures.

**The classification predicate is extracted to a standalone, unit-testable bash script**
(`.github/scripts/ci-detect-docs-only.sh`) rather than embedded inline in YAML — per this
repo's Design Principle ("deterministic where possible; make the load-bearing logic
testable code, not prompt/YAML discipline"). The script reads a newline-delimited file list
on **stdin** and prints `docs_only=true|false`. The workflow's git-diff computation is the
thin, integration-only glue; the load-bearing "all files under `.docs/`" decision is pure,
piped, and covered by `test/`.

### Fail-safe semantics (all default toward RUNNING full CI)

- **Mixed diff** (any file not under `.docs/`) → predicate `false` → heavy jobs run.
- **Empty / undeterminable diff** (git error, no files) → predicate `false` → heavy jobs run.
- **Regex is slash-anchored** (`^\.docs/`) so a sibling path like `.docsaurus/x` or a file
  literally named `.docs` does NOT count as doc-only.
- `docs_only=true` only when **every** listed file matches `^\.docs/`.

## Approaches considered

1. **Naive `paths-ignore: ['.docs/**']` on the `pull_request` trigger (filer's hypothesis
   — a candidate, not chosen).** Simplest, but relies on the *current* absence of required
   checks. The instant a required status check is added it wedges doc-only PRs with "no
   status." Rejected as non-durable against the issue's own stated risk.

2. **Job-level `if:` skip with no aggregate gate (partial alternative).** Gating the heavy
   jobs directly avoids the trigger-level trap, but leaves three *individually* skippable
   job names — if any is set as a required check, GitHub's "skipped required check"
   semantics are the very ambiguity the issue warns about. Rejected on its own; folded into
   the chosen design by adding the always-running aggregate `ci-gate` that is unambiguous.

3. **Aggregate `ci-gate` + `changes`-detection job + extracted testable predicate
   (chosen).** Durable (safe as a required check even after protection is added),
   fail-safe toward running CI, and the load-bearing predicate is real unit-tested code.
   Third-party actions (e.g. `dorny/paths-filter`) are deliberately avoided in favor of a
   dependency-free `git diff` + bash predicate.

Decision: **Approach 3.**

## Operator follow-up (repo settings, not code)

To fully realize "protected AND doc-only-mergeable," the operator may add a
`required_status_checks` rule to the "disable main" ruleset naming **`ci-gate`** (never the
individual heavy jobs). This is a GitHub repo-settings action outside the diff; the workflow
change makes `ci-gate` a correct, always-green-for-docs required check when they do. Until
then nothing wedges (no required checks exist), so this is optional and non-blocking.

## Migration / release-gate note

This change touches `.github/workflows/ci.yml` + a new `.github/scripts/` helper + a
`test/` file + docs. None of these are in `CANONICAL_BREAKING_SURFACES`
(`bin/conduct CLI`, `skill symlink targets`, `hook wiring`, `settings.json schema`), so
**no migration block and no release waiver are required.** A CHANGELOG `[Unreleased]` entry
is required (repo rule). VERSION is **not** bumped (pre-v1; MEMORY: version-locked-until-v1).
