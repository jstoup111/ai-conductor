**Status:** Accepted

# Stories: Show provider activity age on the build quiet warning (#1815)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is the quiet-episode warning the build-progress watcher emits and the daemon log line that renders it. The quiet threshold, the periodic progress heartbeat tick, the stall breaker, the interactive terminal renderer, the OpenTelemetry attributes, the status dashboard, and the verification-group step-header naming remain outside this slice.

## Story 1: The quiet warning carries the running dispatch's provider-activity evidence

As an operator reading an autonomous daemon run, I want the build quiet warning to carry when the build's provider was last observably active, so that a long task and a wedged step stop looking identical to me and to every other consumer of the event.

### Acceptance Criteria

#### Happy Path

- Given the build worktree carries an activity pulse that names the build step and was stamped after the running build dispatch started, when the quiet warning is emitted, then the event carries that pulse's timestamp in epoch milliseconds.
- Given that pulse is only seconds old when the quiet window elapses with no task or commit movement, when the tick runs, then the warning still fires on that same tick and exactly once for the episode.
- Given progress re-arms the quiet episode and a newer pulse is written, when a second quiet warning fires for the same build, then it carries the newer pulse's timestamp rather than the first episode's.

#### Negative Paths

- Given the build worktree carries no activity pulse at all, when the quiet warning is emitted, then it carries no activity timestamp and its quiet minutes, resolved count, total, current task id, last commit time, and feature slug are the values it carries today.
- Given the only activity pulse on disk names a different step, when the quiet warning is emitted, then it carries no activity timestamp.
- Given the only activity pulse on disk was stamped before the running build dispatch started, when the quiet warning is emitted, then it carries no activity timestamp, so a pulse left behind by earlier work is never reported as this dispatch's liveness.
- Given the activity pulse file holds malformed content, when the quiet tick runs, then the warning is still emitted on that tick with no activity timestamp and the tick does not throw.

### Done When

- [ ] The quiet-episode event variant declares one additional optional epoch-millisecond activity-timestamp field and no other field changes.
- [ ] Watcher fixtures prove the timestamp is carried from a pulse owned by the running dispatch, that a fresh pulse never suppresses or delays the warning, and that a re-armed episode reports the newer pulse.
- [ ] Watcher fixtures for an absent pulse, a pulse naming another step, a pulse older than the dispatch start, and a malformed pulse each emit the warning with the activity timestamp absent.

## Story 2: The daemon quiet line separates a live provider from a silent one

As an operator scanning the daemon log, I want the quiet warning line itself to name how long ago the build's provider was last active, so that I can dismiss a healthy long task or escalate a wedged one without opening a worktree or running any command.

### Acceptance Criteria

#### Happy Path

- Given a quiet warning carrying an activity timestamp twenty-seven seconds before the render clock, when the daemon renders it, then the line keeps its existing quiet-duration, counter, and feature slug text and additionally names that activity age.
- Given two quiet warnings with identical counters whose activity timestamps are twenty-seven seconds and twenty-two minutes before the render clock, when the daemon renders them, then the second line reports the larger age, so a silent provider reads differently from an active one.

#### Negative Paths

- Given a quiet warning carrying no activity timestamp, when the daemon renders it, then the line is exactly the line rendered today for that event with no activity fragment appended.
- Given a quiet warning whose activity timestamp is later than the render clock, when the daemon renders it, then the line reports a zero-length age rather than a negative or non-numeric one.

### Done When

- [ ] Renderer fixtures with color disabled prove the activity age is appended beside the existing text and grows with the pulse's age.
- [ ] Renderer fixtures prove the line is unchanged with no activity timestamp and clamps a future-dated timestamp to a zero-length age.

## Negative-category review

Invalid and missing input is covered by the absent and malformed activity pulse and by the absent timestamp at render. Stale and misattributed state is covered separately by the pulse that names another step and the pulse stamped before the running dispatch began, which is the specific failure the dispatch-ownership predicate exists to prevent. Clock disorder is covered by the future-dated timestamp clamping to a zero-length age. Graceful degradation is covered by the requirement that every failure leaves the warning firing on the same tick with its existing fields, so no failure of the new evidence can suppress or delay the warning a wedged step depends on. Idempotency is covered by the once-per-episode assertion and the re-armed second episode. Auth, permission, concurrency, deletion, queue, datastore, upload, and transaction categories are inapplicable: nothing here writes, no new state is shared, and the single new read is a best-effort read of a file whose writer is unchanged.
