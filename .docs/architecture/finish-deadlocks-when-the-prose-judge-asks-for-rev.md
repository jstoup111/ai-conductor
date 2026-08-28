# Components: FINISH prose revision lap (issue #2006)

**Last updated:** 2026-08-28
**Scope:** the FINISH publication prose subsystem — how a judged-deficient PR body routes back
to authoring instead of deadlocking on `publication_transition_unmoved`.

## Diagram

```mermaid
graph TD
    subgraph Observation["Observation (finish-publication-production.ts)"]
        GH["gh pr view: title, body, labels"] --> CLS["prProse classifier"]
        STORE[".pipeline/prose-judgment.json<br/>persisted verdicts by revision digest"] --> CLS
        CLS --> SNAP["PublicationSnapshot.pr.prose<br/>accepted, stale, placeholder,<br/>halt, indeterminate,<br/>NEW: revision_required"]
    end

    subgraph Selector["Selector (nextFinishPublicationTransition)"]
        SNAP --> SEL{prose value}
        SEL -->|placeholder or revision_required| AUTH["author_pr_prose"]
        SEL -->|stale| JUDGE["judge_pr_prose"]
        SEL -->|accepted| REST["write_shipped_record → ready_pr → record_outcome"]
    end

    subgraph Effects["Effects"]
        AUTH --> AUTHFX["Authoring pass<br/>receives judge detail when present"]
        JUDGE --> JUDGEFX["Judgment dispatch<br/>cached verdict short-circuits provider"]
        JUDGEFX -->|revision_required: placeholder or structurally_incomplete| RETRY["publication_retry → author_pr_prose"]
        JUDGEFX -->|accepted| SNAP2["re-observe: prose accepted"]
        AUTHFX --> NEWREV["new revision digest → stale → re-judged"]
    end

    RETRY --> GUARD["reconcileSelectablePublicationRetry<br/>fresh observation now selects author_pr_prose<br/>guard agrees — no deadlock"]
    GUARD --> ALLOW["bounded by publication-progress allowance<br/>non-converging laps still halt,<br/>halt carries verdict detail"]
```

## Legend

- **NEW: revision_required** — the added prose state. Derived at observation time: an authored
  body whose exact revision digest has a persisted `revision_required` verdict (reason
  `placeholder` or `structurally_incomplete`) in `.pipeline/prose-judgment.json`.
- `revision_required` with reason `halt` keeps its current terminal routing
  (`judgment_halt_prose`, human required) — it never enters the authoring lap.
- The reconcile guard (`reconcileSelectablePublicationRetry`) is unchanged: it stops
  deadlocking because the fresh observation's selector now agrees with the retry's transition.
- Bounding is the existing publication-progress allowance; no new counters.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-28 | Initial generation | DECIDE for issue #2006 (spec authoring) |
