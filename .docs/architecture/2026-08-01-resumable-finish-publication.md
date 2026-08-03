# Architecture: Resumable FINISH Publication

**Last updated:** 2026-08-01
**Scope:** Proposed shared FINISH publication boundary for interactive inline, unattended inline, and daemon execution.

## Component View

```mermaid
flowchart LR
    Interactive["Interactive conduct<br/>operator chooses publication outcome"]
    Auto["Inline auto mode"]
    Daemon["Daemon mode"]
    Release["Resolved release-readiness contract<br/>owned by bot release PR feature"]

    subgraph Engine["Shared Conductor engine"]
        Entry["FINISH entry"]
        Preconditions["Deterministic readiness evaluator<br/>classifies knowable blockers"]
        Coordinator["Publication coordinator<br/>resumes the next incomplete transition"]
        Progress[("Durable publication progress<br/>derived from verified effects")]
        Judgment["Judgment dispatcher<br/>PR title and body quality"]
        Classifier["Failure classifier<br/>publication, implementation, or human decision"]
        Completion["FINISH completion verifier"]
    end

    subgraph Effects["Existing publication boundaries"]
        Git["Git adapter<br/>commit and push evidence"]
        GitHub["GitHub adapter<br/>PR identity and presentation"]
        Shipped["Shipped-record writer"]
        Record["Finish outcome recorder"]
    end

    Build["BUILD recovery"]
    FinishRetry["FINISH resume"]
    Halt["Human-action HALT"]
    Done["DONE"]

    Interactive --> Entry
    Auto --> Entry
    Daemon --> Entry
    Entry --> Preconditions
    Release --> Preconditions
    Preconditions -->|"ready"| Coordinator
    Preconditions -->|"exact deterministic gap"| Classifier
    Coordinator <--> Progress
    Coordinator --> Judgment
    Coordinator --> Git
    Coordinator --> GitHub
    Coordinator --> Shipped
    Coordinator --> Record
    Judgment --> Coordinator
    Git --> Coordinator
    GitHub --> Coordinator
    Shipped --> Coordinator
    Record --> Coordinator
    Coordinator --> Completion
    Completion -->|"coherent"| Done
    Completion -->|"gap"| Classifier
    Classifier -->|"publication only"| FinishRetry
    Classifier -->|"implementation evidence invalid"| Build
    Classifier -->|"ambiguous, destructive, or operator-owned"| Halt
    FinishRetry --> Entry
```

## Sequence: Safe Resume Across Modes

```mermaid
sequenceDiagram
    actor Operator
    participant C as Conductor
    participant P as Publication coordinator
    participant S as Verified progress
    participant J as Judgment dispatcher
    participant E as Git and GitHub effects
    participant V as Completion verifier

    Operator->>C: enter FINISH in interactive or unattended mode
    C->>P: evaluate and resume publication
    P->>S: load verified completed transitions
    S-->>P: current coherent progress
    P->>P: evaluate deterministic prerequisites

    alt deterministic blocker exists
        P-->>C: exact publication gap before judgment
        C-->>Operator: FINISH recovery or actionable HALT
    else prose judgment is incomplete
        P->>J: request one PR prose quality pass
        J-->>P: accepted prose or explicit refusal
    end

    loop each incomplete safe transition
        P->>E: apply transition idempotently
        E-->>P: observed external and repository state
        P->>S: retain verified completion
    end

    P->>V: verify coherent publication result
    alt publication-only gap
        V-->>C: resume FINISH at incomplete transition
    else implementation evidence invalid
        V-->>C: route to BUILD with evidence
    else human authority required
        V-->>C: halt without guessing
    else complete
        V-->>C: DONE
    end
```

## Architectural Constraints

- The coordinator is shared by inline and daemon entry points; interaction policy differs by mode, but completion semantics do not.
- Release-note, changelog, semver, and version-cut state remain outside the coordinator. It consumes the resolved readiness result owned by upstream spec PR #1233.
- Progress is accepted only when verified against repository or external state. A local marker alone is not authority for an externally visible effect.
- The judgment dispatcher owns reader-facing prose quality, not mechanical publication sequencing.
- Publication failures cannot select BUILD unless current implementation evidence is invalid.
- No transition merges a pull request or guesses a destructive or operator-owned decision.
- Existing git, GitHub, shipped-record, and finish-record boundaries should be reused behind injectable adapters rather than duplicated.

## Legend

- Solid arrows are control or verified-effect flows.
- Cylinders represent durable progress derived from authoritative evidence.
- `FINISH resume` means retrying the next incomplete publication transition without replaying completed work.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-01 | Initial proposed component and sequence views | DECIDE phase for issue #1172 |
| 2026-08-01 | Plan update: externalized release readiness and fixed coordinator wiring | Avoid overlap with bot-owned release PR; keep `conductor.ts` as a thin composition seam |
