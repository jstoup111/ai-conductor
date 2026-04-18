# Story: Acceptance Spec Generation

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** writing-system-tests/SKILL.md

As a developer, I want failing acceptance specs generated from stories before implementation
so that the RED phase of TDD starts with real, story-driven test cases.

## Acceptance Criteria

### Happy Path
- Given accepted stories exist with Given/When/Then criteria, when the skill runs, then it
  generates one failing test per acceptance criterion (happy + negative paths)
- Given an API project, when specs are generated, then they are integration/request specs
  (e.g., `spec/integration/` or `tests/integration/`)
- Given a full-stack project, when specs are generated, then they are system/e2e specs
  (e.g., `spec/system/` or `tests/e2e/`)
- Given the specs are written, when the test suite runs, then all new specs FAIL (they are
  the RED phase — no implementation exists yet)
- Given the specs are committed, when the build phase begins, then implementation drives
  these specs to GREEN

### Negative Paths
- Given a story has no Given/When/Then criteria (malformed), when the skill runs, then it
  reports the malformed story and asks for correction rather than generating partial specs
- Given specs already exist for some criteria (from a prior run), when the skill re-runs,
  then it generates only the missing specs — it does not duplicate existing ones
- Given the test framework is not detected, when the skill runs, then it asks the user which
  framework to use rather than guessing

### Done When
- [ ] One failing test per acceptance criterion (happy + negative)
- [ ] Correct test type for project type (integration for API, system for full-stack)
- [ ] All generated specs fail when run (RED phase)
- [ ] Specs committed before implementation begins
- [ ] Skipped for Small tier (request specs in TDD suffice)
