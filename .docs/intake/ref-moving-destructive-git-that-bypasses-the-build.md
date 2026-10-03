# Intake origin: ref-moving-destructive-git-that-bypasses-the-build

Source-Ref: jstoup111/ai-conductor#2693
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2693 digest=6d953aee18b3acdecf91b8619c2a3feea22dffe3d0e4bbd1e5eb1af2c85a8792 >>>
## Desired outcome

- In a build worktree, a ref-moving destructive operation that bypasses the #1354 check is refused and leaves the ref unchanged. This covers force-deleting an unmerged branch, a non-fast-forward move of a branch ref, and a push that overwrites remote history without a lease.
- The engine's own ref rewrites succeed unchanged: rebase, quarantine, shipped-record and spec-landing bookkeeping.
- Lease-checked pushes and deletion of provably merged branches still succeed.
- A refusal names what was refused and the safe alternative.
- It holds on every provider and in both self-host and non-self-host runs, with no operator home configuration present, and executable tests prove it.
<<< END INBOUND >>>
