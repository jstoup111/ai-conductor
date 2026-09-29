# Intake origin: automatic-rebase-preserves-merges-carrying-unique-

Source-Ref: jstoup111/ai-conductor#2498
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2498 digest=877f7ac43a6471ae1d400d6673515bffa9fb9431e9a1c548c6fccdb4a5bd0046 >>>
## Desired outcome

- Automatic rebase preserves a feature merge whose merge result contains content not represented by either linear parent chain.
- A feature with duplicated repair lineage does not replay patch-identical commits as add/add conflicts.
- If topology cannot be preserved automatically, the halt identifies the merge-only delta before modifying the worktree and leaves a deterministic recovery path.
<<< END INBOUND >>>
