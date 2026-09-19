# Sequence: Repair-obligation boundary translation after an engine rebase

**Last updated:** 2026-09-18
**Scope:** How `translateAfterRebase` rewrites each persisted repair obligation's `baseline.head`
through the patch-id rewrite map, how a dropped or absorbed boundary (residue) resolves to a
surviving later commit, and how the read path in `autoheal.ts` keeps its fail-closed refusal
for anything the engine cannot explain.

## Diagram

```mermaid
sequenceDiagram
    participant Rebase as performRebase
    participant Translate as translateAfterRebase
    participant Map as buildRewriteMap (patch-id)
    participant Rewrites as .pipeline/rebase-rewrites.json
    participant Stores as applyMapToStores (task-evidence, task-status)
    participant Oblig as RepairObligationStore (engine-state.json)
    participant Events as ConductorEventEmitter
    participant Read as listCommitsWithTrailersAfterRepairBoundary

    Rebase->>Translate: onto, origHead, head
    Translate->>Map: rev-list onto..origHead, onto..head
    Map-->>Translate: map (old→new), residue (no patch-id match)
    Translate->>Rewrites: persist map transitively
    Translate->>Stores: rewrite cited shas

    Translate->>Oblig: read open + resolved obligations
    loop each obligation baseline.head
        alt head is a map key
            Translate->>Oblig: baseline.head := map[head]
        else head is residue
            Translate->>Translate: walk pre-image commits after head toward origHead
            alt a later pre-image commit is a map key
                Translate->>Oblig: baseline.head := map[first survivor] (tighter range)
            else nothing after head survived
                Translate->>Oblig: leave baseline.head unchanged (fail-closed later)
            end
        else head is not in onto..origHead
            Translate->>Oblig: leave unchanged
        end
    end
    Translate->>Oblig: atomic write, emit one translation record per obligation
    Translate->>Events: repair_boundary_translated «obligationId, from, to, rule»

    Note over Read: Later build lap, task-progress checks an obligation
    Read->>Read: rev-parse baseline.head, merge-base --is-ancestor HEAD
    alt ancestor
        Read-->>Read: available, commits baseline.head..HEAD
    else not ancestor
        Read->>Rewrites: translateRepairBoundary (#2544 fallback)
        alt mapped and ancestor
            Read-->>Read: available
        else
            Read-->>Read: unavailable — repair boundary is not an ancestor of HEAD
        end
    end
```

## Legend

- **map key** — the boundary commit replayed onto the new base with an identical patch-id; the
  existing `resolveThroughMap` rule applies unchanged.
- **residue** — the boundary commit had no post-image patch-id match (squashed, absorbed into
  main, or content-changed). Its replacement is the post-image of the **first surviving commit
  after it** in pre-image order, so the evidence range can only shrink, never admit pre-repair
  history.
- **unchanged** — a boundary outside `onto..origHead`, or one with no surviving successor, is
  left as-is. The read path then refuses it exactly as today; that refusal is the intended
  fail-closed outcome, not a defect.
- The `#2544` read-path fallback in `autoheal.ts` is retained so an obligation written before
  this change, or a store the translation step could not rewrite, still resolves direct map hits.
- Translation is observable only through the existing event spine (`ConductorEventEmitter`);
  no sidecar or log line is added.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-18 | Initial generation | DECIDE for #2462, Approach A |
