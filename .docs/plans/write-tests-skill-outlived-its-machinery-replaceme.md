# Implementation Plan: write-tests carries only judgment and is reachable from every host (#1389)

**Date:** 2026-10-29
**Design:** none (technical track, Tier S); scope recorded in `.docs/track/write-tests-skill-outlived-its-machinery-replaceme.md`
**Stories:** .docs/stories/write-tests-skill-outlived-its-machinery-replaceme.md
**Conflict check:** skipped (Tier S)

## Summary

Trim `.agents/skills/write-tests/SKILL.md` to the judgment no gate makes and point at the machinery
that backs the rest; commit the missing `.claude/skills/write-tests` symlink; add a repository-integrity
checker that rejects any local skill wired for only one host. Five tasks.

## Technical Approach

- **Supersession decision (recorded here and in the trimmed skill).** Section by section, against
  the machinery on main today:
  - §8 "the typecheck command MUST cover test files" and "the lint command passes": fully enforced by
    the required CI `typecheck` job (`npm run typecheck:test`) and `lint` job in `.github/workflows/ci.yml`.
    Cut the instructions; keep one pointer.
  - §8 "Before handoff, run the project's configured aggregate test command", §9 step 7, and the
    completion-checklist item "CI and local aggregate execution use the project's configured
    aggregate test command": contradict `HARNESS.md` (the engine-native `test_suite` step owns
    aggregate execution; no other step launches one). Cut; state that `test_suite` owns it.
  - §4 external-boundary rules: partially backed by `AI_CONDUCTOR_NO_REAL_EXEC` in
    `src/conductor/test/setup.ts` (daemon launch, the pr-labels gh/git seam, the engineer dir only).
    §6 cleanup: partially backed by the suite leak guards (`tmpdir-leak-guard.ts`,
    `pipeline-leak-guard.ts`, `signals-leak-guard.ts`, `park-leak-guard.ts`, `tmux-leak-guard.ts`,
    all under `src/conductor/test/`), which detect leaks after the fact. §1 smoke placement: the
    default `vitest.config.ts` excludes `test/smoke/**`, `*.smoke.test.ts`, and `*.e2e.test.ts`. Keep
    the rules; name the backstop and that it is partial.
  - §1 classification, §2 seam selection, §3 fixture bounding, §5 deterministic time, §7 false
    integration tests, §8 live-corpus placement and the suite-duration budget, §9 diagnosis steps 1–6:
    no machinery. Keep unchanged.
- **The trimmed skill follows `scope-check`'s "What is already mechanized — point at it, do not
  restate it" pattern:** a short section listing each backstop by file, after the judgment sections.
  Frontmatter (`name`, `description`, `disable-model-invocation: true`) and
  `agents/openai.yaml` are unchanged.
- **Symlink.** `.claude/` is excluded through `.git/info/exclude`, so the symlink must be staged with
  `git add -f .claude/skills/write-tests`. Create it with `ln -s ../../.agents/skills/write-tests
  .claude/skills/write-tests` so git records mode `120000`, exactly like the four existing entries.
- **Wiring checker (`test/check_local_skill_host_wiring.sh <harness-root>`).** Pattern:
  `test/check_skill_invocation_policy.sh` — `set -euo pipefail`, a required root argument (exit 2 on
  usage), accumulate `VIOLATIONS`, print them to stderr, exit 1. Mechanism, closed:
  1. Enumerate `"$ROOT"/.agents/skills/*/SKILL.md`. Zero matches → exit 2 with `enumerated no local
     skills` (never pass on an empty set).
  2. For each `<name>`: no `.claude/skills/<name>` entry → `<name> — missing .claude/skills symlink`;
     entry exists but `[ ! -L ]` → `<name> — .claude/skills entry is not a symlink`; symlink whose
     physical resolution `(cd -P "$link" 2>/dev/null && pwd -P)` fails or differs from
     `(cd -P "$ROOT/.agents/skills/<name>" && pwd -P)` → `<name> — .claude/skills symlink resolves to
     unexpected target <readlink output>`.
  3. For each `"$ROOT"/.claude/skills/*` entry with no `"$ROOT"/.agents/skills/<name>/SKILL.md` →
     `<name> — orphaned .claude/skills entry`.
  Physical `cd -P`/`pwd -P` resolution is used instead of `readlink -f` so the script needs no GNU
  coreutils; no `mapfile`/`readarray` (bash 3.2 syntax tier in CI).
  The Codex half (`agents/openai.yaml`) is already enforced by `check_skill_invocation_policy.sh`;
  this checker does not duplicate it.
