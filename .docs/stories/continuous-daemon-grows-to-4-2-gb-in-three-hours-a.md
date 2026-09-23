**Status:** Accepted

# Stories: Daemon memory observability and exit attribution (#2079)

Technical track. Governed by `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`
D8–D10 and the review `architecture-review-2026-09-22-continuous-daemon-grows-to-4-2-gb-in-three-hours-a`.
Scope boundary: observability and recovery only — no memory-growth fix, no OpenTelemetry
instrument, no per-dispatch process isolation.

## Story 1: Memory samples ride the event spine at step boundaries

**Requirement:** TR-1 (memory growth observable while the daemon runs)

As an operator, I want the daemon's own memory recorded at every step boundary so that the growth curve can be read before the host's ceiling instead of reconstructed from a kernel message.

### Acceptance Criteria

#### Happy Path
- Given a `--continuous` daemon driving a feature, when a `step_started` or `step_completed` event passes the root bus, then one `daemon_memory_sample` record is appended to `.daemon/events.jsonl` carrying `rss`, `heapUsed`, `heapTotal`, `external`, the feature slug, the step name, the boundary kind, and the daemon pid
- Given a run of 25 build dispatches, when the ledger is read, then the samples can be ordered by timestamp and by dispatch count so growth per dispatch and growth per hour are both computable from the ledger alone

#### Negative Paths
- Given the daemon is idle with no feature in flight, when a poll tick passes, then no `daemon_memory_sample` is written on that tick
- Given a feature worktree's `.pipeline/events.jsonl`, when the daemon samples memory, then no `daemon_memory_sample` appears in the feature ledger because the record is daemon-origin, not feature-origin
- Given `.daemon/events.jsonl` is unwritable, when a sample is due, then the step proceeds unaffected and one `daemon.log` line names the write failure once rather than on every boundary

### Done When
- [ ] `daemon_memory_sample` is a `ConductorEvent` variant with a sink-registry row of `render: false, persist: true, audit: false, otel: false`
- [ ] A unit test drives `step_started` then `step_completed` through the root bus and asserts exactly two `daemon_memory_sample` records with the fields above in the daemon ledger and zero in the feature ledger
- [ ] A unit test asserts an idle poll tick appends no sample
- [ ] A unit test asserts a failing ledger write logs once and does not throw into the step

## Story 2: A heap dump lands before the ceiling

**Requirement:** TR-2 (a dump exists for diagnosis before the host kills the process)

As an operator, I want one V8 heap snapshot written when memory crosses a threshold so that the cause of growth can be diagnosed offline.

### Acceptance Criteria

#### Happy Path
- Given a configured RSS threshold in megabytes, when a memory sample first crosses it, then one heap snapshot is written under `.daemon/heap/` with a name carrying the timestamp and pid and a `daemon_heap_dump_written` record naming the path, the byte size, and the triggering `rss` is appended to `.daemon/events.jsonl`
- Given no threshold configured, when samples are taken, then a documented default threshold applies and a crossing still produces exactly one dump

#### Negative Paths
- Given a dump was already written in this daemon lifetime, when later samples also exceed the threshold, then no second snapshot is written and no second `daemon_heap_dump_written` record is appended
- Given `.daemon/heap/` already holds the configured maximum number of snapshots, when a new dump is written, then the oldest snapshot is removed first so the count never exceeds the cap
- Given the snapshot write fails midway, when the trigger returns, then no partial file remains at the target path, one `daemon.log` line names the failure, and the step in flight is unaffected

### Done When
- [ ] `daemon_heap_dump_written` is a `ConductorEvent` variant with a sink-registry row of `render: false, persist: true, audit: false, otel: false`
- [ ] A unit test with an injected snapshot writer asserts one dump and one record on the first crossing and none on a second crossing in the same lifetime
- [ ] A unit test asserts retention removes the oldest file once the cap is reached
- [ ] A unit test asserts a throwing snapshot writer leaves no partial file and does not propagate

## Story 3: The daemon runs under an explicit heap cap

**Requirement:** TR-3 (runaway growth ends as a Node heap error with a stack, not a kernel OOM kill)

As an operator, I want the daemon's V8 heap capped so that a runaway run fails inside Node with a stack trace instead of taking the host into OOM.

