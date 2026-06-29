**Status:** DRAFT

# Stories: Rebase resolution — follow-ups (from 2026-06-29 retro)

> Tracked debt from `.docs/retros/2026-06-29-rebase-resolution-skill.md`. NOT in scope for the
> feat/rebase-resolution-skill PR. DRAFT until prioritized.

## Story: Emit (or remove) rebase_resolution_failed

**Requirement:** FR-11 follow-up (retro B-1)

As an operator watching the dashboard, I want a `rebase_resolution_failed` event when a single
resolution attempt fails to complete, so the per-attempt lifecycle is fully observable rather than
only attempt → terminal-outcome.

### Acceptance Criteria

#### Happy Path
- Given a resolution attempt completes the resolver call but the rebase is still in progress (a
  failed attempt), when the loop continues, then `rebase_resolution_failed` is emitted with the
  attempt index before the next attempt.

#### Negative Paths
- Given the decision is instead to drop the unused variant, when the event union is reviewed, then
  `rebase_resolution_failed` is removed from events.ts and no code references it (no dead variant).
- Given emission of `_failed` throws, when it is emitted, then the rebase result is unaffected
  (best-effort, mirrors the other resolution events).

### Done When
- [ ] Either `rebase_resolution_failed` is emitted per failed attempt (with index), or the variant
      is removed from the event union — no defined-but-unemitted variant remains.
- [ ] A test asserts the chosen behavior.
