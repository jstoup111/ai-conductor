# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-11-18T02:22:35.534Z
Slug: pi-upstream-model-not-found-under-an-explicit-prov
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-pi-upstream-model-not-found-under-an-explicit-prov
Head SHA: 94f5402f4ad28500d6e862e38e5954aa4cef7492
Halted at: 2026-11-15T18:12:20.693Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
rebase did not start — parked for human recovery
error: '.memory/gotchas/daemon-exclusive-execution-deps.md' is beyond a symbolic link
fatal: Unable to process path .memory/gotchas/daemon-exclusive-execution-deps.md
Cannot save the current worktree state
fatal: Cannot autostash

Recovery procedure:
  1. Review any quarantined files and restore only the content you still need.
  2. Clear .pipeline/HALT and .pipeline/HALT.class.
  3. Re-queue the feature for the daemon.

No git rebase is in progress; do not run git rebase --continue.
```
