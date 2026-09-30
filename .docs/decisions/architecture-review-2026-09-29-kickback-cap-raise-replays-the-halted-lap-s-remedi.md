# Architecture Review: Kickback cap halts at the remediation→build transition (#2753)
**Date:** 2026-09-29
**Mode:** Lightweight (Medium tier): Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** `.docs/track/kickback-cap-raise-replays-the-halted-lap-s-remedi.md`,
`.docs/complexity/kickback-cap-raise-replays-the-halted-lap-s-remedi.md`,
`.docs/architecture/kickback-cap-raise-replays-the-halted-lap-s-remedi.md`. Stories and plan do not
exist yet.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Stack: no new package, service, or store. All paths below are under `src/conductor/src/engine/`.

**Today's charging point (verified).** `planRemediation` reads each gate's budget through
`readRemediationGateAppendBudget` (`conductor.ts` ~842-866). It halts on exhaustion before
`appendRemediationTasks` (~5260-5360). It charges only after a successful append, through
`recordRemediationGateAppend` → `recordRemediationGateLap` (+1 lap) and `recordGrowth` (+added,
+byGate) (~5454-5468, `kickback-ledger.ts` ~1150, ~832). The #2755 pre-remediate check
(`prdAuditLapCapHaltBeforeRemediate`, ~4595, called ~4723) duplicates the lap test before
/remediate.

**A pre-dispatch halt point exists (verified).**
- `stepLoop` has a single pre-dispatch boundary that every `planRemediation` caller reaches: after
  `stopAtOperatorParkBoundary` and before `saveConductorStepStatus(state, step.name,
  'in_progress')` (~9704-9710). There are nine callers, and each handles `route` itself.
- A direct precedent already halts BUILD there while leaving it non-done: the durable build_review
  retry-context check (`step.name === 'build'`, ~9781-9791).
- The operator-park precedent sits at the same boundary.

**Resume semantics fit (verified).**
- `kickback-budget raise` writes an absolute `effectiveLapCap` on the gate entry, or
  `effectiveGrowthCap` on the ledger. It also writes a `resumeAuthorization` bound to the cap
  evidence's `haltGeneration`.
- The daemon consumes that authorization only against the live `kickback-cap` HALT
  (`daemon-rekick.ts` ~263-289). The engine never reads it, and resume re-enters the first
  non-done step.
- So a halt that leaves BUILD non-done resumes into BUILD, and the budget re-read at dispatch sees
  the raised cap.
- The re-kick's BUILD pre-verify is gated on `build === 'done'` (`daemon-rekick.ts` ~879), so a
  non-done BUILD takes the ordinary repair route after a rebase.

**Durable pending state is required (verified absent today).**
- Nothing durable records "BUILD re-opened by this gate's remediation, charge pending".
  `pendingRetryHints` is in memory only. The `captureKickbackToBuildContext` baseline is shared
  with build_review, manual_test, and finish. `appendedRemediationTaskIds` is cumulative, not per
  lap.
- Charging at dispatch therefore needs a new ledger entry. `settleRemediationRound`'s receipt plus
  `lapCap` shape (`kickback-ledger.ts` ~451-478) already implements an atomic check-then-charge
  under the ledger lease, and is the pattern to reuse.

**Growth derivation hazard (verified, load-bearing).** `readGrowth` (`kickback-ledger.ts` ~799)
derives `authored` from the active plan's Task headings when no growth record exists. When one
exists, it reconciles `authored = derived − added` if the totals diverge. Tasks appended but not
yet charged would be reclassified as authored, which refunds the growth allowance they should
consume and inflates the 25% denominator. The pending repair's uncharged task count must be
subtracted in that derivation (Condition 2).

**Surfaces touched:**
- The `planRemediation` append and existing-task paths
- The pre-dispatch boundary
- The kickback ledger (one field, plus the settlement and growth derivation)
- Removal of the #2755 pre-check and its test
- The integration-surface boundaries crossed are conductor, kickback ledger, and repair-restage,
  within one module tree.

No schema version bump: the field is optional and absent reads as none, the same pattern as
`pendingAsBuiltRemediationFindings` (adr-2026-08-25 D7).

Worktree isolation: the state is per-worktree `.pipeline/`. No ports, services, or shared
resources.

## Alignment

