**Status:** Accepted

# Stories: Report a failing integrity check instead of aborting the suite silently (#2160)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the harness integrity suite's failure reporting: a failing check must report itself and the run must continue to an accurate summary, and an abort no guard covers must name itself. What any individual check asserts, and how the suite enumerates the files it checks, remain outside this slice.

## Story 1: A failing check reports itself and the run still finishes

As the operator running repository validation, I want a failing check to name itself and the rest of the suite to keep going, so that one regression does not hide every later one behind a silent non-zero exit.

### Acceptance Criteria

#### Happy Path

- Given a check whose subject command fails, when the suite runs, then a FAIL line naming that check is printed.
- Given an earlier check has already failed, when the run continues, then every later check still runs and prints its own PASS or FAIL line.
- Given at least one check failed, when the run reaches its end, then the summary counts every check that ran and the run exits non-zero.

#### Negative Paths

- Given a copy of the suite in which a check hands a raw exit status straight to the reporter, when the drift guard runs, then it exits non-zero and names the offending line.
- Given a copy of the suite whose reporting region markers are absent, when the spec tries to build its fixture, then it exits non-zero rather than reporting a clean run over nothing.

### Done When

- [ ] A fixture built from the suite's own reporting region prints a FAIL line for a failing check, a PASS line for the check after it, a summary reading one passed and one failed, and exits 1.
- [ ] The drift guard passes against the real suite and exits non-zero for a mutated copy that reintroduces a raw-status call site, naming that line.
- [ ] A mutated copy with no reporting-region markers makes the spec exit non-zero instead of skipping its cases.

## Story 2: An abort no guard covers names itself

As the operator diagnosing a failed validation run, I want an abort that no check guard covers to print where it happened, so that a silent non-zero exit is never the only diagnostic I get.

### Acceptance Criteria

#### Happy Path

- Given a command outside any check guard fails while errexit is in force, when the suite aborts, then it prints a diagnostic naming the script line and the failing exit status.

#### Negative Paths

- Given a command fails inside a region that has deliberately disabled errexit, when the run continues past it, then no abort diagnostic is printed.
- Given the suite runs over the real repository tree with no regression present, when it completes, then it prints no abort diagnostic and its pass, fail, and warning counts are unchanged from before this change.

### Done When

- [ ] A fixture whose unguarded command fails prints one abort diagnostic carrying a line number and the failing exit status, and exits non-zero.
- [ ] A fixture that fails a command inside a deliberately non-errexit region prints no abort diagnostic and reaches its summary.
- [ ] A real-tree run of the suite prints no abort diagnostic and reports the same pass, fail, and warning counts as before the change.

## Negative-category review

Invalid input is covered by the drift guard's mutated copies and by the marker-absent case, which together prove the guard still fails on the shapes it exists to catch rather than degrading into a passing no-op. Partial failure is the subject of Story 1: the run must survive a failed check and still account for it. Resource exhaustion, timeouts, dependency unavailability, auth failures, and concurrent access are inapplicable — this gate is a single-process, read-only text and syntax scan with no network, LLM, registry, datastore, queue, or shared mutable state. Data integrity is inapplicable for the same reason: nothing is written outside a disposable fixture directory that the spec removes. The one invariant side effect worth guarding is the summary itself, and the real-tree criterion in Story 2 holds the existing counts unchanged so the new reporting cannot quietly alter what the gate reports today.
