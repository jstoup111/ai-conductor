# Architecture Review: Restack cascade cap is sized by the feature's complexity tier (#3472)
**Date:** 2026-10-28
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment
**Inputs reviewed:** the operator-confirmed explore outcome in
`.docs/track/restack-cascade-cap-halts-l-tier-stacked-features-.md`, the complexity record, and
`.docs/architecture/restack-cascade-cap-halts-l-tier-stacked-features-.md`. No PRD (technical
track); stories do not exist yet.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. A pure resolver over (config, tier) plus reuse of the existing integer-or-tier-map validator. Verified by reading. |
| Prerequisites | #3475 (restack limit per originating child) lands first: after it, the restack ledger entry stores no limit, and the budget view and raise read the originating child's limit from the cap evidence. This design only changes the default those reads fall back to. `ConductState.complexity_tier` already exists in the feature-wide `.pipeline/conduct-state.json` (`readConductStateOverlay` keeps DECIDE metadata feature-wide), and stacked delivery requires tier M or L (`plan-slices.ts`). Verified. |
| Integration surface | Engine-internal: config validation (`engine/config.ts`, `types/config.ts`), a new pure module `engine/restack/cascade-allowance.ts`, the cap reader (`engine/restack/cascade-cap.ts`), its one enforcement caller (`restack-executor.ts`, before the journal), the stack preflight's discarded per-child pre-check (`stack-preflight.ts`, removed), the restack raise/reset and inspect paths in `engine/kickback-budget-cli.ts`, and `daemon status` (`engine/daemon-observe-cli.ts`). No external API. |
| Data implications | The committed `.ai-conductor/config.yml` contract widens by one optional key, `stacked_prs.max_restack_cascades`. It takes a positive integer (every tier) or a map whose keys are a subset of `S`, `M`, `L` with positive-integer values. `refs/conductor/<slug>/cascades` keeps its version-1 shape. A feature already in flight keeps any `limits[k]` an operator wrote; children without one move from 3 to the tier default (L 8). No migration: every valid config stays valid with the same meaning. |
| Performance risk | None. One config load and one state read per cap check, raise, inspect or status row. |
| Worktree isolation | Tier is per-worktree `.pipeline/` state. Config is read from the main checkout, which the dispatching executor also loads (`loadConfig(projectRoot)`), so a feature branch's stale config cannot split enforcement from display: the #3502 failure class. The counter is the existing per-slug ref. Nothing new is shared. |

**Key verified facts behind the design**

- **Every reader of the default is enumerable.** `MAX_RESTACK_CASCADES_PER_CHILD` is read by
  `checkCascadeCap` and the `applyCascadeAdjustment` default parameter (`cascade-cap.ts`), and by
  `defaultsFor` and the restack `currentLimit` in `kickback-budget-cli.ts`. In tests it is read only by
  `routed-exit.realgit.test.ts`. Verified by repository-wide search, about 95%.
