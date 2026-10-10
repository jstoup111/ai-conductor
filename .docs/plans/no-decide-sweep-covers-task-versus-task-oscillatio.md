# Implementation Plan: DECIDE sweeps task-versus-task oscillation inside a plan (#1540)

**Date:** 2026-10-09
**Design:** none (technical track, Tier S; see `.docs/track/no-decide-sweep-covers-task-versus-task-oscillatio.md`)
**Stories:** .docs/stories/no-decide-sweep-covers-task-versus-task-oscillatio.md
**Conflict check:** Not required at Tier S

## Summary

Adds a task-versus-task oscillation sweep to `/coherence-check`, which records a grounded finding
as `fail` on the existing `task` row. It splits "acyclic" from "non-interfering" in `/plan`, and
states which layer pairs each sweep owns in `/conflict-check` and `/coherence-check`. Four tasks,
all skill prose plus focused skill-contract tests.

## Technical Approach

- **Prose only, no engine change.** The land-time coherence gate already treats a legacy `task`
  row whose verdict is `fail` as blocking (`skills/coherence-check/SKILL.md` "verdict vocabulary"
  section; `src/conductor/src/engine/coherence-parse.ts` `LEGACY_ROW_CLASSES`). The new sweep
  reuses that row and verdict. No row class, parser, validator or tier table changes.
- **Home of the sweep.** `/coherence-check` is the only DECIDE sweep that runs after `/plan`.
  `/conflict-check` runs before `/plan` and cannot see tasks. The new sweep goes beside the
  existing cross-layer oscillation heuristic in `skills/coherence-check/SKILL.md`, with the same
  both-directions question and the same grounding rule.
- **Classification.** A pair that fails in both directions is an oscillation. A pair that fails in
  one direction is a contradiction. Both are recorded as `fail`, because the dependency graph does
  not stop BUILD from completing the two tasks in either order.
- **Layer ownership.** Both sweep skills carry one consistent statement. Story↔story belongs to
  `/conflict-check`. Cross-layer pairs and task↔task belong to `/coherence-check`. The
  coherence-check sentences that defer *all* same-layer pairs to `/conflict-check` are narrowed
  to story↔story.
- **Tests.** Follow the existing skill-contract test pattern in
  `src/conductor/test/engine/plan-slices-skill-contract.test.ts` (read the skill with
  `readFile(fileURLToPath(new URL('../../../../skills/<name>/SKILL.md', import.meta.url)))`, slice
  the relevant section, assert on its text). Search hint: `*-skill-contract.test.ts` under
  `src/conductor/test/engine/`. Each skill gets its own contract test file, so the tasks for
  different skills share no file.

## Prerequisites

- None.

## Tasks

