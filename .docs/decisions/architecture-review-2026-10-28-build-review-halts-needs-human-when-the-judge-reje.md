# Architecture Review: one corrected re-judgement for an inadmissible build_review case binding (#3461)
**Date:** 2026-10-28
**Inputs reviewed:**
- the explore output and track: `.docs/track/build-review-halts-needs-human-when-the-judge-reje.md` (technical track, approach A);
- the diagram `.docs/architecture/build-review-halts-needs-human-when-the-judge-reje.md`;
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (D2, D3) and its superseded predecessor `adr-2026-08-29-build-review-remediate-case-adjudication` (D7.1–D7.6);
- `adr-2026-09-10-portable-build-review-policy` (D8, D9, D11, D12);
- `adr-2026-10-20-operator-acceptance-is-durable-case-state` (carry classification);
- the source of `remediation-case-reconciler.ts`, `remediation-case-validator.ts`, `build-review-adjudication-context.ts`, `build-review-adjudication-coordinator.ts`, the judge wiring in `conductor.ts`, and `skills/remediate/SKILL.md`;
- the event trail of `lap-019b3ec15dd00c0819985e0d1b7d9b2b32bc144a` in `.daemon/evals-raw/features/manual-reviewer-edits-cannot-be-landed-safely-in-t/events.jsonl`.

**Mode:** lightweight (Medium tier). This covers sections 2 (feasibility) and 4 (alignment), plus the required wiring surface.
**Verdict:** APPROVED

## Feasibility

| Item | Assessment | Basis |
|---|---|---|
| **Observed failure** | Case `24d5e51f` got an applied action at 20:58:22Z, BUILD ran its work order (20:58–21:03Z), and the next lap's judge bound a new testQuality source to it as `reject`. `reconcileState` refused because `reject` differs from `act` and neither the refute lane nor the defer lane admits it, and `failUnlessAccepted("case reconciliation illegal-disposition-transition")` halted the feature `needs-human`. After an operator halt clear, a re-adjudication settled the case by absence at 22:43Z. | verified, 95% |
| **One predicate** | Feasible. The admission is a pure function of the existing record, whether BUILD attempted it (`attemptedIds`), and carry eligibility (`isCarryEligibleRemediationCase`, which `classifyRemediationCaseReuse` already uses to return `carry`). The reconciler's check `existing.disposition !== caseRow.disposition && !admitsRefutation && !admitsDeferral` becomes "not in `bindableDispositions(existing, …)`" with identical results. The refutation-repeat check and the lane-specific replacements stay as they are. | verified, 90% |
| **Same inputs on both sides** | The coordinator passes one `attemptedCaseIds` value to `assembleBuildReviewAdjudicationContext` and to `reconcileRemediationCases`, and one `carryInput` to the context and to the carry classification. So the bindable set the judge and validator see is the set the reconciler admits. | verified, 90% |
| **Context carries the set** | Feasible. `freezePriorCase` already projects each prior case and `contextFor` re-serializes under `maxSerializedBytes`. The field adds at most six short strings per case, and the digest budget is computed after the base context, so it cannot overflow silently. The whole context JSON is the judge's prompt payload (`conductor.ts` judge: `JSON.stringify(context)`). | verified, 90% |
| **Validator check is last** | Feasible. `validateRemediationCaseGraph` returns at the first defect. Checking bindings after consistency means the new reason is reported only when every other check passed. The coordinator therefore needs no re-validation classifier, unlike the expansion round's `classifyIndexOnlyAdmission`. | verified, 90% |
| **Correction round** | Feasible. The round loop in `coordinateBuildReviewAdjudication` already discards a refused judgement and re-dispatches once for the expansion round. A second, independent once-per-lap branch for `inadmissible-case-binding` fits the same loop with the bound raised to three dispatches. | verified, 90% |
| **Escalation rows** | Excluded from the check. An `escalate` row never reaches `reconcileRemediationCases` (the coordinator splits it into `escalationCases`), so no reconciler admission applies to it. | verified, 90% |
| **Judge corrects itself** | The observed rationale ("the defect … is gone") is a refutation claim, and `refute` was bindable for that case. A judge told the bindable set should usually answer with an admissible row. If it does not, the lap halts as today after one extra dispatch, so this is not load-bearing for correctness. | inferred, 75% |
| **Stack, prerequisites, isolation** | No new dependency, module, persisted field, CLI flag or hook. Nothing new is shared between worktrees. | verified |

## Alignment

