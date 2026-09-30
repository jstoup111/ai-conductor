# Sequence: Resolve an action or request intake

**Last updated:** 2026-09-30
**Scope:** Tasks 13–16 and 20–23: offline decisions and serialized optional publication.
**Validation:** Logical flows and plan updates approved by the operator 2026-09-30.

## Diagram

```mermaid
sequenceDiagram
  actor Operator
  participant CLI as Action commands
  participant Store as Repository action store
  participant Publish as Per-action publication lease
  participant Tracker as Guarded intake boundary
  participant Bus as Existing event spine
  Operator->>CLI: List or inspect feature / repository actions
  CLI->>Store: Bounded page and evidence read
  Store-->>Operator: Concern, prior outcomes, resolution and issue link
  alt Acted-on or dismissed
    Operator->>CLI: Explicit resolution with reason or reference
    CLI->>Store: Short leased revision mutation
    Store-->>CLI: Durable decision confirmed
    CLI->>Bus: Emit resolution occurrence
    CLI-->>Operator: Confirm persisted result
  else Explicit file request
    Operator->>CLI: File selected action
    alt Intake proposal incomplete
      CLI-->>Operator: Local draft and named missing inputs
    else Complete proposal
      CLI->>Publish: Acquire per-action publication lease
      Publish->>Store: Short lease to reserve stable publication identity
      Publish->>Tracker: Guard and exact marker lookup
      alt Lookup or authorization fails
        Tracker-->>Publish: Refusal or uncertainty, no create
      else Existing issue found
        Tracker-->>Publish: Reuse issue reference
      else Successful lookup finds no issue
        Publish->>Tracker: Create sanitized canonical intake
        Tracker-->>Publish: Issue reference or uncertain outcome
      end
      Publish->>Store: Short lease to merge outcome with latest resolution
      Note over Store,Publish: Concurrent resolution survives, restart repeats exact lookup
      Publish->>Publish: Release publication lease
      CLI->>Bus: Emit persisted outcome or named failure
      CLI-->>Operator: Issue reference or recoverable failure
    end
  end
```

## Legend

Local viewing and resolution never contact the tracker. Publication and resolution are independent:
filing does not mark an action acted-on, and a concurrent resolution is preserved on publication
confirmation. The per-action lease spans remote work; the feature-state lease does not. Failed
lookup cannot authorize creation. A retry after remote creation finds the stable marker before any
new create. Success is reported only after persistence; a separate telemetry diagnostic cannot
falsify or roll back a persisted decision.

[System context and flow index](../non-blocking-review-findings-have-no-post-ship-cha.md)

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial resolution and publication flow | PRD FR-2 through FR-8 and FR-12 |
| 2026-09-30 | Show explicit proposal validation and publication concurrency | Plan update; approved ADR |