- **Mutation suite (`test/test_local_skill_host_wiring.sh`).** Pattern: `test/test_skill_invocation_policy.sh` —
  `mktemp -d "${TMPDIR:-/tmp}/local-skill-host-wiring.XXXXXX"`, a guarded `cleanup` trap that removes
  only that prefix, a baseline copy that must pass, `reset_case`, and `expect_rejection <description>
  <root> <diagnostic>`. Copy both trees with `cp -RP` so the relative symlinks stay symlinks and
  resolve inside the fixture root. Never mutate the live checkout.
- **Integrity wiring.** New section `2b. Repository-local skill host wiring` directly after 2a in
  `test/test_harness_integrity.sh`, two `assert` lines in 2a's shape. Both scripts are classified in
  `test/shell_tests.manifest` beside their 2a siblings.

## Prerequisites

- None.

## Tasks

### Task 1: write-tests §8 and §9 defer to CI gates and the test_suite gate
**Story:** Story 1 (happy criterion 1, negative criterion 1)
**Type:** refactor

**Steps:**
1. Edit `.agents/skills/write-tests/SKILL.md` §8: replace the typecheck-target and lint paragraphs (from "During authoring, run…" through "A green test run is not evidence that the test compiles. Verify both.") with two statements: during authoring, run the narrowest test invocation for the file under work; the required CI `typecheck` job (`npm run typecheck:test`) and `lint` job in `.github/workflows/ci.yml` are the gate that proves test files type-check and lint. Keep the live-corpus placement paragraph and the five-minute suite-duration budget paragraph unchanged.
2. In §8 delete "Before handoff, run the project's configured aggregate test command…" and add one sentence: the engine-native `test_suite` gate owns aggregate test execution as `HARNESS.md` defines, and authoring and diagnosis never launch it.
3. In §9 delete step 7 ("Run the project's aggregate test command once from a clean process set."); keep steps 1–6 unchanged.
4. In the completion checklist delete the typecheck-covers-tests item, the lint item, the "CI and local aggregate execution…" item, and the "The aggregate suite completes under five minutes." item (the budget stays in §8 prose).
5. Commit: "refactor(write-tests): defer typecheck, lint, and aggregate runs to their gates".

**Done when:**
- §8 of `.agents/skills/write-tests/SKILL.md` contains a statement that the CI `typecheck` job (`npm run typecheck:test`) and `lint` job in `.github/workflows/ci.yml` are the gate that proves test files type-check and lint, and the file no longer contains `If the project's default typecheck skips tests` or `The typecheck command MUST be one that covers test files`.
- §8 of `.agents/skills/write-tests/SKILL.md` contains a statement that the `test_suite` gate owns aggregate test execution as `HARNESS.md` defines, and the file contains none of `Before handoff, run`, `Run the project's aggregate test command once`, `CI and local aggregate execution use`.
- The `## 9. Diagnose a slow or wedged suite` section has exactly six numbered steps and none contains the word `aggregate`, and the `## Completion checklist` section contains no item containing `aggregate`.

**Files likely touched:**
- `.agents/skills/write-tests/SKILL.md` — §8, §9 step 7, completion checklist

**Dependencies:** none

### Task 2: write-tests names its partial machinery backstops and keeps its judgment rules
**Story:** Story 1 (happy criteria 2 and 3, negative criterion 2)
**Type:** refactor

