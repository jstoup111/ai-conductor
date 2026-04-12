# Story: TDD RED-GREEN Cycle

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** tdd/SKILL.md

As a developer, I want the TDD skill to enforce a strict RED -> DOMAIN -> GREEN -> DOMAIN ->
COMMIT cycle so that every implementation change is test-driven and domain-reviewed.

## Acceptance Criteria

### Happy Path
- Given a task to implement, when the TDD cycle starts (RED phase), then a failing test is
  written first that captures the expected behavior
- Given the failing test exists, when the DOMAIN review runs after RED, then the domain
  reviewer verifies the test matches the acceptance criteria and domain model. The domain
  reviewer has veto authority — it can reject and send back to RED
- Given the test is verified, when GREEN phase runs, then the minimum code to make the test
  pass is written — no extras, no refactoring
- Given the test passes, when the second DOMAIN review runs after GREEN, then the domain
  reviewer verifies the implementation respects domain boundaries and naming. It has veto
  authority to send back to GREEN
- Given both domain reviews pass, when COMMIT phase runs, then the change is committed with
  a descriptive message
- Given a file is created in `app/` (or equivalent), when the spec coverage check runs, then
  a corresponding spec file must exist — every production file gets a spec
- Given batch boundaries are reached, when refactoring is appropriate, then it happens at
  batch boundaries following "Dry Business Logic, Not Dry Code" — not mid-cycle

### Negative Paths
- Given the domain review after RED finds the test doesn't match acceptance criteria, when
  it vetoes, then the cycle returns to RED — GREEN does not proceed
- Given the domain review after GREEN finds domain violations, when it vetoes, then the
  cycle returns to GREEN — COMMIT does not proceed
- Given the GREEN phase implementation breaks other tests, when the full suite runs, then
  the breakage must be fixed before COMMIT — no partial commits
- Given the test was written but already passes (test doesn't actually test new behavior),
  when detected, then the RED phase fails — tests must genuinely fail before GREEN
- Given a production file has no corresponding spec, when the spec coverage check runs, then
  the cycle blocks until the spec is created

### Done When
- [ ] Five-phase cycle enforced: RED -> DOMAIN -> GREEN -> DOMAIN -> COMMIT
- [ ] Domain reviewer has veto authority at both review points
- [ ] Veto sends back to the prior phase (not to the beginning)
- [ ] Full test suite passes before COMMIT
- [ ] Failing tests that already pass are rejected (RED must be red)
- [ ] Each cycle produces exactly one commit
- [ ] Every production file has a corresponding spec (coverage gate)
- [ ] Refactoring happens at batch boundaries, not mid-cycle
