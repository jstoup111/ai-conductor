# Halt record

Status: halted
Slug: destructive-git-prevention-is-absent-in-self-host
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-prevention-is-absent-in-self-host
Head SHA: 8d353409793de40347fd5995d3d78df6c8c4c95d
Halted at: 2026-09-29T23:11:07.593Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 7 happy: **Given** an engine-prepared worktree whose guard file was deleted, edited, or had its execute bit removed, **When** the next dispatch into that worktree is prepared, **Then** the guard is rewritten from the embedded asset with mode 0755 before the provider launches, and the dispatch proceeds guarded.
Task ids: 7, 8, 19
Done when checks: `ensureGitGuardForDispatch` on a prepared worktree whose guard was deleted, edited, or chmod 0644 rewrites it to `GIT_GUARD_SCRIPT` with mode 0755 and returns the worktree's `.pipeline/bin` path, as asserted by the three repair tests. | `ensureGitGuardForDispatch` on a prepared worktree whose `.pipeline/bin` directory is read-only and whose guard is missing throws an error naming the guard path, as asserted by the unrewritable-guard test. | `ensureGitGuardForDispatch` returns null and writes nothing for a directory whose worktree-scoped `core.hooksPath` is not its own `.pipeline/git-hooks`, as asserted by the unprepared-directory test. | `ClaudeProvider` invocation for non-self-host and self-host dispatches into a prepared worktree, with `HOME` pointing at an empty directory, passes a child env whose `PATH` begins with that worktree's `.pipeline/bin`, as asserted by the two Claude env-cell tests on the captured spawn options. | A Claude dispatch whose `cwd` is an unprepared directory passes a child `PATH` equal to the inherited one, and `process.env.PATH` is identical before and after every guarded Claude dispatch, as asserted by the unprepared and no-bleed tests. | A guarded Claude dispatch's child env still omits `CLAUDE_CODE_OAUTH_TOKEN` wherever it is stripped today, and the contained-review env still equals the allowlisted set with only `PATH` changed, as asserted by the existing credential and review-allowlist tests extended with the guarded `PATH`. | When `ensureGitGuardForDispatch` throws, `ClaudeProvider.invoke` resolves a failed result whose output names the guard path and the recorded spawn function is never called. | `ensureGitGuardForDispatch` on a worktree whose worktree-scoped `core.hooksPath` names its own `.pipeline/git-hooks` while that directory is missing returns the worktree's `.pipeline/bin` path with the guard rewritten to mode 0755, as asserted by the missing-hooks-directory test. | A Claude dispatch and a Codex dispatch into that worktree each reach the recorded spawn with a child `PATH` beginning with the worktree's `.pipeline/bin`, as asserted by the adapter missing-hooks-directory tests.
Missing assertion: No cited check requires that repair of a deleted, edited, or non-executable guard occurs before a provider launch and that that same dispatch proceeds guarded.

Criterion: Story 7 negative: **Given** a daemon whose own `PATH` contains a `.pipeline/bin` directory, spelled with or without a trailing slash, **When** the guard is written, **Then** the real-git path recorded in the sidecar data file does not point into any `.pipeline/bin` directory.
Task ids: 6, 18
Done when checks: After `prepareWorktree`, `.pipeline/bin/git` is a regular file (lstat not a symlink) with mode 0755 whose content equals `GIT_GUARD_SCRIPT`, and `.pipeline/git-guard/real-git` names an absolute executable git that is not under any `.pipeline/bin` directory, as asserted by the worktree-prepare guard test. | `.pipeline/git-guard/common-dir` equals the prepared worktree's `git rev-parse --path-format=absolute --git-common-dir`, as asserted by the same test. | `resolveRealGit` given a `PATH` whose first entry is a `.pipeline/bin` directory containing a `git` returns the next `git` on that `PATH`, as asserted by the resolution test. | When the guard write fails because `.pipeline/bin` is occupied by a regular file, `prepareWorktree` rejects with an error naming `.pipeline/bin/git` and logs no `git hooks: skipped` line, as asserted by the provisioning-failure test. | `resolveRealGit` given a `PATH` whose first entry is a `.pipeline/bin` directory holding the guard, spelled with a trailing slash, with a `.` segment, or through a symlinked directory, returns the next real `git` on that `PATH`, as asserted by the guard-directory spelling tests. | `ensureGitGuardForDispatch` on a prepared worktree whose `.pipeline/git-guard/real-git` sidecar names that worktree's own `.pipeline/bin/git` rewrites the sidecar to a real git outside every `.pipeline/bin` directory before returning, as asserted by the self-resolved sidecar repair test.
Missing assertion: No cited check requires guard provisioning to record a safe real-git sidecar when the daemon PATH contains a .pipeline/bin entry using each specified spelling.
```