**Governing ADRs (reused, not duplicated):**
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback D5 (bounded kickback caps) and
  D6 (growth ledger)
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route D4 (as-built lap cap and shared
  growth), D7 (pending-findings durability, "written only when the append that authorizes the lap
  succeeds") and D9 (existing-task charges lap only)

The change moves where those caps are enforced and when they are charged. The caps themselves,
their defaults, the `kickback-cap` halt class, and the single appender (adr-2026-08-25 D5) are
unchanged. These are additive amendments to the five decisions, not a new ADR.

**Unchanged by this design:**
- The operator raise and consume contract: adr-2026-08-29-operator-authorized-kickback-budget-recovery
  and its successor adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.
- Rebase credit: the pending entry is non-lap-counting and survives it, like the D2 fields.
- A fresh feature session clears the whole ledger, the pending entry included.

**Over-scope ordering (verified unchanged).** `routeCurrentPrdAuditOverScope` runs before
/remediate (~4691-4714) and at group settlement (~8835). An undecided or refused OVER_SCOPE halts
under its own class before any repair is appended or pending. A raise can only clear a live
`kickback-cap` halt, so it can never clear a halt that carries an open over-scope decision.

**The D1 no-op guard (adr-2026-07-13-kickback-build-no-op-escalation).** It exits with a
needs-human halt before `route`. Under this design the lap it currently spends is not yet charged,
and its pending repair remains until a later BUILD dispatch settles it. The guard's own contract
(halt on no new dispatchable work) is unchanged, so no amendment is needed.

**Out of scope:** build_review's cumulative cap. build_review, test_suite, manual_test, and finish
remediation register no pending repair; only `prd_audit` and `architecture_review_as_built`
remediation do.

**State modeling:**
- The pending repair is one tagged ledger record: absent, or present with receipt and charges.
- A settled repair is removed in the same lease that charges it, so "charged and still pending"
  cannot be represented.
- Per-gate charges are a map keyed by the closed gate union, not booleans.

**Event spine.** No new channel or event member. Settlement reuses `recordGrowth`'s `plan_growth`
emission. The cap halt reuses `recordKickbackCapEvidence`, the kickback-cap HALT, and `emitLoopHalt`.

Diagram: the approved sequence in `.docs/architecture/` matches this review. Its three open
questions are resolved by Conditions 1–4.

## Wiring Surface

- **Pending-repair ledger entry (write).** Written from `planRemediation` after a successful append
  or an existing-task binding, in place of today's `recordRemediationGateAppend` and restage lap
  charges.
- **Dispatch settlement.** Invoked from `stepLoop`'s pre-dispatch boundary when `step.name ===
  'build'`, after the operator-park boundary and before `in_progress` is saved. It either charges
  and clears the pending repair, or records cap evidence and halts `kickback-cap`.
- **Growth derivation.** `readGrowth` is consumed by every existing budget reader
  (`readRemediationGateAppendBudget`, status output). It subtracts the pending uncharged task count.
- **Removed surface.** The `prdAuditLapCapHaltBeforeRemediate` caller in `planRemediation` is
  removed. Its halt text and recovery hint move to the settlement.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Uncharged appended tasks are reclassified as authored, refunding growth | Data | High without mitigation | High | Condition 2 |
| Halt leaves BUILD done with pending tasks; the rebase re-kick halts "completed BUILD evidence unavailable" | Technical | Medium | High | Condition 3 |
| One of the nine route callers bypasses the dispatch boundary | Integration | Low | High | Settlement lives in the single stepLoop boundary, not per caller |
| Plan holds unbuilt tasks when the operator never raises | Data | Medium | Low | Feature stays halted; explicitly accepted in the track scope |
| /remediate spend (~$1) on a lap that then halts | Technical | Medium | Low | Accepted trade for no replay machinery |
| Mixed prd_audit and as-built round halts on one gate and partially charges the other | Data | Low | Medium | Condition 1: all-or-nothing settlement |

## ADRs Created

None. Additive amendments, all dated 2026-09-29 by #2753, are recorded on:
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback: decisions 5 and 6
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route: decisions 4, 7 and 9

## Conditions

1. **Atomic all-or-nothing settlement.** At BUILD dispatch, one ledger lease reads the pending
   repair and every charged gate's budget. It then either charges every gate's lap and growth and
   removes the entry, or charges nothing and halts `kickback-cap` on the first exhausted allowance.
   The halt names every finding, as today's exits do.
2. **Pending tasks are never authored.** Growth derivation and reconciliation subtract the pending
   repair's uncharged task count, so a halted or unsettled repair neither refunds allowance nor
   inflates the 25% denominator.
3. **Halted BUILD stays non-done.** The dispatch halt persists state with BUILD not done and the
   appended tasks pending in task-status, so the rebase re-kick routes it as repair work.
4. **Existing-task rounds register lap-only pending charges.** The lap moves from restage
   (`settleRemediationRound`) to dispatch settlement, and no growth is charged (adr-2026-08-25 D9).
5. **The #2755 pre-remediate check is removed.** The lap cap is enforced only at dispatch, and its
   RED test is rewritten to the transition behavior.
6. **No-repair halts keep today's behavior.** A halt with no appended or bound repair writes no
   pending entry.

> **Amended 2026-09-29 by #2753 (conflict-check ADR sweep):**
> - Adds Condition 7: a present but malformed `pendingRepair` fails closed. The prd_audit,
>   as-built and growth allowances read as exhausted, scoped to those gates
>   (adr-2026-08-31-kickback-ledger-read-fails-closed D1/D3).
> - Adds Condition 8: an existing-task pending repair uses the repair obligation id as its receipt,
>   so a replay records no second charge. coverage_binding keeps charging at restage, and the
>   shared `admitAndRestageRepair` seam must not move its lap.
> - Adds Condition 9: the adr-2026-07-13 D1 route-into-no-op guard discards the pending repair
>   uncharged when it halts. Settlement runs on BUILD dispatch only while a pending repair is
>   recorded, and after any pre-dispatch refusal (adr-2026-08-05-build-settle-outcome-stamp D3),
>   so a refused dispatch charges nothing.
> - Corrects "The D1 no-op guard … its pending repair remains until a later BUILD dispatch settles
>   it": it is discarded instead.
> - Additional additive amendments: adr-2026-08-25 D5 (the cap bounds the BUILD dispatch, not the
>   append, which also qualifies adr-2026-08-22-one-owner-per-review-question), and
>   adr-2026-09-06-reopened-task-resolution D2.
