# Conflict Check: Provider-Aware Model and Effort Resolution (#902)

**Date:** 2026-07-23
**New stories:** `.docs/stories/model-and-effort-resolution-provider-aware-902.md`
**Result:** PASSED AFTER RESOLUTION — zero remaining blocking conflicts, zero
accepted degrading conflicts

## Inventory and Method

The check scanned the full contents of:

- 232 files under `.docs/stories/`
- 34 files under `.docs/specs/`
- 115 prior reports under `.docs/conflicts/`

The #902 stories were compared internally and against the complete inventory
for contradiction, behavioral overlap, state conflict, resource contention,
and sequencing conflict. Focused exact-text comparisons covered every existing
story that names model/effort defaults, tier overrides, escalation rungs,
fallback ladders, provider behavior, generated model rows, or `SKILL.md` pins.
Relevant prior conflict reports for retry escalation, model availability, the
generated table, and S-tier knobs were re-read to preserve their established
composition rules.

The verify-claims verdict is **CLEAR**. All resolutions below follow the
operator-approved superseding #902 ADR and accepted story matrix. The
`explore`/`prd` effort choice was explicitly reopened and decided by the
operator; no other product or architecture choice was inferred.

## Resolved Blocking Conflicts

### Conflict 1: Claude ladders were phrased as universal engine behavior

**Stories involved:** Provider-aware retry/fallback stories vs.
`retry-as-escalation`, `model-availability-fallback-ladder`,
`fable-front-of-funnel-decide`, and `fable-recovery-steps`

**Type:** contradiction / behavioral overlap
**Severity:** blocking (resolved)

**Description:**

The older stories name `haiku → sonnet → opus → fable` and
`fable → opus → sonnet` without a provider qualifier. Taken literally for
Codex, those requirements contradict #902's accepted
`gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol` escalation and
`gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna` fallback contracts. Both
unqualified contracts cannot hold for the same Codex dispatch.

**Resolution Options:**

1. Qualify the historical aliases as the Claude policy while preserving the
   provider-neutral retry/fallback invariants.
2. Delete the historical stories and make #902 the only retry/fallback source.
3. Replace both provider tables with a new public logical-tier abstraction.

**Selection:** Option 1. The approved ADR explicitly preserves Claude behavior,
adds an independent Codex table, and rejects a public logical-tier
abstraction. The operator accepted stories encoding that decision.

**Resolution applied:**

- Added provider-aware amendment notes to the four historical story files.
- Scoped the no-config `fable → opus → sonnet` criterion explicitly to Claude.
- Kept attempt indexing, cap behavior, opt-out, in-attempt walking, caching,
  logging, and explicit-ladder precedence unchanged and provider-neutral.

### Conflict 2: Historical front-of-funnel effort values contradicted the accepted matrix

**Stories involved:** `fable-front-of-funnel-decide` vs.
`model-and-effort-resolution-provider-aware-902`

**Type:** contradiction
**Severity:** blocking (resolved)

**Description:**

The old Fable rollout story still required `xhigh` effort for `explore` and
`prd`. Commit `1b448707` / #607 later changed both current values to `medium`,
which the initial #902 matrix inherited without a fresh task-fit decision.
During this conflict review the operator rejected `medium` and selected `high`
for both built-in providers, while retaining the separate `explore.S: low`
override.

**Resolution Options:**

1. Raise both provider policies to `high`, retaining `explore.S: low`.
2. Preserve the shipped `medium` values for exact Claude compatibility.
3. Restore `xhigh` as the base for both steps.

**Selection:** Option 1. The operator determined that both steps are
high-cascade DECIDE work, selected `high` for Claude and Codex, and retained
the independent low-cost S-tier exploration override. This supersedes #607's
base effort choice for these policy values without restoring `xhigh`.

**Resolution applied:**

- Updated the policy matrix and historical happy-path assertions to `high`.
- Preserved `explore.S: low` and added an explicit `high → xhigh` retry
  assertion.
- Created and approved
  `adr-2026-07-23-provider-policies-with-deeper-discovery-effort`; marked the
  original provider-policy ADR superseded.

### Conflict 3: Retry documentation required an unconditional Fable cap

**Stories involved:** `escalation-ladder-docs-cumulative-bump` vs.
the provider-aware retry and documentation stories

**Type:** contradiction
**Severity:** blocking (resolved)

**Description:**

The existing documentation story required the cumulative retry formula to be
capped at `fable` without provider context. Under #902, Fable remains the
Claude cap, while Codex caps at `gpt-5.6-sol`; an unconditional Fable cap would
make the documentation false for Codex.

**Resolution Options:**

1. Document the selected provider policy's top rung and name both concrete
   built-in caps.
2. Keep the prose Claude-only and omit Codex retry documentation.
3. Publish provider-neutral logical tier names and remove concrete caps.

**Selection:** Option 1. It preserves the cumulative `(attempt − 2)` contract
and makes the already-approved provider distinction explicit.

**Resolution applied:**

- Updated the HARNESS and conductor README criteria to require provider-labelled
  Claude `fable` and Codex `gpt-5.6-sol` caps.
- Retained the cumulative formula, deeper-budget cost warning, and stale
  one-tier-phrase checks.

## Non-Conflicting Reconciliations

- **Generated table:** The existing generator remains the sole writer of the
  marked HARNESS region. Its engine rows expand to both built-in policies;
  interactive extra rows and pins remain the labelled Claude path. The existing
  drift and no-write checks compose unchanged.
- **Explicit overrides:** CLI, step, phase, defaults, and configured fallback
  ladders retain their accepted precedence. Opaque cross-provider model strings
  are not translated, so no state ambiguity is introduced.
- **S-tier knobs:** Existing S effort and retry-floor behavior composes with
  either provider policy. Tier selection changes a base value; the same
  provider-native escalation invariants then apply.
- **Provider abstraction:** `LLMProvider` remains unchanged. Unknown installed
  policy keys use the approved Claude compatibility policy without changing the
  selected provider instance; a missing provider binary still follows the
  existing startup failure contract.
- **Model-unavailability classification:** Both built-in providers expose the
  existing `modelUnavailable` result, so the provider policy changes only the
  ladder values, not failure classification.

## Five-Type Re-Check

After the resolutions, the full re-check read all 232 stories, all 34 specs,
and all 116 conflict reports including this report.

| Conflict type | Result after resolution |
|---------------|-------------------------|
| Contradiction | Clean — historical Claude values are scoped; amended efforts and provider caps agree |
| Behavioral overlap | Clean — existing resolver, retry, fallback, and generator contracts are extended at one provider boundary |
| State conflict | Clean — immutable policy selection adds no impossible runtime state |
| Resource contention | Clean — no new persistent resource; the generated HARNESS region retains one writer |
| Sequencing conflict | Clean — provider key and policy are selected before every resolution path; no circular dependency |

## ADR and Review Disposition

- One superseding ADR was required and approved:
  `adr-2026-07-23-provider-policies-with-deeper-discovery-effort`.
- No degrading conflict was accepted.
- A conflict-check review marker is required because blocking story-text
  conflicts were found and resolved.

## Verdict

**PASSED AFTER RESOLUTION.** Zero blocking conflicts remain. After operator
review, proceed to `/plan`.
