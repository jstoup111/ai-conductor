# Sequence: Validation-group branch retry budget and sibling retention (#1425)

**Last updated:** 2026-09-06
**Scope:** The auto-mode SHIP validation-group fan-out and its no-verdict halt path —
`conductor.ts` group dispatch (`runWithConcurrency` over `runGroupBranch`), the
`inFlightGroupCompletions` side-channel, and the `no-verdict` halt block. Two changes
are marked CHANGED; everything else is the existing engine.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant L as conductor run loop (auto mode)
    participant M as resolveGroupMembership
    participant S as conduct-state.json
    participant B1 as branch manual_test
    participant B2 as branch prd_audit
    participant B3 as branch architecture_review_as_built
    participant P as inFlightGroupCompletions
    participant J as group join

    L->>M: resolve members for the validation group
    M->>S: read each member status
    M-->>L: dispatchable = members not skipped and not done
    Note over M,S: a member already done in state is NOT redispatched

    L->>B1: runGroupBranch(member, maxRetries)
    L->>B2: runGroupBranch(member, maxRetries)
    L->>B3: runGroupBranch(member, maxRetries)
    Note over L,B3: DELIVERED BY #2190 (PR #2206) - maxRetries is the member's<br/>resolved max_retries (default 3), not the literal 1.<br/>This spec assumes it and is blocked by #2190.

    B1-->>P: result pass, record done
    B2-->>P: result pass, record done
    B3->>B3: attempt 1 throws (transient provider failure)
    B3->>B3: attempt 2 with a fresh session identity
    Note over B3: previously there was no attempt 2 - budget 1 meant<br/>one throw became a no-verdict immediately

    alt every branch eventually produced a verdict
        B3-->>P: result pass, record done
        P-->>J: all green
        J->>S: commit member statuses and continue the tail
    else one branch is still no-verdict after its full budget
        B3-->>J: no-verdict (reason carried)
        J->>S: CHANGED - persist the passing siblings as done<br/>before the halt, the same merge the signal handlers do
        J->>S: commit group step failed, last_step = group
        J-->>L: write HALT needs-human naming the failed branch
        Note over L,S: on the operator's redispatch, resolveGroupMembership<br/>sees the retained done siblings and dispatches<br/>only the failed member
    end
```

## Legend

- **CHANGED** — the edit this feature makes (sibling retention). **DELIVERED BY #2190** — the retry-budget edit, built on PR #2206; this spec is blocked by #2190 and assumes it.
- **maxRetries** — the trailing argument to `runGroupBranch`. The serial walk resolves
  `max_retries` per step (default `FALLBACK_RETRIES = 3`); the group path passed a
  literal `1`, so a single throw produced a `no-verdict` with no second attempt.
- **`inFlightGroupCompletions`** — the in-memory side-channel that records a member's
  completion as soon as its own branch settles. The SIGINT/SIGTERM handlers already
  merge it into state; the no-verdict halt path did not, which is why green siblings
  were re-run after an operator cleared the halt.
- **The halt itself is unchanged.** `adr-2026-07-10-validation-group-join.md` chose
  "verdicts join, infra fails fast" deliberately, so a genuine no-verdict still halts
  the group loudly rather than being retried indefinitely.
- **BUILD-repair re-verification is unchanged.** `resolveGroupMembership`'s
  `reverifyDoneMembers` flag still forces every non-skipped member to dispatch after a
  repair, so a retained `done` can never mask a member that must re-run.
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | DECIDE phase for #1425 spec |
| 2026-09-06 | Budget change re-attributed to #2190 | conflict-check found the accepted #2190 Story 1 already delivers it |
| 2026-09-06 | Confirmed against the implementation plan (8 tasks); retention predicate named (`memberSatisfiedAtJoin`), one atomic commit | /plan step 8b |
