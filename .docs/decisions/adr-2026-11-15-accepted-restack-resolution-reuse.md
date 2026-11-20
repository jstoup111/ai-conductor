# ADR: Reuse accepted automatic restack resolutions through durable, input-bound evidence

**Date:** 2026-11-15
**Status:** APPROVED
**Deciders:** operator (James Stoup), approval of architecture conditions in the composer session

## Context

#3632 requests comprehensive conflict prevention, reuse, safe deterministic resolution, and reporting. The operator selected Approach A without a small-model tier and approved the component boundaries and six architecture-review conditions. #3599 remains open and describes reuse across an aborted operation; this work covers that outcome. #3628 is closed; its scheduling concern is governed by `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` and is not reimplemented here.

Verified source: `resumePlanned` already skips non-pending journal children; `consumeRecordedResolution` handles operator-recorded tips and checks range and parent-tree identity; `replayChildRange` applies selected bookkeeping rules; `checkResolvedTipOwnership` constrains paths but does not prove semantic equivalence. The uncovered architectural concern is automatic accepted-result persistence beyond an individual journal's abort, and a shared acceptance boundary for normal execution and recovery.

## Options Considered

### A: Extend durable resolution state and shared acceptance (selected)
- Preserves accepted work across an aborted journal, without introducing a second replay engine.
- Requires explicit identity, retention, compatibility, and cleanup semantics.

### B: Retain and resume every halted journal
- Reuses existing per-operation progress.
- Couples operator-driven changes and re-planning to one journal's captured ref set; does not independently address safe reuse when a new operation is necessary.

### C: Ambient rerere or a cheap model before the strong resolver
- Might reduce invocation cost.
- Textual resemblance and model confidence are not the approved acceptance basis; adds unmeasured validation complexity.

## Decision

1. **Preserve existing orchestration.** Extend the existing journaled replay and Git-backed resolution machinery. Keep off-worktree computation, exact rewrite maps, atomic expected-ref movement, and existing post-restack gate invalidation. Do not alter routed repair scheduling or flat-feature rebase behavior.

2. **One acceptance boundary.** Executor and recovery use the same acceptance logic for new shortcut candidates and automatic-result reuse. A candidate carries its origin and evidence. Applicable deterministic predicates or matching durable acceptance evidence are required in addition to existing ownership and rewrite checks. Passing tests or path checks alone cannot qualify an arbitrary source-code merge as mechanical.

3. **Explicit deterministic eligibility.** Retain existing halt-record and remediation-block semantics and allow composition only when every conflicted path is individually eligible under those rules. A mismatched remediation block retains its existing refusal. Unsupported source, binary, rename, delete, or memory-file conflicts receive no new automatic union permission. A mixed conflict never commits a partially resolved tree as an accepted child. Existing candidate selection preserves evidence commits and intentional revert/reapply sequences.

4. **Durable automatic results.** Preserve a validated automatic result before progressing to higher children, using feature-scoped Git-backed authoritative state that survives journal abort. Bind it to child identity, original range, exact replay-parent identity, candidate tip/tree, exact rewrite map, replay-policy inputs, validation/rule version, and any operator decision supplied to that resolution. Matching means the recorded result is valid for the current replay context, not that the conflict text looks alike. Initially require exact identities for automatic reuse; do not inherit broader normalization implicitly. Keep automatic-result provenance separate from operator-recorded tips and preserve the latter's existing tree-matched behavior.

5. **Conservative recovery and lifecycle.** A matching accepted automatic result is reused without another resolver call and retains its tip. Changed inputs or validation version invalidate automatic reuse and return to ordinary resolution, with an explicit reason. Malformed or unreadable authority cannot authorize reuse. Never overwrite a newer result without an expected-old-value check. Keep a retained accepted result reachable through an aborted operation; retire it after successful application or replacement, and include it in existing feature cleanup. A crash before durable acceptance may repeat a provider invocation; exactly-once provider execution is not promised. Legacy records without new evidence remain valid for their existing purpose but do not qualify for the new automatic shortcut.

6. **Bounded escalation.** An unresolved source conflict without an applicable deterministic rule may fall through to the configured strong resolver. Invalid bookkeeping evidence or a failed bookkeeping predicate returns a validation error before any resolver handoff, with no provider invocation and no stack ref movement. This prevents the resolver rebase from silently reapplying the same rejected halt-record driver. Strong-resolver exhaustion or operational failures retain explicit halt/recovery outcomes; they never loop back through shortcuts. Operator design decisions remain explicit. No inference of semantic safety follows from adjacent-line layout. No `.memory/` storage-policy change or new model tier is included.

7. **Report through the event spine.** Extend existing event types and provider-attempt context as needed, using the emitter, persister, and established readers. Report conflict units by child and replayed commit, candidate attempts, accepted resolution tier, reuse/miss reasons, and actual provider attempts/cost. Carry operation and available routed-round identity explicitly. Deduplicate terminal outcomes by durable identity; retain distinct provider attempts. Unattributed historical evidence is unknown rather than zero. Do not estimate dollars saved from skipped calls or introduce a second telemetry ledger. Durable acceptance records are authority, not a substitute event log.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Conservative exact-context reuse and explicit bookkeeping rules satisfy the selected first delivery, without generic adjacent-line merging | verified | 100% | yes | Broader resolution machinery would be required | APPROVED by operator 2026-11-15 |
| A2 | Memory storage policy remains unchanged; unsupported memory conflicts escalate | verified | 100% | yes | Changes ownership and persistence scope | APPROVED by operator 2026-11-15 |
| A3 | Existing ownership checks do not prove arbitrary behavioral equivalence | verified | 100% | yes | Acceptance reasoning changes | Verified source |

## Consequences

### Positive
- Accepted automatic work can survive a higher-child halt.
- Executor and recovery share acceptance semantics.
- Savings and remaining resolver costs become observable without inventing estimates.

### Negative
- Exact identity can reject reuse that might be semantically safe; this is intentional.
- New durable evidence needs compatibility and cleanup coverage.
- Strong-model resolutions retain their existing semantic limitations; this design does not claim a universal equivalence checker.

### Follow-up Actions
- Specify behavioral acceptance for mixed conflicts, cross-operation reuse, crash boundaries, invalidation, and reporting.
- Preserve existing operator-resolution and routed scheduling contracts in conflict review.
- Assign each production integration boundary exactly one owner in the implementation plan.
