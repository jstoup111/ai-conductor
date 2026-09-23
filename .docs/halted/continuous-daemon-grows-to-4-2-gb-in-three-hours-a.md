# Halt record

Status: halted
Slug: continuous-daemon-grows-to-4-2-gb-in-three-hours-a
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-continuous-daemon-grows-to-4-2-gb-in-three-hours-a
Head SHA: 44119e49b53f3dcd3a6d80f84a407b26c9ea0626
Halted at: 2026-09-23T02:46:52.696Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 2 happy: Given no threshold configured, when samples are taken, then a documented default threshold applies and a crossing still produces exactly one dump
Task ids: 4
Done when checks: With threshold 100 MB, samples of 50 then 150 MB rss cause exactly one snapshot write under `.daemon/heap/` named by timestamp and pid and exactly one `daemon_heap_dump_written` record carrying `path`, `bytes`, `rss`, and `pid`, as asserted by the threshold test. | With no threshold configured, `DEFAULT_HEAP_DUMP_THRESHOLD_MB` is applied and a crossing writes exactly one dump and one record, as asserted by the default-threshold test.
Missing assertion: The cited checks require a default threshold to be applied and to produce one dump on crossing, but do not require that default threshold to be documented.

Criterion: Story 3 negative: Given `daemon_heap_limit_mb: 0` or a non-integer or a negative value, when config is validated, then validation fails with a message naming `daemon_heap_limit_mb` and the accepted range, and no daemon is spawned
Task ids: 7
Done when checks: `buildDaemonForegroundCommand` returns a command containing `--max-old-space-size=4096` with no key set and `--max-old-space-size=6144` with `daemon_heap_limit_mb: 6144`, as asserted by the foreground-command test. | Both `newDetachedSession` and `respawnPane` pass the built command, and the four existing tests that assert the exact foreground command string are updated and pass. | A daemon exceeding the cap leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and a non-zero exit for its pid, as asserted by the heap-abort test that starts a child with a 16 MB cap and an allocation loop. | `supervisor.start` builds the command through `buildDaemonForegroundCommand(loadConfig(root))`, and an invalid `daemon_heap_limit_mb` makes it throw the validation message before any `tmux new-session` or `respawn-pane` call is made, as asserted by the invalid-config start test with a recording tmux runner.
Missing assertion: The cited checks do not explicitly require rejection of zero, negative, and non-integer values with a message naming daemon_heap_limit_mb and its accepted range.

Criterion: Story 3 negative: Given the daemon exceeds the cap, when V8 aborts, then `.daemon/daemon.log` contains the `JavaScript heap out of memory` fatal error text and the exit witness of Story 4 records a non-zero exit for that pid
Task ids: 7
Done when checks: `buildDaemonForegroundCommand` returns a command containing `--max-old-space-size=4096` with no key set and `--max-old-space-size=6144` with `daemon_heap_limit_mb: 6144`, as asserted by the foreground-command test. | Both `newDetachedSession` and `respawnPane` pass the built command, and the four existing tests that assert the exact foreground command string are updated and pass. | A daemon exceeding the cap leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and a non-zero exit for its pid, as asserted by the heap-abort test that starts a child with a 16 MB cap and an allocation loop. | `supervisor.start` builds the command through `buildDaemonForegroundCommand(loadConfig(root))`, and an invalid `daemon_heap_limit_mb` makes it throw the validation message before any `tmux new-session` or `respawn-pane` call is made, as asserted by the invalid-config start test with a recording tmux runner.
Missing assertion: The cited heap-abort check requires fatal log text and a non-zero exit, but does not require Story 4's exit witness to record that non-zero exit for the pid.

Criterion: Story 4 happy: Given a tmux-hosted daemon, when the daemon process exits for any reason, then the pane foreground appends one `daemon_exited` record to `.daemon/exit-events.jsonl` carrying the daemon pid, the exit code or the signal name, and a timestamp, before the pane foreground itself exits
Task ids: 9
Done when checks: The built foreground command runs the launcher `daemon --continuous` as the shell's single child and invokes `daemon exit-witness` with that child's pid and exit status after it exits, for both `newDetachedSession` and `respawnPane`, as asserted by the foreground-command tests. | On a fixture-owned private tmux socket, `SIGKILL` of the daemon child yields exactly one `daemon_exited` record with `signal: SIGKILL` and `code: null` in `.daemon/exit-events.jsonl`, zero such records in `.daemon/events.jsonl`, and the record is written before the wrapper exits, as asserted by the real-tmux test. | A daemon exiting 134 after a heap abort yields a `daemon_exited` record with `code: 134` and `signal: SIGABRT`, as asserted by the real-tmux heap-abort case. | A respawn while an older wrapper is still writing leaves `.daemon/exit-events.jsonl` with exactly one line per exited pid and every line parseable, and the witness never opens `.daemon/events.jsonl`, as asserted by the overlapping-respawn test. | A bare `daemon --continuous` run outside tmux exits without creating `.daemon/exit-events.jsonl`, as asserted by the bare-run test.
Missing assertion: The cited checks do not explicitly require every exit record to carry a timestamp.

Criterion: Story 7 happy: Given the same interruption, when the new daemon dispatches, then the worktree `.pipeline/events.jsonl` and `conduct-state.json` from before the kill are intact and the completed steps before `build` are not re-run
Task ids: 13
Done when checks: The resume acceptance test seeds 18 trailered commits and completed rows, re-seeds as a new dispatch, and asserts the next task index is 19 with rows 1–18 unchanged. | The same test asserts `.pipeline/events.jsonl` and `conduct-state.json` retain their pre-kill content and no DECIDE step status changes on redispatch. | A trailer-only completed task is restored as `completed` and an uncommitted mid-flight task is reset to `pending`, as asserted by the re-seed cases. | A feature worktree with no `.pipeline/HALT` is returned as dispatchable by the backlog scan on the next poll, as asserted by the no-halt case.
Missing assertion: The cited checks require retained pre-kill files and unchanged DECIDE step statuses, but do not explicitly require that completed steps before build are not re-run.

Criterion: Story 7 negative: Given the feature had no `.pipeline/HALT` written because the daemon died abruptly, when the new daemon scans the backlog, then the feature is re-dispatched on the next poll without an operator clearing anything
Task ids: 13
Done when checks: The resume acceptance test seeds 18 trailered commits and completed rows, re-seeds as a new dispatch, and asserts the next task index is 19 with rows 1–18 unchanged. | The same test asserts `.pipeline/events.jsonl` and `conduct-state.json` retain their pre-kill content and no DECIDE step status changes on redispatch. | A trailer-only completed task is restored as `completed` and an uncommitted mid-flight task is reset to `pending`, as asserted by the re-seed cases. | A feature worktree with no `.pipeline/HALT` is returned as dispatchable by the backlog scan on the next poll, as asserted by the no-halt case.
Missing assertion: The checks require the no-HALT worktree to be dispatchable on the next poll, but do not explicitly require that it is actually re-dispatched without operator action.
```