### Acceptance Criteria

#### Happy Path
- Given no `daemon_heap_limit_mb` in config, when the supervisor builds the pane foreground command, then the launched daemon carries `--max-old-space-size` with the documented default value
- Given `daemon_heap_limit_mb: 6144` in config, when the supervisor builds the pane foreground command, then the launched daemon carries `--max-old-space-size=6144`

#### Negative Paths
- Given `daemon_heap_limit_mb: 0` or a non-integer or a negative value, when config is validated, then validation fails with a message naming `daemon_heap_limit_mb` and the accepted range, and no daemon is spawned
- Given the daemon exceeds the cap, when V8 aborts, then `.daemon/daemon.log` contains the `JavaScript heap out of memory` fatal error text and the exit witness of Story 4 records a non-zero exit for that pid

### Done When
- [ ] `daemon_heap_limit_mb` is declared in `types/config.ts`, listed among recognized keys, and validated as a positive integer following the `daemon_concurrency` pattern
- [ ] A unit test asserts the foreground command contains `--max-old-space-size=<default>` with no key set and `--max-old-space-size=6144` with the key set
- [ ] A unit test asserts `0`, `-1`, `1.5`, and `"big"` are rejected with a message naming the key
- [ ] The existing tests that assert the exact foreground command string are updated in the same change and pass

## Story 4: An exit witness records why the daemon pid vanished

**Requirement:** TR-4 (death from an external signal is distinguishable from a step failure)

As an operator, I want the daemon's exit status recorded from outside the dying process so that an OOM kill is never described only by a later `execution interrupted` line.

### Acceptance Criteria

#### Happy Path
- Given a tmux-hosted daemon, when the daemon process exits for any reason, then the pane foreground appends one `daemon_exited` record to `.daemon/exit-events.jsonl` carrying the daemon pid, the exit code or the signal name, and a timestamp, before the pane foreground itself exits
- Given the daemon is killed with `SIGKILL`, when the witness runs, then the record carries `signal: SIGKILL` and a null exit code
- Given the daemon exits with code 134 after a V8 heap abort, when the witness runs, then the record carries `code: 134` and `signal: SIGABRT`

#### Negative Paths
- Given the witness cannot write `.daemon/exit-events.jsonl`, when the daemon exits, then the witness writes the same record as one line to `.daemon/daemon.log` and exits non-zero without hanging the pane
- Given a daemon restarted in place while an older wrapper is still writing its record, when both proceed, then `.daemon/events.jsonl` is never opened for writing by the witness and `.daemon/exit-events.jsonl` has exactly one line per exited pid with no torn line
- Given the daemon is run bare with no tmux session, when it exits, then no witness runs and no `.daemon/exit-events.jsonl` is created by that exit
- Given `ai-conductor daemon exit-witness` is invoked without `--pid` or without an exit status, when it parses arguments, then it exits non-zero with a usage message and writes nothing

### Done When
- [ ] `daemon_exited` is a `ConductorEvent` variant with a sink-registry row of `render: false, persist: true, audit: false, otel: false`
- [ ] `exit-witness` is a registered daemon subverb and the foreground command built for both fresh sessions and respawned panes runs the launcher as the single child and invokes the witness with that child's pid and exit status
- [ ] A real-tmux test on a fixture-owned private socket kills the daemon child with `SIGKILL` and asserts one `daemon_exited` record with `signal: SIGKILL` in `.daemon/exit-events.jsonl` and none in `.daemon/events.jsonl`
- [ ] A unit test asserts an unwritable exit ledger falls back to one `daemon.log` line and a non-zero witness exit
- [ ] A unit test asserts missing `--pid` or exit status is rejected with usage and no write

## Story 5: `daemon status` names the last death and the last memory sample

**Requirement:** TR-5 (a dead daemon is surfaced without a hunch)

As an operator, I want `daemon status` to show why the daemon died and how much memory it last held so that the condition is readable at a glance.

### Acceptance Criteria

#### Happy Path
- Given a session whose daemon pid is dead and `.daemon/exit-events.jsonl` holds a `daemon_exited` for that pid, when `daemon status` runs, then the `⚠ session-up/process-dead` row also renders the signal or exit code and the exit timestamp on the same row
- Given `.daemon/events.jsonl` holds `daemon_memory_sample` records, when `daemon status` runs, then the row renders the most recent sample's `rss` in megabytes and its timestamp

