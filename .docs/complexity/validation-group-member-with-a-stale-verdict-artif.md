# Complexity: Validation-group member with a stale verdict artifact re-dispatches instead of remediating

Tier: S

Rationale: Two production files. `src/conductor/src/engine/group-core.ts` gains one optional
dependency (a post-success verification hook) consulted inside `runGroupBranchInner`'s existing
attempt loop, and `src/conductor/src/engine/conductor.ts` moves the validation group's existing
stamp-and-handshake call from the branch's `result` event into that hook. No new state, event
variant, config key, HALT class, CLI, or schema. The behavior enforces an already-approved decision
(adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D5) on the one path that bypassed it,
and reuses the existing no-verdict join halt (adr-2026-07-10-validation-group-join D2, as amended by
#1425). Risk is bounded to the validation group's retry accounting and is covered by focused
group-core and conductor tests.
