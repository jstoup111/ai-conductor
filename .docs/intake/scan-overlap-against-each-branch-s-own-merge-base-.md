# Intake origin: scan-overlap-against-each-branch-s-own-merge-base-

Source-Ref: jstoup111/ai-conductor#1650
Owner: jstoup111

## Desired outcome
- A path is reported against a branch only when that branch's diff actually contains it —
  spot-checking any reported pair with `git diff --name-only` confirms the claim.
- A path genuinely touched by unmerged work is still reported (negative path) — the fix must not
  achieve precision by reporting nothing.
- Output volume for a typical 3-6 path query is small enough that an author reads it rather than
  skipping it.
- A query naming a path no branch touches says so plainly, as it already does today for a
  nonexistent path.
