# Implementation plan: skip full CI when a change is docs-only (`.docs/**` paths)

Source issue: jstoup111/ai-conductor#802
Track: technical · Tier: S

## Summary

Restructure the PR-time CI workflow `.github/workflows/ci.yml` so a PR whose changed files
are **entirely** under `.docs/**` skips the three heavy jobs (`integrity`, `typecheck`,
`conductor`) while a single always-running aggregate gate (`ci-gate`) still resolves green,
keeping docs-only PRs mergeable. Any non-doc file, or an undeterminable diff, runs the full
suite. The load-bearing "all files under `.docs/`" decision is an extracted, unit-tested
bash predicate — not inline YAML. `release.yml` (CHANGELOG/release gate) and
`intake-label-sync.yml` are untouched.

## Design

### New workflow shape (`.github/workflows/ci.yml`)

```
changes ──▶ integrity ─┐
        ├─▶ typecheck ──┼─▶ ci-gate   (if: always())
        └─▶ conductor ──┘
```

- **`changes`** — `runs-on: ubuntu-latest`, `outputs.docs_only`. Steps:
  - `actions/checkout@v4` with `fetch-depth: 0` (both PR base + head reachable).
  - Compute the changed-file list and classify it, fail-safe to `false`:
    ```bash
    set -uo pipefail
    docs_only=false
    if files=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA" 2>/dev/null) \
         && [ -n "$files" ]; then
      docs_only=$(printf '%s\n' "$files" \
        | bash .github/scripts/ci-detect-docs-only.sh \
        | sed 's/^docs_only=//')
    fi
    echo "docs_only=$docs_only" >> "$GITHUB_OUTPUT"
    ```
    with `BASE_SHA: ${{ github.event.pull_request.base.sha }}` and
    `HEAD_SHA: ${{ github.event.pull_request.head.sha }}` in `env:`. Any failure of the
    `git diff` (missing SHA, error) or an empty list leaves `docs_only=false` → full CI.
- **`integrity` / `typecheck` / `conductor`** — unchanged step bodies; each gains
  `needs: changes` and `if: needs.changes.outputs.docs_only != 'true'`.
- **`ci-gate`** — `needs: [changes, integrity, typecheck, conductor]`, `if: always()`,
  `runs-on: ubuntu-latest`. One step fails on any heavy-job `failure`/`cancelled`, else
  passes (so `skipped` on docs-only ⇒ green):
  ```bash
  for r in "$INTEGRITY" "$TYPECHECK" "$CONDUCTOR"; do
    case "$r" in
      failure|cancelled)
        echo "CI gate failed: integrity=$INTEGRITY typecheck=$TYPECHECK conductor=$CONDUCTOR" >&2
        exit 1 ;;
    esac
  done
  echo "CI gate satisfied (integrity=$INTEGRITY typecheck=$TYPECHECK conductor=$CONDUCTOR)"
  ```
  with the three `needs.<job>.result` values passed via `env:`.

### New predicate (`.github/scripts/ci-detect-docs-only.sh`)

Pure, dependency-free, reads a newline-delimited file list on **stdin**, prints exactly one
line `docs_only=true` or `docs_only=false`:

- Read all of stdin.
- If there are **zero** non-empty lines → print `docs_only=false` (empty ⇒ undeterminable).
- If **every** non-empty line matches `^\.docs/` → `docs_only=true`; otherwise `false`.
- Implementation: `grep -qvE '^\.docs/'` over the input returns 0 when a non-doc line
  exists ⇒ `false`; combined with an explicit empty-input guard so empty ⇒ `false`.
- Slash-anchored so `.docsaurus/x` and a bare `.docs` are **not** docs-only.

### Untouched