**Steps:**
1. Add a `## What is already mechanized — point at it, do not restate it` section to `.agents/skills/write-tests/SKILL.md` before the completion checklist, with one bullet per backstop: `AI_CONDUCTOR_NO_REAL_EXEC` in `src/conductor/test/setup.ts` is a partial backstop for the §4 external-boundary rules (it covers only daemon launch, the pr-labels gh/git seam, and the engineer dir); the suite leak guards `tmpdir-leak-guard.ts`, `pipeline-leak-guard.ts`, `signals-leak-guard.ts`, `park-leak-guard.ts`, and `tmux-leak-guard.ts` under `src/conductor/test/` are a partial backstop for the §6 cleanup rules (they detect leaks after the run); the default `vitest.config.ts` exclusion of `test/smoke/**`, `*.smoke.test.ts`, and `*.e2e.test.ts` is a partial backstop for §1 smoke and e2e placement (it excludes by name but cannot classify a test); the CI `typecheck:test` and `lint` jobs back §8. Close with one sentence: each backstop is partial, so the rule it backs remains binding.
2. Leave headings `## 1.` through `## 7.`, the §8 live-corpus placement paragraph, §9 steps 1–6, the frontmatter, and `agents/openai.yaml` unchanged.
3. Run `bash test/check_skill_invocation_policy.sh "$PWD"` and confirm exit 0.
4. Commit: "refactor(write-tests): name the machinery that partially backs each rule".

**Done when:**
- The `## What is already mechanized` section of `.agents/skills/write-tests/SKILL.md` states `AI_CONDUCTOR_NO_REAL_EXEC` in `src/conductor/test/setup.ts` as the partial backstop for the §4 external-boundary rules, and states the leak guards `tmpdir-leak-guard.ts`, `pipeline-leak-guard.ts`, `signals-leak-guard.ts`, `park-leak-guard.ts`, `tmux-leak-guard.ts` as the partial backstop for the §6 cleanup rules.
- The same section states the `vitest.config.ts` smoke and e2e exclusion (`*.smoke.test.ts`, `*.e2e.test.ts`) as the backstop for §1 smoke placement, and states that each backstop is partial so the rule it backs remains binding.
- `.agents/skills/write-tests/SKILL.md` still contains the headings `## 1. Classify the test`, `## 2. Select the seam before writing the fixture`, `## 3. Bound every Conductor fixture`, `## 4. Mock external boundaries through dependency injection`, `## 5. Keep time deterministic`, `## 6. Keep cleanup trustworthy`, `## 7. Avoid false integration tests`, each with its rule bullets unchanged from main.
- §8 still states that a test whose verdict depends on the live `.docs/` corpus belongs in `src/conductor/test/corpus/`, and `## 9. Diagnose a slow or wedged suite` steps 1–6 (stop own workers, re-run in isolation, inspect live state, look for stale evidence, fix the authority or fixture boundary, run the failing files together) are unchanged from main.
- `bash test/check_skill_invocation_policy.sh <repo-root>` exits 0 on the delivered tree, and the diff leaves the skill's `name: write-tests` and `disable-model-invocation: true` lines and `.agents/skills/write-tests/agents/openai.yaml` byte-identical.

**Files likely touched:**
- `.agents/skills/write-tests/SKILL.md` — new mechanized-backstops section

**Dependencies:** Task 1

### Task 3: Wire write-tests for Claude and make scope-check's catalog self-describing
**Story:** Story 2 (happy criteria 1 and 3)
**Type:** infrastructure

**Steps:**
1. `ln -s ../../.agents/skills/write-tests .claude/skills/write-tests`, then `git add -f .claude/skills/write-tests` (`.claude/` is excluded via `.git/info/exclude`).
2. In `.agents/skills/scope-check/SKILL.md` §2 table, replace the local catalog's "Current members" cell (`maintain-documentation`, `write-tests`, `scope-check`) with "every directory under `.agents/skills/`", so the row cannot drift from the tree.
3. In §3 "What is already mechanized — point at it, do not restate it", extend the "The local catalog's parity mechanism is the symlink pair." bullet: `test/check_local_skill_host_wiring.sh` (integrity check 2b) rejects a local skill without a resolving `.claude/skills/<name>` symlink and an orphaned `.claude/skills` entry; `test/check_skill_invocation_policy.sh` (integrity check 2a) rejects a local skill without its `agents/openai.yaml` policy.
4. Commit: "fix(skills): wire write-tests for Claude; scope-check names the parity checks".

