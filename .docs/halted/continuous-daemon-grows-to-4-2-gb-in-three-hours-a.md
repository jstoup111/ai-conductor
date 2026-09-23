# Halt record

Status: halted
Slug: continuous-daemon-grows-to-4-2-gb-in-three-hours-a
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-continuous-daemon-grows-to-4-2-gb-in-three-hours-a
Head SHA: e76027a8f4356758fbf3e5542fbd61f51776a5da
Halted at: 2026-09-23T12:43:13.281Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 4 negative: Given the daemon is run bare with no tmux session, when it exits, then no witness runs and no `.daemon/exit-events.jsonl` is created by that exit
Task ids: 9
Done when checks: The built foreground command runs the launcher `daemon --continuous` as the shell's single child and invokes `daemon exit-witness` with that child's pid and exit status after it exits, for both `newDetachedSession` and `respawnPane`, as asserted by the foreground-command tests. | On a fixture-owned private tmux socket, `SIGKILL` of the daemon child yields exactly one `daemon_exited` record with `signal: SIGKILL` and `code: null` in `.daemon/exit-events.jsonl`, zero such records in `.daemon/events.jsonl`, and the record is written before the wrapper exits, as asserted by the real-tmux test. | On a fixture-owned private tmux socket, a daemon child exiting with code 0 yields exactly one `daemon_exited` record with `code: 0` and `signal: null` in `.daemon/exit-events.jsonl`, written before the wrapper exits, as asserted by the real-tmux clean-exit case. | On a fixture-owned private tmux socket, a daemon child exiting with code 3 yields exactly one `daemon_exited` record with `code: 3` and `signal: null` in `.daemon/exit-events.jsonl`, written before the wrapper exits, as asserted by the real-tmux non-zero-exit case. | A daemon exiting 134 after a heap abort yields a `daemon_exited` record with `code: 134` and `signal: SIGABRT`, as asserted by the real-tmux heap-abort case. | A wrapped daemon launched with a 16 MB cap and an allocation loop leaves the `JavaScript heap out of memory` fatal text in `.daemon/daemon.log` and the witness appends one `daemon_exited` record for that daemon pid with a non-zero `code` or a non-null `signal`, as asserted by the real-tmux heap-abort case. | Every `daemon_exited` record appended by the wrapper carries the daemon `pid`, a `code` or `signal`, and an ISO-8601 `at` timestamp, as asserted by the real-tmux test and the real-tmux heap-abort case. | A respawn while an older wrapper is still writing leaves `.daemon/exit-events.jsonl` with exactly one line per exited pid and every line parseable, and the witness never opens `.daemon/events.jsonl`, as asserted by the overlapping-respawn test. | A bare `daemon --continuous` run outside tmux exits without creating `.daemon/exit-events.jsonl`, as asserted by the bare-run test.
Missing assertion: The cited bare-run check requires no exit-events file, but does not explicitly require that no witness runs.
```