- `release.yml` — the CHANGELOG `[Unreleased]` gate runs post-merge on `push: main` and
  continues to apply to docs-only merges (not exempted; out of the skip's scope).
- `intake-label-sync.yml` — `issues`-triggered, unrelated.
- No `paths-ignore` anywhere (would wedge once a required check is added).

## Prerequisites

- None. `ci.yml` exists; the `.github/scripts/` dir is created by Task 1.

## Task Dependency Graph

```
Task 1 (predicate script) ──▶ Task 2 (predicate unit test, RED→GREEN)
        │
        └──▶ Task 3 (ci.yml restructure: changes + gated jobs + ci-gate)
Task 2, Task 3 ──▶ Task 4 (integrity suite: cover .github/scripts + run new test)
Task 3 ──▶ Task 5 (docs: README + CHANGELOG)
```

## Tasks

### Task 1: Add the extracted docs-only predicate script
**Story:** Story 1a, Story 3a/3c, Story 4a
**Type:** happy-path
**Steps:**
1. Create `.github/scripts/ci-detect-docs-only.sh` (executable, `#!/usr/bin/env bash`,
   `set -uo pipefail`) implementing the stdin→`docs_only=…` predicate from Design:
   empty input ⇒ `false`; every non-empty line `^\.docs/` ⇒ `true`; any other line ⇒
   `false`.
2. Manually smoke it: `printf '.docs/a.md\n.docs/b/c.md\n' | bash .github/scripts/ci-detect-docs-only.sh`
   → `docs_only=true`; add a `src/…` line → `docs_only=false`; empty stdin → `docs_only=false`.
**Files:** `.github/scripts/ci-detect-docs-only.sh`
**Dependencies:** none

### Task 2: Unit-test the predicate (RED → GREEN)
**Story:** Story 1a, Story 3a, Story 3c, Story 4a
**Type:** happy-path + negative-path
**Steps:**
1. Add `test/test_ci_detect_docs_only.sh` (follow the existing `test/*.sh` style — sourcing
   `test/test_helpers.sh` if the sibling tests do; a plain assert-count harness otherwise),
   asserting, by piping fixtures into the script:
   - all-`.docs` list (incl. nested `.docs/a/b.md`) ⇒ `docs_only=true`.
   - mixed list (`.docs/x.md` + `src/conductor/src/index.ts`) ⇒ `docs_only=false`.
   - single non-doc line (`bin/conduct`) ⇒ `docs_only=false`.
   - lookalikes `.docsaurus/x` and bare `.docs` ⇒ `docs_only=false` (slash anchor).
   - empty stdin ⇒ `docs_only=false`.
2. Run it — RED first if written before Task 1 completes; then GREEN against Task 1.
**Files:** `test/test_ci_detect_docs_only.sh`
**Dependencies:** 1

### Task 3: Restructure `ci.yml` — `changes` job, gate heavy jobs, add `ci-gate`
**Story:** Story 1b, Story 2a/2b, Story 3b, Story 4b, Story 5a/5b
**Type:** happy-path + negative-path
**Steps:**
1. Add the **`changes`** job (checkout `fetch-depth: 0`; `env` BASE_SHA/HEAD_SHA from
   `github.event.pull_request.base.sha`/`.head.sha`; compute the diff and pipe to
   `.github/scripts/ci-detect-docs-only.sh`; export `docs_only` via `$GITHUB_OUTPUT`).
   Fail-safe: `git diff` error or empty list ⇒ `docs_only=false`.
2. Add `needs: changes` + `if: needs.changes.outputs.docs_only != 'true'` to `integrity`,
   `typecheck`, and `conductor` (leave their step bodies exactly as they are today).
3. Add the **`ci-gate`** job (`needs: [changes, integrity, typecheck, conductor]`,
   `if: always()`) that fails on any heavy-job `failure`/`cancelled` and otherwise passes
   (so `skipped` ⇒ green).
4. Validate YAML structure locally (e.g. `python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/ci.yml"))'`)
   and `bash -n` the embedded run-script fragments where practical.
**Files:** `.github/workflows/ci.yml`
**Wired-into:** calls `.github/scripts/ci-detect-docs-only.sh`
**Dependencies:** 1

### Task 4: Extend the integrity suite to cover the new script + run its test
**Story:** Story 1a (regression protection)
**Type:** negative-path
**Steps:**
1. In `test/test_harness_integrity.sh`, add `.github/scripts/` to the directories whose
   scripts are `bash -n` syntax-checked (mirroring the existing `bin/`, `hooks/claude/`,
   `test/` coverage).
2. Have the integrity suite invoke `test/test_ci_detect_docs_only.sh` (or document it runs
   standalone) so the predicate's behavior is guarded on every non-doc PR — note the
   `integrity` job is exactly what runs for any change touching `.github/scripts/`.
3. Run `bash test/test_harness_integrity.sh` — must pass.
**Files:** `test/test_harness_integrity.sh`
**Wired-into:** runs `test/test_ci_detect_docs_only.sh`, syntax-checks `.github/scripts/*.sh`
**Dependencies:** 2, 3

### Task 5: Docs — README note + CHANGELOG entry
**Story:** all (documentation upkeep)
**Type:** docs
**Steps:**
1. Add a short subsection to `README.md` (and, if CI behavior is described there,
   `src/conductor/README.md`) documenting: docs-only PRs (all files under `.docs/**`) skip
   the heavy CI jobs; any non-doc file or an undeterminable diff runs the full suite;
   `ci-gate` is the single always-green required check; and the operator note that a
   `required_status_checks` ruleset rule should name **`ci-gate`**, never the heavy jobs.
2. Add a `CHANGELOG.md` `## [Unreleased] → ### Changed` (or `### Added`) entry describing
   the docs-only CI skip and referencing #802. Do **not** bump `VERSION` (pre-v1;
   MEMORY: version-locked-until-v1).
3. Confirm **no** migration block / release waiver is needed — no canonical breaking
   surface (`bin/conduct CLI`, `skill symlink targets`, `hook wiring`, `settings.json
   schema`) is touched.
**Files:** `README.md`, `src/conductor/README.md` (only if it documents CI), `CHANGELOG.md`
**Dependencies:** 3

## Verification (build-time)

- [ ] `.github/scripts/ci-detect-docs-only.sh`: all-`.docs` ⇒ true; mixed/empty/lookalike ⇒ false.
- [ ] `test/test_ci_detect_docs_only.sh` passes and is exercised by the integrity suite.
- [ ] `ci.yml`: `changes` sets `docs_only`; heavy jobs gated on it; `ci-gate` (`if: always()`)
      green when heavy jobs `skipped` or `success`, red on `failure`/`cancelled`.
- [ ] `bash test/test_harness_integrity.sh` passes (now covering `.github/scripts/`).
- [ ] `release.yml` and `intake-label-sync.yml` unchanged; CHANGELOG `[Unreleased]` gate still applies.
- [ ] CHANGELOG `[Unreleased]` entry added; VERSION unchanged; no migration/waiver.
