# Implementation Plan: Skill frontmatter agrees with the engine (#1018)

**Date:** 2026-10-12
**Design:** none (technical track, Tier S — no PRD or ADR)
**Stories:** .docs/stories/skill-frontmatter-disagrees-with-the-engine-for-si.md
**Conflict check:** skipped (Tier S)

## Summary

Correct the remaining skill-frontmatter and skill-prose drift from the engine's built-in step
definitions, and add one default-tier vitest drift check that derives its expectations from those
definitions so the drift cannot return. 5 tasks.

## Technical Approach

- **Source of truth.** The engine's built-in step definitions: `ALL_STEPS` (ordered) plus
  `OUT_OF_BAND_STEPS` (unordered: `bootstrap`, `assess`, `remediate`, `attribution_verify`) in
  `src/conductor/src/engine/steps.ts`. No step's `enforcement` value changes.
- **Step-mapped skill.** A skill directory named by at least one built-in step's `skillName`. Its
  expected `enforcement:` is the strictest level among the steps that name it, ranked
  `advisory` < `gating` < `structural` < `mechanical` (the `EnforcementLevel` union order). Only
  `architecture-review` is multi-mapped today (`architecture_review` advisory,
  `architecture_review_as_built` gating → `gating`).
- **Drift check.** One new test file, `src/conductor/test/skill-frontmatter-engine-drift.test.ts`
  (default tier: matches `test/**/*.test.ts`). It imports `ALL_STEPS` and `OUT_OF_BAND_STEPS`,
  reads each `skills/<name>/SKILL.md` from the repo root (resolve via
  `new URL('../../../skills/…', import.meta.url)` as `skill-contracts.test.ts` does for repo-root
  files), and parses only the leading `---` frontmatter block with line regexes
  (`^enforcement:\s*(\S+)`, `^requires:\s*\[(.*)\]` split on commas, quotes stripped). Each
  assertion collects every violation into an array and `expect`s it to equal `[]`, so a failure
  message names every offending skill/step/row. Skills not named by any built-in step are never
  compared.
- **Requires ordering.** For step-mapped skills A and B both mapped from `ALL_STEPS` steps, A's
  `requires:` listing B is an inversion when B's earliest `ALL_STEPS` index is greater than A's
  latest index. `requires:` entries that are not step-mapped skill names (e.g. `verify-claims`,
  quoted prose preconditions) are ignored.
- **Dangling skillNames.** `worktree` dispatches through `STEP_SKILL_INVOCATIONS` as
  `conduct worktree`; `attribution_verify` is `engine-native`. Their `skillName` fields have no
  matching skill directory, so they are deleted; dispatch reads `STEP_SKILL_INVOCATIONS`, not
  `skillName`, so behavior is unchanged (proved by the existing
  `src/conductor/test/engine/skill-invocation.test.ts`).
- **Sequencing.** Task 1 creates the test file; Tasks 2–4 each append one assertion to it and so run
  serially to avoid concurrent edits of one file. Task 5 is a prose-only skill edit, independent.

## Prerequisites

- None.

## Tasks

