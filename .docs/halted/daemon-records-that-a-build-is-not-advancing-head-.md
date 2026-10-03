# Halt record

Status: halted
Slug: daemon-records-that-a-build-is-not-advancing-head-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-daemon-records-that-a-build-is-not-advancing-head-
Head SHA: 512719be74d720177cbd705f32922cf5591f5d03
Halted at: 2026-10-03T12:27:22.879Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 6 negative: Given a Claude or Codex invocation ended by its abort signal, when its result is classified, then it is reported as neither rate-limited, authentication-failed nor session-expired, so it never takes a recovery path that leaves the retry budget untouched.
Task ids: 11, 12
Done when checks: A Claude invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false` without waiting for the session to finish, as asserted in `test/execution/claude-provider-abort.test.ts`. | A Claude invocation whose `abortSignal` is already aborted spawns no subprocess. | An aborted Claude result carries no `rateLimited`, `authFailure` or `sessionExpired` signal. | A Claude invocation without `abortSignal` passes no `cancelSignal` option to its subprocess. | With a real child process that ignores SIGTERM, aborting a Claude invocation still terminates the child by SIGKILL after the execa grace period and the invocation resolves `success: false`, as asserted in `test/execution/claude-provider-abort.test.ts`. | A Codex invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false`, as asserted in `test/execution/codex-provider-abort.test.ts`. | A Codex invocation whose `abortSignal` is already aborted spawns no subprocess. | An aborted Codex result carries no `rateLimited`, `authFailure` or `sessionExpired` signal. | A Codex invocation without `abortSignal` passes no `cancelSignal` option to its subprocess. | With a real child process that ignores SIGTERM, aborting a Codex invocation still terminates the child by SIGKILL after the execa grace period and the invocation resolves `success: false`, as asserted in `test/execution/codex-provider-abort.test.ts`.
Missing assertion: so it never takes a recovery path that leaves the retry budget untouched

Criterion: Story 6 negative: Given an invocation that receives no abort signal, when it runs, then Claude and Codex behave exactly as before, with no cancellation option forwarded.
Task ids: 11, 12
Done when checks: A Claude invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false` without waiting for the session to finish, as asserted in `test/execution/claude-provider-abort.test.ts`. | A Claude invocation whose `abortSignal` is already aborted spawns no subprocess. | An aborted Claude result carries no `rateLimited`, `authFailure` or `sessionExpired` signal. | A Claude invocation without `abortSignal` passes no `cancelSignal` option to its subprocess. | With a real child process that ignores SIGTERM, aborting a Claude invocation still terminates the child by SIGKILL after the execa grace period and the invocation resolves `success: false`, as asserted in `test/execution/claude-provider-abort.test.ts`. | A Codex invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false`, as asserted in `test/execution/codex-provider-abort.test.ts`. | A Codex invocation whose `abortSignal` is already aborted spawns no subprocess. | An aborted Codex result carries no `rateLimited`, `authFailure` or `sessionExpired` signal. | A Codex invocation without `abortSignal` passes no `cancelSignal` option to its subprocess. | With a real child process that ignores SIGTERM, aborting a Codex invocation still terminates the child by SIGKILL after the execa grace period and the invocation resolves `success: false`, as asserted in `test/execution/codex-provider-abort.test.ts`.
Missing assertion: Claude and Codex behave exactly as before
```
