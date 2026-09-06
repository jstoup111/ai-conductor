# Sequence: Repairing a previously completed task

**Last updated:** 2026-09-06
**Scope:** Admission, restart recovery, and renewed completion for an explicitly reopened task. Logical sequence for architecture review; no storage format is prescribed here.

## Diagram

```mermaid
sequenceDiagram
    participant M as Remediation admission
    participant S as Durable repair state
    participant L as Existing kickback ledger
    participant R as Shared resolver
    participant B as BUILD
    participant G as Review gates
    M->>M: Validate owning task and existing admission limits
    alt No work emitted or binding cannot be admitted
        M->>M: Halt with the specific reason and finding
    else Valid repair obligation
        M->>S: Persist round id, task, finding, and original boundaries
        M->>L: Atomically settle lap plus receipt for this round
        M->>S: Record settlement acknowledged
        Note over M,L: Replay checks receipt before charging
        M->>R: Check dispatchable work
        R->>S: Read current repair obligation
        R-->>M: Old completion does not close reopened work
        opt Process restart or missing task-status rows
            R->>S: Recover outstanding repair obligation
            R-->>B: Restore task as unresolved with finding context
        end
        M->>B: Dispatch owning task with finding context
        B->>R: Supply new work or fresh accepted evidence
        R->>S: Satisfy the current repair obligation
        R-->>G: Route forward using shared completion result
        G->>G: Judge the actual repaired behavior
        alt Effective review passes
            G-->>M: End repair cycle even on unchanged tree
        else Effective failure remains unchanged
            G-->>M: Apply original progress baseline and existing bounds
        end
    end
```

## Legend

Persistence precedes dispatch so a process restart cannot forget admitted work. Duplicate handling must not manufacture a new repair obligation on every retry; a later admitted finding may reopen the task again. Untouched task completion and existing no-progress safeguards remain in force. Architecture review owns the exact freshness witness, persistence ordering, and failure handling.

> **Amended 2026-09-06 by #1831:** This repair sequence is entered only for still-actionable repair. An explicit acceptance of the current `OVER_SCOPE` finding follows the existing decision reducer before repair admission: record acceptance, remove that blocker, and continue if no independent blocker remains. It neither creates a repair obligation nor requires a new commit. A later audit confirming repaired behavior or valid acceptance ends the loop. Repeated failure still uses the existing no-progress and lap limits; the pending-to-complete status cycle is not progress by itself. Replay after restart reuses the same obligation and preserves both acceptance and retry accounting.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-09-06 | Initial proposed repair sequence | Make dispatch and restart behavior reviewable for #1831 |
| 2026-09-06 | Clarified terminal acceptance and no-progress behavior | Operator's explicit convergence requirement |

> **Amended 2026-09-06 by #1831:** The operator approved the component/sequence flow and its acceptance clarification. `adr-2026-09-06-reopened-task-resolution` now supplies the approved durable-state ownership, freshness, evidence-only closure, and failure-handling decisions that this diagram deferred to architecture review.

> **Amended 2026-09-06 by #1831:** Plan update makes replay concrete: persist the round first, atomically write its lap delta and receipt in the existing ledger, then acknowledge settlement. A crash between stores replays the receipt. PASS terminates; unresolved failure retains the original bounds.
