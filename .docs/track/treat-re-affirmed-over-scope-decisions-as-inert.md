# Track: Treat re-affirmed over-scope decisions as inert

Track: technical

Scope boundary: Small fix for #2681, approved by the operator on 2026-09-28 (delegated). Make a same-authority revise-decision entry an inert reaffirmation that keeps the prior decision in force; carry the decision store's invalid-decision rejection through PRD widening capture as an invalid decision naming the entry instead of collapsing it to a persistence failure; and tell the operator in the over-scope HALT how to keep a prior decision unchanged. Store schema, decision revision semantics for a genuine reversal, reconciliation, routing, and projection are outside this slice.

This is an internal engine correction; acceptance criteria live in technical stories rather than a PRD.

Scope check: A — engine behavior (conductor PRD widening capture), no HARNESS.md or AGENT_INSTRUCTIONS.md change; B — n/a (no new skill); C — provider-agnostic (no provider dispatch is touched). Event-spine: no new channel; the existing prd_widening_reconciled rejected event carries a more specific existing-string reason.

Verified foundation: AcceptedWideningDecisionStore.append in src/conductor/src/engine/accepted-widenings.ts returns invalid-decision when a supersedes names the latest decision but repeats its authority. capturePrdWideningDecisions in src/conductor/src/engine/prd-widening-capture.ts records every failed modern append as a write-failed defect. preparePrdWideningBeforeAudit in src/conductor/src/engine/conductor.ts maps write-failed to the persistence-failed recovery, whose text in src/conductor/src/engine/prd-widening-recovery.ts directs the operator to a store or lease failure. renderOverScopeDecisionBlock in accepted-widenings.ts tells the operator to edit each revise entry to accept or refuse and never says that leaving it pending keeps the prior decision, although capture already skips pending entries. The governing durable-reconciliation ADR states that identical replays are inert and supersession names an earlier decision; it does not require rejecting a same-authority reaffirmation, so no ADR amendment is needed.
