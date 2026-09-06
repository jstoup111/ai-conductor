**Status:** Accepted

# Stories: Harness integrity verification runs in BUILD, not SHIP (#658)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is this repository's declared verification entries and the deletion of the integrity sub-gate from the finish-plane release gate. The ordered-command engine support is owned by issue #2358 and is not specified here; the migration-block sub-gate, its waiver evaluation, and the VERSION-approval gate stay as they are.

## Story 1: Verify harness integrity inside the build loop

### Acceptance Criteria

#### Happy Path

- Given this repository's committed project configuration, when its test-suite verification entries are resolved, then they form an ordered list whose first entry runs the conductor package's vitest command in the conductor package directory and whose second entry runs the harness integrity script with the repository root as its working directory.
- Given the declared integrity entry, when its command and working directory are resolved against the repository root, then they name the same script and the same root that the deleted finish-plane sub-gate used.

#### Negative Paths

- Given a configuration whose verification entries omit the integrity entry, when the configuration drift check runs, then it fails and names the missing integrity entry instead of passing on the vitest entry alone.

### Done When

- [ ] A drift check reads this repository's own committed configuration through the real loader rather than a hand-written copy.
- [ ] The counterfactual scoped command, its selector placeholder, and the aggregate verification mode are unchanged.

## Story 2: Run no tests in the finish-plane release gate

### Acceptance Criteria

#### Happy Path

- Given a harness self-build reaches the finish-plane release gate, when the gate runs against a harness root containing no integrity script and a non-breaking change set, then it returns a passing verdict, writes no halt marker, and launches no process.

#### Negative Paths

- Given a self-build changes a canonical breaking surface with no runnable migration block and no fresh waiver, when the finish-plane release gate runs, then it halts with the migration-block reason.
- Given a self-build whose change set cannot be determined, when the finish-plane release gate runs, then it halts fail-closed on the migration requirement without offering a waiver path.

### Done When

- [ ] The release-gate module carries no integrity constant, seam, options interface, or suite function, and imports no process launcher.
- [ ] Every existing migration-waiver scenario keeps its prior verdict without an integrity stub.
- [ ] No comment in the guardrail bundle or the finish-gate method still describes the release gate as running an integrity suite.

## Negative-category review

Input integrity is covered by the omitted-entry drift case and by the undeterminable change set, which is the gate's established fail-closed input. Dependency and environment failure is covered by running the composed gate against a harness root that contains no integrity script at all — previously the gate's own missing-script halt, now a case the gate must ignore. Permission, network, and third-party categories are inapplicable: the deletion removes the module's only process launch, and no new external call is introduced. Deletion, queue, datastore, upload, and transaction categories are inapplicable — nothing is stored, enqueued, or transmitted. Idempotency is inapplicable to a pure verdict function with no side effect beyond the existing halt-marker write, whose behavior is unchanged. Regression risk to the surviving sub-gate is covered by re-running every existing waiver scenario unchanged rather than by new permutations, since the waiver parser and classifier are untouched.
