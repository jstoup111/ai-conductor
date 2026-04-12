# Epic: Skill Override System

**Status:** ACCEPTED

## Description

As a developer customizing the harness, I want to fully replace a skill with my own version
or hook before/after a skill so that I can adapt harness behavior to my project without
modifying the harness itself.

## Child Stories

- ST-060 Full skill replacement via project-local SKILL.md
- ST-061 Before/after hooks on skills
- ST-062 Skill resolution order (project > harness)

## Acceptance Criteria (Epic Level)

### Happy Path
- Given a project with `.harness/skills/tdd/SKILL.md`, when the conductor invokes the tdd
  step, then it uses the project-local skill instead of the harness default
- Given a project config with an `after` hook on brainstorm, when brainstorm completes, then
  the hook script executes before the conductor advances to the next step

### Negative Paths
- Given a project skill override with invalid SKILL.md frontmatter (missing required fields),
  when the conductor loads skills, then it rejects the override with a validation error
- Given a before-hook script that exits non-zero, when the hook runs, then the conductor
  treats the step as failed and enters the recovery flow