### Task 1: Add the task-versus-task sweep to coherence-check
**Story:** 1, 2
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/coherence-check-task-sweep-skill-contract.test.ts`, following the skill-contract pattern above. Locate the new `Task-versus-task oscillation` subsection of `skills/coherence-check/SKILL.md` and assert that it contains:
   - the question "if I fully complete task A, does task B's `Done when` still hold?" and the instruction to ask it in both directions;
   - the pairing criterion naming behavior, entity, file and fixture;
   - the instruction to set the affected `task` row's verdict to `fail` and quote opposing text from both tasks in Notes;
   - the oscillation (both directions) and contradiction (one direction) labels, both recorded as `fail`;
   - the rule that an ungrounded suspicion goes to the operator as an assumption with no `fail`;
   - the rule that the row uses `fail`, never words such as `oscillation` or `interference`;
   - the rule that pairs with nothing shared need no entry.
2. Verify it fails (RED).
3. Implement: add the `Task-versus-task oscillation` subsection immediately after the existing oscillation detection heuristic in `skills/coherence-check/SKILL.md`, carrying each rule from step 1. Cite #1535's Task 3 and Task 9 as the worked example.
4. Verify it passes (GREEN).
5. Commit: "feat(skills): sweep task-versus-task oscillation in coherence-check".

**Done when:**
- [test] coherence-check-task-sweep-skill-contract.test.ts asserts the `Task-versus-task oscillation` subsection of skills/coherence-check/SKILL.md directs asking "if I fully complete task A, does task B's `Done when` still hold?" in both directions (A against B, then B against A) for task pairs sharing a behavior, entity, file or fixture.
- [test] The same test asserts the subsection directs recording a found invalidation as `fail` on the affected `task` row with Notes quoting opposing text from both tasks, which the existing land-time coherence gate blocks.
- [test] The same test asserts the subsection names a both-directions failure an oscillation and a one-direction failure a contradiction, and records both as `fail` because the dependency graph does not stop BUILD from completing the two tasks in either order.
- [test] The same test asserts the subsection directs that an interference that cannot be grounded in quoted text from both tasks is raised to the operator as an assumption with no `fail` verdict, and that the row verdict is `fail`, never `oscillation` or `interference`.
- [test] The same test asserts the subsection states that task pairs sharing no behavior, entity, file or fixture need no row, section or verdict, and that existing `task` rows keep their coverage verdicts.

**Files likely touched:**
- `skills/coherence-check/SKILL.md` — new task-versus-task oscillation subsection
- `src/conductor/test/engine/coherence-check-task-sweep-skill-contract.test.ts` — new contract test

**Dependencies:** none

### Task 2: State layer ownership in coherence-check and add the checklist item
**Story:** 1, 4
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/engine/coherence-check-task-sweep-skill-contract.test.ts` with failing assertions:
   - the skill has a layer-ownership statement naming story↔story → `/conflict-check`, cross-layer → `/coherence-check` and task↔task → `/coherence-check`, and noting that `/conflict-check` runs before `/plan`;
   - no sentence in the skill says all same-layer pairs belong to `/conflict-check` (the current text "same-layer pairs are `/conflict-check`'s sweep" and "same-layer contradictions are what `/conflict-check` already sweeps for" no longer appear);
   - every line that mentions both `same-layer` and `/conflict-check` also names story↔story, so no reworded sentence still defers all same-layer pairs;
   - the verification checklist has an item for the task-versus-task sweep;
   - the verdict vocabulary list is still exactly `covered` / `gap` / `fail`.
2. Verify it fails (RED).
3. Implement:
   - narrow the oscillation-heuristic sentence and the checklist item to story↔story;
   - add the layer-ownership statement;
   - add a checklist item: "Task↔task pairs sharing a behavior, entity, file or fixture checked in both directions; any invalidation recorded as `fail` on the `task` row."
4. Verify it passes (GREEN).
5. Commit: "feat(skills): state coherence-check layer ownership".

**Done when:**
- [test] coherence-check-task-sweep-skill-contract.test.ts asserts skills/coherence-check/SKILL.md carries a layer-ownership statement mapping story↔story to `/conflict-check` and both cross-layer and task↔task to `/coherence-check`, noting `/conflict-check` runs before `/plan`.
- [test] The same test asserts the strings "same-layer pairs are `/conflict-check`'s sweep" and "same-layer contradictions are what `/conflict-check` already sweeps for" are absent from skills/coherence-check/SKILL.md.
- [test] The same test asserts every line of skills/coherence-check/SKILL.md that mentions both `same-layer` and `/conflict-check` also names story↔story, so no sentence anywhere in the skill defers all same-layer pairs to `/conflict-check`.
- [test] The same test asserts the skill's `## Verification` checklist contains a task↔task sweep item and that the verdict vocabulary section still names exactly `covered`, `gap` and `fail`.

**Files likely touched:**
- `skills/coherence-check/SKILL.md` — narrowed deferral sentences, ownership statement, checklist item
- `src/conductor/test/engine/coherence-check-task-sweep-skill-contract.test.ts` — extended assertions

**Dependencies:** Task 1

