# Architecture Review: a bound residual re-raise of a resolved action case routes to BUILD under the lineage limit (#3362)
**Date:** 2026-10-28
**Inputs reviewed:**
- the explore output and track: `.docs/track/build-review-halts-as-regression-when-a-repair-lef.md` (technical track, approach B, balanced scope);
- the diagram `.docs/architecture/build-review-halts-as-regression-when-a-repair-lef.md`;
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (D3, D5 and its D5.4–D5.11 amendments) and its superseded predecessor `adr-2026-08-29-build-review-remediate-case-adjudication` (D7);
- the landed, unbuilt #3461 spec (`.docs/plans/build-review-halts-needs-human-when-the-judge-reje.md`), which edits the same coordinator, reconciler and validator;
- the source of `remediation-case-reconciler.ts` (`classifyRemediationCaseReuse`, new-case minting), `remediation-case-store.ts` (`classifyBuildReviewRecurrence`, `buildReviewRecurrenceLineage`, `BUILD_REVIEW_RECURRENCE_ATTEMPT_LIMIT`), `remediation-case-artifact.ts`, `remediation-case-validator.ts`, `build-review-adjudication-coordinator.ts`, `types/events.ts` and `skills/remediate/SKILL.md`;
- the event trail of case `26a04ec0-caa8-4418-b39d-aee8ce20049d` in `.daemon/evals-raw/features/shipped-features-decide-artifacts-accumulate-in-do/events.jsonl`.

**Mode:** lightweight (Medium tier). This covers sections 2 (feasibility) and 4 (alignment), plus the required wiring surface.
**Verdict:** APPROVED

## Feasibility

| Item | Assessment | Basis |
|---|---|---|
| **Observed failure** | Case `26a04ec0` was reconciled open, its effect `74d67e04` reserved and applied, and BUILD ran (`lap-39db16f0…`). The next lap (`lap-3aac0b93…`) resolved it. In `lap-50e10cb4…` the judge bound a new testQuality finding to it as `act`, and the coordinator emitted `remediation_semantic_repeat_halt` with reason `regressed` and halted `needs-human`. | verified, 95% |
| **Why it halts today** | `classifyRemediationCaseReuse` returns `halt-regression` for any resolved `act` record. The coordinator's pre-reconciliation loop over bound `act` rows halts on it through `recordHaltingBinding` and `failUnlessAccepted`. An unbound row with the same sources instead reaches the D5.10 lineage check. | verified, 95% |
| **Declaration shape** | Feasible. The artifact parser already accepts the optional, bounded `distinctFrom` on a case row through an expected-keys list. `reRaise` is one more optional key with a closed `kind` union and a bounded reason. The validator already drops `distinctFrom` entries that do not name an eligible owner, which is the precedent for dropping an ineligible `reRaise`. | verified, 90% |
| **Lineage check reuse** | Feasible. `buildReviewRecurrenceLineage(cases, ownerIds)` takes arbitrary owner ids and counts applied `act` attempts across `recurrenceOf`. Passing the bound case id (plus any exact-source owners) gives the residual rebind the same limit, halt writer and event as an unbound recurrence. | verified, 90% |
| **Minting a new case** | Feasible. `reconcileRemediationCases` mints an unbound `act` row as a new case and stamps `recurrenceOf` from exact owners or a provenance owner. A residual rebind is passed to it unbound, with the bound case as an explicit recurrence owner, so the resolved row is never edited and no store field is added. `convergedCaseFor` only converges on open cases, so it cannot fold the row back into the resolved bound case. | verified, 85% |
| **Charging** | A new `act` case reserves a fresh action effect, which the existing kickback budget charges as a first action (D5.6). The cumulative cap still applies on top of the lineage limit. | verified, 90% |
| **#3461 interaction** | Compatible. #3461's bindable set for a resolved `act` case with an applied action is `act`, `defer`, so a bound `act` row stays admissible and reaches this routing. `reRaise` on a `defer` row is dropped. Both specs edit the same files, so this spec is sequenced after #3461. | verified, 85% |
| **Judge declares honestly** | A judge may call a real repeat `residual-gap`. This is not load-bearing for correctness: such a row is still bounded by the lineage limit of three applied attempts and the cumulative kickback cap. | inferred, 70% |
| **Stack, prerequisites, isolation** | No new dependency, module, persisted field, CLI flag or hook. Nothing new is shared between worktrees. | verified |

## Alignment

