# Architecture Review: Operator-configurable confidence floor for acting on build_review findings

**Date:** 2026-09-06
**Mode:** DECIDE-time, lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Source:** jstoup111/ai-conductor#2383
**Verdict:** APPROVED WITH CONDITIONS

> **Amended 2026-09-06 by #2383:** The first pass of this review approved confidence on the
> adjudicator's case record with a demote-to-defer floor. The operator then asked how that stops
> build_review from raw-failing and re-dispatching remediate every lap for a finding the floor was
> about to drop. It does not: the coordinator's only pre-dispatch skip is operator authority
> (`build-review-adjudication-coordinator.ts`, `allOperatorResolved`), and prior cases enter the judge
> as context rather than as a skip. The operator moved confidence to the rubric finding and added a
> settled-recurrence fast-path. This review was rewritten for that design; the original verdict and
> conditions are superseded in full by the text below.

## Feasibility

Six production surfaces, all inside settled components; no new seam, service, port, or shared state.
Stack unchanged.

| Surface | Change | Basis |
|---|---|---|
| `build-review-domain.ts` | `BuildReviewFinding` gains optional integer `confidence`; the `finding()` parser (line 65) range-checks it; out of range makes the result malformed as any invalid field does | 95% verified |
| `build-review-finding-identity.ts` | Untouched by design — the identity input is `rubric, contractVersion, concernKind, anchor` (line 14), so confidence never enters an id | 95% verified |
| `config.ts` / `resolved-config.ts` | `min_confidence` joins the per-rubric policy key set (line 121) and validator (lines 205-262), following the bounded-integer shape `build_review.maxParallel` uses; `ResolvedBuildReviewRubricPolicy` (line 694) gains the field | 95% verified |
| `build-review-aggregate.ts` | `deriveEffectiveBuildReviewVerdict` (lines 320-362) gains a `suppressed` bucket beside `accepted`/`unresolved`; the verdict formula at line 359 is unchanged | 95% verified |
| `build-review-adjudication-coordinator.ts` | Suppressed ids excluded from sources; a settled-recurrence predicate after the second `allOperatorResolved` check (line ~432) and before `dispatchSources` is frozen; suppression entries written to the store | 90% verified |
| `remediation-case-store.ts` / `types/events.ts` | Store gains a suppression-entry list keyed by finding id; `build_review_outer_verdict` gains an additive optional `suppressedFindings` list | 90% verified |
| `skills/build-review-test-quality/SKILL.md` | v3 result contract (line 56) states the optional field | 95% verified |

**No contract-version bump.** `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION` stays `v3`. Confidence
is optional and absent means blocking, so old results are never mis-read. A bump would fire
`build_review_disposition_version_invalidated` (`build-review-effective.ts:118`) for every stored
operator disposition; the skill-digest check (`build_review_cache_discarded`, `events.ts:264`)
already discards cached results when the skill text changes, so graders re-run with the new contract
without one. *(95% verified.)*

**The fast-path is sound on exact ids only.** Case source links carry `sourceId` (the
content-anchored finding id) and `outcome` (`remediation-case-store.ts:31-35`). An identical
recurrence has an identical id, so the match is mechanical. A drifted id is a live source and
dispatches the judge — the equivalence-under-drift judgement the adjudicator exists for. *(90%
verified; the store schema was read, the predicate placement inferred from the coordinator's
pre-dispatch block.)*

**Prerequisite: none.** No migration. The store gains an optional list; `STORE_VERSION` stays `v1`
because no live store exists (zero `.pipeline/remediation-cases.json` across all worktrees on
2026-09-06) and an absent list parses as empty.

**Performance risk: none.** One integer comparison per finding; one set lookup per source.

**Test blast radius is small.** Because confidence is optional, the 26 test files that construct
findings need no fixture migration. New cases land in the parser, reducer, coordinator, config, and
store tests.

## Alignment

Repo-wide sweep of all 309 ADRs in `.docs/decisions/` (performed on the first pass; re-checked
against the revised design). Two GOVERN, six CONSTRAIN, 301 irrelevant.

**Governing — `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`.** The revised
design amends it in two places, both as narrowings of what it already decides:

- D1 admits "every valid operator-unresolved content finding" to the mixed-lap judgement. Suppression
  narrows that set by one engine rule before D1 classifies the lap. Recorded as D4.1-D4.6.
- Predecessor D7 says a deferred/rejected case "reuses that outcome after the current adjudication
  confirms the binding". The fast-path skips that confirmation for exact-id recurrence only. Recorded
  as D5.1-D5.3.
- Predecessor D2 (operator authority separate from autonomous outcomes) is honored by keeping
  `suppressed` a separate bucket that never writes to the disposition store.
- Predecessor D5 (versioned feature-scoped store) is used as designed for the suppression entries.
- Predecessor D7's budget rule holds unchanged: a suppressed finding never becomes an action case,
  so it charges nothing.

**Governing — `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` decision 4.**
The new per-rubric key must declare a consumer or the registry totality test fails.

**Why `adr-2026-08-13-stable-build-review-finding-dispositions` is not amended, though the reducer
is its subject.** Its decision headings (`### 1. Separate semantic identity…`) match neither of the
decision extractor's accepted forms, so it has zero citable decisions and a change to it would be
rejected at land. Its decision 1 ("separate semantic identity from presentation evidence") is
honored, not changed: confidence is presentation evidence and stays out of the identity. The
uncitable-heading defect is filed separately.

