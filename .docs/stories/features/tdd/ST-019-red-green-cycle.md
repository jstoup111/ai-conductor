# Story: TDD RED-GREEN Cycle

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** tdd/SKILL.md

As a developer, I want the TDD skill to enforce a strict RED -> DOMAIN -> GREEN -> DOMAIN ->
COMMIT cycle so that every implementation change is test-driven and domain-reviewed.

## Acceptance Criteria

### Happy Path
- Given a task to implement, when the TDD cycle starts (RED phase), then a failing test is
  written first that captures the expected behavior
- Given the failing test exists, when the DOMAIN review runs after RED, then the domain
  reviewer verifies the test matches the acceptance criteria and domain model
- Given the test is verified, when GREEN phase runs, then the minimum code to make the test
  pass is written — no extras, no refactoring
- Given the test passes, when the second DOMAIN review runs after GREEN, then the domain
  reviewer verifies the implementation respects domain boundaries and naming
- Given both domain reviews pass, when COMMIT phase runs, then the change is committed with
  a descriptive message

### Negative Paths
- Given the domain review after RED finds the test doesn't match acceptance criteria, when
  flagged, then the test is revised before proceeding to GREEN — the cycle does not advance
- Given the domain review after GREEN finds domain violations, when flagged, then the
  implementation is revised before committing — the commit does not proceed
- Given the GREEN phase implementation breaks other tests, when the full suite runs, then
  the breakage must be fixed before COMMIT — no partial commits
- Given the test was written but already passes (test doesn't actually test new behavior),
  when detected, then the RED phase fails — tests must genuinely fail before GREEN

### Done When
- [ ] Five-phase cycle enforced: RED -> DOMAIN -> GREEN -> DOMAIN -> COMMIT
- [ ] Domain review after RED verifies test matches criteria
- [ ] Domain review after GREEN verifies implementation respects domain
- [ ] Full test suite passes before COMMIT
- [ ] Failing tests that already pass are rejected (RED must be red)
- [ ] Each cycle produces exactly one commit
