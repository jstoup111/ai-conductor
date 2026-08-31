# Architecture Review: Infrastructure exits can masquerade as test sensitivity (#2051)
**Date:** 2026-08-30
**Stories reviewed:** none yet — pre-stories lightweight (Medium tier) review; input is the explore
output, `.docs/track/infrastructure-exits-can-masquerade-as-test-sensit.md`, and approach D as
adjusted (contract stays v3).
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** pure TypeScript engine + skill-text change; no new dependencies,
  services, or infrastructure. Verified against the current preflight
  (`src/conductor/src/engine/build-review-test-quality-preflight.ts:455`), envelope stamping and
  validation (`src/conductor/src/engine/build-review-coordinator.ts`,
  `stampBuildReviewDispatchedCandidate` / `validateBuildReviewDispatchedResult`), and contract
  source (`src/conductor/src/engine/build-review-domain.ts`). Confidence: verified, 95%.
- **Seam precedent:** `relocationAudit` is an existing provider-owned typed-evidence field passed
  through the engine-stamped envelope and validated by contract; `boundTo`
  (adr-2026-08-21 D2) is an existing optional-field-under-v3 precedent with
  malformed → `absent`-rerun semantics. `counterfactualSensitivity` composes both patterns with no
  novel machinery. Confidence: verified, 95%.
- **Prerequisites:** none. No migration: the skill-text edit changes `skillDigest`
  (adr-2026-08-21 D3), so cached judgements re-judge automatically; stored dispositions stay valid
  because the field is identity-excluded and the version does not bump.
- **Integration surface:** preflight → projection → reviewer skill → envelope validation →
  cache/persistence — one seam, all within the build_review subsystem. No cross-domain reach.
- **Worktree isolation:** no new ports, services, or shared state.

## Alignment

Full-pass ADR sweep (269 ADRs) performed; findings and their resolution:

- **Contradicted, resolved by supersession:** adr-2026-08-17 D2–D4 (exit-code-decides-RED) and
  adr-2026-08-19 D2's closed provider field set — both superseded in the named scope by the new
  DRAFT ADR below; amendment notes added in place to adr-2026-08-17 ("Why #1593 is not reopened")
  and adr-2026-08-13 §3 ("normal test failure is the expected RED evidence"). No #1593 ADR exists
  to supersede; the rule lives only in those two records (verified by sweep).
- **Conformed to, no change:** adr-2026-08-16 (version bumps only on identity-semantics change —
  honored by staying v3; closed vocabulary normalize-then-validate; one engine-side vocabulary
  source bound to the skill text), adr-2026-08-21 (boundTo precedent; skillDigest invalidation),
  adr-2026-08-18 mechanical-fault lane (launch/timeout/signal untouched),
  adr-2026-08-22-opt-in-rubric-container D3 (judge must still cite a stub-passable assertion),
  adr-2026-08-13 closed-projection principle (evidence shape participates in projection digest),
  adr-2026-07-13 / adr-2026-08-16 D3 (malformed field → `absent` rerun, never a burned lap),
  adr-2026-08-22-one-owner (no plan-task appending from `indeterminate`),
  adr-2026-08-05 evidence-derived reasons (doctrinal basis for `indeterminate`),
  event-spine ADRs (any new occurrence rides `ConductorEvent` additively; adr-2026-08-17 D5's
  existing excerpt-bearing event is the model).
- **Convergence:** `indeterminate` neither clears nor refunds the cumulative convergence bound
  (adr-2026-08-12 / adr-2026-08-18-rebase-invalidation); laps still terminate against
  `rubricFailures` unchanged.

No local-pattern departure is authorized or needed; the `boundTo`/`relocationAudit` traits
(optional, engine-validated, identity-excluded, absent-on-malformed) are the binding precedent
basis. Rediscovery seeds: `stampBuildReviewDispatchedCandidate` and
`validateBuildReviewDispatchedResult` in `build-review-coordinator.ts`; `boundTo` handling in
`build-review-domain.ts`.

## Wiring Surface

- **`counterfactualSensitivity` result field** — produced by the testQuality reviewer per
  `skills/build-review-test-quality/SKILL.md`; validated in the existing envelope validation path
  (`validateBuildReviewDispatchedResult`, `build-review-domain.ts` contract); persisted via the
  existing judged-envelope/cache path (`build-review-cache.ts`); consumed by the outer testQuality
  verdict weighing in the coordinator/step-runners. No new entry point.
- **Neutral classification semantics in the preflight** — same producer/consumers as today
  (`materializeTautologyPreflight` → `preflightProjection` → projection v2); the change is the
  meaning and naming of the completed-nonzero case, not a new surface.
- **Closed vocabulary source** — one engine-side constant in the existing vocabulary source bound
  to the skill text, drift-checked by `test/test_harness_integrity.sh` per adr-2026-08-16 D5.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Reviewer misjudges a genuine reverted-import collection failure as `indeterminate`, weakening #1593 evidence | Technical | Low | Medium | Skill text names the collection-failure case as `supports`; reviewer must still cite a stub-passable assertion for any finding, so no false finding results |
| Older cached/in-flight v3 results lack the field | Integration | Medium | Low | Field is optional; absent means today's behavior; skillDigest change re-judges caches on next lap |
| Vocabulary drift between engine constant and skill text | Technical | Low | Low | adr-2026-08-16 D5 integrity-check binding |

No High-impact risks.

## ADRs Created

- `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded` — APPROVED by the operator
  2026-08-30. Supersedes adr-2026-08-17 D2–D4 and extends adr-2026-08-19 D2's closed field set by
  exactly one field.

## Conditions

None.
