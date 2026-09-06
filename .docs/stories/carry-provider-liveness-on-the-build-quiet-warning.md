**Status:** Accepted

# Stories: Carry provider liveness on the build quiet warning (#1815)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the quiet-episode warning the build-progress watcher emits and the daemon log line that renders it. The quiet threshold, the periodic progress heartbeat tick, the stall breaker, the interactive terminal renderer, the status dashboard, and the daemon's step-header naming remain outside this slice.

## Story 1: The quiet warning carries the running dispatch's provider-activity evidence

As an operator reading an autonomous daemon run, I want the build quiet warning to carry when the build's provider was last observably active, so that a long task and a wedged step stop looking identical to me and to every other consumer of the event.

### Acceptance Criteria

#### Happy Path

- Given the build worktree carries an activity pulse stamped by the build dispatch that is currently running, when the quiet warning is emitted, then the event carries the epoch-millisecond timestamp of that most recent pulse.
- Given that pulse is only seconds old at the moment the quiet window elapses with no task or commit movement, when the tick runs, then the warning still fires on that same tick and exactly once for the episode.
- Given the pulse is refreshed and a later quiet episode fires for the same build, when that second warning is emitted, then it carries the newer pulse's timestamp rather than the first episode's.

#### Negative Paths

- Given the build worktree carries no activity pulse at all, when the quiet warning is emitted, then it carries no activity timestamp and its quiet-minute count, resolved and total counters, current task, and feature slug are exactly what they are today.
- Given the only activity pulse on disk names a different step, or was stamped before the running build dispatch started, when the quiet warning is emitted, then it carries no activity timestamp, so a pulse left behind by earlier work is never reported as this dispatch's liveness.
- Given the activity pulse is unreadable or malformed, when the quiet tick runs, then the warning is still emitted at that tick with no activity timestamp and the tick does not throw.

### Done When

- [ ] The quiet-episode event type declares one additional optional epoch-millisecond activity-timestamp field and no other field changes.
- [ ] A watcher fixture over a temporary directory asserts the emitted quiet warning's activity timestamp equals the timestamp written into the worktree's activity pulse by the running dispatch.
- [ ] A watcher fixture asserts the quiet warning still fires on the first tick past the configured quiet window while the activity pulse is seconds fresh, and fires exactly once for that episode.
- [ ] Watcher fixtures for an absent pulse, a pulse naming another step, a pulse older than the dispatch start, and a malformed pulse each emit the warning with the activity timestamp absent and every pre-existing field intact.

## Story 2: The daemon quiet line separates a live provider from a silent one

As an operator scanning the daemon log, I want the quiet warning line itself to name how long ago the build's provider was last active, so that I can dismiss a healthy long task or escalate a wedged one without opening a worktree or running any command.

### Acceptance Criteria

#### Happy Path

- Given a quiet warning carrying an activity timestamp twenty-seven seconds before the render clock, when the daemon renders it, then the line keeps its existing quiet-duration, counter, and slug text and additionally names that activity age.
- Given two quiet warnings with identical counters whose activity timestamps are twenty-seven seconds and twenty-two minutes before the render clock, when the daemon renders them, then the second line reports the visibly larger age, so a silent provider reads differently from an active one.

#### Negative Paths

- Given a quiet warning carrying no activity timestamp, when the daemon renders it, then the line is exactly its existing text with no activity fragment appended.
- Given a quiet warning whose activity timestamp is later than the render clock, when the daemon renders it, then it reports a zero-length age rather than a negative or non-numeric one.

### Done When

- [ ] A renderer fixture with color disabled asserts the quiet line for a twenty-seven-second-old pulse contains both its existing quiet-minute and counter text and the rendered activity age.
- [ ] A renderer fixture asserts a twenty-two-minute-old pulse renders a larger age than a twenty-seven-second-old pulse for the same counters.
- [ ] A renderer fixture asserts the quiet line with no activity timestamp is byte-for-byte the line rendered today for the same event.
- [ ] A renderer fixture asserts a future-dated activity timestamp renders a zero-length age and the line still renders without throwing.

## Negative-category review

Invalid and missing input is covered by the absent, unreadable, and malformed activity pulse and by the absent timestamp at render. Stale and misattributed state is covered by the pulse that names another step and the pulse stamped before the running dispatch began — the specific failure the dispatch-ownership predicate exists to prevent, and the one that once killed a freshly started step one poll tick in. Clock disorder is covered by the future-dated timestamp clamping to a zero-length age. Graceful degradation is covered by the requirement that every failure leaves the warning firing on the same tick with its existing fields, so no failure of the new evidence can suppress or delay the warning a wedged step depends on. Idempotency is covered by the once-per-episode assertion and the re-armed second episode. Auth, permission, concurrency, deletion, queue, datastore, upload, and transaction categories are inapplicable: nothing here writes, no new state is shared, and the single reader is a best-effort read of a file whose writer is unchanged.
