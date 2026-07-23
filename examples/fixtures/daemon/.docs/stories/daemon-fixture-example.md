**Status:** Accepted

# Stories: Daemon fixture example (headless drain)

**Track:** technical (no PRD — minimal fixture for the daemon example harness)
**Source:** examples/fixtures/daemon/ (Task 8, examples/daemon.sh)
**Tier:** S

---

## Story: Daemon drains a single seeded feature to DONE

As the daemon operator, I want a minimal seeded feature the daemon can drain
in one pass, so that the headless example harness has a real fixture to
exercise instead of a mock.

### Acceptance Criteria

#### Happy Path
- Given a fresh sandbox seeded from this fixture, when `daemon.sh small` drains
  once, then the feature reaches `DONE` and a PR/local-commit is recorded.

#### Negative Paths
- Given the seeded feature never reaches `DONE` (build/gate failure injected),
  when the daemon drains once, then the run exits non-zero and no PR is opened.

### Done When
- [ ] The fixture's plan has exactly one task with no unmet dependencies, so a
      drain-once run can complete it.
