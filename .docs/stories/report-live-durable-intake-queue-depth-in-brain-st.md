**Status:** Accepted

# Stories: Report live durable intake queue depth in brain status (#1132)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the brain status reporting path only: durable pending and claimed counts, a distinguishable stranded count, and honest labelling of the last notification batch. Notifier redesign, machine-readable output, per-repository breakdowns, and reap policy remain outside this slice.

## Story 1: Report the durable queue state that exists right now

As an operator watching the background intake loop, I want brain status to tell me how much work is actually waiting and in flight so that I can judge backlog depth instead of reading a number left over from an earlier poll.

### Acceptance Criteria

#### Happy Path

- Given the durable intake ledger holds entries in several lifecycle states, when brain status runs, then it reports the count of pending entries and the count of claimed entries as separate labelled values.
- Given the ledger changes between two brain status invocations without any poll happening in between, when brain status runs the second time, then the reported counts reflect the ledger as it stands at that invocation.

#### Negative Paths

- Given the durable ledger cannot be read because its contents are corrupt or its lease cannot be acquired, when brain status runs, then it reports the queue as unavailable with the underlying reason, prints no counts at all, and exits non-zero.

### Done When

- [ ] Brain status output for a ledger fixture with mixed lifecycle states contains the pending count and the claimed count on separate labelled lines.
- [ ] Two consecutive brain status invocations over a ledger mutated in between report the second ledger's counts, with no poll or notification in between.
- [ ] A corrupt ledger fixture produces an unavailability line naming the reason, no count line, and a non-zero exit code.

## Story 2: Distinguish stranded claims from healthy in-flight work

As an operator, I want stranded claims counted separately from live claims so that a growing stranded population is visible before it silently consumes the whole inbox.

### Acceptance Criteria

#### Happy Path

- Given some claimed entries were last seen longer ago than the configured stale-claim window, when brain status runs, then those entries are reported as a stranded count on its own labelled line, in addition to the claimed count.
- Given no claimed entry is older than the configured stale-claim window, when brain status runs, then the stranded count is zero and the claimed count is unchanged.

#### Negative Paths

- Given a claimed entry carries a missing or unparseable last-seen timestamp, or already carries a delivered pull request, when brain status runs, then that entry is counted as claimed and never as stranded.

### Done When

- [ ] A ledger fixture holding both recently-seen and long-unseen claimed entries reports a stranded count covering only the long-unseen ones, alongside an unchanged claimed count.
- [ ] The stranded count is derived from the same configured stale-claim window the bulk requeue path uses, proven by a fixture whose window override changes the reported stranded count.
- [ ] Claimed entries with an absent, unparseable, or pull-request-bearing last-seen state are excluded from the stranded count and included in the claimed count.

## Story 3: Never present a prior notification batch as current depth

As an operator, I want the last notification batch clearly marked as a past event so that an empty poll cannot leave an old number standing where current depth belongs.

### Acceptance Criteria

#### Happy Path

- Given an earlier non-empty poll recorded a notification batch, when brain status runs, then that batch is reported on its own line identified as the last notification with its recorded time, separate from every durable count.

#### Negative Paths

- Given the notification status surface is absent, empty, or unparseable, when brain status runs, then no batch figure is reported at all, the durable counts are still reported, and the command exits zero.

### Done When

- [ ] Brain status output for a recorded notification batch names it as the last notification and carries its recorded timestamp, on a line distinct from the pending, claimed, and stranded lines.
- [ ] Absent, empty, and unparseable notification-surface fixtures each produce no numeric batch figure while the durable count lines are still present and the exit code is zero.

## Negative-category review

Data integrity is covered by the corrupt-ledger and unparseable-surface criteria, which are the two ways this read can be fed bad bytes. Dependency unavailability and concurrent access are covered by the lease-acquisition failure criterion, since the intake ledger's lease is the contention point a concurrently-running brain loop creates. Boundary-condition integrity for the stranded predicate is covered by the missing, unparseable, and pull-request-bearing last-seen cases, which are exactly the inputs the shared predicate refuses to reap on. Invalid input, authentication, resource exhaustion, partial-failure rollback, and cascade deletion are inapplicable: this verb takes no arguments, performs no writes, contacts no external service, and deletes nothing.
