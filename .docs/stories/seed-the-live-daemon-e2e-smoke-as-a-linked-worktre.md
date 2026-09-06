**Status:** Accepted

# Stories: Seed the live daemon E2E smoke as a linked worktree (#1669)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the shared live-provider daemon E2E run body: its fixture topology, its build-review effective-verdict resolution, and its terminal-state assertions. The scripted non-live sibling fixture and production identity resolution remain outside this slice.

## Story 1: Resolve build-review effective verdicts through the production path

**Requirement:** Issue #1669 desired outcome — the live smoke exercises effective-verdict resolution with no injected resolver, so a regression in feature-identity or disposition-store resolution fails the smoke before it fails a release.

As the operator who gates a release on the live smoke, I want the smoke's fixture to carry the daemon's real repository topology so that a break in build-review feature-identity or disposition-store resolution is caught by the smoke instead of by the release gate.

### Acceptance Criteria

#### Happy Path
- Given the live smoke fixture repository has been seeded, when the production build-review feature-identity resolver runs against the seeded project root, then it returns the seeded main checkout as the repository and the fixture slug as the feature.
- Given the live smoke fixture repository has been seeded, when the production effective-verdict resolver runs against the seeded project root with a valid aggregate and no operator dispositions on disk, then it resolves successfully rather than refusing for unavailable feature identity.
- Given the shared live-provider run body source, when its step-runner construction is inspected, then it declares no build-review effective-verdict resolver override.

#### Negative Paths
- Given a leftover directory already occupies the fixture's linked-worktree path, when the fixture repository is seeded, then seeding rejects with an error naming that path and no provider home, preflight, or dispatch is reached.

### Done When
- [ ] A seeding test asserts the resolved feature identity equals the seeded main checkout plus the fixture slug, with no injected resolver dependency.
- [ ] A seeding test asserts the production effective-verdict resolver returns a successful resolution against the seeded project root.
- [ ] A structural assertion over the shared run body source reports zero build-review effective-verdict resolver overrides.
- [ ] A seeding test with an occupied worktree path asserts rejection naming that path.

## Story 2: Judge the fixture's terminal state where the daemon writes it

**Requirement:** Issue #1669 desired outcome — the smoke continues to pass in its isolated temp environment, which requires its success assertions to keep matching production once the fixture becomes a linked worktree.

As the operator reading a live smoke result, I want the fixture's park check to read the same location the daemon writes so that a parked fixture is never reported as a successful run.

### Acceptance Criteria

#### Happy Path
- Given a seeded fixture whose worktree carries a completion marker, no halt marker, and no park marker anywhere, when the run body evaluates terminal state, then it reports success.

#### Negative Paths
- Given a seeded fixture whose worktree carries a completion marker and whose park marker for the fixture slug was written through the production park writer, when the run body evaluates terminal state, then it reports failure.

### Done When
- [ ] A terminal-state test over a real seeded linked worktree reports success for the unparked completion case.
- [ ] A terminal-state test reports failure after the production park writer parks the fixture slug from the worktree.

## Negative-category review

Data-integrity and dependency-availability are the categories that bite here. A leftover worktree path (resource conflict on shared temp state) is covered by Story 1's negative path, and it is the failure mode that would otherwise silently regress the fixture to a standalone repository and re-hide the defect. Reading park state from the wrong root (data integrity — a marker that exists but is never consulted) is covered by Story 2's negative path. Invalid input, auth/permission, timeout, concurrency, resource exhaustion, and partial-rollback categories are inapplicable: this change adds no user input surface, no credential path, no network or external call, no shared mutable state beyond a per-run temp directory, and no multi-step transaction. Existing shared-body coverage retains the halted-fixture refusal and the credential and readiness refusals unchanged.
