# Implementation Plan: Operator-Controlled DECIDE Scope

**Date:** 2026-08-11
**Stories:** `.docs/stories/require-explore-to-ask-the-operator-how-comprehens.md`
**Conflict check:** Clean as of 2026-08-11

## Summary

Make repair breadth an explicit operator decision in `explore`, preserve that decision through downstream DECIDE authoring, and limit new ADRs to real structural changes. Three scoped TDD tasks change only shared behavioral contracts and their static contract coverage.

## Technical Approach

Use the available `skill-creator` guidance for every `SKILL.md` edit, then pin each rule first in the existing cross-skill shell contract test and update the smallest owning instruction surfaces. `HARNESS.md` states the shared lifecycle rule; `explore` owns the single operator question; downstream skills consume the confirmed boundary; and `architecture-review` applies a structural-change prerequisite before its existing ADR categories. No engine state, configuration, artifact schema, or runtime production surface changes.

Skill-authoring guardrails from `skill-creator`:

- Keep additions concise and include only non-obvious procedural guidance that changes agent behavior.
- Use imperative language and put each rule in the section that owns when it executes.
- Give the scope question high freedom for operator wording, but make its timing and blocking outcome low freedom because silent scope choice is the defect.
- Avoid duplicating full explanations across skills: state the shared rule once in `HARNESS.md`, then add short ownership-specific instructions to each skill.
- Preserve this repository's existing shipped-skill frontmatter contract; no new skill, resource folder, or interface metadata is needed.

Verified claims:

- `skills/explore/SKILL.md` already owns clarification and operator-confirmed approach selection (100%, direct inspection).
- `agents/planner.md` currently encourages usefulness expansion and is the conflicting persona surface (100%, direct inspection).
- `skills/architecture-review/SKILL.md` currently makes listed decision categories sufficient ADR triggers, including some non-structural choices (100%, direct inspection).
- `test/test_skill_pipeline_contract.sh` is an existing static, provider-free cross-skill contract seam run by harness integrity (100%, direct inspection).

## Prerequisites

- Accepted technical stories and clean conflict report in this spec.
- No external dependency, migration, or runtime setup.
- The implementer reads and applies the available `skill-creator` skill before editing any `SKILL.md`; initialization and bundled resources are skipped because all target skills already exist and need only concise body changes.

## Tasks

### Task 1: Ask the operator and stop eager scope expansion

**Story:** Story 1 — explicit comprehensiveness question; no silent default; planner expansion is conditional
**Type:** happy-path

**Steps:**
1. Apply `skill-creator`'s concision, imperative-language, and degree-of-freedom guidance to the proposed skill wording; do not alter frontmatter or add resources.
2. Add failing static assertions to `test/test_skill_pipeline_contract.sh` requiring `explore` to ask how comprehensive the fix should be before approach confirmation, forbidding a silent minimal/balanced/comprehensive default, and requiring the planner persona to treat expansion as operator-controlled rather than unconditional.
3. Run the focused contract test and verify the new assertions fail (RED).
4. Add the concise shared rule to `HARNESS.md`, update `skills/explore/SKILL.md` to ask and record the answer, and replace the eager-expansion instructions in `agents/planner.md` with operator-confirmed scope handling.
5. Re-read the edited skill as a fresh triggered agent would: remove redundant rationale, confirm the mandatory timing/block is unambiguous, and keep operator answer wording flexible.
6. Run the focused contract test and verify it passes (GREEN).
7. Commit with message: `require operator choice of fix breadth`.

**Files:** `HARNESS.md`; `skills/explore/SKILL.md`; `agents/planner.md`; `test/test_skill_pipeline_contract.sh`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Preserve confirmed breadth through downstream DECIDE

**Story:** Story 1 — preserve narrow and comprehensive choices; re-confirm material expansion
**Type:** negative-path

**Steps:**
1. Apply `skill-creator`'s progressive-disclosure rule: add only the short instruction each downstream skill needs to act on the upstream boundary; do not repeat the full exploration rationale.
2. Add failing static assertions to `test/test_skill_pipeline_contract.sh` requiring architecture review, stories, and planning to consume the confirmed comprehensiveness boundary, preserve both narrow and comprehensive outcomes, and block material expansion until the operator confirms it.
3. Run the focused contract test and verify the downstream assertions fail (RED).
4. Update `skills/architecture-review/SKILL.md`, `skills/stories/SKILL.md`, and `skills/plan/SKILL.md` with the shared preservation rule, keeping each skill within its existing artifact ownership.
5. Re-read the three edits together and remove duplicated explanation while retaining each skill's distinct action and blocking condition.
6. Run the focused contract test and verify it passes (GREEN).
7. Commit with message: `preserve operator scope through decide`.

**Files:** `skills/architecture-review/SKILL.md`; `skills/stories/SKILL.md`; `skills/plan/SKILL.md`; `test/test_skill_pipeline_contract.sh`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 3: Restrict ADR creation to structural changes

**Story:** Story 2 — structural trigger; non-structural exclusion; existing-decision reuse
**Type:** negative-path

**Steps:**
1. Apply `skill-creator`'s degree-of-freedom guidance: define the structural prerequisite and exclusions precisely, while leaving architecture-review judgment free within those boundaries.
2. Add failing static assertions to `test/test_skill_pipeline_contract.sh` requiring real structural change as a necessary ADR condition, recognizing boundary/component/integration/state-data/foundational-technology changes, and rejecting importance, breadth, workflow policy, prompt wording, or ordinary implementation detail as sufficient triggers.
3. Add negative-control fixtures proving the predicate rejects a missing structural prerequisite and does not mistake a small structural change for a waiver.
4. Run the focused contract test and verify the ADR assertions fail (RED).
5. Update the ADR creation section and verification checklist in `skills/architecture-review/SKILL.md`: apply the structural prerequisite before category evaluation and reference an existing governing ADR instead of duplicating it.
6. Re-read the full skill for internal contradictions and remove obsolete trigger language rather than layering a conflicting exception over it.
7. Run the focused contract test and verify it passes (GREEN), then run `test/test_harness_integrity.sh` as the repository-required aggregate validation.
8. Commit with message: `limit adrs to structural decisions`.

**Files:** `skills/architecture-review/SKILL.md`; `test/test_skill_pipeline_contract.sh`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

## Task Dependency Graph

Task 1 → Task 2 → Task 3

## Integration Points

- After Task 1: `explore` and the planner persona agree that the operator chooses breadth.
- After Task 2: every DECIDE authoring stage preserves the same confirmed boundary.
- After Task 3: architecture review applies the structural prerequisite consistently with that lightweight scoping policy.

## Coverage Mapping

- Story 1 happy paths: Tasks 1–2.
- Story 1 negative paths: Tasks 1–2.
- Story 2 happy paths: Task 3.
- Story 2 negative paths: Task 3.

## Verification

- [ ] Every happy and negative path maps to a task.
- [ ] All tasks use static, provider-free contract tests at the narrowest seam.
- [ ] Every `SKILL.md` edit applies `skill-creator` guidance: concise, imperative, ownership-local, and calibrated to the decision's required freedom.
- [ ] No task adds runtime machinery or a new artifact type.
- [ ] Dependencies are explicit and acyclic.
- [ ] No terminal catch-all validation task exists.