#### Negative Paths
- Given a dead pid with no `daemon_exited` record for it, when `daemon status` runs, then the row renders `exit cause unknown` rather than the cause of an older pid
- Given `.daemon/exit-events.jsonl` contains one malformed line among valid ones, when `daemon status` runs, then the valid records are still used and the malformed line is counted in a single `skipped N unparseable` note
- Given a healthy running daemon, when `daemon status` runs, then no exit cause is rendered and the last memory sample is still shown

### Done When
- [ ] A reader for `.daemon/exit-events.jsonl` and for `daemon_memory_sample` in `.daemon/events.jsonl` exists and is called from the status sweep
- [ ] A unit test with a dead pid and a matching `daemon_exited` asserts the rendered row contains the signal and timestamp
- [ ] A unit test asserts a stale record for a different pid renders `exit cause unknown`
- [ ] A unit test asserts one malformed line is skipped with a count and does not blank the row
- [ ] A unit test asserts a healthy daemon renders the last sample and no exit cause

## Story 6: `ensureRunning` reports the death it is recovering from

**Requirement:** TR-5 (a dead daemon is surfaced without a hunch)

As an operator, I want the automatic respawn path to say what it found so that a nudge from `compose` or `daemon start` names the prior death instead of silently replacing it.

### Acceptance Criteria

#### Happy Path
- Given a stale pidfile whose pid is dead and a matching `daemon_exited` record, when `ensureRunning` reclaims the lock and respawns, then its log line names the dead pid, the signal or exit code, and the exit timestamp before the respawn line

#### Negative Paths
- Given a stale pidfile whose pid has no `daemon_exited` record, when `ensureRunning` reclaims, then the log line names the dead pid with `exit cause unknown` and the respawn proceeds
- Given the exit ledger is unreadable, when `ensureRunning` reclaims, then the respawn still proceeds and the log line notes the ledger could not be read

### Done When
- [ ] A unit test asserts the reclaim log line contains the pid, signal, and timestamp when a matching record exists
- [ ] A unit test asserts `exit cause unknown` and a successful respawn when no record exists
- [ ] A unit test asserts an unreadable ledger neither throws nor blocks the respawn

## Story 7: A feature interrupted by daemon death resumes from committed progress

**Requirement:** TR-6 (interrupted work resumes, evidence preserved)

As an operator, I want a feature whose daemon was killed mid-build to continue from its committed tasks so that finished work is not redone.

### Acceptance Criteria

#### Happy Path
- Given a feature at task 19 of 25 with tasks 1–18 carrying `Task:` trailers on commits and `completed` rows in its worktree `task-status.json`, when the daemon is killed with `SIGKILL` and a new daemon dispatches the feature, then the build resumes at task 19 and tasks 1–18 are neither re-dispatched nor re-marked
- Given the same interruption, when the new daemon dispatches, then the worktree `.pipeline/events.jsonl` and `conduct-state.json` from before the kill are intact and the completed steps before `build` are not re-run

#### Negative Paths
- Given a completed task whose commit carries a `Task:` trailer but whose `task-status.json` row was lost, when the feature is re-dispatched, then the row is restored as `completed` from the trailer and the task is not redone
- Given the daemon was killed while task 19 was mid-flight with no commit, when the feature is re-dispatched, then task 19 is dispatched again from pending and no half-finished state is treated as complete
- Given the feature had no `.pipeline/HALT` written because the daemon died abruptly, when the new daemon scans the backlog, then the feature is re-dispatched on the next poll without an operator clearing anything

### Done When
- [ ] An acceptance test seeds a worktree with trailered commits and a `task-status.json`, simulates the daemon death, re-dispatches, and asserts the resumed task index and untouched earlier rows
- [ ] The same test asserts pre-kill `.pipeline/events.jsonl` and `conduct-state.json` contents survive the redispatch
- [ ] A test asserts a trailer-only completed task is restored as `completed` and an uncommitted mid-flight task returns to pending
- [ ] A test asserts a killed feature with no HALT marker is picked up on the next poll
