# Architecture: guarded cumulative kickback budget recovery

**Last updated:** 2026-08-29
**Scope:** Medium-tier proposed architecture for inspecting and adjusting one halted feature's
`build_review` cumulative budget, preserving the existing mechanical-fault lane and event spine.

## Component diagram (C4 L3)

```mermaid
graph LR
  OP["Operator"]

  subgraph CLI["ai-conductor CLI process"]
    PARSE["Kickback-budget command parser"]
    RESOLVE["Shared named-feature resolver"]
    AUTH["Interactive operator identity guard"]
    QUIET["Feature quiescence guard"]
    SERVICE["Budget inspection and adjustment service"]
    TX["Guarded recovery transaction"]
    EXTWRITE["External ConductorEvent writer"]
  end

  subgraph ROOT["Primary repository control state"]
    PARK["Operator park state"]
    ACTIVE["Active-dispatch state"]
  end

  subgraph WT["Feature worktree .pipeline state"]
    LEDGER["Kickback ledger<br/>consumption, effective limit,<br/>adjustment history, typed cap halt"]
    HALT["HALT and HALT.class"]
    EXTEVENTS["External-process event ledger<br/>ConductorEvent schema"]
  end

  subgraph ENGINE["Conductor engine and daemon"]
    CONSUME["Existing kickback consumption"]
    CAP["Cumulative-cap classifier and halt writer"]
    BUS["ConductorEvent emitter and consumers"]
    RESUME["Normal daemon resume path"]
  end

  OP --> PARSE --> RESOLVE
  RESOLVE --> AUTH --> QUIET
  QUIET --> PARK
  QUIET --> ACTIVE
  QUIET --> SERVICE
  SERVICE -->|"inspect"| LEDGER
  SERVICE -->|"reset or extend"| TX
  TX --> LEDGER
  TX --> HALT
  TX --> EXTWRITE --> EXTEVENTS
  EXTEVENTS -->|"tail and re-emit"| BUS
  CONSUME --> LEDGER --> CAP
  CAP --> HALT
  HALT --> RESUME
  PARK --> RESUME
```

## Recovery sequence

```mermaid
sequenceDiagram
  actor Operator
  participant CLI as Budget recovery CLI
  participant Resolver as Feature resolver
  participant Guard as Identity and quiescence guard
  participant Ledger as Kickback ledger
  participant Halt as HALT pair
  participant Events as External event writer
  participant Daemon as Daemon resume path

  Operator->>CLI: inspect feature «slug»
  CLI->>Resolver: resolve exactly one worktree
  Resolver-->>CLI: worktree and main repository
  CLI->>Ledger: read budget and adjustment history
  CLI->>Halt: read halt body and class
  CLI-->>Operator: consumed, limit, remaining, latest reason,<br/>mechanical exclusion, adjustments

  Operator->>CLI: reset or extend with rationale
  CLI->>Guard: verify TTY, operator identity,<br/>parked and no active dispatch
  Guard-->>CLI: quiescent or refusal
  CLI->>Ledger: compare current snapshot to inspected state
  CLI->>Halt: verify exact cumulative-cap terminal state
  alt stale, ambiguous, wrong halt, or invalid request
    CLI-->>Operator: refusal with zero mutation
  else guarded recovery
    CLI->>Ledger: atomically record attributed adjustment
    CLI->>Events: append adjustment occurrence with before and after values
    CLI->>Halt: atomically clear only matching halt pair
    alt any recovery stage fails
      CLI->>Ledger: restore prior budget snapshot
      CLI->>Halt: retain or restore protective halt
      CLI-->>Operator: recovery refused, feature remains quiescent
    else all stages succeed
      CLI-->>Operator: recovery recorded, safe to resume
      Operator->>Daemon: return feature to normal dispatch ownership
      Daemon->>Ledger: consume against adjusted budget
    end
  end
```

## Budget state and invariants

```mermaid
stateDiagram-v2
  [*] --> Active: fresh feature budget
  Active --> Active: semantic failure consumes one lap
  Active --> Exhausted: consumed exceeds effective limit
  Exhausted --> Active: attributed reset sets consumed to zero
  Exhausted --> Active: attributed extension raises effective limit
  Active --> Active: rebase invalidation credits lap counters
  Active --> [*]: fresh feature session clears ledger
```

- `cumulative` remains the active semantic-lap count used by the engine.
- The effective limit defaults to the existing constant; a legacy entry with no override resolves to
  that default.
- Reset changes the active count only. Extension changes the selected feature's effective limit
  only. Neither mutates repository-wide configuration or the separate per-tree count.
- Each adjustment record carries a stable id, kind, before/after count and limit, operator,
  rationale, and timestamp. Repeated delivery of the same id is idempotent.
- The existing `mechanicalFaults` and `lastMechanicalFault` fields remain outside cumulative
  consumption and outside reset/extension mutation.
- The cap writer persists typed exhausted-state evidence beside the budget before writing the human
  halt. Recovery requires that typed evidence, the current budget generation, and the halt pair to
  agree; prose matching alone never authorizes mutation.
- A quiescence guard prevents a daemon dispatch from consuming or rewriting the ledger during the
  operator transaction. Failure is toward parked/halted.

## Event spine verdict

```
Event spine
  Channel?    yes — an operator budget adjustment is an occurrence consumers must observe
  Concern:    occurrence — who changed which feature budget, when, and from/to what values
  Verdict:    sibling ledger, same ConductorEvent schema
  Exception:  A and B — the operator CLI is a separate process and must not share an append writer
```

