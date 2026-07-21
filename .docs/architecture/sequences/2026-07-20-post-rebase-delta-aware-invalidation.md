# Sequence: Post-rebase delta-aware gate invalidation (#655)

**Last updated:** 2026-07-20
**Scope:** How the finish-time rebase delta flows into per-gate invalidation decisions —
which gate verdicts are re-run vs preserved after a file-changing rebase, and the fail-closed
fallback. Amends the phase-9.0 rebase-loop-tail flow.

## Diagram

```mermaid
sequenceDiagram
    participant R as performRebase (rebase.ts)
    participant C as classifyClean
    participant M as gate→surface map (NEW)
    participant AV as applyRebaseVerdicts
    participant AT as advanceTail (conductor.ts)
    participant NB as navigateBack / markDownstreamStale
    participant V as gate verdicts + events

    R->>C: diff preTree..HEAD (name-only, code/test)
    C-->>R: RebaseOutcome.changed { changedCodePaths }

    Note over R,M: NEW — build the delta path-set<br/>(changedCodePaths ∪ main-side changes to claimed surfaces)

    alt delta computable
        R->>AV: outcome.changed + deltaPaths
        loop each candidate gate (build, build_review, wiring_check, manual_test)
            AV->>M: surfaces(gate)
            M-->>AV: glob set for gate
            alt delta ∩ surfaces = ∅
                AV->>V: PRESERVE verdict (no kickback)
                AV->>V: emit rebase_gate_preserved { gate, deltaConsidered }
            else delta ∩ surfaces ≠ ∅
                AV->>V: satisfied:false + kickback{from:rebase}
                AV->>V: emit rebase_gate_invalidated { gate, matchedPaths }
            end
        end
        AV-->>AT: verdicts written
        AT->>NB: for each kicked-back gate: navigateBack(gate)
        Note over NB: NEW — downstream-stale sweep is delta-gated:<br/>a downstream judged gate (prd_audit,<br/>architecture_review_as_built) is left intact<br/>when the delta misses its surfaces
        NB-->>AT: only truly-affected steps re-open
    else delta uncomputable (null)
        Note over R,AV: FAIL-CLOSED — fall back to today's behavior
        R->>AV: outcome.changed (no delta)
        AV->>V: invalidate the full fixed set (build, build_review,<br/>wiring_check, +manual_test) — cascade re-runs judged tail
    end
```

## Legend

- **NEW** boxes are introduced by this feature; everything else exists today.
- **claimed surfaces** — the feature's own source/artifact paths a gate's verdict depends on;
  the gate→surface map declares these per gate (e.g. `prd_audit` → `.docs/specs/**` + feature
  source; `architecture_review_as_built` → `.docs/architecture/**` + feature source;
  `manual_test` → non-test feature source; `build_review` → feature-source diff).
- **delta path-set** — union of the rebase's `changedCodePaths` (conflict resolutions +
  main-side code/test changes surviving into the feature tree) computed by `classifyClean`.
- **PRESERVE** — the gate's prior `satisfied:true` verdict is kept; no kickback, no re-open,
  no downstream-stale — recorded as an auditable `rebase_gate_preserved` event.
- **FAIL-CLOSED** — if the delta cannot be computed, the system reverts to today's
  invalidate-everything behavior; correctness is never traded for the optimization.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-20 | Initial generation | Delta-aware invalidation design for #655 |
