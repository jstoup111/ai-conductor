**Status:** Accepted

# Stories: Surface commit recency in daemon build progress lines (#1715)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the commit timestamp the build-progress watcher already observes, the two build events that already report each poll tick, the two daemon log lines that render them, and the operator triage text that currently sends the reader to a hand-run Git log. The quiet threshold, the halt ceilings, the post-hoc stall breaker, the interactive terminal renderer, and the OpenTelemetry span attributes remain outside this slice.

## Story 1: Read build liveness from the daemon line without opening the worktree

### Acceptance Criteria

#### Happy Path

- Given the build worktree has at least one commit, when the watcher emits a change-driven or heartbeat progress tick, then the event carries the commit time of the worktree's current head and the daemon line names that commit's age beside the task counter.
- Given a heartbeat tick repeats a pinned task counter with no new commit, when the daemon renders it, then the age is computed against the render clock, so an older commit time renders a larger age for the same counter.

#### Negative Paths

- Given the build worktree has no commits or its commit-time probe fails, when the watcher emits a tick and the daemon renders it, then the commit time is absent and the line keeps its existing counter, task, and slug text with no commit fragment.
- Given the recorded commit time is later than the render clock, when the daemon renders the line, then it reports a zero-length age rather than a negative one.

### Done When

- [ ] A watcher test over a temporary Git repository observes an emitted commit time equal to the head commit's own committer time.
- [ ] Renderer fixtures with and without a commit time both produce a line, and only the populated one carries the commit-age fragment.
- [ ] Formatter unit cases cover sub-minute, whole-minute, multi-hour, absent, and future-dated inputs.

## Story 2: Tell a quiet branch apart from a quiet log on the warning line

### Acceptance Criteria

#### Happy Path

- Given a quiet episode fires after the configured quiet window, when the daemon renders the warning, then it names the age of the newest branch commit alongside the quiet duration.
- Given a commit lands on the build branch while the task counter stays pinned, when the next poll tick runs, then no quiet warning is emitted for that episode and the tick reports the new commit's time.

#### Negative Paths

- Given no commit time was ever observed for the build worktree, when the quiet warning renders, then it keeps its existing quiet-duration and counter text with no commit fragment.

### Done When

- [ ] A watcher test proves a commit-only tick re-arms the quiet episode and advances the reported commit time.
- [ ] A warning-line fixture carrying a commit time contains both the quiet duration and the commit age.
- [ ] A warning-line fixture without a commit time matches the line shape rendered today.

## Negative-category review

Input integrity is covered by the absent commit time, the unparseable or non-zero-exit commit-time probe, and the future-dated timestamp that would otherwise render a negative age. Dependency failure is covered by the injected Git probe failure, which must leave the last known value untouched rather than manufacture a change. Idempotency is covered by repeated renders of the same event and by the unchanged-head tick, which must reuse the cached commit time instead of re-probing. Boundary conditions are covered by the sub-minute and hour-crossing formatter cases. No deletion, queue, datastore, upload, transaction, credential, permission, or network surface is introduced — the change observes an existing local Git fact and formats it for display — so those categories are inapplicable. Existing watcher, renderer, and event-shape tests remain authoritative for the counter arithmetic, the quiet threshold, and the stall breaker, which this slice does not touch.
