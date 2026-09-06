**Status:** Accepted

# Stories: Reclaim orphaned full-suite lock recovery claims (#2171)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the recovery-claim branch of full-suite lock acquisition: classify a claim left by a dead recoverer as orphaned and reclaim it, and keep a claim held by a live recoverer excluding every other acquirer. Owner liveness rules, the acquisition timeout budget, the timeout message wording, the claim record format, and the separate conduct state lease remain outside this slice.

## Story 1: Reclaim a recovery claim left behind by a dead recoverer

### Acceptance Criteria

#### Happy Path

- Given the full-suite lock holds a dead owner and a recovery claim whose recorded process is not live, when a verifier acquires the lock, then the orphaned claim is reclaimed, the stale lock is removed, and the suite runs without any operator deleting the lock directory.
- Given a recovery claim that cannot be parsed and is older than the unowned-stale threshold, when a verifier acquires the lock, then the claim is treated as orphaned and acquisition proceeds by the same reclaim path.

#### Negative Paths

- Given an orphaned claim disappears between the classification and the reclaiming rename, when the acquirer makes its one bounded retry of the exclusive claim write, then acquisition either takes the claim once or reports the lock occupied, and never reports success while another claim exists.
- Given the claim cannot be read, classified, or reclaimed for a reason other than absence, when acquisition runs, then it fails with a message naming the recovery claim rather than treating the lock as free.

### Done When

- [ ] A lock fixture carrying a dead owner and a dead-process claim recovers and executes the suite in one acquisition.
- [ ] An unparseable claim is reclaimed only once it is older than the injected unowned-stale threshold.
- [ ] A claim removed by an injected side effect during classification produces no double reclaim and no false acquisition.

## Story 2: Keep a live recoverer's claim exclusive

### Acceptance Criteria

#### Happy Path

- Given a recovery claim whose recorded process is live and which is newer than the unowned-stale threshold, when a second verifier attempts stale recovery, then it reports the lock occupied, leaves the claim and lock directory untouched, and runs no suite.

#### Negative Paths

- Given an unparseable recovery claim newer than the unowned-stale threshold, when a verifier attempts stale recovery, then it reports the lock occupied and preserves the claim bytes rather than stealing a claim it cannot prove is orphaned.
- Given two acquirers contend for the same orphaned lock, when both run to completion, then exactly one of them executes the suite and neither reports a successful acquisition it did not hold.

### Done When

- [ ] A live-process claim keeps acquisition occupied until its timeout, with the claim file byte-identical afterwards.
- [ ] A fresh unparseable claim keeps acquisition occupied and is not renamed or removed.
- [ ] Two concurrent acquirers over one orphaned lock produce exactly one suite execution.

## Negative-category review

Input integrity is covered by the unparseable-claim cases, which separate a claim that is provably orphaned from one that merely cannot be read. Concurrency and idempotency are covered by the vanish-during-classification case, the bounded single retry of the exclusive claim write, and the two-acquirer contention case. Permission and filesystem failures are covered by the failure criterion requiring a claim-naming message instead of a free-lock verdict. Deletion safety is covered by the requirement that a claim which cannot be proven orphaned is never renamed or removed. No datastore, queue, upload, transaction, network call, or external service is introduced, so those categories are inapplicable; owner-liveness and quarantine refusal permutations remain covered by the existing lock tests.