### Task 3: State layer ownership in conflict-check
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conflict-check-layer-ownership-skill-contract.test.ts`, following the skill-contract pattern. Extract the layer-ownership statement from `skills/conflict-check/SKILL.md`. Assert that it maps story↔story to `/conflict-check` and both cross-layer and task↔task to `/coherence-check`, and that it says `/conflict-check` runs before `/plan` and cannot see tasks. Also assert that `skills/coherence-check/SKILL.md` carries the same three pair-class → owner mappings.
2. Verify it fails (RED).
3. Implement: add the ownership statement after the oscillating-conflict detection heuristic in `skills/conflict-check/SKILL.md`, using the same mappings as Task 2's coherence-check statement.
4. Verify it passes (GREEN).
5. Commit: "feat(skills): state conflict-check layer ownership".

**Done when:**
- [test] conflict-check-layer-ownership-skill-contract.test.ts asserts skills/conflict-check/SKILL.md maps story↔story to `/conflict-check`, cross-layer and task↔task to `/coherence-check`, and states `/conflict-check` runs before `/plan` and cannot see tasks.
- [test] The same test asserts skills/coherence-check/SKILL.md carries the identical three pair-class → owner mappings, so the two skills' ownership statements agree.

**Files likely touched:**
- `skills/conflict-check/SKILL.md` — layer-ownership statement
- `src/conductor/test/engine/conflict-check-layer-ownership-skill-contract.test.ts` — new contract test

**Dependencies:** Task 2

### Task 4: Split acyclic from non-interfering in the plan skill
**Story:** 3, 2
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/plan-interference-check-skill-contract.test.ts`, following the skill-contract pattern. Assert that each of the two verification checklists in `skills/plan/SKILL.md` (the plan-format template's `## Verification` block and the skill's own `## Verification` section) contains:
   - an acyclic-dependencies item;
   - a separate item saying tasks must not invalidate each other's fixtures or assertions, naming `/coherence-check` as the sweep at Medium and Large tier and stating that Small tier gains no required step for it.

   Also scan every `skills/*/SKILL.md` and assert that the task-versus-task sweep appears as required work only in `skills/coherence-check/SKILL.md`. Elsewhere it may appear only as conflict-check's ownership statement and plan's Medium/Large-scoped item.

   Also assert that no item or sentence in the skill treats an acyclic graph as meeting the non-interference check, by checking that the acyclic items do not mention interference or independence.
2. Verify it fails (RED).
3. Implement: add the non-interference item to both checklists in `skills/plan/SKILL.md`. Keep the existing acyclic items unchanged.
4. Verify it passes (GREEN), along with the existing `plan-slices-skill-contract.test.ts` and `plan-task-count-skill-contract.test.ts`.
5. Commit: "feat(skills): separate plan non-interference from acyclic dependencies".

