# Sequence: a custom-policy build_review lap under provider read-only review mode

**Last updated:** 2026-09-24
**Scope:** One `build_review` lap containing an enabled custom rubric, from the up-front capability
check through the integrity verdict. Adjudication, caching, dispositions and the aggregate are
unchanged and shown only as their entry point.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon / config load
    participant C as Capability check
    participant S as step-runners (custom lap)
    participant M as Frozen view
    participant I as Integrity digest
    participant P as Provider adapter
    participant F as Mechanical-fault lane

    D->>C: providers named by enabled custom members
    C->>P: start read-only mode, attempt a probe write
    P-->>C: process started · write refused (or not)
    C-->>D: available / unavailable on «platform» with reason
    D->>D: report up front (config warning, log, status, event)

    S->>M: materialize baseline + head (unchanged)
    S->>I: digest inputs BEFORE fan-out
    alt a member has no candidate with an available read-only mode
        S->>F: read-only-review-unavailable (charged once, not retried)
        F-->>D: needs-human HALT naming «platform»
    else every member has a candidate
        par custom member
            S->>P: invoke with read-only review option, ordinary env
        and built-in peer
            S->>P: invoke with read-only review option, ordinary env
        end
        P-->>S: structured results
        S->>I: digest inputs AFTER join
        alt digests equal
            S->>S: aggregate + adjudicator (unchanged)
        else any input changed
            S->>F: review-input-mutated, every member verdict discarded
            F-->>D: needs-human HALT naming the changed inputs
        end
    end
```

## Legend

- `par` blocks run concurrently over one shared frozen view, which is why a digest mismatch discards
  the whole lap rather than one member.
- A candidate whose read-only mode is unavailable is treated like an unavailable provider, and the
  next candidate in the member's policy is tried. Only a member with no candidate left produces the
  closed cause.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-24 | Initial generation | #2735 DECIDE |
