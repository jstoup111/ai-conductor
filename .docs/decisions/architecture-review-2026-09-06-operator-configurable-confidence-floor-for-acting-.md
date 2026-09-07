# Architecture Review: Operator-configurable confidence floor for acting on build_review findings

**Date:** 2026-09-06
**Mode:** DECIDE-time, lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Source:** jstoup111/ai-conductor#2383
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Six production surfaces, all inside settled components; no new seam, service, port, or shared state,
so parallel worktrees are unaffected. Stack unchanged — no new dependency.

| Surface | Change | Basis |
|---|---|---|
| `remediation-case-artifact.ts` | `RemediationCaseConfidence` (line 17) becomes an integer 0-100; range check replaces the enum check (line 166), keeping the `invalid-case-confidence` reason | 95% verified |
| `remediation-case-store.ts` | Same retype on the durable record (lines 52, 195, 207) | 95% verified |
| `build-review-adjudication-context.ts` | Carries the confidence type (line 24) into the adjudicator payload | 90% verified |
| `config.ts` | `act_min_confidence` joins `enabled` in the `build_review.adjudication` key set (line 120) and its validator (line 266) | 95% verified |
| `build-review-adjudication-coordinator.ts` | The floor applies at judgement admission, before `reconcileRemediationCases` | 90% verified |
| `types/events.ts` | Additive optional demotion-reason field on an existing remediation event member | 90% verified |

**The demotion seam is earlier than the issue's scope note implies.** The issue names "the effect
dispatcher's `act` path". That block (coordinator lines ~540-660) reads effect kinds the reconciler
has *already* persisted: it guards on `proposed.case.effect.kind !== 'action'` (line 558) and the
deferral kind (line 621). Rewriting a disposition there would desync the proposed case from its
stored record and trip those fail-fasts. The floor must therefore apply at judgement admission,
before reconciliation. *(90% verified — guard shapes read directly; the admission call site itself
was inferred rather than read line-by-line, and the plan should confirm it.)*

**Prerequisite: none.** No migration, backfill, or external account. `STORE_VERSION` stays at `v1` —
the adjudicator is enabled-gated and has produced no durable state, verified by finding zero
`.pipeline/remediation-cases.json` files across every worktree on 2026-09-06. There is nothing to
migrate, and a bump would only cost any in-flight feature a fail-closed halt. *(95% verified.)*

**Performance risk: none.** One integer comparison per case, bounded by `MAX_CASE_ROWS` (128).

**Test blast radius is the real cost.** Roughly 57 confidence enum-literal occurrences across 10
test files must move to integers. Mechanical fixture churn, not new behavior, but it is the bulk of
the diff and the plan must budget for it. *(95% verified.)*

## Alignment

Repo-wide sweep of all 309 ADRs in `.docs/decisions/`. Two GOVERN, six CONSTRAIN, 301 irrelevant.

