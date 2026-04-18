# Implementation Plan: Phase 1 — Story Catalog

**Date:** 2026-04-12
**Design:** .docs/specs/2026-04-12-pluggable-harness-architecture.md
**Stories:** .docs/stories/ (5 epics + 36 feature stories)
**Conflict check:** Clean as of 2026-04-12 (2 degrading resolved)

## Summary

Phase 1 delivers the harness behavior specification as a story catalog. This is a
documentation-only phase — no code changes. The catalog defines all observable behaviors
sufficient to rewrite the harness from scratch. 7 tasks covering review, acceptance, and
changelog updates.

## Prerequisites

- Design doc approved (done: .docs/specs/2026-04-12-pluggable-harness-architecture.md)
- Stories written with happy + negative paths (done: 36 feature stories)
- Conflict check clean (done: 2 degrading conflicts resolved)

## Tasks

### Task 1: Review and accept conduct stories (ST-001 through ST-011)
**Story:** EP-001 Conductor Core Engine — all 11 conduct stories
**Type:** review

**Steps:**
1. Read each of the 11 conduct stories in .docs/stories/features/conduct/
2. Verify each story's acceptance criteria match actual bin/conduct behavior
3. Verify negative paths are concrete (specific error messages, specific states)
4. Verify Done When checkboxes are independently verifiable
5. Change Status from DRAFT to ACCEPTED in each file

**Files likely touched:**
- .docs/stories/features/conduct/ST-001 through ST-011 — Status: DRAFT -> ACCEPTED

**Dependencies:** none

### Task 2: Review and accept DECIDE phase stories (ST-012 through ST-017)
**Story:** Brainstorm, stories, conflict-check, plan, architecture-diagram, architecture-review
**Type:** review

**Steps:**
1. Read each of the 6 DECIDE phase stories
2. Cross-reference against actual SKILL.md behavior for each skill
3. Verify negative paths cover the gate enforcement described in conduct ST-006
4. Change Status from DRAFT to ACCEPTED in each file

**Files likely touched:**
- .docs/stories/features/brainstorm/ST-012 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/stories/ST-013 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/conflict-check/ST-014 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/plan/ST-015 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/architecture-diagram/ST-016 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/architecture-review/ST-017 — Status: DRAFT -> ACCEPTED

**Dependencies:** none

### Task 3: Review and accept BUILD phase stories (ST-018 through ST-021)
**Story:** writing-system-tests, tdd, pipeline, code-review
**Type:** review

**Steps:**
1. Read each of the 4 BUILD phase stories
2. Cross-reference against actual SKILL.md behavior
3. Verify TDD cycle (ST-019) captures all 5 phases: RED -> DOMAIN -> GREEN -> DOMAIN -> COMMIT
4. Verify pipeline (ST-020) captures batch evaluation and rework budgets
5. Change Status from DRAFT to ACCEPTED in each file

**Files likely touched:**
- .docs/stories/features/writing-system-tests/ST-018 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/tdd/ST-019 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/pipeline/ST-020 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/code-review/ST-021 — Status: DRAFT -> ACCEPTED

**Dependencies:** none

### Task 4: Review and accept SHIP + UNDERSTAND + utility stories (ST-022 through ST-030)
**Story:** manual-test, finish, retro, pr, bootstrap, memory, assess, debugging, simplify
**Type:** review

**Steps:**
1. Read each of the 9 stories
2. Cross-reference against actual SKILL.md behavior
3. Verify manual-test (ST-022) captures auto-skip for non-endpoint features
4. Verify finish (ST-023) captures all 4 completion options
5. Change Status from DRAFT to ACCEPTED in each file

**Files likely touched:**
- .docs/stories/features/manual-test/ST-022 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/finish/ST-023 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/retro/ST-024 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/pr/ST-025 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/bootstrap/ST-026 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/memory/ST-027 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/assess/ST-028 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/debugging/ST-029 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/simplify/ST-030 — Status: DRAFT -> ACCEPTED

**Dependencies:** none

### Task 5: Review and accept new capability stories (ST-050 through ST-070)
**Story:** EP-002 Pluggable Step Config, EP-003 Skill Override System
**Type:** review

**Steps:**
1. Read each of the 6 new capability stories
2. Verify config stories (ST-050, ST-051, ST-052) are consistent with the config schema
   in the design doc
3. Verify ST-060 reflects the conflict resolution (enforcement locked for gating steps)
4. Verify ST-061 reflects the conflict resolution (hooks wrap replacement skills)
5. Verify ST-070 (migration) aligns with the strict migration path decision
6. Change Status from DRAFT to ACCEPTED in each file

**Files likely touched:**
- .docs/stories/features/config/ST-050 through ST-061 — Status: DRAFT -> ACCEPTED
- .docs/stories/features/install/ST-070 — Status: DRAFT -> ACCEPTED

**Dependencies:** none

### Task 6: Accept epics
**Story:** EP-001 through EP-005
**Type:** review

**Steps:**
1. Read each epic and verify child story references are complete
2. Verify epic-level acceptance criteria are covered by child stories
3. Change Status from DRAFT to ACCEPTED in each file

**Files likely touched:**
- .docs/stories/epics/EP-001 through EP-005 — Status: DRAFT -> ACCEPTED

**Dependencies:** Tasks 1-5 (all feature stories accepted first)

### Task 7: Update CHANGELOG and commit
**Story:** (harness process — CLAUDE.md release gates)
**Type:** infrastructure

**Steps:**
1. Add entry under ## [Unreleased] in CHANGELOG.md:
   ### Added
   - Story catalog: 5 product epics and 36 feature stories specifying all harness behavior
   - Design doc for pluggable harness architecture (Phase 1 of multi-phase initiative)
   - Conflict check with 2 degrading conflicts resolved
2. Commit accepted stories + CHANGELOG update
3. Push to branch

**Files likely touched:**
- CHANGELOG.md — new [Unreleased] entry

**Dependencies:** Task 6 (all stories and epics accepted)

## Task Dependency Graph

```
Tasks 1-5 (parallel — independent review batches)
    │
    └──→ Task 6 (accept epics — depends on all features accepted)
              │
              └──→ Task 7 (CHANGELOG + commit)
```

## Integration Points
- After Tasks 1-5: All feature stories accepted — coverage can be verified
- After Task 7: Branch is ready for merge

## Coverage Check

All 36 feature stories have acceptance criteria. This plan covers review and acceptance
of every story. No implementation tasks exist because Phase 1 is documentation-only.

Phase 2 (language evaluation) and Phase 3 (conductor rewrite) will have their own plans
driven by these accepted stories.

## Verification

- [ ] All 36 feature stories changed from DRAFT to ACCEPTED
- [ ] All 5 epics changed from DRAFT to ACCEPTED
- [ ] CHANGELOG updated with Phase 1 entry
- [ ] Every story's criteria cross-referenced against actual SKILL.md behavior
- [ ] Conflict resolutions verified in ST-060 and ST-061
