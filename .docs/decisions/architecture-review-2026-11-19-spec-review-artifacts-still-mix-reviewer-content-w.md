# Architecture Review: Shorter spec reviews

**Date:** 2026-11-19  
**Inputs reviewed:** Approved #3419 PRD, layout diagram, operator cleanup decision and the #3405 and #3418 manifest decisions.  
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility and alignment

The manifest builder in feature-manifest.ts currently classifies files by legacy directory and the parser expects one plan. A summary therefore needs a distinct classification; it must never become an executor input. The before-land change-set reader and the after-land manifest reader serve different lifecycle moments. An incomplete manifest at plan creation would hide coherence files authored later. Register at the final DECIDE boundary and use the same feature identity throughout interactive authoring.

The current coherence validator checks the criterion and quoted task text. Preserve its omissions, duplicate and invented row checks and the existing waiver path when resolving references. Plan review already supports indexed inputs and a fallback. Keep the shared decision corpus and review results discoverable at their existing homes. These findings are verified against the manifest source, engineer/coherence-validator.ts, plan-review-runner.ts and the two approved manifest ADRs.

## Complexity and domain integrity

Large. Estimated 12–16 tasks across authoring, format resolution, validation, review, interactive handoff, cleanup and parity verification. Feature identity, artifact kind, criterion identity and task-check identity are distinct; resolving a reference supplies evidence but does not judge its sufficiency.

## Wiring surface

| Proposed surface | Production callers |
|---|---|
| Layout selection and artifact classification | Composer worktree authoring and land, interactive DECIDE entry and final registration, feature discovery and ownership policies |
| Review format and plan summary | Authoring skills and templates, feature manifest, protection and retention |
| Criterion and check resolution | Land coherence, plan review, coverage judgement and PRD audit |
| Summary retention | Existing docs-prune selection, deferral and guarded PR publication; historical lookup resolves the full plan |

## Risks and conditions

Gate inputs may silently shrink if the summary is selected as the plan. Compare equivalent complete and incomplete specs through normal reader entry points. Open-PR deferral could miss a relocated candidate; prove whole-feature deferral with an edit to the summary. Retained files may lose discovery when the manifest is pruned; exercise durable reads after cleanup. Concurrent feature worktrees keep independent manifests. Existing GitHub publication uses the guarded docs-prune boundary.

Implementation depends on #3418's ownership and cleanup behavior. The authoring checkout contains its approved design; its shipped record is absent here. Verify the prerequisite at integration. The operator approved the persistence and opt-in rollout contract on 2026-11-20.

## ADRs created

adr-2026-11-19-spec-review-layout-and-criterion-references (APPROVED).
