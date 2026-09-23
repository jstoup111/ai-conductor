# Halt record

Status: halted
Slug: continuous-daemon-grows-to-4-2-gb-in-three-hours-a
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-continuous-daemon-grows-to-4-2-gb-in-three-hours-a
Head SHA: 0e32ca48208354576858f6f55f42b2336f746513
Halted at: 2026-09-23T07:27:47.662Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 3 happy: Given no `daemon_heap_limit_mb` in config, when the supervisor builds the pane foreground command, then the launched daemon carries `--max-old-space-size` with the documented default value
Task ids: 7
Done when checks: `buildDaemonForegroundCommand` returns a command containing `--max-old-space-size=4096` with no key set and `--max-old-space-size=6144` with `daemon_heap_limit_mb: 6144`, as asserted by the foreground-command test. | Both `newDetachedSession` and `respawnPane` pass the built command, and the four existing tests that assert the exact foreground command string are updated and pass. | A daemon exceeding the cap leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and a non-zero exit for its pid, as asserted by the heap-abort test that starts a child with a 16 MB cap and an allocation loop. | `supervisor.start` builds the command through `buildDaemonForegroundCommand(loadConfig(root))`, and an invalid `daemon_heap_limit_mb` makes it throw the validation message before any `tmux new-session` or `respawn-pane` call is made, as asserted by the invalid-config start test with a recording tmux runner. | For each of `daemon_heap_limit_mb` values `0`, `-1`, `1.5`, and `"big"`, `supervisor.start` throws a message naming `daemon_heap_limit_mb` and the accepted range `[256, ∞)` and the recording tmux runner records zero calls, so no daemon is spawned, as asserted by the invalid-config start test.
Missing assertion: No cited check requires that the 4096 MB default value is documented.

Criterion: Story 4 happy: Given a tmux-hosted daemon, when the daemon process exits for any reason, then the pane foreground appends one `daemon_exited` record to `.daemon/exit-events.jsonl` carrying the daemon pid, the exit code or the signal name, and a timestamp, before the pane foreground itself exits
Task ids: 9
Done when checks: The built foreground command runs the launcher `daemon --continuous` as the shell's single child and invokes `daemon exit-witness` with that child's pid and exit status after it exits, for both `newDetachedSession` and `respawnPane`, as asserted by the foreground-command tests. | On a fixture-owned private tmux socket, `SIGKILL` of the daemon child yields exactly one `daemon_exited` record with `signal: SIGKILL` and `code: null` in `.daemon/exit-events.jsonl`, zero such records in `.daemon/events.jsonl`, and the record is written before the wrapper exits, as asserted by the real-tmux test. | A daemon exiting 134 after a heap abort yields a `daemon_exited` record with `code: 134` and `signal: SIGABRT`, as asserted by the real-tmux heap-abort case. | A wrapped daemon launched with a 16 MB cap and an allocation loop leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and the witness appends one `daemon_exited` record for that daemon pid with a non-zero `code` or a non-null `signal`, as asserted by the real-tmux heap-abort case. | Every `daemon_exited` record appended by the wrapper carries the daemon `pid`, a `code` or `signal`, and an ISO-8601 `at` timestamp, as asserted by the real-tmux test and the real-tmux heap-abort case. | A respawn while an older wrapper is still writing leaves `.daemon/exit-events.jsonl` with exactly one line per exited pid and every line parseable, and the witness never opens `.daemon/events.jsonl`, as asserted by the overlapping-respawn test. | A bare `daemon --continuous` run outside tmux exits without creating `.daemon/exit-events.jsonl`, as asserted by the bare-run test.
Missing assertion: No cited check requires exactly one exit record for every possible daemon exit reason before the pane foreground exits.
```
