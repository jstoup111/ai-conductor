# Story: Gate Enforcement Between Steps

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer, I want the conductor to verify quality gates between steps so that I cannot
proceed to implementation without proper design, or to shipping without passing tests.

## Acceptance Criteria

### Happy Path
- Given stories are complete with negative paths, when the conductor checks the gate before
  conflict-check, then it passes and suggests the next step
- Given a conflict report has no blocking conflicts, when the gate before plan is checked,
  then it passes
- Given the plan covers all acceptance criteria from stories, when the gate before build is
  checked, then it passes
- Given all tests pass and git is clean, when the gate before finish is checked, then it passes
- Given all ADRs are APPROVED (no DRAFT remaining), when the gate before build is checked,
  then it passes

### Negative Paths
- Given a story has only happy paths (no negative paths), when the post-stories gate runs,
  then it BLOCKS with: "Stories incomplete — [story name] is missing concrete negative paths"
- Given blocking conflicts remain unresolved, when the post-conflict-check gate runs, then
  it BLOCKS with: "Blocking conflicts remain"
- Given the plan has coverage gaps (acceptance criterion with no task), when the post-plan
  gate runs, then it BLOCKS with: "Plan has coverage gaps — [criterion] has no task"
- Given tests are failing, when the post-build gate runs, then it BLOCKS with: "[N] tests
  failing"
- Given uncommitted changes exist, when the post-build gate runs, then it BLOCKS with:
  "uncommitted changes exist"
- Given DRAFT ADRs remain, when the post-architecture-review gate runs, then it BLOCKS with:
  "DRAFT ADRs remain unapproved — [list files]"

### Done When
- [ ] Gate after stories verifies every story has at least one concrete negative path
- [ ] Gate after conflict-check verifies no blocking conflicts remain
- [ ] Gate after plan verifies every acceptance criterion maps to a task
- [ ] Gate after architecture-review verifies all ADRs are APPROVED
- [ ] Gate after build verifies tests pass and git status is clean
- [ ] Gate violations produce specific, actionable error messages
- [ ] Blocked steps cannot be bypassed (gating enforcement level)
