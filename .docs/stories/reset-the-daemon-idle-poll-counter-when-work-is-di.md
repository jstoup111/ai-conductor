**Status:** Accepted

# Stories: Reset the daemon idle-poll counter when work is dispatched (#2156)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the consecutive-idle semantics of the `--max-idle-polls` ceiling in the continuous daemon loop, plus the reference wording for that flag. The ceiling's off-by-one arithmetic, the early-wake cadence, and every other stop reason remain outside this slice.

## Story 1: Dispatching a feature restarts the consecutive empty-poll count

### Acceptance Criteria

#### Happy Path

- Given a continuous run with an idle ceiling and a backlog that stays empty for fewer polls than that ceiling before one feature appears, when the feature is dispatched and the backlog stays empty afterwards, then a full ceiling's worth of empty polls elapses after that dispatch before the run stops for `idle_timeout`.

#### Negative Paths

- Given a candidate is selected and then operator-parked before it starts, when the poll ends with no feature started, then the empty-poll count advances and the ceiling still stops the run for `idle_timeout`.

### Done When

- [ ] A continuous-run fixture proves the empty polls taken before a dispatch do not count toward the ceiling reached after it.
- [ ] A fixture whose selected candidate is parked at the dispatch guard proves a poll that starts nothing does not restart the count.
- [ ] The flag's reference row and the foreground-run guidance state that dispatching a feature restarts the count.

## Story 2: A poll that starts no work still counts toward the ceiling

### Acceptance Criteria

#### Happy Path

- Given a continuous run whose backlog is empty from the first poll, when idle polls elapse without any work appearing, then the run stops for `idle_timeout` at its existing cadence of exactly one idle sleep per empty poll up to the ceiling.

#### Negative Paths

- Given a backlog that always returns a feature whose durable HALT marker is never cleared, when no feature can be started on any poll, then the run stops for `idle_timeout` at the same cadence as an empty backlog rather than polling forever.

### Done When

- [ ] The existing empty-backlog ceiling fixture still observes exactly one idle sleep per empty poll and the same stop reason.
- [ ] A never-eligible backlog fixture reaches `idle_timeout` with the same sleep count as an empty backlog.
- [ ] The daemon unit and acceptance files that pass an idle ceiling pass unchanged, proving none relied on cumulative counting.

## Negative-category review

Input integrity is not a category here: the ceiling is an already-parsed integer and this slice adds no parser. The relevant failure categories are ordering and liveness. A candidate that is selected but never started (park race) covers the "found something, started nothing" boundary; a permanently ineligible backlog covers the non-empty-but-unstartable boundary; together they prove the restart is keyed to a started dispatch and cannot make the ceiling unreachable. Idempotency is covered by repeated ineligible polls producing one count per poll. No datastore, queue, deletion, upload, transaction, network, or permission surface is introduced, so those categories are inapplicable. In-flight work never reaches the counting branch, so concurrency adds no distinct case at this seam.
