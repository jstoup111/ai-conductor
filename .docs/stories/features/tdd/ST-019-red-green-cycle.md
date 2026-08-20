# Story: TDD RED-GREEN Cycle

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** tdd/SKILL.md

> **Amended 2026-07-25 by issue #940:** GREEN and COMMIT run the
> affected/scoped test set. The aggregate full suite is owned by the explicit
> pre-SHIP `test_suite` gate, not by every TDD commit.

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

> **Amended 2026-08-13 by #1552:** The assertion above is superseded. GREEN writes the smallest
> behavior-complete change that conforms to the feature's applicable recorded pattern basis when
> one exists. A verified no-fit result or operator-authorized bounded departure follows its approved
> approach instead. Unrelated extras remain forbidden, and this amendment does not authorize an
> unplanned refactor.

- Given the test passes, when the second DOMAIN review runs after GREEN, then the domain
  reviewer verifies the implementation respects domain boundaries and naming. It has veto
  authority to send back to GREEN
- Given both domain reviews pass, when COMMIT phase runs, then the change is committed with
  a descriptive message
- Given a file is created in `app/` (or equivalent), when the spec coverage check runs, then
  a corresponding spec file must exist — every production file gets a spec

> **Amended 2026-08-13 by #1552:** The assertion above is superseded. Test scope follows changed
> behavior and failure boundaries at the lowest sufficient layer; creating a production file does
> not by itself require a corresponding spec file. New behavior and bug fixes remain subject to the
> RED-first cycle.

- Given batch boundaries are reached, when refactoring is appropriate, then it happens at
  batch boundaries following "Dry Business Logic, Not Dry Code" — not mid-cycle

### Negative Paths
- Given the domain review after RED finds the test doesn't match acceptance criteria, when
  it vetoes, then the cycle returns to RED — GREEN does not proceed
- Given the domain review after GREEN finds domain violations, when it vetoes, then the
  cycle returns to GREEN — COMMIT does not proceed
- Given the GREEN phase implementation breaks an affected/scoped test, when the
  scoped set runs, then the breakage must be fixed before COMMIT — no known
  partial failure is committed
- Given the test was written but already passes (test doesn't actually test new behavior),
  when detected, then the RED phase fails — tests must genuinely fail before GREEN
- Given a production file has no corresponding spec, when the spec coverage check runs, then
  the cycle blocks until the spec is created

> **Amended 2026-08-13 by #1552:** The assertion above is superseded. Absence of a mirror spec is
> not a failure; uncovered changed behavior or an uncovered failure boundary remains blocking.

### Done When
- [ ] Five-phase cycle enforced: RED -> DOMAIN -> GREEN -> DOMAIN -> COMMIT
- [ ] Domain reviewer has veto authority at both review points
- [ ] Veto sends back to the prior phase (not to the beginning)
- [ ] Affected/scoped test set passes before COMMIT
- [ ] Failing tests that already pass are rejected (RED must be red)
- [ ] Each cycle produces exactly one commit
- [ ] Every production file has a corresponding spec (coverage gate)

> **Amended 2026-08-13 by #1552:** The Done-When item above is superseded by the requirement that
> every changed behavior and failure boundary has sufficient behavioral coverage, which may cover
> several production files without mirroring them one-for-one.

- [ ] Refactoring happens at batch boundaries, not mid-cycle
