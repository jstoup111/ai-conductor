# Halt: Task 8 priority outage attribution

**Date:** 2026-09-29
**Class:** architectural-clarity

Task 8 requires a missing linked issue to be reported as `unresolved`, while keeping an ordinary linked issue without a priority label as `unlabeled`. The approved Task 8 scope prohibits changes to `backlog-priority.ts`.

The resolver's existing `PriorityResolution` contract cannot represent that distinction: both cases return the same `unlabeled` band. The monitor orderer receives no missing/not-found metadata, so changing only `ordering.ts` cannot produce the required attribution truthfully.

Resolution needed: approve a resolver/result-contract amendment that carries missing-reference attribution, or explicitly accept `unlabeled` for missing linked issues. The timeout, single-flight, monitor notice, and recovery behaviors remain implementable within the existing Task 8 scope once this attribution decision is settled.
