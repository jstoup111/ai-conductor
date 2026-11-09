# Components and Sequence: Composer run checkpoint, resume, provider switch, and hand-off

**Last updated:** 2026-11-07
**Scope:** How a Composer run is saved, made visible, and resumed across sessions, providers, machines,
and operators (#2050). The diagram shows the planned structure. Where the run record is stored and how
events are shaped are decided by architecture-review.

## Diagram

```mermaid
graph TD
    subgraph PEOPLE["People"]
        OPA["Operator A"]
        OPB["Operator B / teammate"]
        REV["Reviewer"]
    end

    subgraph MACHINE["Any operator machine"]
        LAUNCH["compose launcher<br/>compose-launch-host + interactive-launch<br/>continue / switch provider / hand off"]
        HOST["Interactive host session<br/>Claude or Codex running /composer<br/>human-gated DECIDE skills"]
        subgraph PRIMS["Deterministic compose primitives"]
            WT["worktree<br/>worktree-authoring.ts"]
            CKPT["checkpoint (new)<br/>commit artifacts + run record, publish"]
            RESUME["resume (new)<br/>fetch spec branch, attach worktree,<br/>load run record and PR comments"]
            LAND["land<br/>land-spec.ts over already-saved artifacts"]
            HAND["handoff<br/>handoff.ts readies existing draft PR"]
        end
        PUB["Guarded publication<br/>push spec/«slug», gh PR writes"]
        SAN["Inbound neutralization<br/>sanitize-inbound.ts"]
        LEDGER[("Per-machine intake ledger<br/>~/.ai-conductor/engineer<br/>stale-claim recovery")]
        SPINE[("Event spine<br/>ConductorEvent to events.jsonl")]
    end

    subgraph REMOTE["Shared remote: source of truth"]
        BRANCH[("spec/«slug» branch<br/>accepted artifacts + unaccepted drafts<br/>+ run record")]
        PR["Draft spec PR<br/>body rendered from run record<br/>display only"]
        COMMENTS["PR review comments<br/>untrusted review input"]
        ISSUE["Source intake issue<br/>assignees never changed"]
    end

    DAEMON["Daemon<br/>reads base-branch .docs/plans only"]

    OPA --> LAUNCH
    OPB --> LAUNCH
    REV --> COMMENTS
    LAUNCH -- "launch or relaunch with chosen provider" --> HOST
    HOST --> WT
    HOST -- "step accepted or session exits mid-step" --> CKPT
    LAUNCH -- "resume «PR | branch | issue»" --> RESUME
    CKPT --> PUB
    RESUME --> SAN
    COMMENTS --> SAN
    SAN -- "neutralized comments for operator disposition" --> HOST
    PUB -- "fast-forward only; refused if behind" --> BRANCH
    PUB -- "first save opens; later saves refresh" --> PR
    PUB -- "disposition replies" --> COMMENTS
    BRANCH --> RESUME
    RESUME -- "reconcile claim from remote progress" --> LEDGER
    CKPT -. "save / switch events" .-> SPINE
    RESUME -. "resume event" .-> SPINE
    LAUNCH -. "intentional switch, distinct from fallback" .-> SPINE
    HOST --> LAND
    LAND --> HAND
    HAND -- "draft to ready; Refs issue" --> PR
    HAND -. "ensureRunning once" .-> DAEMON
    PR -. "operator merges" .-> DAEMON
    PR -. "Refs, non-closing" .-> ISSUE
```

```mermaid
sequenceDiagram
    participant A as Operator A
    participant L as compose launcher
    participant H1 as Host session (provider 1)
    participant C as compose checkpoint
    participant G as spec/«slug» + draft PR
    participant B as Operator B
    participant R as compose resume
    participant H2 as Host session (provider 2)

    A->>L: compose (provider 1)
    L->>H1: launch /composer
    H1->>C: explore accepted
    C->>G: push spec/«slug», open draft PR (Refs issue)
    H1->>C: session exits mid-PRD
    C->>G: push PRD as UNACCEPTED draft, refresh PR body
    L-->>A: unfinished: continue / switch provider / hand off
    A->>L: hand off
    Note over G: Reviewer leaves PR comments
    B->>R: resume «PR» with provider 2
    R->>G: fetch branch, read run record, read unresolved comments
    R->>R: neutralize comments, reconcile local intake claim
    R->>H2: launch /composer at first unaccepted step
    H2-->>B: comment dispositions + PRD draft to critique / revise / accept
    H2->>C: PRD accepted (by B, provider 2)
    alt remote moved since fetch
        C-->>B: refused non-fast-forward, offer newer progress
    else fast-forward
        C->>G: push, reply dispositions, refresh PR body
    end
```

## Legend

- **Source of truth.** The `spec/«slug»` branch on the shared remote holds all run state: accepted
  artifacts, unaccepted drafts, and the run record. The draft PR body is rendered from that record and
  is never read back as state.
- **New components:** `checkpoint` and `resume`, plus the launcher's between-session choice.
  Everything else exists today and changes behavior: `worktree` reuses a checkpointed run, `land` works
  over artifacts that are already saved, and `handoff` readies an existing draft PR instead of creating
  one.
- **Dashed edges** are telemetry or side effects. The run's save, resume, and switch events extend the
  existing event spine; no parallel channel is added.
- **Concurrency.** There is no ownership lock. A publication that is not a fast-forward is refused, so
  newer progress is never overwritten.
- **Daemon isolation.** The daemon discovers only `.docs/plans` on the base branch
  (`daemon-backlog.ts`), so an in-progress, unmerged spec branch is invisible to it.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-07 | Initial generation | #2050 DECIDE architecture-diagram step |