**Done when:**
- `git ls-files -s .claude/skills/write-tests` reports mode `120000`, `readlink .claude/skills/write-tests` prints `../../.agents/skills/write-tests`, and `cmp .claude/skills/write-tests/SKILL.md .agents/skills/write-tests/SKILL.md` exits 0.
- `.agents/skills/scope-check/SKILL.md`'s current-members row contains `every directory under` and `.agents/skills/` and no longer lists `` `maintain-documentation`, `write-tests`, `scope-check` ``.
- `.agents/skills/scope-check/SKILL.md`'s "What is already mechanized" section names `test/check_local_skill_host_wiring.sh` as enforcing the `.claude/skills/<name>` symlink and `test/check_skill_invocation_policy.sh` as enforcing `agents/openai.yaml`.

**Files likely touched:**
- `.claude/skills/write-tests` — new git symlink (mode 120000)
- `.agents/skills/scope-check/SKILL.md` — members row and mechanized list

**Dependencies:** none

### Task 4: Wiring checker rejects every one-host local skill shape
**Story:** Story 2 (negative criteria 1–5)
**Type:** negative-path

**Steps:**
1. Write the failing mutation suite `test/test_local_skill_host_wiring.sh` (pattern: `test/test_skill_invocation_policy.sh` — `mktemp -d "${TMPDIR:-/tmp}/local-skill-host-wiring.XXXXXX"`, a `cleanup` trap that removes only that prefix and refuses any other path, a baseline that must pass, `reset_case`, `expect_rejection <description> <root> <diagnostic>` that fails when the checker exits 0 or the diagnostic is missing). Build the baseline with `mkdir -p <root>/.agents <root>/.claude` and `cp -RP` of the live `.agents/skills` and `.claude/skills` so relative symlinks stay symlinks. Cases: (a) `rm <case>/.claude/skills/scope-check` → `scope-check — missing .claude/skills symlink`; (b) replace it with `ln -s ../../.agents/skills/does-not-exist` → `scope-check — .claude/skills symlink resolves to unexpected target ../../.agents/skills/does-not-exist`; (c) replace it with `ln -s ../../.agents/skills/event-spine` → `scope-check — .claude/skills symlink resolves to unexpected target ../../.agents/skills/event-spine`; (d) `ln -s ../../.agents/skills/ghost <case>/.claude/skills/ghost` with no `.agents/skills/ghost` → `ghost — orphaned .claude/skills entry`; (e) replace the symlink with `cp -R` of the skill directory → `scope-check — .claude/skills entry is not a symlink`; (f) empty `<case>/.agents/skills/` → non-zero exit and `enumerated no local skills`. Also assert a missing root argument exits 2.
2. Verify it fails (RED) — the checker does not exist.
3. Implement `test/check_local_skill_host_wiring.sh <harness-root>` (pattern: `test/check_skill_invocation_policy.sh` — `set -euo pipefail`, required root argument with exit 2 on usage, accumulated `VIOLATIONS` printed to stderr, exit 1). Mechanism: enumerate `"$ROOT"/.agents/skills/*/SKILL.md` (zero → exit 2 `enumerated no local skills`); per name, missing entry, `[ ! -L ]`, and a physical-resolution mismatch between `(cd -P "$link" 2>/dev/null && pwd -P)` and `(cd -P "$ROOT/.agents/skills/<name>" && pwd -P)` (a failed resolution counts as a mismatch, reporting `readlink "$link"`); then each `"$ROOT"/.claude/skills/*` entry without `"$ROOT"/.agents/skills/<name>/SKILL.md` is orphaned. No `readlink -f`, `mapfile`, or `readarray`.
4. Verify GREEN: the suite passes, and `bash test/check_local_skill_host_wiring.sh "$PWD"` exits 0 on the delivered tree.
5. Commit: "test(integrity): reject repository-local skills wired for only one host".