### Task 1: Drift check for enforcement; align four skills
**Story:** Story 1; Story 5
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/skill-frontmatter-engine-drift.test.ts`: build the step-mapped skill map from `ALL_STEPS` + `OUT_OF_BAND_STEPS` (skillName → steps), compute each skill's expected level as the strictest of its steps' `enforcement` by the rank in Technical Approach, parse each `skills/<skill>/SKILL.md` frontmatter `enforcement:`, and assert the list of mismatches (`<skill>: declared <x>, expected <y> (from <step,…>)`) equals `[]`. Skills absent from the map are not read.
2. Verify RED: it fails listing `memory`, `architecture-diagram`, `assess`, `remediate` as `declared gating, expected advisory`.
3. Implement: set `enforcement: advisory` in `skills/memory/SKILL.md`, `skills/architecture-diagram/SKILL.md`, `skills/assess/SKILL.md`, `skills/remediate/SKILL.md`. Leave `skills/architecture-review/SKILL.md` at `gating`.
4. Verify GREEN.
5. Commit: "test(skills): assert step-mapped skill enforcement matches engine".

**Done when:**
- [test] The enforcement drift test computes each step-mapped skill's expected level at test time from `ALL_STEPS` and `OUT_OF_BAND_STEPS` (strictest of its steps), not from a literal skill→level list, and passes.
- [test] The same test fails with a message naming the skill, its declared value, its expected value, and the step(s) it was derived from when `skills/memory/SKILL.md` declares `enforcement: gating`.
- `skills/memory/SKILL.md`, `skills/architecture-diagram/SKILL.md`, `skills/assess/SKILL.md`, and `skills/remediate/SKILL.md` frontmatter each read `enforcement: advisory`, and `skills/architecture-review/SKILL.md` reads `enforcement: gating`.
- Every other step-mapped skill keeps its prior `enforcement:` value (e.g. `stories`, `plan`, `finish`, `prd-audit` stay `gating`; `pipeline` stays `structural`), and the diff changes no `enforcement` value in `src/conductor/src/engine/steps.ts`.
- [test] The test never compares a skill absent from the step-mapped map (e.g. `tdd`, `verify-claims`): a fixture-free assertion shows those skills are not in the computed map.

**Files likely touched:**
- `src/conductor/test/skill-frontmatter-engine-drift.test.ts` — new drift test
- `skills/memory/SKILL.md` — enforcement → advisory
- `skills/architecture-diagram/SKILL.md` — enforcement → advisory
- `skills/assess/SKILL.md` — enforcement → advisory
- `skills/remediate/SKILL.md` — enforcement → advisory

**Dependencies:** none

### Task 2: Requires-order check; fix manual-test dependency
**Story:** Story 2; Story 5
**Type:** negative-path

**Steps:**
1. Write failing test in the drift test file: for each step-mapped skill A, parse `requires:`; for each entry B that is a step-mapped skill and both map from `ALL_STEPS`, flag `A requires B, but B (earliest step <s>, index i) runs after A (latest step <t>, index j)` when i > j; assert the list equals `[]`.
2. Verify RED: it flags `manual-test requires finish`.
3. Implement: in `skills/manual-test/SKILL.md` set `requires: [verify-claims]` and reword `description:` so it no longer says "after /finish" (it runs after the test suite and before finish).
4. Verify GREEN.
5. Commit: "fix(manual-test): drop inverted finish dependency".

**Done when:**
- [test] The requires-order test fails with a message naming both `manual-test` and `finish` and the inverted step order when `skills/manual-test/SKILL.md` declares `requires: [finish, verify-claims]`.
- [test] The requires-order test passes on the corrected tree and ignores `requires:` entries that are not step-mapped skills (`verify-claims`, quoted prose preconditions).
- `skills/manual-test/SKILL.md` frontmatter `requires:` is exactly `[verify-claims]`, and its `description:` does not contain "after /finish".

**Files likely touched:**
- `src/conductor/test/skill-frontmatter-engine-drift.test.ts` — requires-order assertion
- `skills/manual-test/SKILL.md` — requires + description

**Dependencies:** Task 1

### Task 3: Skill-directory existence check; drop dangling skillNames
**Story:** Story 4; Story 5
**Type:** negative-path

**Steps:**
1. Write failing test in the drift test file: for every step in `ALL_STEPS` and `OUT_OF_BAND_STEPS` with a `skillName`, assert `skills/<skillName>/SKILL.md` exists; collect `<step>: skills/<skillName>/SKILL.md missing` and assert the list equals `[]`.
2. Verify RED: it flags `worktree` and `attribution_verify`.
3. Implement: delete the `skillName` property from the `worktree` entry in `ALL_STEPS` and the `attribution_verify` entry in `OUT_OF_BAND_STEPS` in `src/conductor/src/engine/steps.ts`. Do not touch `STEP_SKILL_INVOCATIONS`.
4. Verify GREEN, and run `src/conductor/test/engine/skill-invocation.test.ts` unchanged.
5. Commit: "fix(steps): remove skillNames that name no skill directory".

**Done when:**
- [test] The skill-directory test fails naming the step and the missing `skills/<name>/SKILL.md` when a built-in step's `skillName` names a nonexistent directory (as `worktree` and `attribution_verify` do before the fix), and passes after.
- The `worktree` and `attribution_verify` step definitions in `src/conductor/src/engine/steps.ts` have no `skillName`, and `STEP_SKILL_INVOCATIONS` is unchanged by the diff.
- [test] `src/conductor/test/engine/skill-invocation.test.ts` passes unmodified, asserting `worktree` still dispatches `conduct worktree` and `attribution_verify` stays `engine-native`.

**Files likely touched:**
- `src/conductor/test/skill-frontmatter-engine-drift.test.ts` — skill-directory assertion
- `src/conductor/src/engine/steps.ts` — remove two `skillName` fields

**Dependencies:** Task 2

### Task 4: Conduct tier-skip table check; remove code-review row
**Story:** Story 3; Story 5
**Type:** negative-path

**Steps:**
1. Write failing test in the drift test file: in `skills/conduct/SKILL.md`, find the table whose header is `| Step | Can Skip? | Reason |`, take each body row's first cell, and flag it unless it equals (after mapping `-` → `_`) an engine step name from `ALL_STEPS`/`OUT_OF_BAND_STEPS` or equals a step-mapped skill name; assert the flagged list equals `[]`.
2. Verify RED: it flags `code-review`.
3. Implement: delete the `| code-review | … |` row from that table.
4. Verify GREEN.
5. Commit: "fix(conduct): drop code-review tier row; it is not an engine step".

**Done when:**
- [test] The tier-table test fails naming the `code-review` row when that row is present in the `| Step | Can Skip? | Reason |` table of `skills/conduct/SKILL.md`, and passes after its removal.
- [test] The tier-table test accepts every remaining row, including `writing-system-tests` (a step-mapped skill) and `architecture-review-as-built` (an engine step after `-`→`_`).
- `skills/conduct/SKILL.md`'s tier-skip table contains no `code-review` row.
- [test] `skill-frontmatter-engine-drift.test.ts`, with all four assertions (enforcement, requires-order, skill-directory, tier-table), is collected by the default vitest config (`src/conductor/vitest.config.ts` include `test/**/*.test.ts`, not excluded) and passes under `npm test` in `src/conductor`.

**Files likely touched:**
- `src/conductor/test/skill-frontmatter-engine-drift.test.ts` — tier-table assertion
- `skills/conduct/SKILL.md` — remove row

**Dependencies:** Task 3

### Task 5: Remove the false progress.log hook claim from pipeline skill
**Story:** Story 3
**Type:** refactor

**Steps:**
1. In `skills/pipeline/SKILL.md`'s `### Progress Log` section, delete the sentence claiming `session-start-context.sh` reads the last 30 lines of `.pipeline/progress.log`; keep the append instruction.
2. Confirm `grep -n progress.log hooks/claude/session-start-context.sh` is still empty (the claim was false, not the hook).
3. Commit: "fix(pipeline): drop false session-start progress.log claim".

