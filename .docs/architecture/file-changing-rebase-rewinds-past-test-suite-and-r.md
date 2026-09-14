# Sequence: Selective verification after a completed rebase

**Last updated:** 2026-09-11
**Scope:** Proposed post-rebase flow for #2253, implementing operator-approved approach A. Existing finish/re-kick entry policy and pre-rebase recovery retain their owners. This diagram awaits operator validation.

> **Amended 2026-09-11 by #2253:** The operator approved this flow in the composer session. The comparison and selective-state architecture were subsequently approved and are recorded in adr-2026-09-11-selective-post-rebase-verification.

## Diagram

```mermaid
sequenceDiagram
    participant Entry as Finish or re-kick
    participant Rebase as Existing rebase driver
    participant Policy as Shared gate classification
    participant State as Conductor state and verdicts
    participant Suite as Test-suite verifier
    participant Review as Required reviews
    participant Build as BUILD repair

    Entry->>Rebase: Apply existing integration and recovery policy
    alt Mergeable skip or no relevant change
        Rebase-->>Entry: Preserve valid evidence and completion
    else Rebase remains unresolved
        Rebase-->>Entry: Existing bounded recovery or halt
    else Rebase completes with relevant changes
        Rebase->>Policy: Combined-tree delta, feature contribution, active inputs
        Note over Rebase,Policy: Reuse #2453 input resolution and surface projection
        Policy->>State: Explicit preserve, refresh, and invalidate decisions
        Note over Policy,State: Refresh required coverage judgement without positional rewind
        Note over State: Do not reopen acceptance authoring or BUILD by position
        alt Required evidence cannot be established
            State-->>Entry: Explicit recovery or halt without unsupported preservation
        else Verification inputs changed
            State->>Suite: Establish current aggregate proof
            alt Suite passes or proof is validly reused
                Suite-->>State: Current passing evidence
                State->>Review: Dispatch only invalidated applicable reviews
            else Completed suite reports failure
                Suite->>Build: Scoped repair with failure evidence
                Build->>Suite: Reverify repaired code
                Suite->>Review: Ordinary downstream validation after repair
            else Suite infrastructure cannot establish a result
                Suite-->>Entry: Existing bounded infrastructure recovery or halt
            end
        else Aggregate proof remains current
            State->>Review: Dispatch only invalidated applicable reviews
        end
        Review-->>Entry: Pass, explicit repair request, or required human decision
    end
```

## Legend and behavior boundaries

- **Existing entry policy:** preserve #1207/#2515 normal-finish versus mandatory re-kick distinctions, current code/test safeguards, protected-artifact checks, evidence translation, and #2495 pre-rebase collision recovery. The diagram starts new behavior only after an actual successful rebase.
- **Shared gate classification:** extend #2453's single projection rather than create another document resolver or event-classification path. A changed active review document remains invalidating even when the feature's implementation contribution is unchanged.
- **Feature contribution:** the implementation change relative to its base before versus after replay, not the set of overlapping file names. The precise comparison and conservative fallback are architecture-review decisions still to be resolved.

> **Amended 2026-09-11 by #2253:** The approved ADR resolves this comparison as a clean explicit-base expected merge tree equal to H, bound to immutable P/B/O/H; unavailable comparison is conservative. Plan Tasks 1–3 implement it. Tasks 6–10 bind and reconcile existing gate evidence; Tasks 11–19 wire the shown continuation and recovery paths.

- **Coverage refresh:** coverage binding remains a judgement, not a newly invented tree-attesting predicate. Refresh only when its actual inputs require it; a real coverage/specification failure blocks and routes explicitly. This refresh must not cause acceptance-spec generation or a completed BUILD task walk by adjacency.
- **Explicit state changes:** rebase-origin handling reopens only the invalidated checks and required publication continuation. Ordinary repair still invalidates its dependent evidence. Never convert a pending failure, missing evidence, or unrelated repair obligation into PASS.
- **Suite reuse:** the native verifier remains authority for fingerprints and explicitly configured drift tolerance. Reopening verification does not force execution when that authority proves existing evidence reusable.
- **Review failure:** implementation defects enter existing bounded repair; scope/decision gaps and unavailable evidence retain their established routes. This feature does not redesign review-remediation ownership.
- **Observability:** existing gate-preserved, gate-invalidated, reverified, kickback, and halt events use the current event spine. No parallel log or channel is proposed.
- **Dependencies:** #2211 / PR #2453 must supply its delivered classification seams before this implementation is dispatched. Sequence integration with #415 / PR #2495 on shared rebase-driver files. #2462 and #2488 remain separate issue owners; rely on valid existing evidence and report any unmet prerequisite rather than duplicating their repairs.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-11 | Initial proposed flow | Whole-flow scope and in-flight ownership confirmed by operator |
