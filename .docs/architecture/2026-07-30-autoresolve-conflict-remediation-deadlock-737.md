# Components and Sequence: Shipped-PR Conflict Remediation Ownership

**Last updated:** 2026-07-30
**Scope:** Proposed ownership, safety, and fallback flow for issues #737 and #1150.
**Source PRD:** `.docs/specs/2026-07-30-autoresolve-conflict-remediation-deadlock-737.md`

## Component Diagram

```mermaid
graph TD
    Operator["Repository operator"]
    GitHub["GitHub pull request"]

    subgraph Daemon["Per-repository daemon"]
        Runner["Feature runner<br/>verified ship"]
        Watch["Shipped-PR watch<br/>durable attempts and cooldown"]
        Preflight["Remediation compatibility preflight<br/>one startup diagnostic"]
        Sweep["Merge-status sweep<br/>per-cycle conflict arbiter"]
        Classifier["Typed conflict classifier<br/>dispatch, defer, already-escalated, escalate"]
        Conflict["Conflict remediation<br/>serial attempt owner"]
        CIFix["CI repair<br/>non-conflict failures"]
        Escalation["Actionable escalation<br/>confirm comment, then sticky label"]
        Log["Operator-visible outcome log"]
    end

    subgraph Workspaces["Git workspaces"]
        Retained["Retained feature workspace<br/>evidence only, not an ownership gate"]
        Resolve["Transient resolve-«slug» workspace<br/>isolated remediation"]
        Primary["Primary checkout<br/>never mutated"]
    end

    subgraph Safety["Publish safety chain"]
        Preservation["Feature-work preservation"]
        Currency["Current-with-base proof"]
        Verification["Repository verification<br/>conductor aggregate plus harness integrity"]
        Lease["Lease-protected branch publish"]
    end

    Runner -->|"verified ship enrollment"| Watch
    Runner -->|"retain recovery evidence"| Retained
    Preflight -->|"CI repair active and conflict remediation inactive"| Log
    Watch --> Sweep
    Sweep -->|"CONFLICTING watched candidate"| Classifier
    Classifier -->|"dispatch"| Conflict
    Classifier -->|"defer or already-escalated"| Log
    Classifier -->|"escalate"| Escalation
    Sweep -->|"non-conflicting failed checks"| CIFix
    Conflict --> Resolve
    Conflict -. "does not mutate" .-> Retained
    Conflict -. "does not mutate" .-> Primary
    Resolve --> Preservation --> Currency --> Verification --> Lease --> GitHub
    Lease -->|"concurrent remote change"| Escalation
    Conflict --> Log
    Escalation --> GitHub
    Escalation --> Operator
    CIFix --> GitHub
    GitHub --> Sweep
```

## Sequence Diagram

```mermaid
sequenceDiagram
    participant O as Operator
    participant GH as GitHub PR
    participant S as Merge-status sweep
    participant W as Shipped-PR watch
    participant D as Conflict classifier
    participant R as Conflict remediation
    participant WT as Resolve workspace
    participant V as Safety and verification
    participant C as CI repair

    Note over S,C: Startup preflight emits one loud diagnostic when CI repair is active<br/>but automatic conflict remediation is intentionally inactive.
    S->>W: Read watched shipped PR and bounded attempt state
    S->>GH: Read state, conflict status, checks, and sticky escalation
    GH-->>S: OPEN, ready, CONFLICTING
    S->>D: Classify watched conflict without a worktree-presence gate
    D-->>S: dispatch, defer, already-escalated, or escalate

    alt sticky escalation already present
        S->>S: Record already-escalated disposition
        S-->>O: Log one unchanged disposition without external mutation
    else transient safety condition
        S->>S: Record temporary deferral without burning an attempt
        S-->>O: Log concrete deferral reason
    else enabled remediation unavailable, permanently ineligible, or exhausted
        S->>GH: Confirm marked comment with stage, reason, and recovery action
        alt comment confirmed
            S->>GH: Apply sticky label
            S-->>O: Log newly-escalated disposition
        else lookup or write indeterminate
            S-->>O: Log retryable escalation failure without attempt burn
        end
    else eligible for remediation
        S->>W: Persist attempt before mutation
        S->>R: Dispatch as the conflict owner
        R->>WT: Create isolated resolve-«slug» workspace
        R->>V: Resolve, preserve feature work, prove currency, verify repository
        alt safety and verification pass
            V->>GH: Publish refreshed branch with lease protection
            GH-->>V: Accepted
            V-->>R: Refreshed
            R-->>S: Successful terminal outcome
            S->>W: Reset conflict-attempt state
        else remote moved or another hard gate fails
            V-->>R: Reject publication with concrete reason
            R->>GH: Confirm actionable comment, then apply sticky label
            R-->>S: Escalated or retryable-escalation outcome
        end
        R->>WT: Remove transient workspace
    end

    Note over S,C: CONFLICTING candidates never enter the CI-repair set.<br/>CI repair may claim non-conflict work only after an explicit conflict disposition.
    S->>C: Evaluate remaining failed checks after conflict clears
```

## Legend

- **Shipped-PR watch:** existing durable enrollment that is written only after a verified ship; it carries retry and cooldown state.
- **Retained feature workspace:** completed build evidence kept until the shipped record reaches the default branch. Its presence does not prove an active BUILD owner.
- **Conflict disposition:** exactly one observable result for a conflicting watched pull request in a sweep: started, temporarily deferred, already escalated, or newly escalated.
- **Deliberate opt-out:** suppresses automated pull-request mutations, emits one startup compatibility diagnostic, and reports manual conflict ownership truthfully.
- **Sticky escalation:** a confirmed marker-tagged actionable comment followed by the idempotent `needs-remediation` label. Comment failure leaves the label unapplied so a later cycle can retry safely.
- **Dashed relationships:** explicit non-mutation boundaries.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-30 | Initial proposed-state component and sequence diagrams | Restore autoresolve ownership and remove the retained-workspace deadlock for #737 and #1150 |
| 2026-07-30 | Preserve deliberate opt-out; add startup compatibility diagnostic | Operator-approved architecture-review correction to FR-7 |
| 2026-07-30 | Confirm actionable comment before applying sticky label | Conflict-check found label-first partial failure could suppress recovery permanently; operator selected comment-first ordering |
| 2026-07-30 | Add typed classifier, sweep arbitration, CI exclusion, and exact verification scope | Plan update mapped the approved design to production wiring and task boundaries |
