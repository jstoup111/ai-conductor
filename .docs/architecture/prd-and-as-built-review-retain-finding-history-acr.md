# Components and sequences: PRD and as-built finding continuity

**Last updated:** 2026-09-30
**Diagram approval:** Initial flow and plan-aligned publication/checkpoint and join detail approved by the operator on 2026-09-30.

**Scope:** Approved #2440 flow, following accepted technical approach A. Each gate receives its own complete relevant history and reconciles current findings without borrowing another gate's approval. Concrete contracts, v3 migration, transition semantics, and bounds follow approved adr-2026-09-30-gate-local-review-finding-continuity D1-D12.

## Components

```mermaid
graph TD
    INPUT["Current feature evidence and governing criteria or ADRs"]
    HISTORY[("Existing case store v3: separate gate histories")]
    CHECKPOINT[("Existing conduct-state: required-history and receipt references")]
    OWNER["Serial owner or single-writer join: atomic history publication"]
    DECISIONS[("Original operator decisions and scope")]
    REPAIRS["Existing repair attempts and verified outcomes"]
    PROJECTION["Engine: bounded gate-specific history projection"]
    REVIEW["PRD auditor or as-built reviewer"]
    CURRENT["Validated current findings"]
    JUDGE["Typed semantic reconciliation using selected provider"]
    VALIDATE["Engine: source completeness, authority, freshness"]
    RESULT["Gate-specific effective findings and traceable relationships"]
    GATE["Existing gate completion and routing"]
    RECOVERY["Explicit unresolved result or recoverable fault"]
    EVENTS["ConductorEventEmitter to ConductorEvent to EventPersister"]

    INPUT --> PROJECTION
    HISTORY --> PROJECTION
    DECISIONS --> PROJECTION
    REPAIRS --> PROJECTION
    PROJECTION --> REVIEW
    REVIEW --> CURRENT
    CURRENT --> JUDGE
    PROJECTION --> JUDGE
    JUDGE --> VALIDATE
    VALIDATE --> OWNER
    OWNER --> HISTORY
    OWNER --> CHECKPOINT
    HISTORY --> RESULT
    CHECKPOINT --> RESULT
    RESULT --> GATE
    VALIDATE --> RECOVERY
    PROJECTION --> RECOVERY
    RESULT --> EVENTS
    RECOVERY --> EVENTS
    DECISIONS --> VALIDATE
```

## Sequence: current finding and earlier decision

```mermaid
sequenceDiagram
    actor Operator
    participant Engine
    participant State as Durable state
    participant Reviewer
    participant Judge as Reconciliation judgment
    participant Gate
    Engine->>State: Read this gate's history and original decisions
    State-->>Engine: Prior findings, decisions, attempts, resolution evidence
    Engine->>Reviewer: Current evidence and bounded history context
    Reviewer-->>Engine: Current findings under existing verdict contract
    Engine->>Engine: Validate current output
    Engine->>Judge: Frozen current sources and gate-local history
    Judge-->>Engine: Typed relationships and reasons for every source
    Engine->>Engine: Validate completeness, references, authority, freshness
    Engine->>State: Atomically persist observations, transitions and receipt
    Engine->>State: Commit matching conduct-state completion reference
    alt Repeated assertion resolved by current criterion or clause evidence
        Engine->>Gate: Resolve only that assertion and retain unrelated failures
    else Relation and original operator decision cover current scope
        Engine->>Gate: Apply scoped authority through existing classification
    else Uncertain relationship or new decision needed
        Engine-->>Operator: Traceable unresolved finding and decision needed
    else Current defect remains actionable
        Engine->>Gate: Preserve current obligation under existing routing
    end
```

## Sequence: attempted repair and recurrence

```mermaid
sequenceDiagram
    participant Gate
    participant Engine
    participant Repair as Existing repair path
    participant State as Durable state
    participant Reviewer
    Gate->>Engine: Current obligation under approved authority
    Engine->>Repair: Existing admitted repair route
    Repair-->>Engine: Attempt evidence and actual outcome
    Engine->>State: Retain attempt evidence without claiming resolution
    Engine->>Reviewer: New evidence with prior finding and attempt history
    Reviewer-->>Engine: Current gate judgment and supporting evidence
    Engine->>Engine: Reconcile and validate under this gate's authority
    Engine->>State: Preserve finding relationship and resolution evidence
    Note over Engine,State: Disappearance alone does not invent a verified repair
    Reviewer-->>Engine: Later materially changed or recurring defect
    Engine->>Engine: Judge recurrence against retained evidence
    Engine->>State: Retain reason for reopening or distinct obligation
```

## Sequence: restart and unusable history

