# Sequence: Policy resolution, cache reuse, and fallback

**Last updated:** 2026-09-10
**Plan update approved:** James Stoup, 2026-09-11
**Scope:** Proposed normal and negative candidate flows for #1986; diagram approved by operator 2026-09-10.


> **Amended 2026-09-10 by #1986:** Tasks 3–20 now fix the previously open loading/fallback rules: policy-loading failures do not become provider unavailability, each actual candidate resolves and hashes its complete delivered package before cache access, containment is proven before review, and every terminal path releases candidate activity.

## Diagram

```mermaid
sequenceDiagram
  participant C as Rubric coordinator
  participant P as Provider candidate boundary
  participant R as Installed-policy resolver
  participant K as Review cache
  participant H as Host-agent reviewer
  participant J as Raw join
  C->>P: Rubric selection and frozen implementation input
  loop Each candidate admitted by existing fallback policy
    P->>P: Prepare actual candidate environment
    P->>R: Resolve selected semantic policy in that environment
    alt Policy missing, ambiguous, or unloadable
      R-->>P: Typed policy failure with actionable evidence
      Note over P,H: No reviewer judgment or cache hit under invalid policy
    else Complete effective policy available
      R-->>P: Complete captured package, source, and content identity
      P->>P: Prove protected-write refusal and private-scratch write
      Note over P,H: Unavailable or nested-probe failure stops before judging, no writable fallback
      P->>K: Lookup for this candidate and frozen review inputs
      alt Eligible cached judgment
        K-->>P: Validated judgment with original producing provenance
      else Cache miss
        P->>H: Fresh read-only review with the bound policy
        H-->>P: Judgment or execution failure
        alt Valid judgment
          P->>P: Validate payload and bind execution provenance
          P->>K: Store eligible judgment under producing identity
        else Candidate failed
          Note over P,H: Existing fallback eligibility applies without inventing PASS
        end
      end
    end
    P->>P: End candidate-owned activity and release scratch
    Note over P,R: Only existing provider/model unavailability advances fallback, policy-load failure does not
  end
  P-->>C: One terminal branch result or typed coverage failure
  C->>J: Preserve branch evidence for aggregate authority
```

## Legend

The loop exits on a valid settled result. A failure advances only when existing provider policy and the approved new failure classification allow fallback. The diagram requires re-resolution for every actual candidate; it does not pre-decide which policy faults are recoverable. Cache entries are judged evidence, not substitutes for proving the current candidate's effective policy.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-10 | Initial candidate sequence | Address effective-provider identity and unsupported-policy negatives |
| 2026-09-10 | Plan-update: concrete candidate, authority, and recovery boundaries | Reflect the approved architecture and 40-task implementation plan |
