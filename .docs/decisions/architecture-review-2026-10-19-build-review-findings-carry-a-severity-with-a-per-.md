# Architecture Review: build_review findings carry a severity with a per-rubric advisory threshold
**Date:** 2026-10-19
**Stories reviewed:** none yet. This is the pre-stories full review (Tier L, technical track). Its
inputs are:
- `.docs/track/build-review-findings-carry-a-severity-with-a-per-.md`
- `.docs/complexity/build-review-findings-carry-a-severity-with-a-per-.md`
- the approved component and sequence diagrams under `.docs/architecture/`

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Plain TypeScript in the existing engine, with no new dependency. The native result grammar admits a closed string enum (verified, `build-review-domain.ts` native-grammar note). |
| Prerequisites | jstoup111/ai-conductor#3271 must build first (operator decision 2026-10-19, recorded as a land dependency). No migration, external account or infrastructure is needed. |
| Integration surface | One module family (`engine/build-review-*`, `remediation-case-*`), plus config, the event union, the PR-body regions and five skills. All the surfaces are in-process. |
| Data implications | The built-in contract bump re-keys every built-in finding id once (ADR D2, operator-accepted); custom ids are unchanged because the custom identity grammar keeps its own version. The durable suppression entry becomes a discriminated union, and legacy entries read as the `confidence` kind. No data is lost; old aggregates still parse for reads. |
| Performance risk | None. The classification is a per-finding comparison beside an existing one. |
| Worktree isolation | No new ports, services or shared files. All state stays per-worktree under `.pipeline/`. |

## Complexity

High by the skill's scale: about six cooperating components plus a contract change, with no
external API or new state machine. **Plan estimate: about 20 tasks.**

The split per §3a was proposed: spec 1 for severity, threshold and surfaces, and spec 2 for the
adjudicator downgrade (D6/D7). **The operator declined it on 2026-10-19.** The plan carries a
`**Scope-exception:**` citing this decision.

## Alignment

- **Governing ADRs reused, not duplicated.**
  - Advisory classification extends the D4 suppression architecture of
    `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`: same reducers, same
    seam, same store, same event, same exclusion from live sources.
  - The downgrade's persistence reuses D5.1 settled-recurrence instead of new store logic.
- **Conflicts with approved decisions resolved by amendment, with operator approval.**
  - Mixed-laps D4.2 keeps the contract at v3. The new ADR's D2 bumps it to v4, and an amendment note
    is added beside D4.2.
  - Mixed-laps D5.1 enumerates finalized dispositions. D7 adds `advisory` there, with a note beside
    D5.1.
  - Portable-policy D7.1 fixes the custom result contract at `custom-findings` v1. D2 moves the
    result contract to v2, leaving the `custom-v1` identity grammar unchanged, with a note beside
    D7.1.
- **Operator authority is separate.** Advisory is never written into the operator disposition
  store, the same as suppression (D4.3). This keeps `adr-2026-08-13-stable-build-review-finding-dispositions`
  intact.
- **Event spine.** One additive optional field on `build_review_outer_verdict`, with no new
  channel. This is consistent with the event-spine skill's schema-not-file test.
- **Overlapping specs.**
  - #3271 (in DECIDE) rewires the same reducers, coordinator, context, CLI and PR body. It is
    sequenced before this spec.
  - Spec PR #2878 amends mixed-laps D3/D5 *deferral* and does not touch D4 or D5.1's disposition
    list. No contradiction.
  - The overlap scan found only `config.ts` and `resolved-config.ts` on
    `spec/daemon-self-host-guardrails`. That is advisory, a different key family.

### Focused local pattern basis

**Concern: the advisory bucket and its persistence.** Precedent: the confidence-floor suppression
from #2383.

- **Traits to preserve:**
  - classification happens in the effective reducers, before the pass/fail fork;
  - one idempotent upsert seam, keyed by exact finding id and called from both the effective path
    and the coordinator;
  - entries are never pruned;
  - excluded from live sources, and recorded in a non-blocking context section;
  - an additive optional event field.
- **Allowed variation:** a discriminated entry kind instead of a second list.
- **Rediscovery hints:**
  - `deriveEffectiveBuildReviewVerdict` (`build-review-aggregate.ts`)
  - the custom branch of `build-review-effective.ts`
  - `persistBuildReviewSuppressions` / `projectBuildReviewSuppressionEntries`
    (`build-review-suppression-history.ts`)
  - `allOperatorResolved` and the live-source filter in `build-review-adjudication-coordinator.ts`
  - `suppressedFindings` on `build_review_outer_verdict` (`types/events.ts`)

**Concern: mode-independent judgement extension.** Precedent: how `case-v2` admitted `escalate` in
`remediation-case-artifact.ts`.

- **Trait:** the parser admits the extra disposition only under an engine-declared condition.
- **Variation:** gated by the context's declared thresholds rather than the mode (ADR A4).

## Domain Integrity

- **Severity is a closed union type**, not a string. A total order function compares against a
  threshold. No numeric encoding leaks into persisted data.
