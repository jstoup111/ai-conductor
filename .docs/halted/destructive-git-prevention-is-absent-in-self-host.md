# Halt record

Status: halted
Slug: destructive-git-prevention-is-absent-in-self-host
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-destructive-git-prevention-is-absent-in-self-host
Head SHA: b766f5f975fa914e8bd434582992babf17aecea9
Halted at: 2026-09-28T11:21:51.505Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 3 negative: **Given** a guarded agent shell, **When** the agent runs `git clean -n` or `git clean --dry-run`, **Then** the command reaches the real git and lists what would be removed without removing anything.
Task ids: 3
Done when checks: In a scratch repository with an untracked file, `clean -f`, `clean -fd`, `clean -xdf` and `clean --force` through the guard exit non-zero and the untracked file still exists. | With an uncommitted tracked edit, `checkout -- «file»`, `checkout HEAD -- «file»`, `checkout -- .`, `restore «file»` and `restore .` through the guard exit non-zero and the edit is byte-identical afterwards. | With a merge stopped on a conflicted file, `checkout --theirs -- «file»`, `checkout --ours -- «file»` and `restore --theirs «file»` reach the real git and the file's content equals the chosen side. | `restore --staged «file»`, `checkout «branch»` with no pathspec, `clean -n` and `clean --dry-run` reach the real git with unchanged argv, and `clean -n` prints the untracked path while the file still exists.
Missing assertion: The cited check requires only `git clean -n` to print the untracked path; it does not explicitly require `git clean --dry-run` to list what it would remove.

Criterion: Story 4 negative: **Given** a guarded agent shell in a sibling worktree or the root checkout of the feature repository, **When** the agent runs `git clean -f`, **Then** the command is refused.
Task ids: 4
Done when checks: In a temporary repository whose git common dir differs from the recorded feature common dir, `reset --hard`, `clean -fd` and `branch -D` through the guard reach the real git and take effect. | `status`, `log -1`, `diff`, `commit` and `rebase --continue` through the guard produce stdout, stderr, exit status and resulting `HEAD` byte-identical to the real git run directly from the same repository state, as asserted by the pass-through equivalence test. | From a temporary repository, `-C «feature-worktree» reset --hard` and `reset --hard` with `GIT_DIR` set to the feature repository's git dir exit non-zero, because the guard resolves the target's common dir via the real git's `rev-parse --git-common-dir` honouring `-C`, `--git-dir` and `GIT_DIR`. | `clean -f` in a sibling worktree of the feature repository, and a non-shell alias expanding to `reset --hard` in the feature worktree, both exit non-zero, as asserted by the sibling-worktree and alias tests.
Missing assertion: Refusal of `git clean -f` from the feature repository's root checkout is not explicitly required; only the sibling-worktree case is asserted.
```
