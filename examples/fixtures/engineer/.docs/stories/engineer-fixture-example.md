Status: Accepted

# Stories: Engineer fixture example (headless land)

**Track:** technical (no PRD — minimal fixture for the engineer example harness)
**Source:** examples/fixtures/engineer/ (Task 10, examples/engineer.sh)
**Tier:** M

---

## Story: Engineer lands a single seeded spec cleanly

As the engineer operator, I want a minimal, complete `.docs/` artifact set the
`land` guards accept on inspection, so that the headless example harness has a
real fixture to exercise instead of a mock.

### Acceptance Criteria

#### Happy Path
- Given a fresh sandbox seeded from this fixture, when `engineer.sh medium`
  runs `worktree -> land -> handoff`, then `land` accepts the fixture (no
  DRAFT ADR, stories `Accepted`, plan present) and handoff reaches
  `pr-opened`/`local-commit`.

#### Negative Paths
- Given the fixture is mutated to carry a DRAFT ADR or non-Accepted stories,
  when `land` inspects it, then `land` rejects the fixture and no PR is
  opened.

### Done When
- [ ] The fixture's `.docs/` set has no `Status: DRAFT` anywhere, its stories
      carry `Status: Accepted`, its plan has exactly one task, and (since the
      fixture is tier M) its ADR carries `Status: APPROVED`.
