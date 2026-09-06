# ADR: Shared resolution of explicitly reopened task obligations

**Date:** 2026-09-06
**Status:** APPROVED
**Deciders:** James Stoup, composer session for jstoup111/ai-conductor#1831; explicit approval of the architecture proposal after the scope-acceptance and convergence clarification.

## Context

The existing-task remediation route restages bound task rows, but the shared completion resolver immediately unions in their old Task trailers. The D1 no-op guard can therefore refuse real repair before dispatch. Missing task-status reconstruction independently restores those same old trailers. A local guard bypass would leave dispatch, completion, progress, and recovery disagreeing.

The operator selected shared semantics for explicitly reopened tasks, confirmed technical track and Medium complexity, and required completed scope to be acceptably closed without manufacturing work. Existing evidence must remain usable for untouched tasks; actual repairs must have a fresh, reachable close path and cannot receive an unbounded series of retries.

## Options Considered

### Option A: Bypass only the remediation no-op check
- Small–Medium effort; removes the immediate dispatch refusal.
- Rejected by the operator: completion, progress, and recovery would still disagree.

### Option B: Durable repair obligations applied by shared resolution
- Medium effort; preserves owning-task identity, finding context, and restart recovery.
- Selected: adds explicit freshness and serialized state handling while retaining existing acceptance and review authorities.

### Option C: Append a new repair task for every finding
- Medium effort; avoids reopening old ids.
- Rejected: duplicates approved task ownership and spends plan-growth allowance on work already admitted by the existing-task route.

## Decision

1. Store plan-scoped current repair obligations as an additive versioned section of the existing engine-state.json. Each admitted obligation binds a stable engine-issued id, canonical task ids, validated source-gate/finding evidence, the repair instruction, a pre-reopen HEAD boundary, and an explicit open/resolved state. This is durable control state under event-spine exception C, not a telemetry log. No new sidecar or polling path.
2. Persist an admitted obligation before restaging rows or dispatching BUILD. Replay the same admitted effect idempotently after a crash; do not mint another obligation, move the freshness boundary, or charge another lap for the same effect. A genuinely later admitted repair may reopen the task with a new obligation. Keep the pre-reopen tree/resolved baseline for the existing no-progress guard.
3. All engine-state writers use one atomic, serialized read-modify-write seam so plan-path and appended-task bookkeeping cannot erase repair state. Preserve unrelated fields. Distinguish legacy absence from malformed present state; malformed repair state blocks affected completion with a named reason. The existing active-plan identity isolates reused task ids across plans.
4. For an open obligation, old terminal rows, old Done-when records, and pre-reopen Task trailers do not resolve the task. A matching commit strictly after the saved boundary can resolve routing; an engine-accepted task close for the current obligation can resolve through fresh per-check evidence without a new commit. The latter uses the existing Done when/verify-only validation, never a raw status flip or permission grant. Preserve the historical record instead of requiring deletion of old evidence.
5. The post-reopen commit range must never widen to the full branch if its boundary cannot be established. Existing getEvidenceRange falls back to merge-base when its anchor is unavailable, so using it unchanged would resurrect old evidence and is prohibited for this new range. Keep reopened work unresolved with a specific diagnostic, while still allowing a valid current task-close proof to resolve it. This bounded freshness rule does not revive old per-task diff attribution or stamp-validation gates.
6. Resolver, task-status seeding, and task-close integration share the obligation reader and canonical task binding. Seed/reconstruction must not restore an open repair as completed from an old trailer. Restart rebuilds the BUILD finding context from the durable obligation rather than relying solely on the in-memory retry hint. Recovery here covers process restart and missing task-status rows while engine state survives; wholesale loss of all uncommitted runtime state is not claimed recoverable from old commits alone.
7. Apply existing scope acceptance before deciding that a repair is actionable. Accepted-only current OVER_SCOPE findings produce no repair obligation, BUILD dispatch, or repair charge. Acceptance of one finding leaves unrelated repair obligations and other blockers intact. A later accepted scope decision must not be ignored by a stale pending route; reevaluate current authority before retrying. Do not use string matching on new grant text or invent a second acceptance store.
8. A completed repair returns to its governing review. A passing effective review ends the loop, including evidence-only close or valid acceptance with an unchanged code tree. If review still fails, retain the existing no-progress escalation and lap bounds. Pending-to-completed row movement after reopening must not masquerade as net progress over the pre-reopen baseline. No new retry counter or semantic-equivalence mechanism is introduced; existing adjudication remains responsible where configured.
9. Preserve existing remediation eligibility, consolidated manual_test behavior, gate ownership, budgets, and plan-growth accounting. Diagnose empty remediation output, missing/unresolvable ownership, failed restaging/state persistence, and truly already-resolved emitted work separately. Emit observations through the existing ConductorEvent spine with source and task/finding context.