```mermaid
sequenceDiagram
    participant Engine
    participant State as Durable state
    participant Judge as Reconciliation judgment
    participant Gate
    actor Operator
    Engine->>State: Load gate-local history after restart
    alt Known first use with no prior history
        Engine->>State: Initialize explicit fresh history
        Engine->>State: Commit required-history enrollment before dispatch
    else Required history missing, corrupt, or over bounds
        Engine-->>Operator: Recoverable fault identifying affected evidence
        Note over Engine,Gate: No silent omission or success verdict
    else Valid history
        Engine->>Engine: Check current source, authority, code and contract identity
        alt Prior reconciliation remains valid for this exact input
            Engine->>Gate: Reuse validated result with source trace
        else Changed input needs substantive judgment
            Engine->>Judge: Current sources and preserved history
            Judge-->>Engine: Typed relationships or explicit uncertainty
            Engine->>Engine: Validate and persist, or keep unresolved
        end
    end
```

## Sequence: concurrent review reaches its history-owning join

```mermaid
sequenceDiagram
    participant Engine
    participant PRD as PRD branch
    participant AB as As-built branch
    participant Join as Single-writer join
    participant State as Case store and conduct-state
    participant Gate
    Engine->>Engine: Capture original decisions, enroll history, freeze member inputs
    par Independent review artifacts
        Engine->>PRD: Immutable PRD history and current evidence
        PRD-->>Join: Validated raw PRD result or existing provider fault
    and Independent review artifacts
        Engine->>AB: Immutable as-built history and current evidence
        AB-->>Join: Validated raw typed result or existing provider fault
    end
    Note over PRD,Join: A valid branch does not retry while waiting for a join-owned receipt
    Join->>Join: Reconcile complete gate sources with current evidence
    Join->>State: Publish each valid batch atomically, then matching checkpoint
    Note over Join,State: Preserve valid sibling history without granting a failed sibling satisfaction
    Join->>Gate: Shared effective classification after history publication
    Note over State,Gate: Restart can finish a matching checkpoint without another judgment
```

## Boundaries and integration constraints

- The boxes are logical responsibilities, not new lifecycle steps or a commitment to an additional provider call. Approved D5/D7 puts reconciliation after raw review, at the serial owner or single-writer join. This diagram does not authorize consolidated routing or budget redesign.
- PRD audit remains governed by story criteria and requirement/plan intent. As-built remains governed by approved ADR and plan authority. A prior autonomous dismissal or sibling-gate success cannot grant operator approval or force a gate pass.
- Preserve the shipped #2429 original-decision capture, scoped accept/refuse authority, and NC reconciliation. Include criterion findings as history without semantically widening criterion-keyed approvals.
- Consume #2188's typed as-built contract. Integrate with the existing PRD parsed representation on this baseline; #2521 owns its verdict/parser migration. New reconciliation results use the existing provider-native schema seam, not a new Markdown parser.
- Current findings remain individually traceable even when several relate to one case or require a human decision. Rewording, reordering, and report-local identifier changes are evidence changes to judge, not automatic new obligations.
- Persist history as state using the existing state-artifact pattern (event-spine exception C). Publish reconciliation occurrences through the existing event spine; add no parallel telemetry schema.
- Both serial and concurrent review execution must reach the same history/validation boundary. No lease is held across model judgment. Changed evidence or operator authority invalidates stale results before publication.
- Existing build-review and widening histories survive the extension. Overflow and missing required history are explicit recovery conditions; no truncation, guessed continuity, or fabricated resolution.

## Verified basis

At current GitHub main 99d077d837f6b5cbeb2a3fcbde21ed1a036a50c4, the shared store supports build_review and prd_widening. `buildPrdWideningContext` filters to no-owner OVER_SCOPE sources. `buildAsBuiltProjection` reads pending REMEDIABLE findings through `readPendingAsBuiltRemediationFindings`. Successful as-built review projects pending repair outcomes into the current typed verdict and clears the pending set; this is not a full persistent review-history input. See the current-main validation in the track artifact and the exploration evidence ledger in `.pipeline/`.

## Legend

Rectangles denote logical processing responsibilities. Cylinders denote durable feature-local state. The selected provider supplies review and semantic judgment through the existing Claude/Codex seams. Gate authority and original operator decisions remain distinct from case relationships. Storage/versioning and allowed transitions follow the approved continuity ADR.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-09-30 | Initial component flow and three sequences | Operator selected durable cases; current-main validation confirms remaining #2440 gap |
| 2026-09-30 | Plan update: explicit v3/checkpoint publisher, current resolution, enrollment, and group join sequence | Reflect approved D2/D6/D7/D9 and tasks 1–40; no new architectural decision |

## Plan integration map

| Diagram responsibility | Plan tasks |
| --- | --- |
| v3 case store and required checkpoint | 1–10 |
| Immutable review history inputs | 11–13 |
| Current sources, semantic relationships, preserved authority | 14–22 |
| Atomic publication and restart/sibling handling | 23–26 |
| Actual admitted/executed repair facts | 27–30 |
| Effective completion and raw branch/join boundary | 31–33 |
| Bounded native-schema dispatch | 34–37 |
| Views, existing events, actionable recovery | 38–40 |
