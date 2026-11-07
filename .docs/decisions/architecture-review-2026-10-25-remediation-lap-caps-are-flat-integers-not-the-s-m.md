# Architecture Review: Remediation lap caps derive from the feature's complexity tier (#2413)
**Date:** 2026-10-25
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment
**Inputs reviewed:** the operator-confirmed explore outcome in
`.docs/track/remediation-lap-caps-are-flat-integers-not-the-s-m.md`, the complexity record, and
`.docs/architecture/remediation-lap-caps-are-flat-integers-not-the-s-m.md`. No PRD (technical
track); stories do not exist yet.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. A pure resolver over (gate, config, tier) plus config validation. Verified by reading. |
| Prerequisites | None. `ConductState.complexity_tier` (`types/state.ts`) already exists and the daemon seeds it from the backlog item's tier (`daemon-state.ts`). Verified. |
| Integration surface | Engine-internal: config validation and loading (`engine/config.ts`), the cap resolver (`engine/remediation-caps.ts`), its enforcement callers in `engine/conductor.ts`, the budget renderer (`engine/kickback-budget-view.ts`), and two read-only operator surfaces (`engine/kickback-budget-cli.ts` inspect, `engine/daemon-observe-cli.ts`). No external API. |
| Data implications | The committed `.ai-conductor/config.yml` contract widens: `max_remediation_laps` under `prd_audit` and `architecture_review_as_built` accepts a positive integer (unchanged meaning: every tier) or a map whose keys are a subset of `S`, `M`, `L` with positive-integer values. No kickback-ledger field changes. No migration: every currently valid config stays valid with the same meaning. Consumers that never set the key move from 1 lap to 2/3/4 by tier, which is the intended behavior change and needs a release note. |
| Performance risk | None. Resolution is an in-memory lookup per cap check. `kickback-budget inspect` adds one read of the worktree's `conduct-state.json`. |
| Worktree isolation | Tier and ledger are per-worktree `.pipeline/` state; config is per-repo. Nothing new is shared. |

**Key verified facts behind the design**

- **One choke point.** Every enforcement and display read of the default goes through `remediationLapCapForGate` (directly, or via `kickbackBudgetFallbackLimit`, `validationJoinRemediationRoundCap`, `pendingRepairSettlementBudgets`). The only other readers of `max_remediation_laps` are `config.ts` validation/resolution. Verified by repository-wide search, ~95%.
- **Loading currently erases the "unset" signal.** `validateConfig` defaults `materializeDefaults` to true, and `resolvePrdAuditBlock` / `resolveArchitectureReviewAsBuiltBlock` write `max_remediation_laps: 1` when the key is absent. A tier-derived default therefore requires the resolved blocks to leave the key absent when the operator did not set it, so the resolver's fallback runs. Verified (`config.ts` `validateConfig` and the two `resolve*Block` functions).
- **User and project configs deep-merge.** `mergeConfigs` → `deepMerge` merges plain objects key by key and replaces otherwise. Two maps therefore merge per tier (project wins per key), and an integer at either layer replaces a map at the other. This is the existing semantics for every other nested key; no new rule is needed. Verified.
- **One cached read predates the tier.** `run()` computes `prdAuditRemediationLapCap` once before the loop. For a fresh interactive feature `complexity_tier` is written later by the complexity step, so this site must resolve at each use. Verified (`conductor.ts` `run()` and `runComplexityStep`).
- **Operator raises are unaffected.** `kickback-budget raise` sets `effectiveLapCap = capEvidence.limit + by`. `capEvidence.limit` is the limit recorded at the halt, which is the tier-resolved value after this change. Every enforcement site already prefers `effectiveLapCap`. Verified (`kickback-ledger.ts` `applyKickbackBudgetAdjustment`).

## Alignment

- **Governing ADRs reused, not duplicated.** No structural decision is introduced: no new boundary,
  component, integration, persisted state, or technology. The lap allowance is a value inside the
  existing termination decisions, so the change amends the APPROVED ADRs that state a one-lap
  default, rather than adding an ADR:
  - `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` decision 5 ("one lap per feature").
  - `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` decision 4 ("default **1**").
  - `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework` decision 5 ("With the default one-lap cap").

  Each receives an additive `Amended 2026-10-25 by #2413` note; the original text is preserved.
  `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` mentions "lap cap default 1" only
  inside its own #1874 amendment note that points to `adr-2026-08-25`; the governing decision is
  amended there, so that ADR is left unchanged.
- **Machinery, not prompt.** The allowance is computed by the engine from recorded state; no agent
  instruction changes. Aligned with the Design Principle.
