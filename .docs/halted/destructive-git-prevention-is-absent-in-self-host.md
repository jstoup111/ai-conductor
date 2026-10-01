# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-01T01:29:29.471Z
Slug: destructive-git-prevention-is-absent-in-self-host
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-prevention-is-absent-in-self-host
Head SHA: 7b7f539449073b0effb088025e0e079f15503158
Halted at: 2026-10-01T01:27:20.829Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 11 negative: **Given** the default (non-smoke) test suite, **When** it runs, **Then** no live provider session is started.
Task ids: 16
Done when checks: `git-guard-claude.smoke.test.ts` declares `credentialed:claude` and, with Claude credentials and binary present, asserts a real Claude session's `command -v git` output equals the prepared worktree's `.pipeline/bin/git` and its `git clean -f` output contains the guard's refusal text. | `git-guard-codex.smoke.test.ts` declares `credentialed:codex` and makes the same two assertions against a real Codex session. | In advisory mode a guard smoke file lacking its credential or binary reports skipped naming the missing prerequisite, and in gate mode it reports a non-gating skip naming the missing credential, as asserted by the smoke-runner tests. | The smoke-entry-point test lists both files with their capabilities and confirms the default `vitest` configuration excludes them.
Missing assertion: The check only requires excluding the two guard smoke files from default Vitest; it does not explicitly require that no other live provider session can start.
```
