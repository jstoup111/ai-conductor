# Implementation Plan: Daemon memory observability and exit attribution

**Date:** 2026-09-22
**Design:** .docs/architecture/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md
**Architecture:** .docs/decisions/adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md
**Stories:** .docs/stories/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md
**Conflict check:** Clean, .docs/conflicts/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md
**Source-Ref:** jstoup111/ai-conductor#2079

## Summary

13 tasks make the continuous daemon's memory observable on the event spine, capture a heap dump before the host ceiling, cap the V8 heap, witness the daemon's exit from outside the dying process, surface the cause in `daemon status` and `ensureRunning`, and prove a SIGKILLed feature resumes from committed task progress. No memory-growth fix, no OpenTelemetry instrument, no per-dispatch process isolation (scope boundary in `.docs/track/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md`).

## Technical Approach

- **Spine, not channel.** Three new `ConductorEvent` variants (`daemon_memory_sample`, `daemon_heap_dump_written`, `daemon_exited`) with sink rows `persist: true, otel: false`. The sampler (`engine/daemon-memory.ts`) subscribes to the daemon's root `ConductorEventEmitter` in `daemon-cli.ts` beside `startDaemonEventPersistence`, so samples reach `.daemon/events.jsonl` through the existing daemon persister and never a feature ledger (root-bus events are not forwarded-from-feature).
- **Dump before the ceiling.** The sampler owns a threshold trigger (`daemon_heap_limit_mb`-independent `DEFAULT_HEAP_DUMP_THRESHOLD_MB`, injectable `v8.writeHeapSnapshot`), once per daemon lifetime, temp-then-rename so a failed write leaves nothing, retention pruned by mtime.
- **Heap cap via `NODE_OPTIONS`.** The launcher is a shell script, so the pane command exports `NODE_OPTIONS=--max-old-space-size=<n>` ahead of it; `n` comes from the new flat `daemon_heap_limit_mb` key (validated like `daemon_concurrency`, default 4096).
- **Exit witness, one writer per file.** `DAEMON_FOREGROUND_COMMAND` becomes `buildDaemonForegroundCommand(config)`: a `sh -c` string that runs the launcher `daemon --continuous` as the shell's single child, captures its status, and invokes `daemon exit-witness --pid <pid> --status <rc>`. The witness (`engine/daemon-exit-witness.ts`, subverb registered in `daemon-command.ts`) maps `128+signo` to a signal name and appends one line to `.daemon/exit-events.jsonl` — never `.daemon/events.jsonl` (hosting ADR D10; adr-2026-08-08 D2). The bare-run path is untouched.
- **Readers, not rollups.** `engine/daemon-ledger-readers.ts` answers "latest exit for pid" and "latest sample" with per-line parsing that skips and counts malformed lines (unlike `parseLedger`, which fails closed for rollups). `daemon-observe-cli.ts` and `daemon-lock.ts::ensureRunning` call them.
- **Resume is verified, not built.** Task 13 is verify-only: an acceptance test over the existing trailer/row re-seed and backlog scan.
- **Local pattern context.** New daemon-origin events follow `daemon_backlog_snapshot` (`types/events.ts`, `event-sinks.ts`); config keys follow `daemon_concurrency` (`types/config.ts`, `engine/config.ts` validator block); real-tmux tests use a fixture-owned private socket per the repository test policy (search `-L` / `privateSocket` under `src/conductor/test/engine/`). Variation allowed: field names inside the new events; not allowed: any cmdline-based process census (binding #554 constraint).
- **Sequencing.** Task 1 (events) and Task 6 (config) are independent roots; sampler → dump; config → heap cap → wrapper; events → witness → wrapper; readers → status and ensureRunning; Task 13 is independent.

## Prerequisites

- None beyond the current checkout; Node ≥ 26 provides `process.memoryUsage` and `v8.writeHeapSnapshot`.

## Tasks

### Task 1: Register the three daemon-origin event variants
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write a failing type-level test asserting `daemon_memory_sample`, `daemon_heap_dump_written`, and `daemon_exited` are members of `ConductorEvent` and that `EVENT_SINKS` has a row for each (the `Record` keyed by the union is total, so the compile fails until the rows exist).
2. Verify RED.
3. Add the three variants to `types/events.ts` following the `daemon_backlog_snapshot` shape: memory sample carries `rss`, `heapUsed`, `heapTotal`, `external`, `slug`, `step`, `boundary` (`started`|`completed`), `pid`, `dispatchSeq`; heap dump carries `path`, `bytes`, `rss`, `pid`; exit carries `pid`, `code` (number or null), `signal` (string or null), `at`.
4. Add sink rows `{ render: false, persist: true, audit: false, otel: false, otelTrace: false }` for all three.
5. Verify GREEN; commit `feat(events): add daemon memory, heap-dump, and exit event variants`.

**Done when:**
- The `ConductorEvent` union in `types/events.ts` carries `daemon_memory_sample`, `daemon_heap_dump_written`, and `daemon_exited` with the fields named in Steps, and `tsc` passes.
- The `EVENT_SINKS` registry has a row for each of the three with `persist: true` and `otel: false`, and the sink-registry exhaustiveness test passes.

**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, src/conductor/test/engine/event-sinks.test.ts
**Dependencies:** none

### Task 2: Sample process memory at step boundaries on the root bus
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/daemon-memory.test.ts`: with an injected `memoryUsage` returning fixed numbers, driving `step_started` then `step_completed` (slug `f`, step `build`) through a root `ConductorEventEmitter` yields exactly two `daemon_memory_sample` events with `rss`/`heapUsed`/`heapTotal`/`external`/`slug`/`step`/`boundary`/`pid`/`dispatchSeq`, `dispatchSeq` increments per step_started, and none of them are forwarded-from-feature (so a feature `EventPersister` attached to a `ForwardingEventEmitter` records zero).
2. Verify RED.
3. Implement `engine/daemon-memory.ts` `startDaemonMemorySampler(events, { memoryUsage, pid, now })` that subscribes to the root bus, emits on the two boundary types, and returns `stop()`. Wire it in `daemon-cli.ts` next to `startDaemonEventPersistence` so samples persist to `.daemon/events.jsonl` through the existing daemon persister.
4. Verify GREEN; commit `feat(daemon): emit daemon_memory_sample at step boundaries`.

**Done when:**
- Driving `step_started` then `step_completed` through the root bus with `startDaemonMemorySampler` attached emits exactly two `daemon_memory_sample` records carrying `rss`, `heapUsed`, `heapTotal`, `external`, `slug`, `step`, `boundary`, `pid`, and `dispatchSeq`, as asserted by the sampler unit test.
- Each sample carries a timestamp and a monotonically increasing `dispatchSeq`, so ordering by time and by dispatch count is asserted from the recorded array alone.
- A feature `EventPersister` attached to a `ForwardingEventEmitter` over the same root bus records zero `daemon_memory_sample` lines while the daemon persister records both, as asserted by the two-ledger test.
- `daemon-cli.ts` calls `startDaemonMemorySampler` on the root `events` bus beside `startDaemonEventPersistence`, and the sampler is stopped in the same teardown.

**Files:** src/conductor/src/engine/daemon-memory.ts, src/conductor/src/daemon-cli.ts, src/conductor/test/engine/daemon-memory.test.ts
**Dependencies:** Task 1

### Task 3: Sampler stays quiet when idle and logs a ledger write failure once
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: emitting a `daemon_backlog_snapshot` (an idle poll tick) produces no `daemon_memory_sample`; a persister whose append throws `EACCES` on every call sees the sampler log exactly one `daemon.log` line naming the path and error across three boundaries, and the boundary events themselves still reach other listeners.
2. Verify RED.
3. Implement: the sampler reacts only to `step_started`/`step_completed`; ledger write failures surface through the persister's existing error path and the sampler dedups the log line on first failure.
4. Verify GREEN; commit `fix(daemon): memory sampler is idle-silent and logs write failures once`.

**Done when:**
- Emitting a `daemon_backlog_snapshot` on the root bus produces no `daemon_memory_sample`, as asserted by the idle-tick test.
- With an appender that throws on every write, three step boundaries produce exactly one `daemon.log` line naming the ledger path and the error, and the `step_completed` listener registered after the sampler still runs, as asserted by the unwritable-ledger test.

**Files:** src/conductor/src/engine/daemon-memory.ts, src/conductor/test/engine/daemon-memory.test.ts
**Dependencies:** Task 2

### Task 4: Write one heap snapshot when a sample crosses the threshold
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: with threshold 100 MB and an injected `writeHeapSnapshot(path)` spy, samples of 50, 150 MB rss trigger exactly one write to `.daemon/heap/<iso-ts>-<pid>.heapsnapshot` and one `daemon_heap_dump_written` event carrying `path`, `bytes`, `rss`, `pid`; with no threshold option the documented default (`DEFAULT_HEAP_DUMP_THRESHOLD_MB`) applies and a crossing still writes exactly one dump.
2. Verify RED.
3. Implement the trigger inside `daemon-memory.ts`: `heapDumpThresholdMb` option (default constant exported), `writeHeapSnapshot` injectable (default `v8.writeHeapSnapshot`), file name from timestamp and pid, `bytes` from `statSync`.
4. Verify GREEN; commit `feat(daemon): threshold-triggered heap snapshot with daemon_heap_dump_written`.

**Done when:**
- With threshold 100 MB, samples of 50 then 150 MB rss cause exactly one snapshot write under `.daemon/heap/` named by timestamp and pid and exactly one `daemon_heap_dump_written` record carrying `path`, `bytes`, `rss`, and `pid`, as asserted by the threshold test.
- With no threshold configured, `DEFAULT_HEAP_DUMP_THRESHOLD_MB` is applied and a crossing writes exactly one dump and one record, as asserted by the default-threshold test.
- `docs/reference/configuration.md` documents the default heap-dump threshold by naming `DEFAULT_HEAP_DUMP_THRESHOLD_MB` and its megabyte value, and the default-threshold test asserts that documented value equals the exported constant.

**Files:** src/conductor/src/engine/daemon-memory.ts, src/conductor/test/engine/daemon-memory.test.ts
**Dependencies:** Task 2

### Task 5: Heap dump is once per lifetime, retention-capped, and never partial
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: after one dump, further samples above threshold write nothing and emit no second record; with `heapDumpRetention` 3 and three existing files, a new dump removes the oldest so four never exist; a `writeHeapSnapshot` that throws midway leaves no file at the target path, logs one `daemon.log` line, and the in-flight `step_completed` listener still runs.
2. Verify RED.
3. Implement: a `dumped` flag on the sampler; write to `<target>.tmp` then `renameSync`, unlink the tmp on throw; prune `.daemon/heap/` by mtime to the retention cap before writing.
4. Verify GREEN; commit `fix(daemon): heap dump once per lifetime with retention and atomic write`.

**Done when:**
- After one dump, two further samples above threshold write no file and emit no second `daemon_heap_dump_written`, as asserted by the once-per-lifetime test.
- With retention 3 and three existing snapshots, a new dump leaves exactly three files in `.daemon/heap/` and the oldest by mtime is the one removed, as asserted by the retention test.
- A `writeHeapSnapshot` that throws leaves no file at the target path and no `.tmp` sibling, produces exactly one `daemon.log` line naming the failure, and does not throw into the step listener, as asserted by the failed-write test.

**Files:** src/conductor/src/engine/daemon-memory.ts, src/conductor/test/engine/daemon-memory.test.ts
**Dependencies:** Task 4

### Task 6: Add the daemon_heap_limit_mb config key with validation
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/config.test.ts`: `daemon_heap_limit_mb: 6144` validates and is retained; `0`, `-1`, `1.5`, and `"big"` each fail with a message containing `daemon_heap_limit_mb` and the accepted range `[256, ∞)`.
2. Verify RED.
3. Declare `daemon_heap_limit_mb?: number` in `types/config.ts` beside `daemon_concurrency`, add it to the recognized-keys list in `engine/config.ts`, and add a positive-integer validator following the `daemon_concurrency` block; export `DEFAULT_DAEMON_HEAP_LIMIT_MB = 4096`.
4. Verify GREEN; commit `feat(config): add daemon_heap_limit_mb`.

**Done when:**
- `daemon_heap_limit_mb: 6144` passes `validateConfig` and is present on the resolved config, as asserted by the config test.
- `0`, `-1`, `1.5`, and `"big"` are each rejected by `validateConfig` with a message naming `daemon_heap_limit_mb` and the range `[256, ∞)`, as asserted by the config test.

**Files:** src/conductor/src/types/config.ts, src/conductor/src/engine/config.ts, src/conductor/test/engine/config.test.ts
**Dependencies:** none

### Task 7: Launch the daemon under --max-old-space-size
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/daemon-tmux.test.ts`: `buildDaemonForegroundCommand(config)` contains `--max-old-space-size=4096` when the key is unset and `--max-old-space-size=6144` when `daemon_heap_limit_mb: 6144`; the launcher invocation still ends with `daemon --continuous`.
2. Verify RED.
3. Replace the constant `DAEMON_FOREGROUND_COMMAND` with `buildDaemonForegroundCommand(config)`; `supervisor.start`/`restart` in `daemon-supervisor-cli.ts` load and validate config to build it, so an invalid key refuses before any tmux call. It passes `NODE_OPTIONS=--max-old-space-size=<n>` ahead of the quoted launcher (the launcher is a shell script, so the flag must travel via `NODE_OPTIONS`, not as a `node` argv). Update `newDetachedSession`, `respawnPane`, and the four existing tests that assert the exact command string. Add a `daemon_heap_limit_mb` row (default `4096`) and section to `docs/reference/configuration.md`, and a test that reads that file and asserts the row's default equals `DEFAULT_DAEMON_HEAP_LIMIT_MB`.
4. Verify GREEN; commit `feat(daemon): cap the daemon heap via NODE_OPTIONS in the pane command`.

**Done when:**
- `buildDaemonForegroundCommand` returns a command containing `--max-old-space-size=4096` with no key set and `--max-old-space-size=6144` with `daemon_heap_limit_mb: 6144`, as asserted by the foreground-command test.
- Both `newDetachedSession` and `respawnPane` pass the built command, and the four existing tests that assert the exact foreground command string are updated and pass.
- A daemon exceeding the cap leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and a non-zero exit for its pid, as asserted by the heap-abort test that starts a child with a 16 MB cap and an allocation loop.
- `supervisor.start` builds the command through `buildDaemonForegroundCommand(loadConfig(root))`, and an invalid `daemon_heap_limit_mb` makes it throw the validation message before any `tmux new-session` or `respawn-pane` call is made, as asserted by the invalid-config start test with a recording tmux runner.
- For each of `daemon_heap_limit_mb` values `0`, `-1`, `1.5`, and `"big"`, `supervisor.start` throws a message naming `daemon_heap_limit_mb` and the accepted range `[256, ∞)` and the recording tmux runner records zero calls, so no daemon is spawned, as asserted by the invalid-config start test.
- `docs/reference/configuration.md` documents `daemon_heap_limit_mb` in its key table with default `4096`, equal to `DEFAULT_DAEMON_HEAP_LIMIT_MB`, as asserted by the configuration-reference test in `daemon-tmux.test.ts`.

**Files:** src/conductor/src/engine/daemon-tmux.ts, src/conductor/src/engine/daemon-supervisor-cli.ts, src/conductor/test/engine/daemon-tmux.test.ts, docs/reference/configuration.md, src/conductor/test/engine/daemon-supervisor-cli.test.ts, src/conductor/test/engine/canonical-launcher.test.ts, src/conductor/test/engine/daemon-restart-broken-current.test.ts, src/conductor/test/acceptance/daemon-merged-config-967.acceptance.test.ts
**Dependencies:** Task 6

### Task 8: Add the exit-witness subverb that appends daemon_exited to its own ledger
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/daemon-exit-witness.test.ts`: `runExitWitness({ pid: 42, status: 137, root })` appends one `daemon_exited` line to `<root>/.daemon/exit-events.jsonl` with `pid: 42`, `code: null`, `signal: "SIGKILL"`, `at`; status 134 yields `code: 134`, `signal: "SIGABRT"`; status 0 yields `code: 0`, `signal: null`; `.daemon/events.jsonl` is never opened for writing (spy on the appender path); missing `--pid` or missing status exits non-zero with a usage string and writes nothing; an unwritable exit ledger writes the same JSON line to `.daemon/daemon.log` and returns non-zero.
2. Verify RED.
3. Implement `engine/daemon-exit-witness.ts` (status → code/signal via `128 + signo` mapping from `os.constants.signals`; single `appendFileSync` of one line under `PIPE_BUF`) and register `exit-witness` in `daemon-command.ts` `DAEMON_SUBVERBS` with an early return in `detectDaemonCommand`; dispatch it from `daemon-cli.ts`.
4. Verify GREEN; commit `feat(daemon): exit-witness subverb records daemon_exited`.

**Done when:**
- `runExitWitness` with status 137 appends one `daemon_exited` line to `.daemon/exit-events.jsonl` carrying `pid`, `code: null`, `signal: "SIGKILL"`, and `at`, and with status 134 carries `code: 134` and `signal: "SIGABRT"`, as asserted by the witness unit test.
- The witness never opens `.daemon/events.jsonl` for writing, as asserted by the appender spy in the witness unit test.
- Invoking the witness without `--pid` or without an exit status exits non-zero with a usage message and creates no file, as asserted by the argument test.
- With an unwritable `.daemon/exit-events.jsonl`, the witness writes the same record as one line to `.daemon/daemon.log` and exits non-zero, as asserted by the fallback test.
- `exit-witness` is listed in `DAEMON_SUBVERBS` and `ai-conductor daemon exit-witness --pid 1 --status 0` reaches `runExitWitness`, as asserted by the subverb dispatch test.

**Files:** src/conductor/src/engine/daemon-exit-witness.ts, src/conductor/src/engine/daemon-command.ts, src/conductor/src/daemon-cli.ts, src/conductor/test/engine/daemon-exit-witness.test.ts, src/conductor/test/engine/daemon-command.test.ts
**Dependencies:** Task 1

### Task 9: Make the pane foreground a witnessing wrapper around the single daemon child
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `buildDaemonForegroundCommand` produces a `sh -c` string that runs the quoted launcher `daemon --continuous` as its only command before `rc=$?` and then invokes the quoted launcher `daemon exit-witness --pid $! ...` (capture the child pid via `&` + `wait`), so the daemon is the shell's single child; both `newDetachedSession` and `respawnPane` use it; a real-tmux test on a fixture-owned private socket (`-L`) starts the wrapper around a stub daemon script, `SIGKILL`s the child, and asserts one `daemon_exited` with `signal: SIGKILL` in `.daemon/exit-events.jsonl`, none in `.daemon/events.jsonl`, and the pane still present; a second respawn while the first wrapper is mid-write leaves exactly one line per pid with every line parseable; clean-exit (code 0) and non-zero-exit (code 3) stub cases each assert exactly one `daemon_exited` record written before the wrapper exits; a bare run (`daemon --continuous` outside tmux) exits without creating `.daemon/exit-events.jsonl`.
2. Verify RED.
3. Implement the wrapper string in `daemon-tmux.ts` with `shellQuote` for every path; the bare-run path in `daemon-cli.ts` is untouched (the witness is only ever invoked by the wrapper).
4. Verify GREEN; commit `feat(daemon): pane foreground wraps the daemon with an exit witness`.

**Done when:**
- The built foreground command runs the launcher `daemon --continuous` as the shell's single child and invokes `daemon exit-witness` with that child's pid and exit status after it exits, for both `newDetachedSession` and `respawnPane`, as asserted by the foreground-command tests.
- On a fixture-owned private tmux socket, `SIGKILL` of the daemon child yields exactly one `daemon_exited` record with `signal: SIGKILL` and `code: null` in `.daemon/exit-events.jsonl`, zero such records in `.daemon/events.jsonl`, and the record is written before the wrapper exits, as asserted by the real-tmux test.
- On a fixture-owned private tmux socket, a daemon child exiting with code 0 yields exactly one `daemon_exited` record with `code: 0` and `signal: null` in `.daemon/exit-events.jsonl`, written before the wrapper exits, as asserted by the real-tmux clean-exit case.
- On a fixture-owned private tmux socket, a daemon child exiting with code 3 yields exactly one `daemon_exited` record with `code: 3` and `signal: null` in `.daemon/exit-events.jsonl`, written before the wrapper exits, as asserted by the real-tmux non-zero-exit case.
- A daemon exiting 134 after a heap abort yields a `daemon_exited` record with `code: 134` and `signal: SIGABRT`, as asserted by the real-tmux heap-abort case.
- A wrapped daemon launched with a 16 MB cap and an allocation loop leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and the witness appends one `daemon_exited` record for that daemon pid with a non-zero `code` or a non-null `signal`, as asserted by the real-tmux heap-abort case.
- Every `daemon_exited` record appended by the wrapper carries the daemon `pid`, a `code` or `signal`, and an ISO-8601 `at` timestamp, as asserted by the real-tmux test and the real-tmux heap-abort case.
- A respawn while an older wrapper is still writing leaves `.daemon/exit-events.jsonl` with exactly one line per exited pid and every line parseable, and the witness never opens `.daemon/events.jsonl`, as asserted by the overlapping-respawn test.
- A bare `daemon --continuous` run outside tmux exits without ever invoking `daemon exit-witness` and without creating `.daemon/exit-events.jsonl`, as asserted by the bare-run test.

**Files:** src/conductor/src/engine/daemon-tmux.ts, src/conductor/test/engine/daemon-tmux.test.ts, src/conductor/test/engine/daemon-exit-witness-tmux.test.ts
**Dependencies:** Task 7, Task 8

### Task 10: Read the exit ledger and the last memory sample, skipping malformed lines
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/daemon-ledger-readers.test.ts`: `readLastExit(root, pid)` returns the newest `daemon_exited` for that pid or `null` when none matches (an older record for a different pid is not returned); `readLastMemorySample(root)` returns the newest `daemon_memory_sample`; a file with one malformed line among valid ones still returns the valid newest record and reports `skipped: 1`; a missing file returns `null` with `skipped: 0`; an unreadable file returns `{ error }` rather than throwing.
2. Verify RED.
3. Implement `engine/daemon-ledger-readers.ts` with per-line JSON parsing that counts and skips unparseable lines (never the whole-ledger null of `parseLedger`, since these readers answer "latest" not "rollup").
4. Verify GREEN; commit `feat(daemon): readers for exit-events and last memory sample`.

**Done when:**
- `readLastExit(root, pid)` returns the newest `daemon_exited` whose `pid` matches and `null` when only records for other pids exist, as asserted by the reader test.
- `readLastMemorySample(root)` returns the newest `daemon_memory_sample` from `.daemon/events.jsonl`, as asserted by the reader test.
- One malformed line among valid ones is skipped and counted as `skipped: 1` while the valid newest record is still returned, and an unreadable file yields `{ error }` without throwing, as asserted by the malformed-line and unreadable tests.

**Files:** src/conductor/src/engine/daemon-ledger-readers.ts, src/conductor/test/engine/daemon-ledger-readers.test.ts
**Dependencies:** Task 1

### Task 11: Render the exit cause and last sample in daemon status
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/daemon-observe-cli.test.ts`: a `dead-pane` row with a matching `daemon_exited` renders `⚠ session-up/process-dead` followed by `killed by SIGKILL at <iso>` (or `exited <code> at <iso>`) on the same line; a dead pid with no matching record renders `exit cause unknown`; every row renders `mem <n> MB at <iso>` from the last sample when one exists; a healthy `running` row renders the sample and no exit cause; a ledger with one malformed line renders `(skipped 1 unparseable)` once.
2. Verify RED.
3. Wire `readLastExit`/`readLastMemorySample` into the status sweep in `daemon-observe-cli.ts` and extend the row renderer.
4. Verify GREEN; commit `feat(daemon): status shows exit cause and last memory sample`.

**Done when:**
- A `dead-pane` row whose dead pid has a matching `daemon_exited` renders the signal or exit code and the exit timestamp on the same line as `⚠ session-up/process-dead`, as asserted by the status render test.
- A row renders the most recent `daemon_memory_sample` as `mem <n> MB at <iso>`, as asserted by the status render test.
- A dead pid with no matching record renders `exit cause unknown` rather than an older pid's cause, as asserted by the stale-record test.
- One malformed exit-ledger line produces a single `(skipped 1 unparseable)` note and the row still renders the valid record, as asserted by the malformed-line render test.
- A healthy running daemon renders the last sample and no exit cause, as asserted by the healthy-row test.

**Files:** src/conductor/src/engine/daemon-observe-cli.ts, src/conductor/test/engine/daemon-observe-cli.test.ts
**Dependencies:** Task 10

### Task 12: ensureRunning names the prior death it reclaims from
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/daemon-lock.test.ts`: with a stale pidfile for dead pid 42 and a matching `daemon_exited`, `ensureRunning` logs `reclaiming lock from dead pid 42 (killed by SIGKILL at <iso>)` before the respawn log line; with no record it logs `reclaiming lock from dead pid 42 (exit cause unknown)` and still respawns; with an unreadable exit ledger it logs `(exit ledger unreadable: <err>)` and still respawns.
2. Verify RED.
3. Call `readLastExit` in the dead-pid branch of `ensureRunning` (before `reclaim`) and pass the summary to the `onReclaim` log line.
4. Verify GREEN; commit `feat(daemon): ensureRunning reports the prior exit cause on reclaim`.

**Done when:**
- With a dead pidfile owner and a matching `daemon_exited`, the `ensureRunning` reclaim log line contains the dead pid, the signal or exit code, and the exit timestamp, and is emitted before the respawn line, as asserted by the reclaim-report test.
- With no matching record the reclaim log line contains `exit cause unknown` and the respawn still proceeds, as asserted by the unknown-cause test.
- With an unreadable exit ledger the reclaim log line notes the ledger could not be read and the respawn still proceeds without throwing, as asserted by the unreadable-ledger test.

**Files:** src/conductor/src/engine/daemon-lock.ts, src/conductor/test/engine/daemon-lock.test.ts
**Dependencies:** Task 10

### Task 13: Prove a SIGKILLed feature resumes from committed task progress
**Story:** 7
**Type:** verification

**Steps:**
1. Write an acceptance test `test/acceptance/daemon-death-resume.acceptance.test.ts` that seeds a feature worktree with 18 commits carrying `Task: <n>` trailers, a `task-status.json` with rows 1–18 `completed`, a `conduct-state.json` with DECIDE steps passed, and a `.pipeline/events.jsonl`; runs the build-entry re-seed as a new dispatch would; and asserts the next task index is 19, rows 1–18 are byte-identical to before, `.pipeline/events.jsonl` and `conduct-state.json` retain their pre-kill content, and no DECIDE step is re-run.
2. Add cases: a task with a trailer whose `task-status.json` was lost is restored `completed` from the trailer over the `origin/main` merge-base range (the `[task-seed] restored` log line); a task with no commit and a stale `in_progress` row keeps that preserved row and is re-dispatched, never marked complete; a backlog scan over a worktree with no `.pipeline/HALT` returns the feature as dispatchable on the next poll.
3. These cases are expected to pass against existing engine behavior; if any fails, stop and file intake rather than changing the engine here.
4. Commit the test with `Task: 13` and, if no production change was needed, `Evidence: satisfied-by <sha of the re-seed implementation>`.

**Done when:**
- The resume acceptance test seeds 18 trailered commits and completed rows, re-seeds as a new dispatch, and asserts the next task index is 19 with rows 1–18 unchanged.
- The same test asserts `.pipeline/events.jsonl` and `conduct-state.json` retain their pre-kill content and no DECIDE step status changes on redispatch.
- A trailer-only completed task is restored as `completed` when `task-status.json` was lost, and an uncommitted mid-flight task keeps its preserved `in_progress` row and is re-dispatched rather than treated as complete, as asserted by the re-seed cases.
- A feature worktree with no `.pipeline/HALT` is returned as dispatchable by the backlog scan on the next poll, as asserted by the no-halt case.
- The same resume test asserts the redispatch resumes at `build` and records no `step_started` for any step ordered before `build`, so completed steps before `build` are not re-run.
- The no-halt case asserts the feature is re-dispatched on the next poll with no operator action: no HALT file is removed, no unpark or clear command is issued, and the dispatch call receives the feature.

**Files:** src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts
**Verify-only:** yes
**Dependencies:** none

## Task Dependency Graph

```text
Task 1 ─┬─▶ Task 2 ─┬─▶ Task 3
        │          └─▶ Task 4 ──▶ Task 5
        ├─▶ Task 8 ─┐
        └─▶ Task 10 ─┬─▶ Task 11
                     └─▶ Task 12
Task 6 ──▶ Task 7 ───┴─▶ Task 9   (Task 9 depends on Task 7 and Task 8)
Task 13 (independent, verify-only)
```

## Integration Points

- After Task 2: a running daemon writes `daemon_memory_sample` lines to `.daemon/events.jsonl`; the growth curve is readable live.
- After Task 9: killing the daemon inside its tmux pane produces a `daemon_exited` record; the full witness path is exercised end to end on a private socket.
- After Task 11 and Task 12: `daemon status` and `ensureRunning` name the cause of a prior death.

## Coverage Check

Every criterion is diff-local: each is asserted by a unit, real-tmux (private socket), or acceptance test whose fixtures and injected boundaries are inside this diff; no external deployment or later commit changes whether it holds.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a `--continuous` daemon driving a feature, when a `step_started` or `step_completed` event passes the root bus, then one `daemon_memory_sample` record is appended to `.daemon/events.jsonl` carrying `rss`, `heapUsed`, `heapTotal`, `external`, the feature slug, the step name, the boundary kind, and the daemon pid | 2 | "Driving `step_started` then `step_completed` through the root bus with `startDaemonMemorySampler` attached emits exactly two `daemon_memory_sample` records carrying `rss`, `heapUsed`, `heapTotal`, `external`, `slug`, `step`, `boundary`, `pid`, and `dispatchSeq`, as asserted by the sampler unit test." | diff-local |
| Story 1 happy: Given a run of 25 build dispatches, when the ledger is read, then the samples can be ordered by timestamp and by dispatch count so growth per dispatch and growth per hour are both computable from the ledger alone | 2 | "Each sample carries a timestamp and a monotonically increasing `dispatchSeq`, so ordering by time and by dispatch count is asserted from the recorded array alone." | diff-local |
| Story 1 negative: Given the daemon is idle with no feature in flight, when a poll tick passes, then no `daemon_memory_sample` is written on that tick | 3 | "Emitting a `daemon_backlog_snapshot` on the root bus produces no `daemon_memory_sample`, as asserted by the idle-tick test." | diff-local |
| Story 1 negative: Given a feature worktree's `.pipeline/events.jsonl`, when the daemon samples memory, then no `daemon_memory_sample` appears in the feature ledger because the record is daemon-origin, not feature-origin | 2 | "A feature `EventPersister` attached to a `ForwardingEventEmitter` over the same root bus records zero `daemon_memory_sample` lines while the daemon persister records both, as asserted by the two-ledger test." | diff-local |
| Story 1 negative: Given `.daemon/events.jsonl` is unwritable, when a sample is due, then the step proceeds unaffected and one `daemon.log` line names the write failure once rather than on every boundary | 3 | "With an appender that throws on every write, three step boundaries produce exactly one `daemon.log` line naming the ledger path and the error, and the `step_completed` listener registered after the sampler still runs, as asserted by the unwritable-ledger test." | diff-local |
| Story 2 happy: Given a configured RSS threshold in megabytes, when a memory sample first crosses it, then one heap snapshot is written under `.daemon/heap/` with a name carrying the timestamp and pid and a `daemon_heap_dump_written` record naming the path, the byte size, and the triggering `rss` is appended to `.daemon/events.jsonl` | 4 | "With threshold 100 MB, samples of 50 then 150 MB rss cause exactly one snapshot write under `.daemon/heap/` named by timestamp and pid and exactly one `daemon_heap_dump_written` record carrying `path`, `bytes`, `rss`, and `pid`, as asserted by the threshold test." | diff-local |
| Story 2 happy: Given no threshold configured, when samples are taken, then a documented default threshold applies and a crossing still produces exactly one dump | 4 | "With no threshold configured, `DEFAULT_HEAP_DUMP_THRESHOLD_MB` is applied and a crossing writes exactly one dump and one record, as asserted by the default-threshold test." | diff-local |
| Story 2 negative: Given a dump was already written in this daemon lifetime, when later samples also exceed the threshold, then no second snapshot is written and no second `daemon_heap_dump_written` record is appended | 5 | "After one dump, two further samples above threshold write no file and emit no second `daemon_heap_dump_written`, as asserted by the once-per-lifetime test." | diff-local |
| Story 2 negative: Given `.daemon/heap/` already holds the configured maximum number of snapshots, when a new dump is written, then the oldest snapshot is removed first so the count never exceeds the cap | 5 | "With retention 3 and three existing snapshots, a new dump leaves exactly three files in `.daemon/heap/` and the oldest by mtime is the one removed, as asserted by the retention test." | diff-local |
| Story 2 negative: Given the snapshot write fails midway, when the trigger returns, then no partial file remains at the target path, one `daemon.log` line names the failure, and the step in flight is unaffected | 5 | "A `writeHeapSnapshot` that throws leaves no file at the target path and no `.tmp` sibling, produces exactly one `daemon.log` line naming the failure, and does not throw into the step listener, as asserted by the failed-write test." | diff-local |
| Story 3 happy: Given no `daemon_heap_limit_mb` in config, when the supervisor builds the pane foreground command, then the launched daemon carries `--max-old-space-size` with the documented default value | 7 | "`buildDaemonForegroundCommand` returns a command containing `--max-old-space-size=4096` with no key set and `--max-old-space-size=6144` with `daemon_heap_limit_mb: 6144`, as asserted by the foreground-command test." | diff-local |
| Story 3 happy: Given `daemon_heap_limit_mb: 6144` in config, when the supervisor builds the pane foreground command, then the launched daemon carries `--max-old-space-size=6144` | 7 | "`buildDaemonForegroundCommand` returns a command containing `--max-old-space-size=4096` with no key set and `--max-old-space-size=6144` with `daemon_heap_limit_mb: 6144`, as asserted by the foreground-command test." | diff-local |
| Story 3 negative: Given `daemon_heap_limit_mb: 0` or a non-integer or a negative value, when config is validated, then validation fails with a message naming `daemon_heap_limit_mb` and the accepted range, and no daemon is spawned | 7 | "`supervisor.start` builds the command through `buildDaemonForegroundCommand(loadConfig(root))`, and an invalid `daemon_heap_limit_mb` makes it throw the validation message before any `tmux new-session` or `respawn-pane` call is made, as asserted by the invalid-config start test with a recording tmux runner." | diff-local |
| Story 3 negative: Given the daemon exceeds the cap, when V8 aborts, then `.daemon/daemon.log` contains the `JavaScript heap out of memory` fatal error text and the exit witness of Story 4 records a non-zero exit for that pid | 7, 9 | "A daemon exceeding the cap leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and a non-zero exit for its pid, as asserted by the heap-abort test that starts a child with a 16 MB cap and an allocation loop." | diff-local |
| Story 4 happy: Given a tmux-hosted daemon, when the daemon process exits with code 0, exits with a non-zero code, or is killed by `SIGKILL`, then the pane foreground appends exactly one `daemon_exited` record to `.daemon/exit-events.jsonl` carrying the daemon pid, the exit code or the signal name, and a timestamp, before the pane foreground itself exits | 9 | "On a fixture-owned private tmux socket, `SIGKILL` of the daemon child yields exactly one `daemon_exited` record with `signal: SIGKILL` and `code: null` in `.daemon/exit-events.jsonl`, zero such records in `.daemon/events.jsonl`, and the record is written before the wrapper exits, as asserted by the real-tmux test." | diff-local |
| Story 4 happy: Given the daemon is killed with `SIGKILL`, when the witness runs, then the record carries `signal: SIGKILL` and a null exit code | 9 | "On a fixture-owned private tmux socket, `SIGKILL` of the daemon child yields exactly one `daemon_exited` record with `signal: SIGKILL` and `code: null` in `.daemon/exit-events.jsonl`, zero such records in `.daemon/events.jsonl`, and the record is written before the wrapper exits, as asserted by the real-tmux test." | diff-local |
| Story 4 happy: Given the daemon exits with code 134 after a V8 heap abort, when the witness runs, then the record carries `code: 134` and `signal: SIGABRT` | 9 | "A daemon exiting 134 after a heap abort yields a `daemon_exited` record with `code: 134` and `signal: SIGABRT`, as asserted by the real-tmux heap-abort case." | diff-local |
| Story 4 negative: Given the witness cannot write `.daemon/exit-events.jsonl`, when the daemon exits, then the witness writes the same record as one line to `.daemon/daemon.log` and exits non-zero without hanging the pane | 8 | "With an unwritable `.daemon/exit-events.jsonl`, the witness writes the same record as one line to `.daemon/daemon.log` and exits non-zero, as asserted by the fallback test." | diff-local |
| Story 4 negative: Given a daemon restarted in place while an older wrapper is still writing its record, when both proceed, then `.daemon/events.jsonl` is never opened for writing by the witness and `.daemon/exit-events.jsonl` has exactly one line per exited pid with no torn line | 9 | "A respawn while an older wrapper is still writing leaves `.daemon/exit-events.jsonl` with exactly one line per exited pid and every line parseable, and the witness never opens `.daemon/events.jsonl`, as asserted by the overlapping-respawn test." | diff-local |
| Story 4 negative: Given the daemon is run bare with no tmux session, when it exits, then no witness runs and no `.daemon/exit-events.jsonl` is created by that exit | 9 | "A bare `daemon --continuous` run outside tmux exits without ever invoking `daemon exit-witness` and without creating `.daemon/exit-events.jsonl`, as asserted by the bare-run test." | diff-local |
| Story 4 negative: Given `ai-conductor daemon exit-witness` is invoked without `--pid` or without an exit status, when it parses arguments, then it exits non-zero with a usage message and writes nothing | 8 | "Invoking the witness without `--pid` or without an exit status exits non-zero with a usage message and creates no file, as asserted by the argument test." | diff-local |
| Story 5 happy: Given a session whose daemon pid is dead and `.daemon/exit-events.jsonl` holds a `daemon_exited` for that pid, when `daemon status` runs, then the `⚠ session-up/process-dead` row also renders the signal or exit code and the exit timestamp on the same row | 11 | "A `dead-pane` row whose dead pid has a matching `daemon_exited` renders the signal or exit code and the exit timestamp on the same line as `⚠ session-up/process-dead`, as asserted by the status render test." | diff-local |
| Story 5 happy: Given `.daemon/events.jsonl` holds `daemon_memory_sample` records, when `daemon status` runs, then the row renders the most recent sample's `rss` in megabytes and its timestamp | 11 | "A row renders the most recent `daemon_memory_sample` as `mem <n> MB at <iso>`, as asserted by the status render test." | diff-local |
| Story 5 negative: Given a dead pid with no `daemon_exited` record for it, when `daemon status` runs, then the row renders `exit cause unknown` rather than the cause of an older pid | 11 | "A dead pid with no matching record renders `exit cause unknown` rather than an older pid's cause, as asserted by the stale-record test." | diff-local |
| Story 5 negative: Given `.daemon/exit-events.jsonl` contains one malformed line among valid ones, when `daemon status` runs, then the valid records are still used and the malformed line is counted in a single `skipped N unparseable` note | 11 | "One malformed exit-ledger line produces a single `(skipped 1 unparseable)` note and the row still renders the valid record, as asserted by the malformed-line render test." | diff-local |
| Story 5 negative: Given a healthy running daemon, when `daemon status` runs, then no exit cause is rendered and the last memory sample is still shown | 11 | "A healthy running daemon renders the last sample and no exit cause, as asserted by the healthy-row test." | diff-local |
| Story 6 happy: Given a stale pidfile whose pid is dead and a matching `daemon_exited` record, when `ensureRunning` reclaims the lock and respawns, then its log line names the dead pid, the signal or exit code, and the exit timestamp before the respawn line | 12 | "With a dead pidfile owner and a matching `daemon_exited`, the `ensureRunning` reclaim log line contains the dead pid, the signal or exit code, and the exit timestamp, and is emitted before the respawn line, as asserted by the reclaim-report test." | diff-local |
| Story 6 negative: Given a stale pidfile whose pid has no `daemon_exited` record, when `ensureRunning` reclaims, then the log line names the dead pid with `exit cause unknown` and the respawn proceeds | 12 | "With no matching record the reclaim log line contains `exit cause unknown` and the respawn still proceeds, as asserted by the unknown-cause test." | diff-local |
| Story 6 negative: Given the exit ledger is unreadable, when `ensureRunning` reclaims, then the respawn still proceeds and the log line notes the ledger could not be read | 12 | "With an unreadable exit ledger the reclaim log line notes the ledger could not be read and the respawn still proceeds without throwing, as asserted by the unreadable-ledger test." | diff-local |
| Story 7 happy: Given a feature at task 19 of 25 with tasks 1–18 carrying `Task:` trailers on commits and `completed` rows in its worktree `task-status.json`, when the daemon is killed with `SIGKILL` and a new daemon dispatches the feature, then the build resumes at task 19 and tasks 1–18 are neither re-dispatched nor re-marked | 13 | "The resume acceptance test seeds 18 trailered commits and completed rows, re-seeds as a new dispatch, and asserts the next task index is 19 with rows 1–18 unchanged." | diff-local |
| Story 7 happy: Given the same interruption, when the new daemon dispatches, then the worktree `.pipeline/events.jsonl` and `conduct-state.json` from before the kill are intact and the completed steps before `build` are not re-run | 13 | "The same test asserts `.pipeline/events.jsonl` and `conduct-state.json` retain their pre-kill content and no DECIDE step status changes on redispatch." | diff-local |
| Story 7 negative: Given a completed task whose commit carries a `Task:` trailer but whose `task-status.json` row was lost, when the feature is re-dispatched, then the row is restored as `completed` from the trailer and the task is not redone | 13 | "A trailer-only completed task is restored as `completed` when `task-status.json` was lost, and an uncommitted mid-flight task keeps its preserved `in_progress` row and is re-dispatched rather than treated as complete, as asserted by the re-seed cases." | diff-local |
| Story 7 negative: Given the daemon was killed while task 19 was mid-flight with no commit, when the feature is re-dispatched, then task 19 keeps its preserved `in_progress` row and is dispatched again, and no half-finished state is treated as complete | 13 | "A trailer-only completed task is restored as `completed` when `task-status.json` was lost, and an uncommitted mid-flight task keeps its preserved `in_progress` row and is re-dispatched rather than treated as complete, as asserted by the re-seed cases." | diff-local |
| Story 7 negative: Given the feature had no `.pipeline/HALT` written because the daemon died abruptly, when the new daemon scans the backlog, then the feature is re-dispatched on the next poll without an operator clearing anything | 13 | "A feature worktree with no `.pipeline/HALT` is returned as dispatchable by the backlog scan on the next poll, as asserted by the no-halt case." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D1 | existing | none | `daemon-tmux.ts` `newDetachedSession` still hosts the daemon as the pane foreground inside `cc-daemon-<slug>-<pathhash>`; the wrapper keeps it there. |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D2 | no-change | none | Lifecycle verbs and the operator/automation authority split are untouched; `exit-witness` is invoked only by the pane wrapper, never by an operator verb. |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D3 | no-change | none | The supervisor port seam is unchanged; the wrapper is built inside the existing tmux adapter. |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D4 | existing | none | `daemon_concurrency` handling in `daemon-cli.ts` is untouched by this feature. |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D5 | no-change | none | The injected work-source seam is not touched; sampling reads the root bus, not the backlog. |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D6 | no-change | none | Session naming is unchanged; the wrapper targets the same `cc-daemon-<slug>-<pathhash>` session. |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D7 | existing | none | `buildDaemonForegroundCommand` still launches `daemon --continuous` with no `--max-idle-polls`; only `NODE_OPTIONS` and the witness wrap are added. |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D8 | task | task-7 | `buildDaemonForegroundCommand` returns a command containing `--max-old-space-size=4096` with no key set and `--max-old-space-size=6144` with `daemon_heap_limit_mb: 6144` |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D9 | task | task-9 | runs the launcher `daemon --continuous` as the shell's single child and invokes `daemon exit-witness` with that child's pid and exit status after it exits |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting#D10 | task | task-8, task-9 | The witness never opens `.daemon/events.jsonl` for writing |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks naming a mechanism
- [x] Dependencies are explicit and acyclic
- [x] Every citable decision D1–D10 of the amended hosting ADR has one obligation row

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/daemon-lock.ts:661,779 — make reclaim reporting non-optional: default onReclaim to a stderr writer (process.stderr.write(message + newline)) when the caller supplies none, keeping the call before the pidfile unlink/respawn; src/conductor/src/engine/engineer-cli.ts:1358 — pass { onReclaim: (m) => printErr(m) } so compose handoff prints the line; keep every existing Task 12 test in src/conductor/test/engine/daemon-lock.test.ts (injected onReclaim, ordering before respawn) and add one that calls ensureRunning with no onReclaim and asserts the reclaim line is written to stderr before launch runs
**Gate:** as-built
**Rationale:** daemon-lock.ts:779 emits the reclaim summary only via optional opts.onReclaim and the sole production caller engineer-cli.ts:1358 passes {}, so Task 12's 'ensureRunning reclaim log line' never reaches an operator; making the report non-optional delivers Task 12 without changing approved architecture. Sweep: ensureRunning has exactly one production caller (engineer-cli.ts:1358); daemon start/restart never call ensureRunning, so no other site needs wiring. Existing daemon-lock.test.ts reclaim tests (Task 12) are preserved unchanged.
**Parent task:** 12
**Governing clause:** Task 12
**Done when:**
- Task 12 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab2-1 is complete.

### Task rem-prd-audit-rem-s61-1: src/conductor/test/engine/engineer-cli.test.ts (or the existing compose-handoff test file) — with a dead pidfile owner pid 42 and a matching daemon_exited SIGKILL record in the exit ledger, drive the compose-handoff path with its real ensureRunning (launch stubbed) and assert stderr contains 'reclaiming lock from dead pid 42 (killed by SIGKILL at <iso>)' before the launch is invoked
**Gate:** prd-audit
**Rationale:** prd-audit S6.1 FIXABLE: daemon-lock.ts:773-779 builds the killed-by summary only for opts.onReclaim, and engineer-cli.ts:1358 wires none, so the production nudge is silent; same root cause and owner (Task 12) as AB-2, which supplies the sink — this task proves the SIGKILL line reaches the operator through the real compose-handoff caller.
**Criterion:** S6.1
**Parent task:** 12
**Done when:**
- S6.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s61-1 is complete.

### Task rem-prd-audit-rem-s62-1: src/conductor/test/engine/engineer-cli.test.ts (compose-handoff path) — with a dead pidfile owner and no matching daemon_exited record, assert stderr contains 'reclaiming lock from dead pid <n> (exit cause unknown)' and the stubbed launch is still invoked
**Gate:** prd-audit
**Rationale:** prd-audit S6.2 FIXABLE: the 'exit cause unknown' summary at daemon-lock.ts:641-643 is discarded in production because engineer-cli.ts:1358 passes {}; the respawn half is already delivered and tested (Task 12), so the fix is the AB-2 sink plus a production-path assertion.
**Criterion:** S6.2
**Parent task:** 12
**Done when:**
- S6.2 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s62-1 is complete.

### Task rem-prd-audit-rem-s63-1: src/conductor/test/engine/engineer-cli.test.ts (compose-handoff path) — with a dead pidfile owner and an unreadable exit ledger (e.g. exit-events.jsonl as a directory), assert stderr contains '(exit ledger unreadable:' , the stubbed launch is still invoked, and the handoff does not throw
**Gate:** prd-audit
**Rationale:** prd-audit S6.3 FIXABLE: the 'exit ledger unreadable' note at daemon-lock.ts:628-630 is discarded in production (engineer-cli.ts:1358); readLastExit already returns { error } without throwing (daemon-ledger-readers.ts:34-37), so only the sink (AB-2) and a production-path assertion are missing.
**Criterion:** S6.3
**Parent task:** 12
**Done when:**
- S6.3 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s63-1 is complete.

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/daemon-supervisor-cli.ts:241-249 — extract the foregroundCommand(repo) closure into an exported resolveDaemonForegroundCommand(repo, loadConfig) (same missing-config-allowed / invalid-config-throws rule) and use it at :314,:320,:342,:421 unchanged in behavior; src/conductor/src/engine/engineer/daemon-launch.ts:67 — call supervisor.start(project, await resolveDaemonForegroundCommand(project)); add a daemon-launch test asserting the command passed to start contains --max-old-space-size=6144 when the project config sets daemon_heap_limit_mb: 6144
**Gate:** as-built
**Rationale:** ADR D8 requires an operator-tunable heap cap, but engineer auto-launch (daemon-launch.ts:67 supervisor.start(project)) and session self-restart (index.ts:407 respawnPane(sessionName)) fall back to buildDaemonForegroundCommand() with empty config (daemon-tmux.ts:525,352); Task 7 already requires the command be built from loadConfig(root), so this is conforming wiring drift, not an architecture change. Sweep: all production start/restart/respawn callers enumerated — daemon-supervisor-cli.ts:314,320,342,421 already pass the configured command; brain-supervisor-cli.ts:98 is the brain session, not the daemon, and is excluded.
**Governing clause:** adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting D8
**Done when:**
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting D8 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab1-1 is complete.

### Task rem-as-built-rem-ab3-1: src/conductor/src/index.ts:395-408 — in buildDaemonModeOptions build the self-restart command as buildDaemonExitWitnessCommand(await resolveDaemonForegroundCommand(projectRoot), projectRoot) (injectable via deps) and pass it as respawnPane's cmd argument; extend the existing buildDaemonModeOptions test to invoke triggerSelfRestart and assert the recorded respawnPane cmd contains 'daemon exit-witness' and --max-old-space-size=6144 when config sets daemon_heap_limit_mb: 6144
**Gate:** as-built
**Rationale:** Task 9 requires respawnPane to use the exit-witness wrapper, but index.ts:395-408 buildDaemonModeOptions calls deps.respawnPane(sessionName) with the raw default buildDaemonForegroundCommand() (daemon-tmux.ts:352), so a self-restarted daemon's later death writes no daemon_exited; the same call is AB-1's self-restart half, fixed together. After this change respawnPane's raw default has no production caller; it is left for existing tests and named here rather than removed.
**Parent task:** 9
**Governing clause:** Task 9
**Done when:**
- Task 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab3-1 is complete.

### Task rem-as-built-rem-ab4-1: src/conductor/src/engine/daemon-ledger-readers.ts:26-54 — make readLastMatching select the matching record with the greatest timestamp (at for daemon_exited, ts for daemon_memory_sample; ties and unparseable timestamps fall back to later line order) instead of the last physical line, and add an exported readDaemonTimeline(root) that merges exit-events.jsonl and events.jsonl records by timestamp with a combined skipped count; in src/conductor/test/engine/daemon-ledger-readers.test.ts keep all Task 10 cases and add: an out-of-order exit ledger returns the newest-by-at record for the pid, and readDaemonTimeline interleaves records from both ledgers in timestamp order
**Gate:** as-built
**Rationale:** ADR D10 says readers (daemon status, ensureRunning) merge the sibling ledger by timestamp, but readLastMatching (daemon-ledger-readers.ts:26-54) keeps the last physical line and never compares at/ts; ordering reader results by record timestamp is determinable implementation drift inside Task 10's reader module and preserves D10's one-writer-per-ledger design, so it is build rather than architecture_review. Task 10's existing reader tests (newest-for-pid, malformed-line skip, unreadable { error }) are preserved; status (daemon-observe-cli.ts:562-581) and ensureRunning (daemon-lock.ts:769-779) keep their current call shapes and inherit the ordering.
**Governing clause:** adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting D10
**Done when:**
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting D10 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab4-1 is complete.

### Task rem-as-built-rem-ab1-timeline-1: src/conductor/src/engine/daemon-observe-cli.ts:563-581 — replace the status sweep's separate readLastExit/readLastMemorySample calls with one readDaemonTimeline(record.path) call and derive from its timestamp-ordered result the newest daemon_exited whose pid === row.pid (only when row.state === 'dead-pane' || row.liveness === 'stale', as today) and the newest daemon_memory_sample; set row.skippedUnparseable from the timeline's combined skipped count and, on { error }, leave lastExit/lastMemorySample unset without throwing; drop the now-unused readLastExit/readLastMemorySample imports from this file only (daemon-lock.ts keeps readLastExit). Keep every existing Task 11 render test in src/conductor/test/engine/daemon-observe-cli.test.ts passing unchanged (killed-by/exited line, exit cause unknown, mem <n> MB at <iso>, healthy row with no exit cause, single '(skipped 1 unparseable)' note), and add one status test with an exit ledger whose physically-last record for the dead pid is older by `at` than an earlier line, asserting the row renders the newer-by-timestamp cause, plus one test where both ledgers hold records and the row renders the exit cause and memory sample drawn from the single merged read
**Gate:** as-built
**Rationale:** readDaemonTimeline (daemon-ledger-readers.ts:128-146), required by completed task rem-as-built-rem-ab4-1 as D10's merged-by-timestamp reader, has no production caller while the daemon status sweep (daemon-observe-cli.ts:563-581) reads the two ledgers separately via readLastExit/readLastMemorySample; wiring status onto the merged timeline is conforming D10 implementation drift admitted by Task 11 (status renders exit cause + last sample) and rem-as-built-rem-ab4-1, so it is build, not architecture_review. Removal of the export was rejected because it would regress rem-as-built-rem-ab4-1's delivered export and its timeline test. Sweep: the only other production reader consumer is ensureRunning (daemon-lock.ts:775-776), which needs only one pid's last exit and is left on readLastExit (found-and-excluded: rewiring it is not required to close AB-1 and would widen the reclaim path covered by Task 12/rem-as-built-rem-ab2-1); readLastExit/readLastMemorySample remain in use there and in their Task 10 tests, so nothing is orphaned.
**Governing clause:** adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting D10
**Done when:**
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting D10 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab1-timeline-1 is complete.

### Task rem-as-built-rem-ab1-orphan-1: src/conductor/src/engine/daemon-ledger-readers.ts:124-126 — delete the unreachable exported readLastMemorySample (keep daemonMemorySample, readLastMatching, readLastExit, readDaemonTimeline and the DaemonMemorySample type, which all still have callers); in src/conductor/test/engine/daemon-ledger-readers.test.ts drop readLastMemorySample from the import and retarget each of its four assertions onto readDaemonTimeline so Task 10's memory-sample Done-when behaviour stays covered: 'returns the newest daemon memory sample' asserts the last daemon_memory_sample in the timeline is the newest one; 'skips malformed lines' asserts readDaemonTimeline returns the valid samples with skipped: 1; 'treats an absent ledger as empty' asserts readDaemonTimeline resolves { event: [], skipped: 0 } alongside the unchanged readLastExit null case; 'returns an error result' asserts readDaemonTimeline resolves { error } when .daemon/events.jsonl is a directory. Keep the readLastExit cases, the out-of-order case, the interleave case, and every Task 11 / rem-as-built-rem-ab1-timeline-1 status test in daemon-observe-cli.test.ts unchanged; confirm with a grep that no file under src/conductor/src or src/conductor/test still references readLastMemorySample
**Gate:** as-built
**Rationale:** readLastMemorySample (src/conductor/src/engine/daemon-ledger-readers.ts:124-126) lost its only production caller when rem-as-built-rem-ab1-timeline-1 moved daemon status onto readDaemonTimeline (daemon-observe-cli.ts:565-573); the reviewer confirms no ADR change is needed and recommends removing the obsolete export, which is conforming implementation drift admitted by Task 10 (Files: daemon-ledger-readers.ts + its test), so it is build. Re-adding a status caller is rejected because it would re-orphan readDaemonTimeline, the exact ping-pong of the previous lap. Coverage preserved: Task 10's Done-when behaviour for the memory sample (newest daemon_memory_sample from .daemon/events.jsonl, one malformed line skipped and counted as skipped: 1, unreadable file yields { error } without throwing) moves onto the surviving production reader readDaemonTimeline in the same task, and Task 11 / rem-as-built-rem-ab1-timeline-1 status tests keep the rendered 'mem <n> MB at <iso>' behaviour; readLastExit's Task 10 cases stay unchanged. Sweep: removal orphans nothing else — daemonMemorySample is still used by readTimelineLedger (:88), readLastMatching and DaemonMemorySample are still used by readLastExit and daemon-observe-cli.ts:157; readLastExit keeps its production caller in daemon-lock.ts ensureRunning (Task 12); no docs, skills, or other src reference the symbol (the plan text under .docs/plans is a sealed artifact and is left as-is).
**Parent task:** 10
**Governing clause:** Task 10
**Done when:**
- Task 10 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab1-orphan-1 is complete.