## Architectural Alignment

This is a durable state-transition decision, so an ADR is warranted even at Medium tier. No existing ADR covers a current repair obligation spanning resolver, reconstruction, task close, and restart. The July 23 trailer-union ADR continues to own the shared resolution/authority split; its bounded freshness exception and the July 13 no-op guard qualification are amended beside their original clauses in this same DECIDE change.

The existing-task admission and lap-only charging decisions remain binding. The Done when task-close gate remains the authority for fresh per-check task-close evidence. The OVER_SCOPE decision reducer remains the authority for explicit scope acceptance. The current mixed-build-review ADR retains its configured case/adjudication semantics; this change adds no second semantic judge.

The repair obligation is state, not proof that a defect is fixed. Fresh Task trailers permit routing to review; they do not bypass an opted-in Done when check or certify correctness. The current review gates still evaluate the result. A scope acceptance closes its covered scope objection, not an unrelated implementation defect.

## Local Pattern Basis

- `task-progress.ts::resolveTaskIds`: one routing definition shared by completion and progress. Preserve canonical task matching and use this as the production rendezvous, not a parallel repair-only predicate.
- `task-seed.ts`: reconstruction is distinct from ordinary reseeding and uses branch-scoped trailer evidence. Preserve that distinction and reuse shared repair filtering.
- `completeTaskDoneWhen`: the existing per-check evidence close boundary. Bind closure to the current repair obligation while preserving plans without a Done when block and verify-only behavior.
- Existing engine-state writers currently tolerate corrupt reads and write directly. Verified no-fit as a persistence precedent for authoritative repair state: introduce a shared serialized atomic update seam and migrate every writer of this same file.
- `getEvidenceRange` can widen to merge-base when an anchor is unavailable. Verified no-fit for strict repair freshness unless an explicit strict mode is added; its existing callers retain their existing semantics.

## Consequences

### Positive
- Real admitted repair can dispatch despite historical completion, then close and reach review.
- Restart and task-status reconstruction preserve current repair context and completion semantics.
- Explicit scope acceptance ends its blocker without forced code edits or a duplicate repair lap.
- Existing no-progress and budget safeguards continue to bound unresolved work.

### Negative
- Shared engine-state writers and task-close paths require careful concurrency and crash handling.
- An unavailable freshness boundary leaves the affected task unresolved until valid current closure evidence is supplied or recovery establishes the boundary; it never broadens the range to old evidence.
- Recovery depends on the durable engine state surviving. This feature does not promise reconstruction of lost, uncommitted repair obligations after deletion of all runtime state.

## Verified Claims and Confirmed Inputs

Verified from this spec checkout: `restageExistingRemediationTaskStatuses` precedes the D1 build-completion check; `resolveTaskIds` has no reopen boundary; `seedTaskStatus` reconstructs missing rows from trailers; `completeTaskDoneWhen` validates per-check evidence; `classifyOverScopeCriterion` is consumed by routing and audit completion; pre-restage progress baselines already exist; `getEvidenceRange` falls back when an anchor cannot resolve.

The operator explicitly approved the scope, technical/M classification, architecture flow, the acceptance/convergence clarification, and this architecture proposal on 2026-09-06. No unconfirmed load-bearing assumption remains. Verify-claims: CLEAR.

## Follow-up Actions

- [ ] Implement the decision through scoped tasks with explicit integration ownership.
- [ ] Prove admitted repair dispatch, fresh and evidence-only closure, scope acceptance, crash replay, and bounded unresolved retries.
- [ ] Update canonical daemon guidance and the affected recovery runbook alongside implementation.