- **One enforcement site.** `runRestack` checks before the journal for `cause === 'feature-repair'`
  and owns the cap evidence and halt. The stack preflight also calls `checkCascadeCap` for each
  `repairChildren` origin, but discards the result (`await checkCascadeCap(...)` as a bare
  statement; its comment says `runRestack` repeats the check). That call has no side effect beyond
  git reads, so it is removed rather than given the new allowance. Verified (`restack-executor.ts`,
  `stack-preflight.ts`, introduced in #3169).
- **A raise already wins.** `checkCascadeCap` uses `limits[k] ?? default`, and the raise writes
  `limits[k] = beforeLimit + by` by compare-and-swap. The tier default therefore only replaces
  the fallback. Verified (`cascade-cap.ts` `checkCascadeCap`, `applyCascadeAdjustment`).
- **The raise compares limits by exact value.** `applyCascadeAdjustment` refuses as `stale` unless
  `limits[k] ?? defaultLimit` equals the adjustment's `beforeLimit`, and the CLI derives
  `beforeLimit` from the same expression. So the halt, the raise and the ref update must resolve the
  default identically. Verified.
- **The tier map is validated and merged as #2413's is.** `validateRemediationLapCap(raw, path)`
  (`config.ts`) already validates "a positive integer or a map of S, M, L to positive integers" with
  path-named errors. `mergeConfigs` deep-merges maps per key, and an integer at either layer replaces
  a map. The `stacked_prs` default materialization writes only `enabled`, `max_slices` and
  `route_whole_feature_fixes`, so the new key stays absent when unset. Verified.

## Alignment

- **Governing ADR reused and amended, not duplicated.** The decision is a value inside an existing
  termination decision: no new boundary, component, integration, persisted state or technology.
  So the change amends, and does not add, an ADR:
  - `adr-2026-10-10-stacked-restack-journaled-replay` decision 10 ("The bound is
    `MAX_RESTACK_CASCADES_PER_CHILD = 3`") receives an additive `Amended 2026-10-28 by #3472` note;
    the original text is preserved.
  - `adr-2026-10-12-routed-whole-feature-repair` (re-validation bound: "restacks are bounded by
    `MAX_RESTACK_CASCADES_PER_CHILD` per originating child") is left unchanged. Its termination
    argument needs only that a finite per-child bound exists, which still holds. The decision 10
    amendment states that this bound is now the tier-resolved allowance.
- **Termination preserved.** Approaches B (count only no-progress cascades) and C (remove the cap)
  were rejected in explore. Every feature-repair restack already carries a fix commit (a no-commit
  routed exit requests no restack), so B would leave routed re-validation without a bound. A
  finite per-tier limit keeps it bounded.
- **Machinery, not prompt.** The allowance is computed by the engine from recorded state; no agent
  instruction changes. Aligned with the Design Principle.
- **Single cap authority preserved.** For child k: `limits[k]` in the `cascades` ref (operator raise)
  → the configured integer, or the map's entry for the feature's tier → the tier default (S 3, M 3,
  L 8). An unrecorded tier resolves as M. Every site calls the one resolver.
- **Precedent for missing tier.** `resolveRemediationLapAllowance` (`remediation-caps.ts`) treats an
  absent tier as M, and the issue requires S/M to stay at least as tight as today. Both point to
  M = 3, not the most permissive L.
- **Event spine.** No new channel. The halt still uses `restack_refused` reason `cascade-cap` and
  typed cap evidence; raises still append `kickback_budget_adjustment_authorized`.
- **Layering.** The new module imports only `types/` (`HarnessConfig`, `ComplexityTier`) plus the
  existing config loader and state reader, so it adds no cycle among `restack/`,
  `kickback-budget-cli.ts` and `daemon-observe-cli.ts`.
- **Diagrams.** The feature diagram's Before/After component views and the resolution sequence
  match this review.

**Local pattern basis**

- **Tier-keyed allowance resolver.** Precedent: `resolveRemediationLapAllowance` and
  `REMEDIATION_LAP_TIER_DEFAULTS` (`engine/remediation-caps.ts`).
  - Preserve: a `{ limit, tier, source }` result; an integer applies to every tier; an unrecorded
    tier is treated as M and reported as unrecorded.
  - Allowed variation: the default table, and the restack-specific `raised` source when the ref holds
    a per-child limit.
- **Config block validation.** Precedent: `validateStackedPrsBlock` plus `validateRemediationLapCap`
  (`engine/config.ts`).
  - Preserve: a typed, path-named `ConfigError` for each invalid shape; refusal at load, never a
    clamp.
- **Budget surfaces.** Precedent: the #2413 ` — tier <T> allowance <l> (<source>)` phrase in
  `renderKickbackBudgetView`, and the `KICKBACK BUDGET [slug]` status lines.
  - Preserve: one phrase shared by the halt, inspect and status.
  - Allowed variation: a per-originating-child list, because the restack budget is keyed by child.

## Wiring Surface

| New or changed production surface | Where production calls it |
|---|---|
| `stacked_prs.max_restack_cascades` config key | Validated in `validateStackedPrsBlock`, reached by every `loadConfig`; read only by the new resolver. |
| `resolveRestackCascadeAllowance(config, tier)` and `resolveCascadeAllowanceForWorktree(worktree)` (new `restack/cascade-allowance.ts`) | Called by `runRestack`'s feature-repair cap check, `kickback-budget-cli.ts` (`defaultsFor`, the restack `currentLimit`, the reconcile and apply paths, inspect), and `renderPlanGrowthSection` in `daemon-observe-cli.ts`. |
| Required default-limit argument on `checkCascadeCap` and `applyCascadeAdjustment` | The same callers, which pass the resolved limit; the module-level constant is removed. The stack preflight's discarded `checkCascadeCap` loop is deleted, so `runRestack` is the only caller of `checkCascadeCap`. |
| Restack cascade summary in inspect and status | The existing inspect handler (child-scoped views) and the existing per-feature loop in `renderPlanGrowthSection`, reading the `cascades` ref with `readCascadeCounts`. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The halt and the raise resolve different defaults (config edited or tier reassessed between them), so the raise refuses as stale | Technical | Low | Medium | Accepted: fail closed, as today. The refusal names the stale evidence. Editing the config is itself the recovery: clearing the halt resumes under the new allowance. A test pins that the halt, the raise and the ref update use one resolver. |
| A caller keeps a hard-coded 3 | Technical | Low | High | Condition 1: the constant is deleted, and the default-limit argument is required, so a missed caller fails to type-check. |
| L 8 hides a non-converging child longer | Product | Medium | Low | Operator-chosen value (2026-10-28). The bound is still finite and configurable per tier, and the halt names the child. |
| #3475 has not landed when this builds | Integration | Medium | Medium | Recorded as a land dependency on jstoup111/ai-conductor#3475; the plan names the post-#3475 behavior it builds on. |

## ADRs Created

None. `adr-2026-10-10-stacked-restack-journaled-replay` decision 10 is amended in place with an
additive note (see Alignment).

## Conditions

1. `MAX_RESTACK_CASCADES_PER_CHILD` is removed, and `checkCascadeCap` and `applyCascadeAdjustment`
   take the default limit as a required argument, so no enforcement or recovery site falls back to a
   constant.
2. Loading never materializes `stacked_prs.max_restack_cascades`. A test exercises the `loadConfig`
   path with a user and a project config.
3. The cascade-cap halt, `kickback-budget inspect` and `daemon status` render the same tier label,
   allowance and source for the same feature.
