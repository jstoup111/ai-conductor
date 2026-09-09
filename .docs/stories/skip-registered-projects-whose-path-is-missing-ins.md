**Status:** Accepted

# Stories: Skip registered projects whose path is missing (#1131)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the intake poll's handling of a
registered project whose directory no longer exists: skip it before any GitHub command, report it as
a path-liveness problem, report it once per episode, and leave every healthy registration untouched.
Registry repair, de-registration, and durable registration health remain outside this slice.

## Story 1: Diagnose a dead registration as a path-liveness skip

As the operator watching the brain pane, I want a registration whose directory is gone to be named as
a missing project path so that I stop reading it as a broken `gh` installation.

### Acceptance Criteria

#### Happy Path
- Given a registered project whose directory does not exist, when the intake poll runs, then no GitHub command is attempted for that registration and the poll continues to the remaining registrations.
- Given that skipped registration, when the poll reports it, then the operator-facing line names the registration, names its configured path, and states that the path is missing, and does not report a `gh` command failure.

#### Negative Paths
- Given a registered project whose directory exists but whose issue listing fails, when the intake poll runs, then the existing per-repo poll-failure diagnostic is emitted unchanged for it and no missing-path notice is emitted.

### Done When
- [ ] A poll over a registration whose directory is absent returns no envelopes and invokes the injected GitHub runner zero times.
- [ ] The line emitted for that registration carries its name, its configured path, and the missing-path reason, and does not carry the existing poll-failure wording.
- [ ] A registration whose directory exists and whose issue listing throws still produces the existing poll-failure line and no missing-path line.

## Story 2: Keep healthy registrations polling and stop the dead one repeating

As the operator, I want a dead registration to cost one notice and no further GitHub attempts so that
real intake errors stay visible in the pane.

### Acceptance Criteria

#### Happy Path
- Given a registry holding one live registration with an assigned issue and one registration whose directory is missing, when the intake poll runs, then the live registration's issue is captured and only the missing registration is skipped.

#### Negative Paths
- Given a registration whose missing path was already reported in this process, when later polls run, then no further GitHub command is attempted for it and no further notice is emitted for it while the path stays missing.
- Given a registration whose missing path is restored, when the next poll runs, then it is polled normally, and a later disappearance of the same path is reported again.

### Done When
- [ ] A poll over one live and one absent registration returns exactly the live registration's envelope and skips only the absent one.
- [ ] Two consecutive polls of the same absent registration invoke the GitHub runner zero times and emit exactly one notice in total.
- [ ] Restoring the directory lets the next poll list that registration's issues, and removing it again emits a second notice.

## Negative-category review

Dependency unavailability is the subject of the fix itself: a registration's working directory is the
dependency that vanished, and both the skip and the preserved listing-failure path are covered.
Invalid input is covered by the restored-then-missing-again reversal, which is the only state
transition this change can get wrong. Partial failure is covered by the mixed live/missing registry
criterion, which holds the existing per-repo isolation contract. Concurrent access, resource
exhaustion, cascade deletion, and data integrity are inapplicable: the poll holds no lock, writes no
record on the skip path, and the ledger, queue, and write-back paths are untouched. Auth and permission
failures remain the existing listing-failure path, which this change must leave unchanged and asserts
as such.
