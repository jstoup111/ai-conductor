# Sequence: A test-tagged Done-when check is verified at task close

**Last updated:** 2026-10-02
**Scope:** How a Done-when check the plan tags as test-requiring is evidenced at BUILD task close, how an unverified check is nudged once inside BUILD, and how a still-unverified check is recorded and supplied to `prd_audit`. Untagged checks and legacy plans are unchanged.

## Diagram

```mermaid
sequenceDiagram
    participant Plan as Plan task Done-when
    participant Agent as BUILD agent
    participant Close as Task close
    participant Ref as Test reference check
    participant Status as Task status record
    participant Pred as BUILD completion predicate
    participant Bus as Event spine
    participant Audit as prd_audit
    Note over Plan: Plan author tags test-requiring checks. Land gate validates the tag. Remediation tasks prd_audit appends for a criterion are tagged too
    Agent->>Close: task done with per-check evidence
    Close->>Plan: Read checks and their tags
    alt Check is untagged
        Close->>Status: Record reported evidence as today
    else Tagged check cites a test reference
        Close->>Ref: Resolve cited file at HEAD
        Ref->>Ref: Title present and Covers marker names the task or a criterion it covers
        alt Reference resolves
            Ref-->>Close: Verified
            Close->>Status: Record verified evidence
        else Reference does not resolve
            Ref-->>Close: Refused with the check and the missing part
            Close-->>Agent: Refusal names the check. Write or cite the test, never a plan-gap
        end
    else Tagged check closed as unverified with a reason
        Close->>Status: Record unverified evidence and complete the task
    end
    Agent->>Pred: Step session ends
    Pred->>Status: Read unverified checks
    alt Unverified checks remain and no nudge was spent this lap
        Pred-->>Agent: One retry hint naming each unverified check. Existing retry cap applies, no stall tick
    else Nudge spent or nothing unverified
        Pred->>Pred: Complete BUILD on task resolution as today
        Pred->>Bus: Event naming each still-unverified check
    end
    Audit->>Status: Engine-owned input includes unverified close records
    Audit-->>Audit: Grade criteria without rediscovering the known gaps
```

## Legend

A test reference is a file path plus a test title. It is verified by text only: the file exists at HEAD, the whitespace-normalized title occurs in it, and a `Covers:` marker in the file names the task (`task:«id»`) or a story criterion that the check covers. No language, framework, or repository-specific parsing is involved, so consumer projects get the same check. The file need not be in the feature diff, so a check that relies on an existing test still verifies. Unverified checks never stall BUILD on `no_task_progress`: their tasks are completed. Exhausting existing retry or lap caps halts exactly as today; nothing here adds a halt class.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-10-02 | Dropped the testQuality-rubric fallback; still-unverified checks go to the event spine and prd_audit input | Operator chose option 1; rubric route is a follow-up intake |
| 2026-10-02 | Initial sequence | #2758: tasks closed on boilerplate Done-when evidence; missing tests surfaced only as prd_audit laps |
