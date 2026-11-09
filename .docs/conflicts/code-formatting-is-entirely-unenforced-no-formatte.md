# Conflict Check: Enforce canonical code formatting on touched files (#1991)

**Date:** 2026-11-07
**New stories:** `.docs/stories/code-formatting-is-entirely-unenforced-no-formatte.md` (Stories 1–6)
**Result:** PASSED after resolution — 1 blocking conflict resolved (operator-selected), 2 degrading interactions (one plan note, one operator-accepted compromise), 0 blocking remaining.

## Inventory

- **Stories scanned:** every file in `.docs/stories/`. Pairwise review concentrated on the stories that share a behavior, gate, or file with this feature: the 19 files naming `ci-gate`, the `changes` docs-only predicate, `test_suite.commands` / `changed_command`, `lint-after-edit`, or the errors-only lint stance, and the 52 files naming `test_suite`.
- **ADRs examined:** all 48 APPROVED ADRs in `.docs/decisions/`. Narrowed in: `adr-2026-07-27-project-config-scaffolder` and `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` (both govern `test_suite` configuration). Narrowed out: the remaining 46, whose subjects (engine runtime, routing, review, daemon, release, intake, and memory machinery) touch no formatter, CI job, ESLint configuration, or `test_suite` command list. No ADR governs code formatting or `ci.yml` job wiring.
- **Prior conflict reports:** no recurring pattern concerns formatting or the `test_suite` command list.

## Conflict: test_suite command list fixed at three ordered entries

**Stories involved:** Story 5 (Self-host builds fail on a non-canonical changed file before a pull request) vs Story 1 (A test file that does not compile fails test_suite, not CI)
**Files:** [.docs/stories/code-formatting-is-entirely-unenforced-no-formatte.md] vs [.docs/stories/test-suite-skips-typecheck-test-so-test-type-error.md]
**Type:** contradiction
**Severity:** blocking

**Description:**
The shipped story stated that `test_suite.commands`' first command runs the two typechecks, followed by `npm test` and `test/test_harness_integrity.sh` — exactly three ordered entries, asserted with `toEqual` in `src/conductor/test/self-host-verification-entries.test.ts`. Story 5 as first written added a separate `format:check` entry, which cannot hold alongside a three-entry list.

**Resolution Options:**
1. Chain `format:check` ahead of the typechecks inside the first entry, keeping three ordered entries; rewrite the shipped story's first criterion to name the chained command.
2. Add `format:check` as a separate fourth entry and rewrite the shipped story to list four entries.

**Resolution (operator-selected 2026-11-07):** Option 1. Both stories were updated in place: the shipped story's first criterion now names `npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent`, and Story 5 requires the same chained first entry plus `format:check` before Vitest in `changed_command`. The plan updates the tests asserting the first command string.

Bidirectional check after resolution: satisfying Story 5 keeps the shipped story's three ordered entries and its changed-mode `typecheck:test` criterion; satisfying the shipped story leaves Story 5's chained check in place. No oscillation.

## Interaction (degrading, plan note): exact-string rewrites of ci-gate

**Stories involved:** Story 4 (CI rejects a pull request with a non-canonical changed file) vs the live-corpus CI wiring story in [.docs/stories/a-docs-only-spec-landing-silently-breaks-main-via-.md]
**Type:** overlap
**Severity:** degrading

**Description:**
Both stories register a job in `ci-gate`'s `needs` list and result loop. The behaviors are compatible, but the live-corpus structural test (`src/conductor/test/structural/docs-corpus-ci-wiring.test.ts`) mutates the workflow with exact substrings that assume `docs-corpus` is the last `needs` entry and `$DOCS_CORPUS` the last loop item. Appending `format` after them turns those mutations into no-ops and fails that test.

**Resolution:** No story change. The plan either inserts `format` before `docs-corpus` / `$DOCS_CORPUS` or updates that test's substrings; both satisfy both stories.

## Interaction (degrading, operator-accepted): drift budget holds a PASS without re-running the check

**Stories involved:** Story 5 (Self-host builds fail on a non-canonical changed file before a pull request) vs ADR
**Files:** [.docs/stories/code-formatting-is-entirely-unenforced-no-formatte.md] vs [.docs/decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md]
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-08-28-test-suite-drift-budget-and-verification-mode
**Story ID:** Story 5
**ADR opposing sentence (verbatim):** "max distinct changed paths tolerated since the attested PASS"
**Story opposing sentence (verbatim):** "Given a self-host feature branch that changed an in-scope file into non-canonical form, when `test_suite` runs in either full or changed mode, then the step fails and its output names the file."

**Description:**
This repository's `test_suite.verification.drift_budget` sets `source: 6` and `tests: 3`: within budget an attested PASS is preserved and nothing re-runs. A late remediation lap that edits up to six source files after the PASS therefore does not re-run `format:check`, so a non-canonical edit made in that lap reaches the pull request, where the CI `format` job (Story 4) rejects it. Story 5 holds whenever `test_suite` runs; it does not promise a run after every edit.

**Resolution Options:**
1. Accept: the CI job remains the merge authority and a post-PASS miss costs one CI repair; no budget change.
2. Classify formatter-relevant changes as unbudgetable — a change to the ADR's closed category set, which that ADR makes an ADR-level act.

**Resolution (operator-accepted 2026-11-07):** Option 1. No story or ADR change.

## Pairs checked and found clean

- Story 4 vs `skip-full-ci-for-docs-only-changes` and `30-of-33-bash-tests-never-execute-and-smoke-gating`: the `format` job uses the same docs-only predicate and the same `ci-gate` skipped-is-not-failure rule.
- Story 4 vs `daemon-e2e-smoke-step-has-no-real-agent-live-llm-t`: that story keeps a separate workflow out of `ci-gate`; this feature adds only an in-workflow job.
- Story 5 vs changed-mode stories: a dependency change is unbudgetable and fails closed to the full `commands` sequence, which now also runs `format:check`.
- Stories 1–2 vs fixture- and golden-comparing stories: ignored fixture paths are never checked or written (Story 1 and Story 2 negative paths).
- Story 6 vs `lint-after-edit` and ESLint policy stories: no change to either surface.