**Done when:**
- [test] plan-interference-check-skill-contract.test.ts asserts both verification checklists in skills/plan/SKILL.md carry an acyclic item and a distinct non-interference item naming `/coherence-check` as its Medium/Large sweep.
- [test] The same test asserts no acyclic item or sentence in skills/plan/SKILL.md claims an acyclic graph satisfies the non-interference check, and that the non-interference item states Small tier gains no required step.
- [test] The same test scans every skills/*/SKILL.md and asserts the task-versus-task sweep is stated as required work only in skills/coherence-check/SKILL.md (a Medium/Large-only step); skills/conflict-check/SKILL.md mentions task↔task only in its ownership statement and skills/plan/SKILL.md only in its Medium/Large-scoped non-interference item, so no skill makes the sweep or an artifact required at Small tier.
- The existing plan-slices-skill-contract.test.ts and plan-task-count-skill-contract.test.ts pass unchanged.
- This feature's diff modifies no file under `src/conductor/src/`, so the tier-required artifact list in the engine is unchanged.

**Files likely touched:**
- `skills/plan/SKILL.md` — non-interference checklist items
- `src/conductor/test/engine/plan-interference-check-skill-contract.test.ts` — new contract test

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
Task 4 (independent)
```

Task 2 depends on Task 1 because both edit `skills/coherence-check/SKILL.md` and its contract test.
Task 3 asserts agreement with Task 2's statement. Task 4 shares no file with Tasks 1–3.

## Integration Points

- After Task 3: an agent reading `/conflict-check` or `/coherence-check` finds the same
  layer-ownership statement, and coherence-check's sweep records task interference as a blocking
  `fail` row.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a plan where one task locks an assertion or fixture and another task changes the behavior that assertion or fixture depends on, as in #1535's Task 3 and Task 9, when an agent follows `skills/coherence-check/SKILL.md`, then the skill directs it to ask, for each task pair sharing a behavior, entity, file or fixture, "if I fully complete task A, does task B's `Done when` still hold?", in both directions. | 1 | "directs asking "if I fully complete task A, does task B's `Done when` still hold?" in both directions (A against B, then B against A) for task pairs sharing a behavior, entity, file or fixture" | diff-local |
| Story 1 happy: Given an agent that finds such an invalidation, when it records the finding, then the skill directs it to set the affected `task` row's verdict to `fail`. The Notes must quote the opposing text from both tasks, and the `fail` row then blocks at land through the existing coherence gate. | 1 | "directs recording a found invalidation as `fail` on the affected `task` row with Notes quoting opposing text from both tasks, which the existing land-time coherence gate blocks" | diff-local |
| Story 1 happy: Given a pair that fails in both directions, when the skill classifies it, then it is named an oscillation. Given a pair that fails in only one direction, it is named a contradiction. Both are recorded as `fail`, because the dependency graph does not stop the build from completing the two tasks in either order. | 1 | "names a both-directions failure an oscillation and a one-direction failure a contradiction, and records both as `fail`" | diff-local |
| Story 1 negative: Given an agent that suspects two tasks interfere but cannot quote opposing text from both tasks, when it follows the skill, then it raises the suspicion to the operator as an assumption and records no `fail` verdict for it. | 1 | "an interference that cannot be grounded in quoted text from both tasks is raised to the operator as an assumption with no `fail` verdict" | diff-local |
| Story 1 negative: Given an agent tempted to record a precise-sounding verdict word such as `oscillation` or `interference` on the `task` row, when it follows the skill, then the skill directs it to use `fail` instead. This preserves the existing rule that any word outside the blocking set silently passes the legacy gate. | 1 | "the row verdict is `fail`, never `oscillation` or `interference`" | diff-local |
| Story 2 happy: Given a Medium or Large plan whose tasks share no behavior, entity, file or fixture, when `/coherence-check` follows its skill, then the sweep adds no row, section or verdict. Existing `task` rows keep their current coverage verdicts. | 1 | "task pairs sharing no behavior, entity, file or fixture need no row, section or verdict, and that existing `task` rows keep their coverage verdicts" | diff-local |
| Story 2 negative: Given an S-tier spec, which skips `/coherence-check`, when its DECIDE chain runs, then no skill makes a task-versus-task sweep or artifact required. `skills/plan/SKILL.md` names the sweep only as `/coherence-check`'s work at Medium and Large tier. | 4 | "so no skill makes the sweep or an artifact required at Small tier" | diff-local |
| Story 3 happy: Given `skills/plan/SKILL.md`, when an agent reads its verification checklists, then "dependencies are acyclic" and "tasks do not invalidate each other's fixtures or assertions" are separate items. The second names `/coherence-check` as the sweep that checks it at Medium and Large tier. | 4 | "both verification checklists in skills/plan/SKILL.md carry an acyclic item and a distinct non-interference item naming `/coherence-check` as its Medium/Large sweep" | diff-local |
| Story 3 negative: Given a plan whose dependency graph is acyclic but contains two unordered tasks that invalidate each other, when an agent follows `skills/plan/SKILL.md`, then no checklist item or prose treats the acyclic result as satisfying the non-interference check. | 4 | "no acyclic item or sentence in skills/plan/SKILL.md claims an acyclic graph satisfies the non-interference check" | diff-local |
| Story 4 happy: Given `skills/conflict-check/SKILL.md` and `skills/coherence-check/SKILL.md`, when an agent reads either one, then it finds the same ownership statement. Story versus story belongs to `/conflict-check`. Cross-layer pairs and task versus task belong to `/coherence-check`. `/conflict-check` runs before `/plan` and cannot see tasks. | 2, 3 | "skills/conflict-check/SKILL.md maps story↔story to `/conflict-check`, cross-layer and task↔task to `/coherence-check`, and states `/conflict-check` runs before `/plan` and cannot see tasks" | diff-local |
| Story 4 negative: Given `skills/coherence-check/SKILL.md`, when an agent reads its oscillation guidance and its checklist, then no sentence says that all same-layer pairs belong to `/conflict-check`. The deferral is limited to story versus story. The current wording at the oscillation heuristic and the checklist item ("same-layer pairs are `/conflict-check`'s sweep") is corrected. | 2 | "so no sentence anywhere in the skill defers all same-layer pairs to `/conflict-check`" | diff-local |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [x] Dependencies are explicit and acyclic