Budget counts, adjustment history, and typed exhausted evidence remain durable control state under
exception C; they are not reconstructed from telemetry. The operator occurrence is a new typed
`ConductorEvent` emitted through the existing external-process writer and tailed onto the normal bus.
No bespoke sidecar, ad-hoc log, or second event schema is introduced.

## Existing seams reused

- Named feature/worktree resolution and interactive identity follow the current operator-facing
  `build-review` command boundary.
- Compare-before-mutate behavior and protective halt restoration follow the operator rewind
  transaction pattern.
- Atomic ledger writes continue through the kickback ledger's temp-file-and-rename boundary.
- External-process telemetry follows the existing same-schema event writer used by operator review
  decisions.
- Normal daemon park, halt, and resume semantics remain authoritative; budget recovery does not
  dispatch, build, or merge the feature.

> **Amended 2026-08-29 by #1760:** Architecture review found that the original sequence's direct
> CLI clearing cannot atomically cover ledger state, the external event, halt markers, park state,
> and committed halt presentation. The approved target is a staged ledger adjustment followed by a
> daemon-owned resume handoff. The corrected sequence below supersedes only the direct-clear arrows;
> the component boundaries and state invariants above remain unchanged.

## Corrected recovery sequence after architecture review

```mermaid
sequenceDiagram
  actor Operator
  participant CLI as Budget recovery CLI
  participant Park as Operator park boundary
  participant Ledger as Leased kickback ledger
  participant Events as External same-schema writer
  participant Daemon as Daemon resume path
  participant Halt as Halt lifecycle

  Operator->>CLI: reset or raise feature «slug» with rationale
  CLI->>Park: establish temporary park or preserve existing park
  CLI->>Ledger: verify exact typed cumulative-cap halt
  CLI->>Ledger: stage adjustment id, active budget unchanged
  CLI->>Events: append authorization occurrence exactly once
  CLI->>Ledger: apply values, history, and resume authorization atomically
  alt command created the park
    CLI->>Park: release temporary park
  else park pre-existed
    CLI-->>Operator: adjustment committed, explicit unpark still required
  end
  Daemon->>Ledger: validate resume authorization and live halt generation
  Daemon->>Halt: clear matching halt through canonical lifecycle
  Daemon->>Ledger: consume resume authorization
  Daemon->>Daemon: resume normal feature selection
```

## Change log

| Date | Change | Reason |
|---|---|---|
| 2026-08-29 | Initial Medium-tier component, sequence, and state diagrams | Composer DECIDE for jstoup111/ai-conductor#1760 |
| 2026-08-29 | Added corrected staged-adjustment and daemon-handoff sequence | Architecture review removed an infeasible multi-file direct-clear transaction |
| 2026-08-29 | Kept `needs-human`; moved exact cap identity to typed ledger evidence | Conflict-check preserved the approved halt taxonomy and committed-record lifecycle |
| 2026-08-29 | Added dependency-ordered implementation wiring | Plan update mapped 19 tasks onto the approved component boundaries |

> **Amended 2026-08-29 by #1760:** Repository-wide conflict-check found that naming
> `kickback-cap` as a new `HALT.class` contradicts the approved two-disposition engine halt
> contract. The controlling design keeps `HALT.class = needs-human`; typed ledger evidence and its
> generation establish the exact cap identity. The daemon checks an explicit matching authorization
> before the generic needs-human retention branch. The earlier “cumulative-cap terminal” labels
> remain domain descriptions, not a new sidecar value.

## Corrected halt classification and authorization sequence

```mermaid
sequenceDiagram
  participant Cap as Cumulative-cap writer
  participant Ledger as Leased kickback ledger
  participant Halt as Canonical halt lifecycle
  participant Daemon as Daemon halted-feature boundary

  Cap->>Ledger: persist typed cap evidence and stable generation
  Cap->>Halt: write HALT with class needs-human
  Daemon->>Daemon: reject while an operator park stands
  Daemon->>Ledger: read resume authorization and live cap evidence
  alt authorization missing, stale, malformed, or mismatched
    Daemon->>Halt: retain needs-human halt unchanged
  else exact authorization and generation match
    Daemon->>Halt: canonical clear and committed-record resolution
    Daemon->>Ledger: consume authorization
    Daemon->>Daemon: resume normal feature selection
  end
```

> **Plan update 2026-08-29 by #1760:** The implementation plan resolves the approved architecture
> into the dependency-ordered wiring below. This is additive implementation detail; it changes no
> accepted component boundary, state invariant, event-spine verdict, or halt classification.

## Planned implementation wiring

```mermaid
flowchart LR
  Schema[Typed budget schema<br/>Task 1] --> View[Canonical budget view<br/>Task 2]
  Schema --> Lease[Leased ledger mutations<br/>Tasks 3-4]
  View --> Cap[Effective cap and evidence<br/>Task 5]
  Lease --> Cap
  EventType[Authorization event contract<br/>Task 6] --> EventWrite[Idempotent external append<br/>Task 7]
  Resolver[Shared feature resolver<br/>Task 8] --> Commands[Inspect and guarded mutation preconditions<br/>Tasks 9-12]
  View --> Commands
  Lease --> Commands
  EventWrite --> Adjust[Reset, raise, and reconciliation<br/>Tasks 13-15]
  Commands --> Adjust
  Cap --> Resume[Daemon exact-authorization resume<br/>Task 16]
  Adjust --> Resume
  Commands --> Preboot[Pre-boot CLI dispatch<br/>Task 17]
  Adjust --> Preboot
  Cap --> Render[Canonical halt rendering<br/>Task 18]
  Preboot --> Observability[Merged event, audit, and UI consumers<br/>Task 19]
  EventType --> Observability
  EventWrite --> Observability
```
