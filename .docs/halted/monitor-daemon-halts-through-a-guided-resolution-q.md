# Halt record

Status: halted
Slug: monitor-daemon-halts-through-a-guided-resolution-q
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-monitor-daemon-halts-through-a-guided-resolution-q
Head SHA: 3cd7c4c6db2ece144095fbf595040fa3c82bfc26
Halted at: 2026-09-29T16:13:59.241Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 happy: Given at least one feature is halted in a selected project, when the operator starts the monitor, then it reports that halt as work to resolve rather than exiting.
Task ids: 17
Done when checks: Starting with no halted features reports an empty queue, stays alive, and creates zero sessions across several passes. | An interrupt during an open guided session exits without writing a deferral or a resolution for that item. After the interrupt the monitor reports that it stopped, and when it is started again with that feature still halted the item is offered again. | A feature that halts after an empty pass is reported on the next pass without a restart. | The stop condition is injectable, so the loop is tested without sending a real signal.
Missing assertion: Starting with at least one halted feature reports it as work to resolve rather than exiting.

Criterion: Story 1 happy: Given the monitor is running, when the operator ends it with an interrupt, then it stops and reports that it stopped.
Task ids: 17
Done when checks: Starting with no halted features reports an empty queue, stays alive, and creates zero sessions across several passes. | An interrupt during an open guided session exits without writing a deferral or a resolution for that item. After the interrupt the monitor reports that it stopped, and when it is started again with that feature still halted the item is offered again. | A feature that halts after an empty pass is reported on the next pass without a restart. | The stop condition is injectable, so the loop is tested without sending a real signal.
Missing assertion: An interrupt stops and reports stopping when no guided session is open.

Criterion: Story 4 happy: Given the monitor is working through a queue of two items, when a third feature halts and membership is next recomputed, then the third halt is included in the ordering.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. A halt marker written while a pass is midway through enumerating is picked up by that pass or the next one, each pass's queue is internally consistent, and no duplicate entry for it arises across the two passes. | A halt created and cleared between passes never reaches the operator. A halt resolved during its guided session is absent from the queue on the next recomputation, and a halt marker removed while its session is open leaves the feature absent from the queue recomputed when the session ends and never reported as unresolved; a halt cleared and then re-written for the same feature before the next pass is offered on that pass as current halted work. | A duplicate enumeration of one feature collapses to exactly one queue entry. A halt marker co-present with the reclaimable completion marker is not offered as halted. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. While a queue of three halts is worked, exactly one item is open, and so exactly one guided session exists, at any moment. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk. Two monitors over the same project each derive membership independently and each offer the halt, neither writing state the other reads, so the redundant offer is a duplicate prompt and never a data fault.
Missing assertion: The checks require a later-created halt to appear in a subsequent pass, but do not explicitly require inserting it into the ordering while an existing two-item queue is being worked.

Criterion: Story 15 happy: Given a guided session for the head item ends normally, when the monitor continues, then it recomputes membership and offers the next item.
Task ids: 14
Done when checks: Sessions ending with zero status, non-zero status, and by signal all return the operator to the queue. After a non-zero exit the monitor offers the next item. | A three-item queue is worked to completion without the monitor being restarted. When the last item's session ends and no halts remain, the monitor reports an empty queue and stays active. | Membership is recomputed after each session ends, so a halt resolved inside the session is absent from the next offer. | A session that changed nothing leaves its halt in the recomputed queue.
Missing assertion: A normally ending session is not required to resolve its halt; a session that changes nothing leaves that halt in the recomputed queue rather than offering the next item.

Criterion: Story 15 happy: Given a queue of three halts, when each session ends in turn, then all three are offered in order without the monitor being restarted.
Task ids: 14
Done when checks: Sessions ending with zero status, non-zero status, and by signal all return the operator to the queue. After a non-zero exit the monitor offers the next item. | A three-item queue is worked to completion without the monitor being restarted. When the last item's session ends and no halts remain, the monitor reports an empty queue and stays active. | Membership is recomputed after each session ends, so a halt resolved inside the session is absent from the next offer. | A session that changed nothing leaves its halt in the recomputed queue.
Missing assertion: The checks require a three-item queue to be worked to completion without restart, but do not explicitly require that all three items are offered in order.
```
