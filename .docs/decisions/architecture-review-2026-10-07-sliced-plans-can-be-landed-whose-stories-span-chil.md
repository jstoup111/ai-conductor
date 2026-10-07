# Architecture Review: Sliced plans — story ownership and stack eligibility (#2941)
**Date:** 2026-10-07
**Mode:** Lightweight (tier M): sections 2 (Feasibility) and 4 (Alignment)
**Input reviewed:** technical track `.docs/track/sliced-plans-can-be-landed-whose-stories-span-chil.md`
(approach C, operator-confirmed scope including the ADR-owed `stacked_prs.max_slices` work), the
approved diagram `.docs/architecture/sliced-plans-can-be-landed-whose-stories-span-chil.md`. Stories
and plan do not exist yet.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure TypeScript inside existing modules. No new package, service or infrastructure. (verified) |
| Prerequisites | Foundation shipped: child identity, `MAX_CHILD_ID` and per-child state, via #3019 (verified: `e734dea775`). `validatePlanSlices` and the `stacked_prs` block exist (verified). |
| Integration surface | `plan-slices.ts`, `plan-task-parse.ts`, `engineer/land-spec.ts`, the `coverage_binding` runner in `step-runners.ts`, `artifacts.ts` (sign-off parser), and config load/registry (`config.ts`, `types/config.ts`), plus `skills/plan/SKILL.md`. These are 3+ module boundaries, all inside the engine, and all already connected by the existing slice path. |
| Data implications | One optional envelope field (story → child), kept and versioned like the existing slice membership. One new config key. No migration, and unsliced/flag-off plans keep their behavior. |
| Performance | Linear scans of plan text at land and once per `coverage_binding` run. Negligible. |
| Worktree isolation | No ports, databases or shared state. The predicates are pure. |

Verified facts the design rests on:

- Land loads the target config (`land-spec.ts:479`). Confidence 95%, verified.
- The runner holds `HarnessConfig` and a `buildStepRegistry` (`step-runners.ts:1026-1027`), so the
  current step order is available at build entry. Confidence 90%, verified by reading. The exact
  position of resolved custom steps in the registry is to be confirmed in BUILD against
  `steps.ts:538-602`.
- 82 of 131 plans carry multi-id Story lines. Confidence 99%, verified by grep.
- `stacked_prs` is not set in this repo's `.ai-conductor/config.yml`, so the flag-gated rungs are
  dormant here until the operator enables it. Confidence 95%, verified.

## Alignment

- **Governing ADRs reused and amended (additive notes):**
  - `adr-2026-09-29-plan-slice-manifest` D2, D3, D5, D6;
  - `adr-2026-08-31-coverage-binding-judge-step` D1 (feature-scope contract, D16/D19 triggers);
  - `adr-2026-10-03-stacked-child-plans-identity-and-state` decision 5 (land behavior for the slice
    bound).
- **One owner per question.** Ownership and eligibility live beside `validatePlanSlices`. Land and
  `coverage_binding` call the same functions (the #1744 shared-predicate precedent and D2's "only
  production callers"). No new importer of `plan-slices.ts` is introduced, which respects the
  identity ADR decision 5 restriction.
- **Event spine:** no new event or sidecar. Refusals use the existing land-gate error and the
  `coverage_binding` refusal and halt path. Ownership is an envelope field like slice membership.
- **State management:** eligibility is a typed verdict listing reasons, not booleans. Ownership
  violations are typed codes (`story-spans-children`, `multi-story-line`).
- **Machinery over prompt:** every rule is engine-enforced at land and build entry. `/plan`'s
  proposal is the only prompt-level part, and land backstops it.
- **Diagram accuracy:** the approved diagram matches this design.
- **Production DI defaults:** no new DI seam and no in-memory default.

**Focused local pattern basis.**
- **Precedent:** the existing `plan-slices` land rung and its `coverage_binding` re-validation. Find
  them via `validatePlanSlices`, `landGateError('plan-slices'`, and the `sliceMembership` handling in
  the `coverage_binding` runner.
- **Traits to preserve:** pure, model-free, offline predicates; one function shared by both
  callers; every violation reported (not just the first); non-waivable refusal; the envelope field
  is optional, kept on invalidation, and kept out of the judge prompt.
- **Allowed variation:** the new rung engages only under the flag, and runs after the existing
  rung.

**Sign-off parser precedent:** `parseComplexityTier` / `parseTrack` in `artifacts.ts`, a single
case-insensitive line regex that returns `undefined` when the line is absent.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| Story-ownership predicate (`plan-slices.ts`) | `landSpec` `stacked-delivery` rung, and the `coverage_binding` runner's slice layer |
| Stack-eligibility verdict (`plan-slices.ts`) | Same two callers |
| Multi-id Story-line reader (`plan-task-parse.ts`) | Ownership predicate |
| `Stacked-Delivery:` sign-off parser (`artifacts.ts`) | `landSpec` (worktree complexity file) and the `coverage_binding` runner (feature complexity file) |
| `LandGateIdentifier` `stacked-delivery` | `landSpec`, surfaced by `ai-conductor compose land` |
| `stacked_prs.max_slices` config key | `loadProjectConfig` validation; read by the eligibility verdict at both callers; consumer-registry row |
| Envelope `story → child` ownership field | Written by the `coverage_binding` runner; read by #2942's child projection |
| `/plan` slice proposal and sign-off line | `skills/plan/SKILL.md`, run in DECIDE (composer / conduct) |

**Early overlap scan (advisory):** `origin/spec/daemon-self-host-guardrails` also touches
`src/conductor/src/engine/config.ts` and `src/conductor/src/types/config.ts`. It is an unmerged spec
branch. Expect a mechanical rebase on config-block validation and no semantic overlap.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A flag-on sliced plan that passed land is refused at `coverage_binding` after a config change | Integration | Low | Medium | Accepted by design. The refusal names every reason and needs no plan rework. |
| Loosening the grammar ceiling from 5 to 9 accepts 6–9-slice plans with the flag off | Technical | Low | Low | Only looser. Flag-off plans still build as one branch, and stacking is still bounded by `max_slices` (default 1). |
| The custom-step region test misclassifies chained customs | Technical | Medium | Medium | Decide the region from the resolved registry order, not from `after` text. Tests cover chained, before-region, in-region and after-region customs. |
| `/plan` writes the sign-off line without real operator acceptance | Knowledge | Low | Medium | It is an operator-gated DECIDE step, the same control as every DECIDE marker. The ADR records the limit. |

## ADRs Created

- `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`: this assigns cross-module
  ownership (one predicate owner shared by land and build entry) and adds durable envelope state
  that the existing ADRs do not cover. Additive amendment notes were placed on the three governing
  ADRs listed above.

## Conditions

1. The new ADR must be APPROVED before stories are written.
2. The stories must cover the four "unchanged" paths explicitly: an unsliced plan, a sliced plan with
   the flag off, a multi-id Story line in an unsliced plan, and a `max_slices` default of 1 with the
   flag off.
3. The `coverage_binding` re-check must be tested under a config that changed after land: the flag
   turned on, and a custom step moved into the region.
