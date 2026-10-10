# Architecture Review: coverage_binding lap-cap halt has no supported recovery (#2846)
**Date:** 2026-10-10
**Mode:** Lightweight (Medium tier) — Sections 2 and 4 only
**Input:** explore output and track scope boundary (`.docs/track/coverage-binding-lap-cap-halt-has-no-supported-rec.md`); sequence diagram `.docs/architecture/coverage-binding-lap-cap-halt-has-no-supported-rec.md`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | TypeScript engine only; no new package, service, or infrastructure. |
| Prerequisites | None. Every primitive already exists: `recordKickbackCapEvidence`, `stageKickbackBudgetAdjustment` / `applyKickbackBudgetAdjustment`, `consumeResumeAuthorizations`, `renderKickbackRecoveryHint`, `kickbackBudgetView`. |
| Integration surface | Five engine modules in one domain (kickback budget): `kickback-budget-cli.ts`, `kickback-budget-view.ts`, `kickback-ledger.ts`, `halt-classification.ts`, the coverage_binding reopen in `step-runners.ts`, plus `daemon-rekick.ts` for the feature-scoped ledger read. |
| Data implications | No schema change. `gates.coverage_binding` already exists in the ledger with `laps`; it gains the optional fields every gate entry already admits (`capEvidence`, `effectiveLapCap`, `adjustments`, `pendingAdjustment`, `resumeAuthorization`). Existing ledgers stay readable. |
| Performance risk | None; one extra ledger read under the existing lease on the cap path only. |
| Worktree isolation | All state is per-worktree `.pipeline/`; no ports, databases, or shared files. |

### Verified claims (verify-claims protocol)

| Claim | Confidence | Basis |
|---|---|---|
| The CLI admits only `build_review`, `prd_audit`, `architecture_review_as_built` for raise, reset, and inspect. | 99% | verified: `GATES` set in `kickback-budget-cli.ts`, used by the mutation guard and the inspect row list. |
| `raise` refuses any gate whose entry has no `capEvidence` ("no current cap evidence for that gate"), and the coverage_binding cap path records none. | 97% | verified: staging callback in `kickback-budget-cli.ts`; the only `recordKickbackCapEvidence` callers are the BUILD pending-repair settlement and the `build_review` cap paths in `conductor.ts`. |
| The coverage_binding cap halt is written by the generic step-refusal branch as `needs-human` with the reason verbatim and no generation line. | 95% | verified: `failedStepResult.refusal` branch in `conductor.ts` writes `reason + '\n'` with class `needs-human` for a non-seal refusal; the reopen returns `refusal: { kind: 'needs-human' }`. |
| The restage cap ignores `effectiveLapCap`. | 97% | verified: `step-runners.ts` passes `remediationLapCapForGate('coverage_binding', …)` (generic cap 2); `settleRemediationRound` compares `laps >= lapCap` with no entry override. |
| Stage, apply, and view arithmetic treat every gate other than `prd_audit`/`architecture_review_as_built` as cumulative. | 98% | verified: four literal `gate === 'prd_audit' \|\| gate === 'architecture_review_as_built'` predicates (`capEvidenceAgreesWithAdjustment`, `applyKickbackBudgetAdjustment`, `kickbackBudgetView`) and `gate !== 'build_review'` in the CLI. Adding the gate to the CLI alone would raise `effectiveLimit`, which nothing reads for it. |
| With the judge enabled, a cap-exceeded reopen overwrites the invalidated envelope with status `failed`, which makes the next run reopen-ineligible. | 85% | verified by reading: `writeEnvelope('failed', entries)` precedes the cap refusal; eligibility requires `previous.status === 'invalidated'`. Inferred (not exercised): after a grant the rerun would skip the reopen. The issue's successful hand-edit recovery is consistent with the judge-disabled path, which writes no envelope. |
| The coverage_binding reopen charges the feature (root) ledger; the CLI and the daemon sweep default to the active child's ledger when child state exists. | 90% | verified: `settleRemediationRound(projectRoot, …)` takes no child; `dispatchKickbackBudgetCommand` and `consumeResumeAuthorizations` resolve the active child when children exist. |
| A cleared halt re-dispatches coverage_binding and the reopen replays its admission, settling under the current cap. | 85% | verified: admission is idempotent by key and the settlement receipt is recorded only on success; corroborated by the issue's hand-edit recovery. |

