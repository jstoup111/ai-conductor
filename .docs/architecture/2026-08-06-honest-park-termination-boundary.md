# Components: Honest park termination boundary

**Last updated:** 2026-08-06
**Scope:** The daemon's feature-termination boundary in `daemon-runner.ts` — how a park decision
becomes durable park state, how the `.pipeline/HALT` note is worded, and which downstream readers
consume each artifact. Covers intake `jstoup111/ai-conductor#1328`.

## Current state (defective)

The park decision and the durable park state are produced by two unrelated code paths. Only the
operator CLI reaches the marker writer; the automatic path stops at the HALT note.

```mermaid
graph TD
    subgraph Deciders
        ST["setup-triage.ts<br/>TriageOutcome kind park"]
        DR["daemon-runner.ts<br/>error boundary"]
        CLI["daemon-park-cli.ts<br/>conduct-ts daemon park"]
    end

    subgraph Writers
        WEH["writeErrorHalt<br/>daemon-runner.ts:578"]
        PM["park-marker.ts<br/>writeAutoPark / writeOperatorPark"]
    end

    subgraph "Disposable — worktree"
        HALT[".worktrees/«slug»/.pipeline/HALT<br/>text asserts 'parked for human inspection'"]
    end

    subgraph "Durable — main repo root"
        MARK[".daemon/parked/«slug»"]
    end

    subgraph Readers
        BL["daemon-backlog.ts:846<br/>isOperatorParked gates eligibility"]
        PR["park-reconciliation.ts:479<br/>counts markers observed"]
        OP["Operator reading HALT"]
    end

    ST -->|kind park| DR
    DR -->|"4 call sites: :356 :484 :536 :556"| WEH
    WEH --> HALT
    CLI --> PM
    PM --> MARK

    MARK --> BL
    MARK --> PR
    HALT --> OP

    DR -.->|"MISSING EDGE — the defect"| PM
    BL -.->|"HALT is not consulted"| HALT

    classDef bad fill:#fdd,stroke:#c00,stroke-width:2px
    class HALT bad
```

The dotted `MISSING EDGE` is the whole bug: `daemon-runner.ts` decides `park`, writes a HALT that
claims the park happened, and returns `status: 'error'` — but nothing ever reaches `park-marker.ts`.
`daemon-backlog.ts:846` consults only `.daemon/parked/«slug»`, so the slug stays dispatchable and is
re-dispatched on the next scan, burning a fix-session each cycle. `park-reconciliation.ts:479`
derives its `parked` count from markers it observes, so it truthfully reports `parked=0`.

## Target state (approach B)

One boundary primitive owns the decision, the marker write, and the wording. The HALT text is
*derived* from what was actually written, so the note cannot assert a park that did not happen.

```mermaid
graph TD
    subgraph Deciders
        ST["setup-triage.ts<br/>TriageOutcome kind park"]
        DR["daemon-runner.ts<br/>4 termination sites declare park intent"]
        CLI["daemon-park-cli.ts<br/>conduct-ts daemon park"]
    end

    subgraph "New boundary primitive"
        PT["terminateFeature<br/>park intent in, rendered note out"]
    end

    subgraph Writers
        PM["park-marker.ts<br/>writeAutoPark (idempotent, main-root resolving)"]
        HW["HALT note renderer<br/>wording derived from write result"]
    end

    subgraph "Disposable — worktree"
        HALT[".worktrees/«slug»/.pipeline/HALT"]
    end

    subgraph "Durable — main repo root"
        MARK[".daemon/parked/«slug»<br/>auto-parked: «reason»"]
    end

    subgraph Readers
        BL["daemon-backlog.ts:846<br/>eligibility"]
        PR["park-reconciliation.ts:479<br/>sweep count"]
        OP["Operator reading HALT"]
    end

    ST -->|kind park| DR
    DR -->|"park intent true — site :356"| PT
    DR -->|"park intent false — sites :484 :536 :556"| PT
    CLI --> PM

    PT -->|"intent true"| PM
    PM -->|"write result"| PT
    PT -->|"renders note from result"| HW
    HW --> HALT
    PM --> MARK

    MARK --> BL
    MARK --> PR
    HALT --> OP

    classDef good fill:#dfd,stroke:#0a0,stroke-width:2px
    class PT good
```

Ordering is load-bearing: the marker write precedes the HALT render, so a failure to park produces
a note that says so rather than a note that lies. Because `writeAutoPark` is idempotent on `EEXIST`
and resolves the main repo root via `git rev-parse --git-common-dir`, calling it from inside a
worktree is safe and repeat-safe.

## Legend

- **Disposable — worktree**: `.pipeline/HALT` lives inside `.worktrees/«slug»/`, which this repo
  treats as recreatable (CLAUDE.md, Daemon Operations Safety rule 3). It is operator-facing prose
  and must never be load-bearing for dispatch control.
- **Durable — main repo root**: `.daemon/parked/«slug»` survives worktree removal and is the only
  artifact `daemon-backlog.ts` honors. It is the single source of dispatch-stop truth.
- **Red node**: artifact whose content is currently false with respect to on-disk state.
- **Green node**: component introduced by this change.
- Dotted edges denote absent or unread relationships, not runtime calls.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-06 | Initial generation | Spec for intake #1328 — automatic park writes no marker |