**Governing — `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`** (adopting its
predecessor's non-conflicting decisions). The change conforms rather than departs:

- Predecessor D4 already lists `confidence` as a required governed field. Retyping it is an
  implementation detail inside an existing contract, not a new field, and range validation is
  exactly D4's stated shape — a field exceeding its bound fails the adjudication closed.
- D6 supplies the deferral effect the demotion reuses verbatim, including its exact hidden-marker
  lookup and sanitized four-section intake body.
- **D7 already decides the budget question:** "Deferred, rejected, and merged-only adjudications
  consume no kickback." A demoted case charging nothing is an existing decision, not new design.
- D9 already registers the remediation event members with every sink.
- D3 constrains ordering — demotion must complete before the PASS/kickback precedence evaluation,
  so a demoted case reads as a finalized permitted outcome rather than outstanding actionable
  content. This is the same constraint the seam finding produces independently.

**Governing — `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` decision 4.**
A new config key fails the registry-totality test until it declares a production consumer.

**Structural decision recorded by amendment.** A case's disposition becomes a function of provider
judgement *and* operator config where it was provider judgement alone — a revision of the durable
state-transition design, which meets §7's structural prerequisite. Per the operator's standing
preference for amendments over new ADRs, this is recorded as **D4.1-D4.5 appended to the governing
ADR** rather than as a new dated ADR. No new ADR was created and none was superseded.

**Not applicable:** `adr-2026-08-16-closed-build-review-finding-vocabularies` governs
finding-*identity* vocabularies; case-record confidence is not an identity field and enters no
identity hash — case ids are generated, not content-derived. An engine-verified integer is
consistent with that ADR's "closed vocabulary member or engine-verifiable reference" principle
regardless.

**State management.** The floor cannot represent an invalid state: it only narrows `act` to `defer`,
never the reverse, and never touches `reject`. At the default `0` the comparison never fires.

**Security / DI defaults.** No new endpoint, input, or persistence. Not applicable.

## Wiring Surface

| New production surface | Where it is called from in production |
|---|---|
| `build_review.adjudication.act_min_confidence` config key | Resolved through the existing `resolveBuildReviewConfig(this.config).adjudication.*` path already used for `enabled` at `conductor.ts:5009`, and consumed by the coordinator's judgement-admission path. Declared in the config-key consumer registry at `src/conductor/test/engine/config-consumer-registry.ts` beside `build_review.adjudication.enabled` (line 196). |
| Floor comparison + demotion in the coordinator | Reached from the existing `coordinateBuildReviewAdjudication` call in `conductor.ts`, on the path already taken whenever adjudication runs. No new entry point. |
| Demotion-reason event field | Emitted through the coordinator's existing `emit` callback into `ConductorEventEmitter`; persisted by the existing `EventPersister` to `.pipeline/events.jsonl`. |
| Demotion lines in the lap trace | Rendered by the existing `renderBuildReviewAdjudicationTrace`, whose output already reaches route detail, kickback evidence, and HALT markers. |

**Early overlap scan: non-informative.** `ai-conductor overlap-scan` reported 220 overlaps against
105 existing spec branches, including one named `spec/scan-overlap-against-each-branch-s-own-merge-base-`
— the scan's own known merge-base defect is inflating the result. No real collision signal could be
drawn from it. Advisory only; it does not affect this verdict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Demotion applied after reconciliation desyncs the proposed case from its stored record and trips a fail-fast | Technical | Medium | High | Condition 1: apply the floor at judgement admission, before `reconcileRemediationCases` |
| Inconsistent demotion mints a new `effect.id` per lap, so the marker dedup fails and duplicate issues are filed | Integration | Medium | High | Condition 2: demotion must be deterministic from `(confidence, floor)` alone, evaluated before reconciliation on every lap |
| A demotion in a repo with no tracker leaves the deferral `reserved`, and the lap halts instead of passing | Technical | Medium | High | Condition 3: the floor is inert when tracker deps are absent |
| The demotion path calls the kickback gate for a zero charge and perturbs `cumulative` | Data | Low | Medium | Condition 4: bypass the gate outright rather than charging zero |
| A new config key ships without a registry declaration, failing the harness's own totality test | Technical | Medium | Low | Condition 5: registry entry in the same diff |
| Enum retype misses one of 10 test files or the context type, breaking the build late | Technical | Medium | Low | Plan enumerates all six surfaces and all 10 test files as explicit tasks |

## ADRs Created

None. The structural decision is recorded as amendment D4.1-D4.5 on
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, which remains `Status:
APPROVED`. No ADR was superseded.

## Conditions

1. **Apply the floor at judgement admission, before `reconcileRemediationCases`** — not at the
   effect-dispatch block the issue names. (ADR D4.2; governing-ADR D3 ordering.)
2. **Demotion is deterministic from `(confidence, floor)` alone** and evaluated on every lap before
   reconciliation, so the case's `effect.id` is stable and the exact-marker dedup files exactly
   once. (ADR D4.3.)
3. **The floor is inert when the tracker dependencies are absent.** The `act` proceeds unchanged.
   A confidence floor must never convert a passing or actionable lap into a halt. (ADR D4.4.)
4. **The demotion path bypasses the kickback gate outright**, rather than invoking it for a zero
   charge, so `count` and `cumulative` are never touched.
   (`adr-2026-08-12-cumulative-build-review-convergence-bound`.)
5. **`act_min_confidence` declares a production consumer** in
   `src/conductor/test/engine/config-consumer-registry.ts` in the same diff.
   (`adr-2026-08-26` decision 4.)
6. **The demotion reason rides an additive optional field on an existing remediation event member.**
   If a new member proves necessary instead, it must declare its sink
   (`adr-2026-07-26-event-sink-registry-exhaustiveness`) and enter the audit mapping
   (`adr-2026-07-07-audit-trail-event-sink`). It is never rendered as a `kickback` event.
7. **A fully-demoted lap must be covered by a test asserting it reaches PASS**, not a halt — the
   operator-raised failure mode of "verdict fine but zero findings left to fix".
8. **Documentation lands in the same PR:** `docs/reference/configuration.md` key table (line 1017)
   and the `build_review.adjudication` behavior table (lines 1028-1029).

## Blocking Issues

None.