No unconfirmed load-bearing assumption remains.

## Alignment

- **Governing ADR reused, not duplicated.** `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` (with the superseded ADR's carried-forward D1-D8) governs this command family. The change admits one more gate to an existing structural mechanism and makes no new structural decision, so no new ADR is created; the governing ADR is amended additively with D6.
- **Halt taxonomy.** Class stays `needs-human` (D1); typed ledger evidence and generation, not class or prose, authorize recovery (D2). Same shape as the `restack` pseudo-gate precedent.
- **No new config key.** `adr-2026-09-06-reopened-task-resolution` decision 10 keeps coverage_binding under the engine default per-gate cap with no config key; the feature-local raised cap is the operator recovery the family already grants other lap gates, not a configuration source. The filer's config-key hypothesis is rejected (track scope boundary).
- **Event spine.** Authorization rides the existing `kickback_budget_adjustment_authorized` event and `halt_cleared` (`cause: 'kickback-budget'`); no new event type or channel.
- **Machinery over prose.** The four duplicated lap-gate predicates are replaced by one engine-owned predicate, so admitting a gate to the grammar cannot drift from its budget arithmetic — the drift that makes the filer's minimal fix insufficient.
- **Diagram accuracy.** The sequence diagram reflects the flow; no container or component changes.
- **Security.** No new endpoint; existing TTY, operator-identity, park, and lease authority unchanged.

Focused local pattern basis: the `prd_audit` lap path. Role: a lap-budgeted remediation gate recovered by `raise`. Traits to preserve: evidence recorded under the ledger lease before the halt; `effectiveLapCap ?? default` read where the cap is enforced; recovery hint rendered by `renderKickbackRecoveryHint`; generation line appended to the halt body. Allowed variation: coverage_binding charges at restage time (not BUILD dispatch) and halts `needs-human`, not `kickback-cap`. Rediscovery hints: `settleBuildPendingRepair` in `conductor.ts`, `recordKickbackCapEvidence` in `kickback-ledger.ts`, `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` in `halt-classification.ts`.

## Wiring Surface

| Surface | Production caller |
|---|---|
| Shared lap-budgeted gate predicate (new export) | Called by the existing stage/apply evidence comparison and apply arithmetic in `kickback-ledger.ts`, by `kickbackBudgetView`, and by `dispatchKickbackBudgetCommand`. |
| `coverage_binding` in the CLI gate set and defaults | Existing `kickback-budget` subcommand dispatch (`dispatchKickbackBudgetCommand`). Default cap derived from `remediationLapCapForGate`. |
| `coverage_binding: 'needs-human'` in `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` | Existing readers: the CLI live-halt check and `consumeResumeAuthorizations`. |
| Cap evidence and halt body at coverage_binding cap | The existing coverage_binding reopen in the `coverage_binding` step runner (both judge-disabled and judge-enabled branches), reached through the conductor's step dispatch. |
| `effectiveLapCap` honored at settlement | Existing `admitAndRestageRepair` → `settleRemediationRound` call from the coverage_binding reopen. |
| Feature-ledger read for feature-scoped gates | Existing daemon loop's `consumeResumeAuthorizations` sweep and the CLI's ledger resolution. |

Early overlap scan (advisory): one overlap — `origin/spec/daemon-self-host-guardrails` touches `daemon-rekick.ts`; no other unmerged work touches these files.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A grant succeeds but the rerun skips the reopen because the envelope was overwritten as `failed` | Technical | Medium | Medium | D6.5: preserve reopen eligibility on cap failure; plan task with a rerun-after-grant integration proof. |
| Changing the shared predicate alters `build_review` or the existing lap gates | Technical | Low | Medium | The predicate's set is exactly today's two gates plus coverage_binding; existing raise/reset/inspect tests stay green. |
| Stacked feature: authorization written to one ledger, sweep reads another | Technical | Low | Medium | D6.6: coverage_binding resolved in the feature ledger by CLI and sweep. |

## ADRs Created

None. Amended: `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` — D6 added (APPROVED ADR; additive note).

## Conditions

None.
