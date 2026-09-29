# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-29T20:24:00.293Z
Slug: monitor-daemon-halts-through-a-guided-resolution-q
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-monitor-daemon-halts-through-a-guided-resolution-q
Head SHA: 1070b6e2b447517bbbb1232bf0ccfd6b292c1de2
Halted at: 2026-09-29T18:16:48.112Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 6 happy: Given a halt was resolved, when the queue is displayed, then the resolved feature is absent rather than shown with a resolved status.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. A halt marker written while a pass is midway through enumerating is picked up by that pass or the next one, each pass's queue is internally consistent, and no duplicate entry for it arises across the two passes. | A halt created and cleared between passes never reaches the operator. A halt resolved during its guided session is absent from the queue on the next recomputation, and a halt marker removed while its session is open leaves the feature absent from the queue recomputed when the session ends and never reported as unresolved; a halt cleared and then re-written for the same feature before the next pass is offered on that pass as current halted work. | A duplicate enumeration of one feature collapses to exactly one queue entry. A halt marker co-present with the reclaimable completion marker is not offered as halted. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. While a queue of three halts is worked, exactly one item is open, and so exactly one guided session exists, at any moment. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk. Two monitors over the same project each derive membership independently and each offer the halt, neither writing state the other reads, so the redundant offer is a duplicate prompt and never a data fault. | While a two-item queue is being worked, a third feature that halts is included in the ordering by the next membership recomputation, which then orders all three items.
Missing assertion: The checks require absence from a recomputed queue, but do not explicitly require a displayed queue to omit a resolved-status entry.

Criterion: Story 15 negative: Given a guided session ends having changed nothing, when membership is recomputed, then the same halt is offered again rather than being silently consumed.
Task ids: 14
Done when checks: Sessions ending with zero status, non-zero status, and by signal all return the operator to the queue. After a non-zero exit the monitor offers the next item. | A three-item queue is worked to completion without the monitor being restarted. When the last item's session ends and no halts remain, the monitor reports an empty queue and stays active. | Membership is recomputed after each session ends, so a halt resolved inside the session is absent from the next offer. | A session that changed nothing leaves its halt in the recomputed queue. | When the head item's session ends normally, membership is recomputed and the next item in the recomputed order is offered; the session is not required to resolve its halt, and an unresolved head halt stays in the recomputed queue without being re-offered ahead of the remaining items. | With a queue of three halts, as each session ends in turn all three items are offered in queue order, and the monitor is never restarted.
Missing assertion: The checks require the unchanged halt to remain in the recomputed queue, but do not explicitly require that same halt to be offered again.
```
