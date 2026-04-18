# Story: Manual Test Story Validation

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** manual-test/SKILL.md

As a developer, I want the manual-test skill to validate implemented stories by exercising
the running application so that I verify the system works end-to-end as a user would
experience it.

## Acceptance Criteria

### Happy Path
- Given the build is complete, when manual-test runs, then it starts the application server
  fresh (killing any stale server first)
- Given an API project, when stories are tested, then each acceptance criterion is exercised
  via curl and results are recorded in a table (Story, Criterion, Expected, Actual, Pass/Fail)
- Given a full-stack project, when stories are tested, then browser automation or manual
  browser testing validates each criterion
- Given all stories pass, when results are displayed, then the step completes successfully

### Negative Paths
- Given a story criterion FAILs, when the failure is detected, then it becomes a bug that
  loops back through /tdd: write a failing test (RED), fix it (GREEN), commit, re-verify
- Given bugs remain after the TDD fix loop, when the gate checks, then manual-test BLOCKS —
  the step cannot complete with known bugs
- Given the application server fails to start, when detected, then the error is reported
  with the server's stderr output and the step fails
- Given no stories reference HTTP endpoints or UI (internal components only), when the feature
  type check runs, then manual-test is auto-skipped with a logged reason
- Given a stale server from a prior session is running, when manual-test starts, then it
  kills the existing process before starting fresh
- Given testing completes (pass or fail), when the step finishes, then the application
  server is shut down cleanly

### Done When
- [ ] Application server started fresh (stale servers killed)
- [ ] Every story criterion tested (happy + negative paths)
- [ ] Results displayed in tabular format
- [ ] FAILs loop through TDD until fixed
- [ ] No known bugs remain before proceeding
- [ ] Auto-skipped for non-endpoint features with logged reason
- [ ] Server shut down after testing
