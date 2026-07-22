# Conflict Check: stale claim recovery

**Date:** 2026-07-22
**Result:** CLEAN — no blocking conflicts. Three sequencing/precedence constraints recorded for the plan.

## Method

Cross-checked all 8 stories for contradictions, overlaps, shared-state conflicts, and resource
contention. Also checked against existing intake behavior (claim, delivery-guard heal, `reopen`).

## Findings

### No contradictions
- Story 1 (auto-reap stale `claimed`) and Story 8 (auto-reap targets only `claimed`, never `done`)
  are complementary, not contradictory — Story 8 constrains the predicate Story 1 introduces.
- Automatic recovery (Story 1) and manual recovery (Stories 3, 6) share one underlying transition
  (`requeueClaimed`) but fire on different triggers (queue-pull vs operator command); no overlap in
  ownership or timing.
- Story 7's fail-safe (never `forget` on an unconfirmed-closed liveness read) does not conflict with
  Story 6's bulk requeue — it narrows the drop condition to *confirmed* closed.

### Precedence / sequencing constraints (for the plan — not conflicts)

1. **Delivered-heal precedes stale-claim reap in the claim-time pass.** Both run inside the same
   `createDeliveryGuardedQueue` invocation. An entry that is both delivered (has a live PR) and old
   must heal to `done` (existing behavior), NOT be reaped to `pending`. The plan must order the
   delivered-heal rule before the stale-`claimed` reap rule, and the reap predicate must exclude any
   status other than `claimed`. (Covered by Story 8.)

2. **Reap must complete before dequeue within a single claim.** Story 1 requires a reaped idea to be
   claimable on the *same* pull. The plan must run the reap pass, persist, then select the oldest
   `pending` — not select first and reap after.

3. **Ledger write atomicity under the combined pass.** A single claim invocation may now perform
   delivered-heals, stale-claim reaps, and the claim transition — multiple writes to the one ledger
   file. The existing atomic tmp-write+rename per save already serializes these; the plan must ensure
   each transition reloads-then-writes (no stale in-memory store carried across the sub-steps) so a
   reap is not lost by a later same-pass write. (Matches the existing per-call `loadStore`/`saveStore`
   discipline.)

### Resource contention
- Only shared resource is `ledger.json`. Writes are already atomic (tmp + rename) and per-operation
  load-then-save; no new lock is required, provided constraint 3 is honored.

## Verdict

Proceed to `/plan`. No story rewrites needed.
