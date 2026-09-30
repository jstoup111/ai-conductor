# Halt record

Status: halted
Slug: destructive-git-prevention-is-absent-in-self-host
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-prevention-is-absent-in-self-host
Head SHA: 763221e6659c5e35fa8eb9940f3d71542fb73c8a
Halted at: 2026-09-30T01:37:29.982Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 7 negative: **Given** an engine-prepared worktree whose guard cannot be rewritten (for example its directory is read-only), **When** a dispatch into it is prepared, **Then** the provider is not launched and the dispatch fails with a message naming the guard path.
Task ids: 8, 9
Done when checks: `ClaudeProvider` invocation for non-self-host and self-host dispatches into a prepared worktree, with `HOME` pointing at an empty directory, passes a child env whose `PATH` begins with that worktree's `.pipeline/bin`, as asserted by the two Claude env-cell tests on the captured spawn options. | A Claude dispatch whose `cwd` is an unprepared directory passes a child `PATH` equal to the inherited one, and `process.env.PATH` is identical before and after every guarded Claude dispatch, as asserted by the unprepared and no-bleed tests. | A guarded Claude dispatch's child env still omits `CLAUDE_CODE_OAUTH_TOKEN` wherever it is stripped today, and the contained-review env still equals the allowlisted set with only `PATH` changed, as asserted by the existing credential and review-allowlist tests extended with the guarded `PATH`. | When `ensureGitGuardForDispatch` throws, `ClaudeProvider.invoke` resolves a failed result whose output names the guard path and the recorded spawn function is never called. | A Claude dispatch into a prepared worktree whose guard was deleted, edited, or chmod 0644 finds, at the moment the recorded spawn function is called, `.pipeline/bin/git` already rewritten to `GIT_GUARD_SCRIPT` with mode 0755, and that same spawn receives a child `PATH` beginning with the worktree's `.pipeline/bin`, as asserted by the repair-before-launch tests. | `CodexProvider` invocation for non-self-host and self-host dispatches into a prepared worktree, with `HOME` pointing at an empty directory, passes a child env whose `PATH` begins with that worktree's `.pipeline/bin`, as asserted by the two Codex env-cell tests. | The Codex argv for a guarded dispatch contains `--config` with `shell_environment_policy.set.PATH` equal to the guarded child `PATH`, and an unguarded dispatch's argv contains no `shell_environment_policy.set.PATH`, as asserted by the argv tests. | When `ensureGitGuardForDispatch` throws, `CodexProvider.invoke` resolves a failed result naming the guard path without calling the spawn function, and `process.env.PATH` is unchanged after every Codex dispatch. | A Codex dispatch whose `cwd` is an unprepared directory passes an env overlay with no `PATH` override, and a guarded Codex review-profile env still equals the allowlisted set with only `PATH` changed and no credential variable added, as asserted by the unprepared and review-allowlist tests.
Missing assertion: The cited provider checks cover the outcome when ensureGitGuardForDispatch throws, but do not explicitly require that an unrewriteable guard directory causes that throw during provider dispatch preparation.
```