**Constraining ADRs re-checked against the revised design:**
- `adr-2026-08-16-closed-build-review-finding-vocabularies` — confidence is not a vocabulary member
  and not an identity field; an engine-range-checked integer conforms to its "engine-verifiable"
  principle.
- `adr-2026-08-12-cumulative-build-review-convergence-bound` — suppression touches no ledger; the
  reset-on-PASS rule applies to a fully-suppressed lap exactly as to any pass.
- `adr-2026-07-26-event-sink-registry-exhaustiveness`, `adr-2026-07-07-audit-trail-event-sink`,
  `adr-2026-08-11-halt-events-ride-the-persisted-spine` — no new event member; one additive field
  on `build_review_outer_verdict`, and the fast-path reuses `remediation_adjudication_completed`.
- `adr-2026-07-04-kickback-event-emission-and-log-prominence` — suppression is never a `kickback`.

**State management.** Three buckets with three authorities: `accepted` (operator), `suppressed`
(engine, from grader confidence), `unresolved` (blocking). No invalid combination is representable
because a finding lands in exactly one. At the default floor the `suppressed` bucket is always empty.

## Wiring Surface

| New production surface | Where it is called from in production |
|---|---|
| `confidence` on the finding contract | Parsed by `finding()` in `build-review-domain.ts` on every rubric result the existing container already validates; requested by the skill text every grader session loads |
| `build_review.rubrics.<id>.min_confidence` | Resolved through `resolveBuildReviewConfig` into `ResolvedBuildReviewRubricPolicy`, read by `deriveEffectiveBuildReviewVerdict` via the existing effective-verdict call in `conductor.ts`; declared in `test/engine/config-consumer-registry.ts` beside `build_review.rubrics.effort` |
| `suppressed` bucket | Produced by the existing effective-verdict reducer the conductor already calls before choosing a route |
| Suppressed-id exclusion + settled-recurrence predicate | Inside `coordinateBuildReviewAdjudication`, on the path the conductor already takes for every effective FAIL |
| Suppression entries in the case store | Written by the coordinator under the existing store lease; read by `assembleBuildReviewAdjudicationContext` into the judge's context |
| `suppressedFindings` on `build_review_outer_verdict` | Emitted at the existing outer-verdict emit site; persisted and rendered by the existing sinks for that member |

**Early overlap scan: non-informative** (220 overlaps against 105 branches — the scan's known
merge-base defect). Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Confidence accidentally enters the identity hash and re-graded findings mint new ids, orphaning operator dispositions | Data | Low | High | Condition 1: identity input is unchanged; a test asserts two findings differing only in confidence share an id |
| The fast-path admits a drifted id and skips a judgement it should have made | Technical | Low | High | Condition 2: exact-id only; a test with a one-character anchor change must dispatch |
| Suppression written into the operator disposition store, granting autonomous accepted risk | Security | Low | High | Condition 3: separate bucket; a test asserts the disposition store is byte-identical after a suppressed lap |
| A grader omits confidence and the floor silently never fires | Technical | Medium | Low | Absent means blocking — the failure direction is cost, not silence; visible as an empty suppressed list |
| Suppressed findings vanish from the judge's memory and a later conflicting rubric finding is judged without them | Integration | Medium | High | Condition 4: suppression entries persist in the case store and enter the context; never pruned |
| The predicate resolves or prunes cases while settling | Data | Low | High | Condition 5: the predicate is read-only on the store |
| A contract-version bump invalidates every stored operator disposition | Data | Low | High | No bump; confidence optional |

## ADRs Created

None. The structural decisions are recorded as amendments D4.1-D4.6 and D5.1-D5.3 on
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, which remains `Status:
APPROVED`. No ADR was superseded.

## Conditions

1. **Confidence never enters the finding identity.** `BuildReviewFindingIdentityInput` is unchanged; a
   test proves two findings differing only in confidence share an id. (D4.1.)
2. **The settled-recurrence predicate is exact-id only.** A one-character change in a finding's
   anchor must dispatch the judge. (D5.1.)
3. **`suppressed` is a separate bucket that never writes operator authority.** The disposition store
   is byte-identical before and after a suppressed lap. (D4.3.)
4. **Suppressions persist in the case store and enter the judge's context as non-blocking history**,
   distinct from current sources so the source-complete validator does not demand an outcome for
   them; never pruned. (D4.6.)
5. **The predicate is read-only on the store.** It never resolves, prunes, or writes a case. (D5.2.)
6. **Absent confidence blocks.** A finding without the field lands in `unresolved`. (D4.2.)
7. **A fully-suppressed lap is an effective PASS that never enters adjudication**, and a mixed lap
   sends only surviving findings to the judge. (D4.4.)
8. **A skipped dispatch is recorded** via `remediation_adjudication_completed` with the settled case
   ids. (D5.3.)
9. **`min_confidence` declares a production consumer** in the config-key registry in the same diff.
   (`adr-2026-08-26` decision 4.)
10. **Documentation lands in the same PR:** `docs/reference/configuration.md` rubric-policy key table,
    and the build_review gate explanation for the suppression bucket.

## Blocking Issues

None.