- **Mixed-laps D5.6 / predecessor D7.** The explicit-rebind regression halt is narrowed, not removed. A judge-declared `repeat` still halts as the predecessor D7 regression. The amendment of 2026-10-28 (D5.12–D5.15) records the narrowing on the authoritative successor ADR. The superseded predecessor is not amended: its D7 is in force only through the successor's references, which the amendment updates.
- **Mixed-laps D5.8–D5.10.** A residual rebind reuses the recurrence lineage, its single limit of three and its halting-binding writer, rather than adding a second bound. Distinctness is still declared, never inferred, and `distinctFrom` is unchanged.
- **Mixed-laps D3.** An open attempted case re-raised as `act` still halts as `already-attempted`. The change touches only the `halt-regression` branch.
- **Design principle (CLAUDE.md).** Progress versus repeat is a judgement. The judge's verdict is schema-constrained (`residual-gap` or `repeat`), the engine does the bookkeeping (lineage, limit, charge), and nothing is inferred from prose.
- **Event spine.** The only telemetry change is additive optional fields on the existing `remediation_case_reconciled` and `remediation_semantic_repeat_halt` variants. There is no sidecar or new channel.
- **State.** The declared kind is a closed union, not a boolean, and the reported kind adds `undeclared` for an absent declaration. The resolved row is never rewritten, and the store version is unchanged.
- **Diagram.** It matches the design. No other `.docs/architecture/` diagram covers the adjudication reuse routing.

## Wiring Surface

| New surface | Production caller |
|---|---|
| `reRaise` case-row field (artifact parser) | `readRemediationCaseJudgement`, which reads `.pipeline/remediation.json` in the conductor's build_review judge (`engine/conductor.ts`) and hands the judgement to `coordinateBuildReviewAdjudication`. |
| `reRaise` eligibility drop (validator) | `validateRemediationCaseGraph`, called from the coordinator's round loop with the prior cases. |
| Residual rebind routing and repeat-halt attempt count | The coordinator's pre-reconciliation reuse loop, reached from `applyBuildReviewOutcome` in `build-review-outcome.ts` for every adjudicated build_review lap. |
| Explicit recurrence owner for a minted case | `reconcileRemediationCases`, called by the coordinator after the lineage check. |
| `reRaise` / bound case id on `remediation_case_reconciled` and `remediation_semantic_repeat_halt` | Emitted by the coordinator and persisted by the shipped `EventPersister`; both variants are already registered in `event-sinks.ts`. |
| Remediate skill `reRaise` rule | Read by the `remediate` judge on every build_review case dispatch. |

**Overlap scan (advisory):** `ai-conductor overlap-scan` reported only the stale branch `spec/no-runbook-recovery-for-a-build-review-semantic-ca` on `build-review-adjudication-coordinator.ts`; its PR #3491 is already merged. The landed #3461 spec has no build branch yet and edits the same coordinator, reconciler and validator, so this spec is blocked by #3461.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A real cycling case is declared `residual-gap` every lap | Technical | Medium | Medium | The lineage limit of three applied attempts halts it as `recurrence-limit`, naming every lineage case and the count; the cumulative kickback cap still applies |
| The residual rebind is reconciled as an edit of the resolved bound case | Data | Low | High | It is passed to reconciliation unbound with an explicit recurrence owner; a test asserts the bound row is byte-identical after the lap |
| The judge omits `reRaise` because the skill contract is not updated | Technical | Low | Low | An absent declaration routes as `undeclared` residual under the same limit, and the event says so |
| Textual conflict with #3461's build in the coordinator and validator | Integration | High | Low | Native blocked-by #3461; this spec's tasks name symbols, not line numbers |

## ADRs Created
None. The structural decision (how a bound re-raise of a resolved case is routed and bounded) is governed by `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5, amended with an additive note dated 2026-10-28 (D5.12–D5.15).

## Assumptions

| # | Assumption | Basis | Confidence | Impact if wrong | Load-bearing |
|---|---|---|---|---|---|
| A1 | `convergedCaseFor` never converges an unbound row onto a resolved case, so a residual rebind always mints a new case. | verified | 85% | The row would bind the resolved case; the byte-identical test fails in BUILD | no |
| A2 | An absent `reRaise` should route as residual (bounded), not halt. | verified | 100% | — operator-chosen in explore (approach B), consistent with the bounded-autonomy default of #3124 | yes, approved |
| A3 | #3461 builds first, and its bindable set keeps `act` bindable on a resolved applied action case. | verified | 85% | If #3461 changed that set, the bound row would be corrected to unbound before reaching this routing; the plan must be reconciled when #3461 lands | no |
