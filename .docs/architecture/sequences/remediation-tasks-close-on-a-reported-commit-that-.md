# Sequence: A closed remediation task is judged against its finding before BUILD hands off

**Last updated:** 2026-10-21
**Scope:** How BUILD's completion predicate judges each completed engine-appended `rem-*` task against the change its plan block names, reopens a task whose finding still holds, and bounds both reopens and judge failures. Ordinary plan tasks, `[test]` verification at task close, and the unverified Done-when nudge are unchanged.

## Diagram

```mermaid
sequenceDiagram
    participant Agent as BUILD agent
    participant Close as Task close
    participant Pred as BUILD completion predicate
    participant Store as Engine-state verdict record
    participant Judge as remediation-closure judge
    participant Repair as Repair obligation store
    participant Bus as Event spine
    participant Next as test_suite and build_review
    Agent->>Close: task done for rem-«id» with Done-when evidence
    Close->>Close: Record evidence as today
    Agent->>Pred: Step session ends
    Pred->>Pred: All tasks resolved and worktree clean, as today
    Pred->>Store: Read verdicts and reopen counts
    Pred->>Pred: Candidates are completed rem tasks in BUILD scope with no verdict for their current close
    alt No candidates
        Pred->>Pred: Continue to the unverified Done-when nudge as today
    else Candidates exist
        Pred->>Pred: Fingerprint HEAD and tree
        Pred->>Judge: One batched prompt with each plan task block and the commits citing it
        Judge->>Judge: Read code at HEAD and decide per task
        Judge-->>Pred: Closed schema verdict per task resolved, persists or partial, with rationale
        Pred->>Pred: Re-fingerprint. Invalid schema, provider failure or a changed tree is a judge failure
        alt Judge failure on the first try
            Pred->>Judge: One immediate retry
        end
        alt Judge still failing
            Pred->>Store: Record candidates as unjudged for this close
            Pred->>Bus: remediation_closure_judged with outcome unjudged
            Pred->>Next: BUILD hands off
        else Verdicts received
            Pred->>Store: Record each verdict for its close
            Pred->>Bus: remediation_closure_judged with per-task verdicts
            alt Any task persists or partial and under its reopen bound
                Pred->>Repair: Admit settled remediation_closure obligation per task. No lap, no growth
                Pred->>Store: Increment the task reopen count
                Pred-->>Agent: Not done with the fixed closure prefix. Retry hint carries each rationale. No stall tick
                Agent->>Close: New commit or fresh close resolves the obligation
            else All resolved, or every non-resolved task is at its bound
                Pred->>Bus: Bound-exhausted tasks named on the event
                Pred->>Next: BUILD hands off. As-built and prd-audit remain the backstop
            end
        end
    end
```

## Legend

A candidate is a task whose id passes `isEngineAppendedRemediationTaskId`, sits in the current BUILD task scope (including a routed host child's scope), and is resolved without a recorded verdict for its current close identity. Because a judged task is never re-judged until it closes again, one commit may legitimately close several tasks: each task is judged on its own plan block. The plan task block (title, Rationale, Criterion, Governing clause) is the authority for the change the task names; no gate finding is re-persisted. The judge dispatches through the existing auxiliary provider boundary under the `build_review` step's provider policy, so the builder does not grade its own work. The reopen bound is two reopens per task. A reopened task needs a repair obligation because its earlier `Task:` trailer would otherwise resolve it again immediately (adr-2026-09-06-reopened-task-resolution D4).

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-10-21 | Initial sequence | #3190: remediation tasks closed on a reported commit that never implemented them; the next audit lap found the findings persisted |
