# Sequence: Stacked restacks recover merge-bearing conflicts automatically (#3438)

**Last updated:** 2026-11-01
**Scope:** the stacked restack conflict path in `runRestack` and `resumePlanned` when the child's own range contains a merge. N=1 `flatten_refused` rebases are out of scope.

**What changes:**
- **No refusal.** A merge-bearing replay conflict no longer halts `flatten_refused`. It takes the shipped decision delivery and resolver path.
- **Flatten at hand-off.** The resolver's todo walks the first-parent range and classifies each merge with `classifyReplayMerge`, as the plumbing replay does: ancestry-only merges are dropped, a Q-carried merge contributes only its hand-resolved part, any other merge becomes one flattened commit carrying its change from its first parent, and a flattened commit whose change the new parent already contains is dropped, as the plumbing replay drops it.
- **Rewrites and audit.** The rewritten list is translated from flattened commits back to the original merges, and `rebase_merge_audit` also covers a resolved child.
- **On exhaustion.** The ordinary restack conflict halt is written. Its `--tip` recipe starts from a pinned linear flattened tip instead of the merge-bearing `oldTip`, because a plain rebase of the merge-bearing tip drops the merge's hand edits and subject. `--decision` is unchanged.

**Built on shipped code:** `replayChildRange`, `classifyReplayMerge`, `resolveRestackConflict`, `prepareRestackDecisionDelivery`, `haltRecordedRestackConflict`, `writeConflictRecord`, `consumeRecordedResolution`, `appliedTransactionLines`, and `featureConductorRefNames`.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant Exec as restack executor or recovery
    participant Res as restack resolver
    participant LLM as provider resolver
    participant Refs as conductor refs

    Exec->>Exec: plumbing replay of child «k» conflicts
    Exec->>Res: hand off range, including merge-bearing ranges
    Res->>Res: classify first-parent commits, build flattened todo
    Res->>LLM: rebase -i onto new parent, within the attempt budget
    alt resolver settles the conflict
        LLM-->>Res: resolved
        Res->>Res: translate rewrites back to original merges
        Res-->>Exec: tip, checked by FR-8, FR-9 and path ownership
        Exec->>Refs: shipped move and applied transaction
        Exec->>Exec: emit rebase_merge_audit
    else budget exhausted
        Res-->>Exec: unresolved
        Exec->>Refs: write conflict record, parent pin, flattened tip pin
        Exec-->>Op: restack conflict halt with both recipes
        alt operator records a decision
            Op->>Refs: stack restack-resolve --decision «answer»
            Note over Exec,LLM: next restack delivers the decision to the resolver
        else operator records a tip
            Op->>Op: rebase the flattened tip onto the new parent
            Op->>Refs: stack restack-resolve --tip «sha»
            Note over Exec,Refs: next restack consumes the tip, subject to #3557
        end
    end
```

## Legend

- **Flattened tip pin:** `refs/conductor/«slug»/restack/conflict/flattened-tip`. It is written only for a merge-bearing child, and has the same lifecycle as `conflict/parent`.
- **Children with no merge in their range:** every step is unchanged, and no flattened tip pin is written.

## Change Log

| Date | Change | Reason |
|------|------|------|
| 2026-11-01 | Initial sequence | #3438 |
