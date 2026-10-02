# Sequence: restart and legacy PRD report handling

**Last updated:** 2026-09-30
**Scope:** Proposed compatibility behavior following the shipped as-built migration pattern.

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor restart or replay
    participant S as Single typed-verdict reader
    participant D as Existing operator-decision store
    participant G as Gate code-validity policy
    participant R as PRD-audit step
    C->>D: Read existing attributable decisions
    D-->>C: Preserve approvals, refusals and history
    C->>S: Read persisted PRD verdict
    alt Only legacy Markdown exists or typed evidence is unusable
        S-->>C: No authoritative typed verdict
        C->>R: Require a new audit through the existing lifecycle
    else Typed verdict is present
        S-->>C: Judgment and engine-owned identity
        C->>G: Evaluate existing preservation conditions
        alt All preservation premises hold
            G-->>C: Reuse without a new provider dispatch
        else Preservation premises fail
            G-->>C: Audit required
            C->>R: Start a new attempt
        end
    end
```

## Legend

Migration does not reinterpret a historical Markdown report as a typed verdict or discard
durable operator decisions. Legacy decision-import behavior remains with its existing owner.
The exact preservation premises and compatibility transition will be reviewed against the
governing ADRs before stories are accepted.

See the [component diagram](../prd-audit-receives-bounded-inputs-and-returns-vali.md).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial sequence | Make restart and legacy evidence boundaries reviewable |
