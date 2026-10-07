# Sequence: restart and legacy remediation plan handling

**Last updated:** 2026-10-06
**Scope:** Restart or replay of `planRemediation` across the migration.

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor restart or replay
    participant P as Pending-repair receipts
    participant S as Typed plan reader
    participant R as Remediate step
    C->>P: Read pending repairs and charged receipts
    P-->>C: Preserve idempotent charges and baselines
    alt Restart re-enters planRemediation
        C->>R: New attempt dispatches through the existing lifecycle
        R-->>S: Persist validated plan stamped with the new attempt
    end
    C->>S: Read plan for the current attempt only
    alt Plan belongs to a prior attempt or is a legacy prose-authored file
        S-->>C: Not authoritative for this attempt
    else Plan carries the current attempt identity
        S-->>C: Validated dispositions for admission
    end
```

## Legend

Restart keeps today's behavior: re-entering `planRemediation` is a new attempt that dispatches
again. A legacy `remediation.json` or a prior attempt's plan is never parsed into the current
plan, mirroring the as-built OD-6 precedent. Pending-repair receipts keep charges idempotent across the transition.

See the [component diagram](../remediation-dispositions-honor-the-engine-owned-in.md).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-06 | Initial sequence | #2522 restart boundary |
| 2026-10-06 | Restart is a new attempt; no cross-attempt reuse | Architecture review: preserve current re-dispatch behavior |