- **Mixed-laps D2.** It allows one authoritative judgement per lap, with a bounded expansion round. The correction round has the same properties: same skill, member, mode and context contract; the refused round is discarded, never merged; no kickback. The amendment of 2026-10-28 records the second round kind and the three-dispatch bound.
- **Mixed-laps D3 / predecessor D7.** A repeated attempted `act` still halts as a semantic repeat, a refutation still needs engine-verified evidence, and a second refutation still halts. The correction round never changes which transitions are legal; it only lets the judge see them and try once more. Normalizing a bound `reject` to `refute` (filer hypothesis 2) was rejected: a `reject` row carries no refutation evidence, so it would bypass D7.2.
- **Portable D9.** Its mechanical validation gains binding legality. The amendment adds a second exception to "invalid output produces a decision stop", in the same form as #3291's.
- **Portable D11.** No retry ledger or case store is added; the round is in-process and bounded per lap.
- **Portable D12 / event spine.** The only telemetry change is an additive optional field, `bindingCorrectionCaseIds`, on the existing `remediation_adjudication_started` variant. There is no sidecar or new channel.
- **Operator acceptance ADR.** A carry-eligible case admits every disposition, which matches the carry lane being decided before any disposition rule.
- **State.** The bindable set is a closed list of the existing `RemediationCaseDisposition` union, not a boolean. The rejection carries a typed list of refused bindings rather than prose.
- **Diagram.** It matches the design. No other `.docs/architecture/` diagram covers the adjudication round loop.

## Wiring Surface

| New surface | Production caller |
|---|---|
| `bindableDispositions` (reconciler module, exported) | `reconcileState`'s transition check; `assembleBuildReviewAdjudicationContext` for every prior case; the coordinator, which builds the validator's bindable-set references. |
| `priorCases[].bindableDispositions` and `bindingCorrections` context fields | Serialized into the `remediate` dispatch by the conductor's build_review judge (`JSON.stringify(context)`). |
| `inadmissible-case-binding` validator rejection | `validateRemediationCaseGraph`, called from `coordinateBuildReviewAdjudication`'s round loop. |
| Correction round | `coordinateBuildReviewAdjudication`, reached from `applyBuildReviewOutcome` in `build-review-outcome.ts` for every adjudicated build_review lap. |
| `remediation_adjudication_started.bindingCorrectionCaseIds` | Emitted by the coordinator's round loop and persisted by the shipped `EventPersister` (the variant is already registered in `event-sinks.ts`). |
| Remediate skill binding rule | Read by the `remediate` judge on every build_review case dispatch. |

**Overlap scan (advisory):** `ai-conductor overlap-scan` reported `spec/no-runbook-recovery-for-a-build-review-semantic-ca` (PR #3491, the #3449 hotfix) on `build-review-adjudication-coordinator.ts`. That PR edits the semantic repeat and regression halt messages, not the round loop, so it is a textual overlap that a rebase resolves. Open #3362 (narrower residual gap halts as a regression) concerns the regression classifier and is independent.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The validator's bindable set drifts from the reconciler's admission, so a judgement passes validation and still fails reconciliation | Technical | Low | Medium | One exported predicate used by both, and a test that a judgement the validator admits is reconciled without `illegal-disposition-transition`; the reconciler backstop still fails closed |
| The judge repeats the inadmissible binding after correction | Technical | Medium | Low | One extra bounded dispatch, then the halt names the case, the proposed disposition and the bindable set |
| A lap with both an expansion round and a correction round costs three judge dispatches | Performance | Low | Low | Each round kind is once per lap; neither charges a kickback |
| The correction round masks a refutation-repeat or semantic-repeat halt | Technical | Low | High | Those stay outside the bindable check (a same-disposition binding is always bindable), proven by tests that both still halt with their existing reasons |

## ADRs Created
None. The structural decision (one authoritative remediate judgement per lap, with bounded engine-run rounds) is governed by `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2 and `adr-2026-09-10-portable-build-review-policy` D9, which are amended with additive notes dated 2026-10-28.

## Assumptions

| # | Assumption | Basis | Confidence | Impact if wrong | Load-bearing |
|---|---|---|---|---|---|
| A1 | Context, validator and reconciler see the same attempted ids and carry input for a lap (coordinator passes one value to each). | verified | 90% | A binding could pass validation and fail reconciliation; the backstop halts as today | no |
| A2 | Case `24d5e51f` was in the lap's attempted set, so `refute` was bindable (its work order was applied and BUILD committed the repair before the lap). | inferred | 85% | None for the design: `defer` is bindable for any applied action regardless | no |
| A3 | A judge told the bindable set usually returns an admissible judgement. | inferred | 75% | One extra dispatch, then the same fail-closed halt | no |
