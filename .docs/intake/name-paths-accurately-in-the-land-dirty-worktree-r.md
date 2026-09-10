# Intake origin: name-paths-accurately-in-the-land-dirty-worktree-r

Source-Ref: jstoup111/ai-conductor#1300
Owner: jstoup111

## Desired outcome
- Revising the `.docs/` artifacts of an already-landed spec, on its own spec branch,
  is possible through a supported command — without constructing a throwaway worktree
  or hand-committing around the gates.
- A revision landed that way runs the same gate set a first land runs (artifact
  presence, `Status: Accepted`, no DRAFT ADR, tier completeness, coherence, mermaid).
- When a land is refused for dirty tracked changes, the message names the paths
  accurately: a modified file under `.docs/` is never described as a change
  "outside `.docs/`".
- A genuinely stale leftover worktree — tracked modifications the operator did not
  intend to land — still fails closed. The existing FR-11 protection is not weakened
  in the course of allowing an intended revision.
- No operator step in the revision path requires force-deleting an unmerged branch.
