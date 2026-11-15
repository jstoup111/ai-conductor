# Components and sequence: Mechanical restack resolution

**Last updated:** 2026-11-15
**Scope:** Proposed extension of stacked replay and recovery for #3632; operator-approved component boundaries, with implementation ownership recorded in the 12-task plan.

## Component diagram

```mermaid
graph TD
  Entry[Stack preflight and recovery] --> Replay[Existing off-worktree replay]
  Replay --> Prevention[Candidate selection and bookkeeping conflict prevention]
  Prevention --> Clean[Clean replay candidate]
  Prevention --> Conflict[Remaining conflict]
  Conflict --> Reuse[Validate recorded resolution against current inputs]
  Reuse -->|eligible| Candidate[Resolution candidate]
  Reuse -->|missing or stale| Deterministic[Explicit deterministic resolution rules]
  Deterministic -->|rule proves eligibility| Candidate
  Deterministic -->|unsupported or ambiguous| Resolver[Configured strong resolver]
  Resolver -->|candidate| Candidate
  Resolver -->|design choice required| Operator[Operator decision]
  Operator --> Entry
  Candidate --> Validation[Rule or reuse evidence plus existing acceptance safeguards]
  Clean --> Validation
  Validation -->|accepted| Journal[Existing durable journal and rewrite map]
  Validation -->|eligible source conflict| Resolver
  Validation -->|invalid bookkeeping or operational failure| Halt[Typed halt or recovery outcome]
  Journal --> Pins[Accepted-result record and candidate commit pin]
  Pins --> Recovery[Reuse after a later-child halt]
  Recovery --> Reuse
  Journal --> Apply[Existing atomic ref transaction]
  Apply --> Revalidate[Existing post-restack gate invalidation and revalidation]
  Reuse -.-> Events[ConductorEventEmitter and ConductorEvent union]
  Deterministic -.-> Events
  Resolver -.-> Events
  Validation -.-> Events
  Apply -.-> Events
  Journal -.-> Outbox[Pending events in authoritative state]
  Outbox -.-> Events
  Events --> Persist[EventPersister and events.jsonl]
  Persist --> Report[Existing reporting consumers]
```

## Interrupted-operation sequence

```mermaid
sequenceDiagram
  participant Engine as Preflight or recovery
  participant State as Durable journal and resolution records
  participant Replay as Replay and resolution
  participant Accept as Candidate validation
  participant Git as Atomic Git ref transaction
  participant Bus as Existing event spine
  Engine->>State: Read recorded inputs and completed child results
  State-->>Engine: Durable identities and available evidence
  Engine->>Replay: Continue only work not safely reusable
  Replay->>Accept: Candidate and its resolution provenance
  Accept-->>Engine: Accepted, escalate, or refuse
  alt Accepted
    Engine->>State: Persist accepted candidate and exact rewrite map
    Engine->>Git: Apply complete checked cascade with expected old refs
    Git-->>Engine: Applied or compare-and-swap refused
    Engine->>Bus: Emit actual outcome with operation and round context
  else Shortcut cannot establish safety
    Engine->>Replay: Escalate within a bounded attempt policy
  else Unresolved or operational failure
    Engine->>Bus: Emit typed failure without moving stack refs
  end
```

## Legend

Solid arrows show control or authoritative state flow. Dotted arrows show reporting through the existing event spine. Durable records remain authority; events describe occurrences. Existing modules are extended rather than introducing a second replay engine or telemetry channel.

## Verified basis

- `restack-executor.ts` and `restack-recovery.ts` already consume recorded resolutions and invoke ownership checks.
- `restack-replay.ts` already handles selected bookkeeping conflicts and selects replay candidates.
- `restack-journal.ts` persists child state, exact rewrites, and routed-round context.
- `restack-ownership.ts` checks path ownership and selected parent reverts. These checks do not prove arbitrary behavioral equivalence.
- The approved journaled-replay ADR requires off-worktree computation and atomic ref application; those boundaries remain.

## Boundaries for architecture review

The approved ADR and plan define deterministic eligibility, exact automatic-reuse identity, bounded escalation, and evidence required before application. Candidate commits are pinned as Git objects; JSON references alone do not retain them. Accepted-state event delivery uses the existing persister and durable outbox pattern. It must distinguish rejected shortcut candidates from exhausted strong-resolver attempts so the diagram's escalation edge cannot form an unbounded loop. Existing post-restack validation does not substitute for the requested before-application safety checks.

Generic adjacent-line union and blanket union of `.memory/` files are not approved rules. Memory storage-policy changes require separate operator approval. Recorded answers cannot be reused merely because conflict text resembles a prior conflict. No new small-model tier is included.

Per-round reporting must distinguish completed resolutions, rejected candidates, reuse, provider attempts, and failures without double-counting resumed operations. Historical intake costs are not a forecast of savings. Operational failures remain explicit outcomes even when no design choice is needed.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-11-15 | Initial component and recovery diagrams | Approved comprehensive Approach A |