- **Single cap authority preserved.** Precedence is: operator raise (`effectiveLapCap`) → the
  configured integer, or the map's entry for the feature's tier → the tier default (S 2, M 3, L 4).
  A feature with no recorded tier resolves as M. Every site uses the one resolver, so enforcement
  and display cannot disagree on the default.
- **Precedent for missing tier.** `resolveAsBuiltPolicy` (`as-built-policy.ts`) already treats an
  absent tier as `M`. The operator chose the same fallback here. Other engine sites fall back to
  `L` for step selection; that is deliberately not followed, because the issue requires the
  fallback not to be the most permissive budget.
- **Tier-keyed config precedent.** `by_tier` under steps and phases (`types/config.ts`,
  `validateByTier`) keys overrides by `S | M | L`, and `checks.<name>.tiers` validates against
  `VALID_COMPLEXITY_TIERS`. The map form reuses that tier vocabulary and validation set.
- **State management.** No booleans or new states. The resolved allowance is a pure function; the
  tier label it reports is the tier used, or `M (no tier recorded)`.
- **Diagrams.** The feature diagram's Before/After component views and the resolution sequence
  match this review.

**Local pattern basis**

- **Config block validation.** Precedent: `validatePrdAuditBlock` /
  `validateArchitectureReviewAsBuiltBlock` and `validateByTier` (`engine/config.ts`).
  - Preserve: a typed, path-named `ConfigError` for each invalid shape (non-integer, non-positive,
    unknown tier key, non-object); refusal at load, never a silent clamp.
  - Allowed variation: the map shape and its message text.
- **Budget rendering.** Precedent: `renderKickbackBudgetView` (`engine/kickback-budget-view.ts`),
  which takes a fallback limit from its caller.
  - Preserve: one render function shared by halts, inspect, and observe.
  - Allowed variation: an added tier-and-allowance phrase.

## Wiring Surface

| New or changed production surface | Where production calls it |
|---|---|
| `max_remediation_laps` map form (both gates) | Validated and resolved in `validateConfig` (`engine/config.ts`), which every `loadConfig` path runs. |
| Tier parameter on `remediationLapCapForGate` and its three wrappers | Called from `planRemediation`, the refusal-rework allowance check, the validation-join round cap, and the BUILD-dispatch settlement halt in `engine/conductor.ts`, each passing the current `state.complexity_tier`. |
| Tier and allowance in the budget line | `renderKickbackBudgetView`, already called by the BUILD-dispatch settlement halt and the refusal-rework halt in `conductor.ts`, by `kickback-budget inspect`, and by `daemon-observe-cli.ts`. |
| Tier read in `kickback-budget inspect` | The existing inspect handler in `engine/kickback-budget-cli.ts`, reading `.pipeline/conduct-state.json` in the feature worktree it already resolves. |
| Tier passed in daemon observe | The existing `visibleFeatures` loop in `engine/daemon-observe-cli.ts`, from the entry's `tier`. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A materialized default survives somewhere (user config, a test fixture loader) and silently pins every tier to 1 | Technical | Medium | High | Condition 1: a load-level test proves an unset key resolves to the tier default through `loadConfig` with a user config present. |
| A reassessed tier lowers the allowance below laps already consumed, halting at the next check | Technical | Low | Medium | Accepted: pinning is out of scope. The halt names the tier and allowance, and `kickback-budget raise` recovers. |
| Consumers that relied on the implicit one-lap default see more remediation laps | Integration | Medium | Low | Release note (Changed). The integer form still pins every tier. |
| Concurrent open PRs #3411 and #3424 touch `kickback-budget-cli.ts` / `daemon-observe-cli.ts` | Integration | Medium | Low | Ordinary rebase; no shared semantics. |
| The serial prd-audit impl-gap path keeps its cached, raise-ignoring cap | Technical | Medium | Low | Out of scope by operator decision; it still receives the tier-resolved default through the shared resolver call. |

## ADRs Created

None. Three APPROVED ADRs are amended in place with additive notes (see Alignment).

## Conditions

1. Loading must leave `max_remediation_laps` absent when no layer sets it; a test exercises the
   `loadConfig` path (user plus project), not only `remediationLapCapForGate` directly.
2. Every production call of `remediationLapCapForGate` and its wrappers passes the feature's
   current tier; the value cached in `run()` before the loop is replaced by a resolution at each
   use.
3. Halt text, `kickback-budget inspect`, and daemon observe render the same tier label and
   allowance for the same feature.
4. This repository's two TEMPORARY root-config lap overrides are removed in the same change, so
   the tier defaults govern this repo's own builds, and the TEMPORARY
   `prd_audit.max_appended_tasks: 10` grant tied to them reverts to its prior 8.