- **Suppression entry is a discriminated union** (`confidence` | `severity`). A confidence entry
  cannot carry a threshold, and a severity entry cannot carry a floor.
- **Threshold is optional, typed as absent-or-severity.** There is no sentinel default such as
  `'nit'` meaning "off". Declaring `nit` is valid and never classifies anything.
- **Exhaustive matching** on severity and on entry kind. No `default` branch is allowed.
- **Parse, don't validate.** Severity is parsed once in the finding parser. Downstream code trusts
  the type.

## Wiring Surface

| New or changed production surface | Production caller (design-time) |
|---|---|
| `severity` on built-in v4 and custom v2 findings | Parsed by the existing `parseBuildReviewJudgedResult` and custom parser, reached from `dispatchBuildReviewRubric` in `step-runners.ts`. The schema is rendered into the prompt by `renderRubricContractShape`. |
| `min_severity` config keys (built-in and custom) | Validated in `config.ts`. Resolved in `resolved-config.ts` into the rubric policy. Declared in the config-consumer registry. Read by the shared threshold helper. |
| Shared threshold helper (generalized `buildReviewConfidenceFloors`) | Existing callers in `step-runners.ts`, `conductor.ts` and `build-review-cli.ts`, plus the gate-completion predicate in `artifacts.ts`, which replaces its private map. |
| `advisory` bucket in both effective reducers | `deriveEffectiveBuildReviewVerdict` and the custom effective path, called by the build_review step runner and the conductor's raw-FAIL branch. |
| Severity-kind suppression entries | The existing `persistBuildReviewSuppressions` seam, called from the step runner before the pass/fail fork and from the coordinator. |
| `advisoryFindings` on `build_review_outer_verdict` | Emitted where `suppressedFindings` is emitted in `step-runners.ts`. Rendered by the existing daemon-log projection. |
| Advisory history in the adjudication context, plus declared thresholds | Built by `build-review-adjudication-context.ts` for the remediate dispatch in `conductor.ts`. |
| `advisory` judgement disposition | Parsed by `remediation-case-artifact.ts`, validated by `remediation-case-validator.ts`, reduced by `reduceBuildReviewAdjudication`. Effects come from `remediation-case-effects.ts` (effect none). |
| Advisory settled-recurrence admission | The coordinator's settled predicate, which runs before every remediate dispatch. |
| `build-review findings` advisory listing | The existing `build-review findings` CLI subcommand (`build-review-cli.ts`). |
| `## Advisory build-review findings` PR region | The finish publication path (`finish-publication-production.ts`), alongside the accepted-risk and reduced-coverage regions, with the engine-owned region registry for masking. |
| Rubric and remediate skill guidance | The bundles the engine already dispatches: `skills/build-review-*/SKILL.md`, the custom contract text and `skills/remediate/SKILL.md`. |

Early overlap scan (advisory): only `config.ts` and `resolved-config.ts` overlap, with
`origin/spec/daemon-self-host-guardrails`. #3271 is not landed, so the scan cannot see it. It is
handled by the operator-chosen dependency.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Reviewers cluster severity at `major` the way confidence clustered at 82-100, so few findings become advisory | Knowledge | Medium | High | Impact-named levels with per-kind skill guidance; the D6 downgrade as a second lever; a post-ship measurement follow-up (A1) |
| The one-time built-in re-key strands in-flight features' built-in acceptances and settled cases | Data | High (certain once) | Medium | Operator-accepted (2026-10-19). The existing invalidation event makes it visible. Every v3 acceptance must be re-recorded with `build-review accept`; #3271's carry cannot rescue them, because it requires a currently valid disposition. At most one fresh judgement per feature. |
| A code collision with #3271 in the reducers, coordinator, context, CLI and PR body | Integration | High | Medium | Land dependency on #3271; this plan builds on its resolver |
| A reviewer omits severity and the whole result is malformed | Technical | Medium | Low | Native schema enforcement makes the field required at the provider; the existing mechanical-retry lane |
| An adjudicator downgrades a real defect to dodge a kickback | Technical | Low | High | Allowed only below an operator-declared threshold, with a rationale; visible in the CLI and on the PR; lowering the threshold reopens it (D7) |
| The PR region leaks local adjudicator rationale | Security | Low | Low | The region carries the reviewer summary only. The rationale stays local, per #1614. |

## ADRs Created

- `adr-2026-10-19-build-review-finding-severity-advisory-threshold` (DRAFT, pending operator
  approval). Decisions D1–D7.
- Amendment notes on the approved ADRs:
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, beside D4.2 and D5.1;
  - `adr-2026-09-10-portable-build-review-policy`, beside D7.1.

## Conditions

- **Build order.** #3271 builds first, recorded at land with
  `--depends-on jstoup111/ai-conductor#3271`.
- **Scope exception.** The plan states a `**Scope-exception:**` citing the operator's 2026-10-19
  decision to keep D6/D7 in this spec.
- **Obligation coverage.** The plan carries Architecture Obligation Coverage rows for every decision
  of the new ADR and of both amended ADRs.
- **No implementationQuality re-enable.** This spec does not change this repository's
  `.ai-conductor/config.yml`.
