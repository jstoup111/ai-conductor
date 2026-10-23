# Sequence: A closed remediation task is judged against its named change before BUILD hands off

**Last updated:** 2026-10-23
**Scope:** How the conductor's BUILD session boundary, straight after the #3200 citation judgement, judges each completed engine-appended `rem-*` task against the change its plan block names, reopens a task whose change is absent, and bounds both reopens and failed dispatches. Ordinary plan tasks, `[test]` verification at task close, the citation judgement itself and the unverified Done-when nudge are unchanged.

## Diagram

```mermaid
sequenceDiagram
    participant Agent as BUILD agent
    participant Close as Task close
    participant Bound as Conductor BUILD boundary
    participant Cite as Citation judgement (#3200)
    participant Store as Engine-state verdict record
    participant Judge as Remediation-closure dispatch (build_review provider, read-only, native schema)
    participant Repair as Repair obligation store
    participant Pred as BUILD completion predicate
    participant Bus as Event spine
    participant Next as test_suite and build_review
    Agent->>Close: task done for rem-«id» with Done-when evidence
    Close->>Close: Record evidence as today
    Agent->>Bound: Step session ends
    Bound->>Cite: Settle, admit and judge pending citations as today
    Cite-->>Bound: Citation refusal lines, if any
        alt Uncommitted-work probe reports a dirty tree
        Bound->>Pred: Skip this pass. Predicate withholds for the dirty tree as today
    else Clean worktree
        Bound->>Store: Read verdicts and reopen counts
        Bound->>Bound: Candidates are resolved rem tasks in the execution child's scope, not trailer-restored, with no pending citation, no open citation obligation and no verdict for their current close
        alt No candidates
            Bound->>Pred: Evaluate completion as today
        else Candidates exist
            Bound->>Judge: One input with each plan task block, close-record sources and the commits citing it
            Judge-->>Bound: Closed schema verdict per task resolved, persists or partial, with rationale. One internal retry on a failed dispatch
            alt Dispatch failed twice, unavailable or no port
                Bound->>Store: Record candidates as unjudged for this close
                Bound->>Bus: remediation_closure_judged with outcome unjudged
                Bound->>Pred: Evaluate completion as today
            else Verdicts received
                Bound->>Store: Record each verdict for its close
                Bound->>Bus: remediation_closure_judged with per-task verdicts
                alt Any task persists or partial, under its reopen bound, with a BUILD attempt left
                    Bound->>Repair: Admit settled remediation-closure obligation per task. No lap, no growth
                    Bound->>Store: Increment the task reopen count
                    Bound->>Pred: Evaluate completion
                    Bound-->>Agent: Not done. Citation lines, then Remediation closure reopened lines with each rationale. No stall tick
                    Agent->>Close: New commit or fresh close resolves the obligation
                else All resolved, or every non-resolved task is bound-exhausted
                    Bound->>Pred: Evaluate completion as today
                    Pred->>Next: BUILD hands off. As-built and prd_audit remain the backstop
                end
            end
        end
    end
```

## Legend

A candidate is a task whose id passes `isEngineAppendedRemediationTaskId`, sits in the execution child's BUILD task scope (the whole plan when not stacked), holds no `pending-judgement` record and no open `done-when-citation` obligation, was not restored from trailer evidence, and is resolved under the shared task resolver without a recorded verdict for its current close identity. The close identity digests the task id, its reopen count and its Done-when close records' check text and evidence, and excludes record sources and every SHA that rebase translation rewrites, so neither a source rewrite nor a rebase triggers re-judgement. The judgement is skipped while the uncommitted-work floor's probe reports a dirty tree. Because a judged task is never re-judged until it closes again, one commit may legitimately close several tasks: each task is judged on its own plan block. The plan task block (title, Rationale, Criterion, Governing clause) is the authority for the change the task names; no gate finding is re-persisted. The dispatch is engine-owned, with its provider policy resolved from the `build_review` step's configuration so the builder does not grade its own work, supervised as BUILD activity, with the read-only review capability and the provider's native output schema; no skill ships. The reopen bound is two reopens per task. A reopened task needs a repair obligation because its earlier `Task:` trailer would otherwise resolve it again immediately (adr-2026-09-06-reopened-task-resolution D4).

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-10-21 | Initial sequence | #3190: remediation tasks closed on a reported commit that never implemented them; the next audit lap found the findings persisted |