**Done when:**
- [test] `test/test_local_skill_host_wiring.sh` passes, and `test/check_local_skill_host_wiring.sh` exits non-zero with output containing `scope-check — missing .claude/skills symlink` for fixture (a), `ghost — orphaned .claude/skills entry` for fixture (d), and `scope-check — .claude/skills entry is not a symlink` for fixture (e).
- [test] For fixture (b) the checker exits non-zero with output containing `scope-check — .claude/skills symlink resolves to unexpected target ../../.agents/skills/does-not-exist`, and for fixture (c) with output containing `scope-check — .claude/skills symlink resolves to unexpected target ../../.agents/skills/event-spine`.
- [test] For fixture (f) with an empty `.agents/skills/`, `test/check_local_skill_host_wiring.sh` exits non-zero and prints `enumerated no local skills`, and with no root argument it exits 2.
- [test] The suite's `cp -RP` baseline fixture, holding relative symlinks copied from the live `.claude/skills/`, passes `test/check_local_skill_host_wiring.sh` with exit 0, and the suite's cleanup removes only its `local-skill-host-wiring.*` fixture directory.
- `bash test/check_local_skill_host_wiring.sh <repo-root>` exits 0 on the delivered tree, and `test/check_local_skill_host_wiring.sh` contains no `readlink -f`, `mapfile`, or `readarray`.

**Files likely touched:**
- `test/check_local_skill_host_wiring.sh` — new checker
- `test/test_local_skill_host_wiring.sh` — new mutation suite

**Dependencies:** Task 3

### Task 5: Integrity suite runs the wiring checker and its mutation suite
**Story:** Story 2 (happy criterion 2)
**Type:** happy-path

**Steps:**
1. In `test/test_harness_integrity.sh`, directly after section 2a, add `echo -e "${BOLD}2b. Repository-local skill host wiring${NC}"` and two assertions in 2a's exact shape: `bash "$SCRIPT_DIR/check_local_skill_host_wiring.sh" "$HARNESS_DIR"` → `assert "every repository-local skill is wired for both Claude and Codex" 0|1` (indented output on failure), and `bash "$SCRIPT_DIR/test_local_skill_host_wiring.sh"` → `assert "local skill host-wiring checker rejects one-host mutations" 0|1`.
2. Add to `test/shell_tests.manifest`, beside the 2a lines: `check_local_skill_host_wiring.sh integrity integrity validates its contract directly` and `test_local_skill_host_wiring.sh integrity integrity runs its fixture suite`.
3. Run `bash test/check_shell_test_classification.sh` and the two new scripts directly and confirm each exits 0. The full `test/test_harness_integrity.sh` run is owned by the `test_suite` gate; do not launch it here.
4. Commit: "test(integrity): add local skill host-wiring check 2b".

**Done when:**
- `test/test_harness_integrity.sh` has a `2b. Repository-local skill host wiring` section that runs `check_local_skill_host_wiring.sh "$HARNESS_DIR"` and `test_local_skill_host_wiring.sh`, asserting `every repository-local skill is wired for both Claude and Codex` and `local skill host-wiring checker rejects one-host mutations`, each passing (0) when its script exits 0 and failing (1) otherwise.
- `test/shell_tests.manifest` classifies `check_local_skill_host_wiring.sh` and `test_local_skill_host_wiring.sh` as `integrity`, and `bash test/check_shell_test_classification.sh` exits 0.
- The `test_suite` gate's `test/test_harness_integrity.sh` run on the delivered tree reports both 2b assertions as passing.

