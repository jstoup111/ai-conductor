# Complexity: Judge lane never dispatches on resumed/stalled build-gate residue (#570)

Tier: S

## Rationale
- **Models/integrations:** none new. Touches an existing dispatch predicate.
- **Auth/state machines:** none. No new state; a guard-clause removal in an existing gate path.
- **Surface:** single production file (`src/conductor/src/engine/conductor.ts`) — remove `!isZeroWork`
  from the judge-lane dispatch predicate (`:3057-3062`) and delete the now-redundant `isZeroWork`
  computation in that block (`:3048`). The separate zero-work use at `:3244` is untouched.
- **Story count:** ~3 (dispatch-on-inherited-residue happy path; no-op when cutover disabled;
  no-op when residue set empty).
- **Risk note:** the file is on the engine's critical build-gate loop, so blast radius is real even
  though structural complexity is low — mitigated by unit tests pinning the three acceptance signals
  and by leaving the correct kickback-path zero-work use (`:3244`) byte-for-byte unchanged.

## Tier-driven step skipping (Small)
Skips: architecture-diagram, architecture-review, conflict-check.
Runs: stories, plan.