**Done when:**
- `skills/pipeline/SKILL.md` contains no sentence stating that `session-start-context.sh` (or any session-start hook) reads `.pipeline/progress.log`.
- `hooks/claude/session-start-context.sh` is unchanged by the diff.

**Files likely touched:**
- `skills/pipeline/SKILL.md` — remove sentence

**Dependencies:** none

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3 → Task 4
Task 5 (independent)
```

## Integration Points

- After Task 1: the default vitest suite (`npm test` in `src/conductor`) runs the drift check.
- Task 3 is the only production-code change; its dispatch behavior is proved through the existing `STEP_SKILL_INVOCATIONS` dispatch test.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the built-in step definitions, when `skills/memory/SKILL.md`, `skills/architecture-diagram/SKILL.md`, `skills/assess/SKILL.md`, and `skills/remediate/SKILL.md` are read, then each declares `enforcement: advisory`, matching its step's engine enforcement. | 1 | "each read `enforcement: advisory`" | diff-local |
| Story 1 happy: Given `architecture-review` backs both `architecture_review` (advisory) and `architecture_review_as_built` (gating), when `skills/architecture-review/SKILL.md` is read, then it declares `enforcement: gating`, the strictest level among the steps it backs. | 1 | "`skills/architecture-review/SKILL.md` reads `enforcement: gating`" | diff-local |
| Story 1 negative: Given a step-mapped skill whose step is `gating` in the engine, when its frontmatter is read after this change, then it still declares `enforcement: gating` (no step-mapped skill is weakened below its engine level; e.g. `stories`, `plan`, `finish`, `prd-audit` remain `gating`, and `pipeline` remains `structural`). | 1 | "Every other step-mapped skill keeps its prior `enforcement:` value" | diff-local |
| Story 2 happy: Given the engine runs `manual_test` before `finish`, when `skills/manual-test/SKILL.md` frontmatter is read, then `requires:` does not list `finish` and still lists `verify-claims`. | 2 | "frontmatter `requires:` is exactly `[verify-claims]`" | diff-local |
| Story 2 happy: Given the same ordering, when the manual-test `description:` is read, then it does not instruct use "after /finish". | 2 | "its `description:` does not contain "after /finish"" | diff-local |
| Story 2 negative: Given any step-mapped skill A whose `requires:` names another step-mapped skill B, when B's earliest step runs strictly after A's latest step in engine order, then the drift check (Story 5) fails naming A, B, and the inverted ordering. | 2 | "fails with a message naming both `manual-test` and `finish` and the inverted step order" | diff-local |
| Story 3 happy: Given `code-review` is not an engine step, when the tier-skip table in `skills/conduct/SKILL.md` is read, then it contains no `code-review` row. | 4 | "tier-skip table contains no `code-review` row" | diff-local |
| Story 3 happy: Given `hooks/claude/session-start-context.sh` does not read `.pipeline/progress.log`, when `skills/pipeline/SKILL.md`'s Progress Log section is read, then it makes no claim that a session-start hook reads that file. | 5 | "contains no sentence stating that `session-start-context.sh` (or any session-start hook) reads `.pipeline/progress.log`" | diff-local |
| Story 3 negative: Given the conduct tier-skip table after this change, when each row's first cell is compared with the engine's step names (hyphen/underscore equivalent) and step-mapped skill names, then the drift check (Story 5) fails for any row naming neither (e.g. a restored `code-review` row), naming that row. | 4 | "fails naming the `code-review` row" | diff-local |
| Story 4 happy: Given the `worktree` step (dispatched through the `conduct` skill invocation) and the engine-native `attribution_verify` step, when their step definitions are read, then neither carries a `skillName`. | 3 | "have no `skillName`" | diff-local |
| Story 4 happy: Given those two steps, when the engine dispatches them, then they dispatch exactly as before (the `worktree` step still invokes `conduct worktree`; `attribution_verify` stays engine-native). | 3 | "asserting `worktree` still dispatches `conduct worktree` and `attribution_verify` stays `engine-native`" | diff-local |
| Story 4 negative: Given any built-in step definition whose `skillName` has no `skills/<skillName>/SKILL.md`, when the drift check (Story 5) runs, then it fails naming the step and the missing skill directory. | 3 | "fails naming the step and the missing `skills/<name>/SKILL.md`" | diff-local |
| Story 5 happy: Given the corrected repository, when the default vitest suite runs, then the frontmatter/engine drift check passes. | 4 | "with all four assertions (enforcement, requires-order, skill-directory, tier-table), is collected by the default vitest config" | diff-local |
| Story 5 happy: Given a step-mapped skill, when the check computes its expected enforcement, then the expectation is derived from the engine's step definitions at test time (strictest level among the steps that name it), not from a hand-maintained list. | 1 | "computes each step-mapped skill's expected level at test time from `ALL_STEPS` and `OUT_OF_BAND_STEPS` (strictest of its steps)" | diff-local |
| Story 5 negative: Given a step-mapped skill whose frontmatter `enforcement:` differs from its derived engine level (e.g. `memory` declaring `gating`), when the check runs, then it fails naming the skill, the declared value, the expected value, and the step(s) it was derived from. | 1 | "naming the skill, its declared value, its expected value, and the step(s) it was derived from" | diff-local |
| Story 5 negative: Given a built-in step whose `skillName` has no `skills/<name>/SKILL.md`, when the check runs, then it fails naming the step and the missing directory. | 3 | "fails naming the step and the missing `skills/<name>/SKILL.md`" | diff-local |
| Story 5 negative: Given a step-mapped skill whose `requires:` names a step-mapped skill that runs strictly later in engine order (e.g. `manual-test` requiring `finish`), when the check runs, then it fails naming both skills. | 2 | "fails with a message naming both `manual-test` and `finish`" | diff-local |
| Story 5 negative: Given a row in `skills/conduct/SKILL.md`'s tier-skip table whose first cell names neither an engine step (hyphen/underscore equivalent) nor a step-mapped skill, when the check runs, then it fails naming that row. | 4 | "fails naming the `code-review` row" | diff-local |
| Story 5 negative: Given a skill not named by any built-in step (e.g. `tdd`, `verify-claims`, a per-project override skill), when the check runs, then that skill's `enforcement:` is not compared and does not fail the check. | 1 | "The test never compares a skill absent from the step-mapped map" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
