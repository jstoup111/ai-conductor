**Status:** Accepted

# Stories: Reclaim a lease whose recovery claim was left by a dead process (#2170)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the conduct-state lease's already-held recovery-claim branch: reclaiming a claim whose writer is proven dead, refusing an invalid or unverifiable claim, naming the real blocking state in the acquire timeout, and keeping concurrent recoverers mutually exclusive. The separately filed full-suite lock and the owner-metadata read path remain outside this slice.

## Story 1: Reclaim a recovery claim whose writer is proven dead

As an operator whose recoverer crashed mid-recovery, I want the next acquirer to clear the abandoned claim so that state mutations resume without me deleting the lease directory by hand.

### Acceptance Criteria

#### Happy Path

- Given a lease directory whose owner pid and whose existing recovery claim pid are both proven dead, when a new acquirer attempts the lease, then it quarantines the lease, acquires it, and records its own owner metadata.
- Given a stale recovery claim was reclaimed, when the acquirer reports its recovery diagnostic, then the recovered diagnostic names both the dead owner pid and the reclaimed claim pid.

#### Negative Paths

- Given the existing recovery claim is present but corrupt or ambiguous, when a new acquirer attempts the lease, then it fails with a recovery-refused result naming an invalid or ambiguous recovery claim and leaves the stored owner metadata and claim unchanged.
- Given the liveness probe for the existing recovery claim's pid throws, when a new acquirer attempts the lease, then it fails with a recovery-refused result naming unverifiable recovery-claim liveness and leaves the stored owner metadata and claim unchanged.

### Done When

- [ ] A lease fixture staged with a dead owner and a dead claimant's claim yields a successful acquisition whose stored owner metadata belongs to the new acquirer.
- [ ] That acquisition emits exactly one recovered diagnostic carrying both the dead owner pid and the reclaimed claim pid.
- [ ] Corrupt, ambiguous, and probe-failure claim fixtures each return a recovery-refused acquire result and leave the staged owner and claim contents byte-identical.

## Story 2: Name the real blocker and keep concurrent recoverers exclusive

As an operator reading a lease timeout, I want the message to name what is actually blocking me so that I do not chase a process that is already gone.

### Acceptance Criteria

#### Happy Path

- Given a lease whose existing recovery claim names a pid the liveness probe reports live, when the acquirer's wait budget expires, then the timeout message names that live recovery claim pid rather than the dead owner's pid.
- Given a lease held by a live owner with no recovery claim present, when the acquirer's wait budget expires, then the timeout message names the live owner pid exactly as it does today.

#### Negative Paths

- Given two acquirers both observe the same proven-dead recovery claim and both attempt to quarantine the lease, when the directory move is arbitrated, then exactly one acquirer recovers the lease and the other retries within its wait budget instead of failing with a recovery-refused result.
- Given the existing recovery claim disappears between a losing claim write and the inspecting read, when the acquirer's wait budget expires, then the timeout message names no blocking pid at all.

### Done When

- [ ] A live-claim fixture produces a timeout message naming the recovery claim pid, and the existing live-owner timeout message fixture passes unchanged.
- [ ] A two-recoverer fixture over one dead claim records exactly one successful acquisition, no recovery-refused result, and one surviving lease directory.
- [ ] A vanished-claim fixture produces a timeout message carrying no blocking-pid clause.

## Negative-category review

Data integrity is covered by the corrupt and ambiguous claim refusals, which keep the module's rule that ambiguous ownership is never stolen. Dependency unavailability is covered by the liveness probe that throws, the only external dependency this path has. Concurrent access is covered by the two-recoverer race over one dead claim, and partial failure by the claim that disappears mid-flight after a losing exclusive write; both assert the acquirer degrades to a bounded retry rather than a hard refusal. Timeouts are covered by both message criteria, which assert the wait budget still terminates the attempt. Invalid input, auth and permission failures, resource exhaustion, cascade deletion, model-level immutability, exception-hierarchy, and dedup-key categories are inapplicable: the path takes no user input, has no authorization surface, allocates nothing, deletes no dependent records, and performs no deduplication. Existing lease coverage for refusing a live owner, for labelled diagnostics, and for worktree isolation remains authoritative for everything this slice does not change.
