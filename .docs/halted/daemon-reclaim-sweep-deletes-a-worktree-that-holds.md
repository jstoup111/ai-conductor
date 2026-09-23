# Halt record

Status: halted
Slug: daemon-reclaim-sweep-deletes-a-worktree-that-holds
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-daemon-reclaim-sweep-deletes-a-worktree-that-holds
Head SHA: 8e2f2ebf67dc75483f70c1bc51b852f312f1ef14
Halted at: 2026-09-23T14:37:07.483Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 2 negative: Given an ancestry-proven branch without a shipped record whose only merged pull request reports a different head commit, when `reconcileMergedPark` runs for its slug, then nothing is removed and the refusal is not a success outcome.
Task ids: 4
Done when checks: The `reconcileMergedPark` test with a rejecting injected `gh` and an ancestry-proven branch returns refusal `no-merge-proof` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test whose merged PR reports a different `headRefOid` returns a result carrying a `refusal` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test for a non-ancestor branch whose merged PR head equals its tip returns refusal `branch-delete-failed`, keeps the branch, and records a `branch -d` git call and no `branch -D` git call.
Missing assertion: The cited check does not require that no non-force branch-deletion command or any other removal occurs for the different-head case.
```
