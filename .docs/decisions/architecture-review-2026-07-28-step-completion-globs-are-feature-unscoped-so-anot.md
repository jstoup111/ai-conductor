# Architecture Review: Feature-aware step artifact resolution (#993)

**Date:** 2026-07-28
**Tier:** M (lightweight review)
**Track:** technical
**Verdict:** APPROVED
**ADR produced:** `adr-2026-07-28-feature-aware-artifact-resolution.md` (Status: APPROVED by operator 2026-07-28)

## Feasibility

| Decision | Feasible? | Basis | Confidence |
|---|---|---|---|
| Typed contract with derived glob compatibility export | Yes | `STEP_ARTIFACT_GLOBS` is centralized and its consumers import it; a projection preserves the current `string[]` API while moving authored policy into the contract. | verified, 95% |
| Shared feature resolution without a new manifest | Yes | `CompletionContext`, both renderer option types, `resolveFeaturePlanPath`, `resolveFeatureStoriesPath`, and engineer land's change-set attribution already provide the required inputs/patterns. | verified, 95% |
| Three-consumer migration | Yes | Generic completion, interactive review, and dashboard status have direct, enumerated call sites; no external integration or infrastructure boundary is involved. | verified, 100% |
| Legacy compatibility ladder | Yes, with tests | Exact plan-stem alignment is universal for current coherence files and already implemented for plans/stories; the committed corpus includes dated/prefixed variants requiring explicit normalization and change-set/singleton fallbacks. | verified, 90% |

No schema migration, external service, authentication change, new package, or shared worktree resource is required.

## Alignment

- Aligns with the repository design principle: artifact scope becomes mechanically declared and enforced rather than relying on naming discipline.
- Extends the #407 scoped plan/story precedent instead of introducing a parallel identity system.
- Closes the artifact-glob tightening explicitly deferred by approved ADR `adr-2026-07-26-daemon-decide-preseed-ownership`.
- Preserves the stronger session-fresh/custom predicates; the typed registry does not replace semantic gate evidence.
- Scope-check verdict remains consumer-facing, catalog n/a, provider-agnostic.

## Wiring Surface

| New or changed production surface | Production wiring commitment |
|---|---|
| `STEP_ARTIFACT_CONTRACTS` | Imported/consumed inside `artifacts.ts` as the authored source for the derived glob projection and shared resolver. |
| `resolveArtifactFiles` | Called by `checkStepCompletion`, the conductor's interactive artifact-review collection, and `getArtifactStatus`. |
| Artifact resolution context/diagnostic result | Populated from conductor completion state and the existing `featureDesc` held by terminal/create renderers; rendered as unsatisfied/ambiguous status where appropriate. |
| Derived `STEP_ARTIFACT_GLOBS` | Continues serving existing compatibility/read-only consumers while no longer carrying hand-authored scope policy. |

The advisory overlap scan named `src/conductor/src/engine/artifacts.ts` across many queued spec branches, including the #971 coherence work that deferred this issue. This is merge-contention risk, not a design conflict; implementation should keep the contract migration localized and rebase only at the sanctioned finish boundary.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Historical feature artifacts cannot be associated and false-fail | Integration | Medium | High | Change-set evidence, explicit normalization, singleton fallback, corpus fixtures, and actionable ambiguity diagnostics. |
| Resolver work makes every dashboard refresh expensive | Performance | Low | Medium | Resolve feature/change-set context once per refresh and reuse it across step contracts; prohibit per-pattern git discovery. |
| A custom predicate is accidentally weakened during migration | Technical | Low | High | Inventory `CUSTOM_COMPLETION_PREDICATES`; resolver remains only the generic fallback unless a predicate explicitly calls it. |
| High branch overlap causes semantic merge conflict | Integration | High | Medium | Small focused source surface, overlap noted in plan, sanctioned finish-time rebase and full verification. |

## ADRs Created

- `adr-2026-07-28-feature-aware-artifact-resolution.md` — APPROVED by the operator on 2026-07-28.

## Conditions

1. The plan includes a custom-predicate inventory and a corpus-backed legacy compatibility task.
2. The plan wires all three generic consumers and includes a production-reachability assertion for each.
3. The implementation updates `docs/reference/artifacts.md`; no migration block is expected because no CLI, hook, settings schema, or skill symlink changes.

## Blocking Issues

None.
