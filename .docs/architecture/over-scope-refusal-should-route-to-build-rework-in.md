# Sequence: Over-scope refusal routes to BUILD rework

**Last updated:** 2026-10-03
**Scope:** How the SHIP `prd_audit` gate routes an outside-visible `OVER_SCOPE` finding that an operator has durably refused (#2931). The serial tail and the validation-group join share this route. This is a logical sequence; storage formats stay with the existing stores.

## Diagram

```mermaid
sequenceDiagram
    participant A as prd_audit report
    participant R as Over-scope route
    participant D as Durable decision + case stores
    participant P as planRemediation (/remediate)
    participant K as Kickback lap budget
    participant B as BUILD
    participant H as HALT
    A->>R: OVER_SCOPE findings with criterion keys
    R->>D: Project accept / refuse / pending per finding
    alt Any blocking finding is pending (undecided)
        R->>H: Halt with decision block (unchanged, prior decisions kept)
    else All accepted or not blocking
        R-->>A: Record accepted risk (unchanged)
    else Every blocking finding is refused
        R->>K: Check prd_audit.max_remediation_laps
        alt Lap budget spent
            K->>H: Halt "Refused — rework required" naming each refused key (growth overflow at dispatch: kickback-cap)
        else Lap available
            R->>P: Refusal evidence: criterion/NC key, decision id + rationale, original source snapshot
            P->>P: Judge which code removes or reworks the refused behavior
            P-->>R: rem-prd-audit-«key» tasks citing the refused key
            R->>K: Charge one lap and emit kickback
            R->>B: Dispatch remediation tasks
            B-->>A: Next prd_audit runs on the changed code
            Note over A,R: Behavior gone → no finding, still present → re-enter route
        end
    end
```

## Legend

- **Durable decision + case stores:** the existing `AcceptedWideningDecisionStore` and `RemediationCaseStore`. Refusal is read here and never written by this route.
- **planRemediation:** the existing SHIP-gate remediation planner. Refusal is a new kind of evidence for it, not a separate writer. The `rem-prd-audit-*` id scheme and upsert semantics are unchanged.
- **Kickback lap budget:** the existing `prd_audit.max_remediation_laps` (default 1). A refused finding that survives a spent budget halts with the existing refusal block.
- **Pending wins:** if any blocking finding is undecided, the feature halts as it does today, so an operator decision is never skipped. Refused findings are remediated only once nothing is pending.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial sequence | #2931: a durable refusal currently re-halts forever on unchanged code |
