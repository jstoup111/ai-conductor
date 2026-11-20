# ADR: SHIP validators continue when product write protection is unavailable

**Date:** 2026-11-19  
**Status:** APPROVED  
**Source:** jstoup111/ai-conductor#3685, explicit operator decision

## Decision

1. **Validator protection and fallback.** Apply verified product and Git write protection to SHIP validator processes wherever available. If protection cannot be established, emit a prominent operator-visible warning identifying the validator and reason, then dispatch immediately. Keep evidence writable, check findings against the inspected code and send unverified product changes through the normal build and review gates.

2. **Automatic handoff to BUILD.** The operator approved automatic handoff of validation edits. Use a dispatch-owned checkout of the reviewed revision with independent Git metadata for fallback execution. Leave existing operator files, index state and branch references in place. A disposable checkout separates ordinary validation writes by destination but does not prove filesystem confinement, so the warning still applies. Continue checking the authoritative worktree for independent changes.

Capture the committed and outstanding product delta against the dispatch baseline before cleaning up the checkout. Include additions, deletions, binary content and mode changes. Keep explicit validator evidence separate. Preserve ambiguous new files for BUILD classification. Keep a durable, verifiable copy accessible to the owning repair task until BUILD has acknowledged it. Deliver it through the existing repair route. On retry, recognize the same captured input and already-applied content. If destination content has diverged, retain both versions for repair in BUILD. Never switch a dirty operator checkout or overwrite an operator edit to complete the transfer.

## Consequences

Validation remains available on hosts with limited isolation. On those hosts a validator can modify product code before the engine detects a change. The operator accepted this exposure to keep processing. The engine must account for changes made during validation before it can ship.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The operator accepts continued execution with a prominent warning when write protection is unavailable. | verified | 100% | yes | Dispatch availability policy would change. | Approved by operator in the #3685 composer session. |
| A2 | Switching a dirty child worktree is refused by the per-child build-region contract. | verified | 99% | yes | The handoff would have different routing constraints. | — |