**Files likely touched:**
- `test/test_harness_integrity.sh` — section 2b
- `test/shell_tests.manifest` — two classification lines

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ──▶ Task 2
Task 3 ──▶ Task 4 ──▶ Task 5
```

## Integration Points

- After Task 5: `test/test_harness_integrity.sh` (owned by `test_suite`) reports the 2b assertions against the live tree.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the skill, when an agent reads its CI-parity guidance, then it names the CI `typecheck:test` and `lint` jobs in `.github/workflows/ci.yml` as the gate that proves test files type-check and lint, and it no longer instructs the agent to find or choose a typecheck target that covers the test directory. | 1 | "contains a statement that the CI `typecheck` job (`npm run typecheck:test`) and `lint` job in `.github/workflows/ci.yml` are the gate" | diff-local |
| Story 1 happy: Given the skill, when an agent reads its mechanized-backstops section, then that section names `AI_CONDUCTOR_NO_REAL_EXEC` in `src/conductor/test/setup.ts` as the partial backstop for the external-boundary rules, the suite leak guards (tmpdir, pipeline, signals, park, and tmux) as the partial backstop for the cleanup rules, and the `vitest.config.ts` smoke and e2e exclusion as the backstop for smoke placement, and states that each backstop is partial so the rule it backs remains binding. | 2 | "states `AI_CONDUCTOR_NO_REAL_EXEC` in `src/conductor/test/setup.ts` as the partial backstop" | diff-local |
| Story 1 happy: Given the skill, when an agent reads it, then the rules for classifying the test level, selecting the seam before writing the fixture, bounding every Conductor fixture, mocking external boundaries through dependency injection, keeping time deterministic, keeping cleanup trustworthy, avoiding false integration tests, placing live-corpus tests in `src/conductor/test/corpus/`, and diagnosing a slow or wedged suite (isolate, inspect, fix, re-run together) are all still present. | 2 | "still contains the headings `## 1. Classify the test`" | diff-local |
| Story 1 negative: Given the skill, when it is searched for an instruction to run the configured aggregate test command before handoff, as a diagnosis step, or as a completion-checklist item, then none is found, and the skill instead states that the `test_suite` gate owns aggregate runs as `HARNESS.md` defines. | 1 | "contains a statement that the `test_suite` gate owns aggregate test execution" | diff-local |
| Story 1 negative: Given the trimmed skill, when `test/check_skill_invocation_policy.sh` runs against the live repository, then it still passes, because the skill keeps its `name: write-tests` and canonical `disable-model-invocation: true` frontmatter and its `agents/openai.yaml` keeps `allow_implicit_invocation: false`. | 2 | "`bash test/check_skill_invocation_policy.sh <repo-root>` exits 0 on the delivered tree" | diff-local |
| Story 2 happy: Given the delivered tree, when `.claude/skills/write-tests` is inspected, then it is a committed git symlink (mode `120000`) whose target is `../../.agents/skills/write-tests` and which resolves to the same `SKILL.md` Codex reads. | 3 | "`git ls-files -s .claude/skills/write-tests` reports mode `120000`" | diff-local |
| Story 2 happy: Given the live repository where every `.agents/skills/<name>/` has a `.claude/skills/<name>` symlink resolving to it and every `.claude/skills/<name>` entry has a matching `.agents/skills/<name>/`, when `test/test_harness_integrity.sh` runs, then its local-skill host-wiring assertion passes and its wiring-checker mutation-suite assertion passes. | 5, 4 | "has a `2b. Repository-local skill host wiring` section" | diff-local |
| Story 2 happy: Given `.agents/skills/scope-check/SKILL.md`, when an agent reads its local catalog's current-members row and its already-mechanized list, then the row defines the members as every directory under `.agents/skills/` instead of a hand-maintained name list, and the mechanized list names the wiring checker as the enforcement for the `.claude/skills/<name>` symlink and `test/check_skill_invocation_policy.sh` as the enforcement for `agents/openai.yaml`. | 3 | "current-members row contains `every directory under`" | diff-local |
| Story 2 negative: Given a fixture root where `.agents/skills/<name>/` exists with no `.claude/skills/<name>` entry, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` as missing its `.claude/skills` symlink. | 4 | "`scope-check — missing .claude/skills symlink` for fixture (a)" | diff-local |
| Story 2 negative: Given a fixture root where `.claude/skills/<name>` is a dangling symlink or a symlink that resolves outside `.agents/skills/<name>`, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` and the unexpected target. | 4 | "For fixture (b) the checker exits non-zero" | diff-local |
| Story 2 negative: Given a fixture root where `.claude/skills/<name>` exists with no matching `.agents/skills/<name>/`, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` as an orphaned `.claude/skills` entry. | 4 | "`ghost — orphaned .claude/skills entry` for fixture (d)" | diff-local |
| Story 2 negative: Given a fixture root where `.claude/skills/<name>` is a regular directory copy of the skill rather than a symlink, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` as not a symlink. | 4 | "`scope-check — .claude/skills entry is not a symlink` for fixture (e)" | diff-local |
| Story 2 negative: Given a fixture root whose `.agents/skills/` contains no skill directories, when the wiring checker runs against it, then it exits non-zero reporting that it enumerated no local skills, rather than passing on an empty set. | 4 | "prints `enumerated no local skills`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
