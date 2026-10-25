# Components: FINISH Reports the Real PR-Publish Failure (#3376)

**Last updated:** 2026-10-24
**Scope:** The path from a provider-run guarded GitHub write during FINISH's `author_pr_prose`
pass to the FINISH halt disposition — the `github-operation` CLI
(`github-operations-cli.ts`, launched by the provider with the feature worktree as cwd), the
single-writer sibling ledger (`.pipeline/pipeline-events.jsonl`) and the session event tail
(`CloseoutEventTail`) that re-emits admitted kinds onto the bus, the production authoring effect (`finish-publication-production.ts`
`authorProse`), and the publication coordinator (`finish-publication.ts` `advanceFinishPublication`
author branch and `HUMAN_REQUIRED_REASONS`). Transport (`tracker-client.ts` `gh pr edit`) is
unchanged and out of scope.

## Diagram

```mermaid
graph TD
    subgraph Provider["Provider FINISH session (cwd = feature worktree)"]
        PROV["FINISH authoring pass<br/>authors title/body"]
        CLI["github-operation CLI<br/>github-operations-cli.ts<br/>NEW: emit github_operation_failed<br/>on a failed result"]
        TRK["tracker-client.ts<br/>gh pr edit (unchanged)"]
    end

    subgraph Spine["Event spine (existing)"]
        EVT["ConductorEvent union<br/>NEW variant: github_operation_failed<br/>operation, target, bounded error"]
        SIB[("worktree .pipeline/pipeline-events.jsonl<br/>CLI-owned sibling ledger<br/>NEW admitted kind")]
        TAIL["session event tail<br/>CloseoutEventTail re-emits admitted kinds"]
        LOG[("worktree .pipeline/events.jsonl<br/>engine single writer")]
    end

    subgraph Engine["Engine FINISH publication"]
        AUTH["authorProse effect<br/>finish-publication-production.ts<br/>NEW: subscribe to bus during dispatch,<br/>flush tail, keep failures for this PR"]
        COORD["advanceFinishPublication<br/>finish-publication.ts author branch<br/>NEW: publish failure → human_required<br/>publication_operation_failed + error"]
        UNMOVED["existing: publication_transition_unmoved<br/>'left pr.prose unchanged at placeholder'"]
        HALT["FINISH halt reason + loop_halt event"]
    end

    PROV -->|guarded pull-request.edit| CLI
    CLI --> TRK
    TRK -->|kind: failed| CLI
    CLI -->|append| SIB
    SIB -.->|schema| EVT
    SIB --> TAIL
    TAIL -->|re-emit on bus| LOG
    AUTH -->|dispatch| PROV
    AUTH -->|flush after dispatch| TAIL
    TAIL -->|github_operation_failed on bus| AUTH
    AUTH -->|publish failure observed| COORD
    COORD -->|failure present| HALT
    COORD -->|no failure, placeholder remains| UNMOVED
    UNMOVED --> HALT
```

```mermaid
sequenceDiagram
    participant C as Coordinator (finish-publication.ts)
    participant A as authorProse (production)
    participant P as Provider session
    participant G as github-operation CLI
    participant S as pipeline-events.jsonl
    participant T as Session tail / bus
    C->>A: author_pr_prose (placeholder observed)
    A->>T: subscribe github_operation_failed
    A->>P: dispatch FINISH author pass
    P->>G: pull-request.edit «pr»
    G-->>P: kind failed (missing scope)
    G->>S: github_operation_failed «pr», error text
    P-->>A: provider attempt success
    A->>T: flush tail
    T->>S: read new records
    T-->>A: github_operation_failed «pr» (re-emitted)
    A->>T: unsubscribe
    A-->>C: publish failure with error text
    C->>C: re-observe PR (prose still placeholder)
    C-->>C: human_required publication_operation_failed
```

## Legend

- **NEW** marks behavior this change adds; unmarked nodes exist today.
- `«pr»` is the feature's pull-request target (repository + number).
- The pass window is the bus subscription from before dispatch until the post-dispatch tail flush;
  only `pull-request.edit` failures for the feature's own PR target delivered in it count. The
  session tail stays the sibling ledger's only reader (operator decision 2026-10-25).
- The CLI never writes the engine-owned `events.jsonl` for this event (adr-2026-08-08 D2); the
  session tail re-emits it there.
- Re-observation stays authoritative: if the PR prose moved despite a recorded failure (e.g. a later
  retry succeeded), the transition advances normally.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial generation | Spec for jstoup111/ai-conductor#3376 |
| 2026-10-24 | Route the event through the sibling ledger and tail | Architecture review: one writer per ledger |
| 2026-10-24 | Plan update: no structural change; the diagram matches plan Tasks 1–6 | /plan step 8b |
| 2026-10-25 | authorProse observes failures on the feature bus after a tail flush, not by reading the sibling ledger | Operator decision resolving build_review eventSpine stop 64898260 |
