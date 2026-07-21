**Status:** Accepted

# Stories: Small features are cheap through the existing pipeline's own knobs — #668

**Track:** technical (no PRD — acceptance criteria live here)
**Design:** .docs/decisions/adr-2026-07-21-s-tier-pipeline-knobs.md (APPROVED)
**Feature area:** the resolver's per-step tier-override table
(`src/conductor/src/engine/resolved-config.ts` `DEFAULT_STEP_TIER_OVERRIDES`), the model rationale
metadata (`src/conductor/src/engine/model-table-metadata.ts` + generated `HARNESS.md`), and — for the
optional seed — the DECIDE `complexity` tier source (`src/conductor/src/engine/complexity.ts`,
read by `parseComplexityTier` in `src/conductor/src/engine/artifacts.ts`). The escalation ladder
(`escalation.ts`) and the step registry (`steps.ts`) are **consumed unchanged** and stories guard
they are not modified.

## Context

#668's real pain is that S bugs bypass DECIDE and lose the gate-stamping machinery. Per operator
directive (no separate SDLC flows), the fix makes the **existing** pipeline cheap for S via its own
resolution knobs, so there is no incentive to bypass it. These stories cover the S resolution profile
and its invariants; they add no new flow, step type, or artifact type.

---

## Story 1: An S step resolves to its lean base via the existing override table

As the conductor resolving a DECIDE step for an `S`-tier feature, I want `resolveStepConfig` to return
the S profile from `DEFAULT_STEP_TIER_OVERRIDES` so small work is cheap without any new mechanism.

**Acceptance criteria:**
- `resolveStepConfig('explore', 'DECIDE', config, { tier: 'S' })` returns `effort: 'low'` (below the
  `medium` base at `resolved-config.ts:59`), sourced from a new `explore.S` override row.
- The S value flows through the **existing** `hardcodedStepTier` precedence rung
  (`resolved-config.ts:234-236`) — no new resolver branch, field, or code path is added.
- `stories.S` (`{ effort: 'low' }`) and `plan.S` (`{ effort: 'medium', max_retries: 3 }`) remain
  exactly as today (regression guard on the pre-existing rows).

## Story 2: The same steps resolve normally for M and L

As an M/L feature, I want the S rows to leave my resolution untouched, so tuning S never changes
larger tiers.

**Acceptance criteria:**
- `resolveStepConfig('explore', 'DECIDE', config, { tier: 'M' })` and `{ tier: 'L' }` return the
  unchanged base effort — the new S rows carry no `M`/`L` keys.
- `resolveStepConfig('build', 'BUILD', config, { tier: 'L' })` is byte-identical to its pre-change
  resolution.

## Story 3: Small still skips exactly the ceremony it already skipped — nothing more

As an S feature, I want the artifact/step skip set to be exactly the pre-existing
`skippableForTiers: ['S']` set, so this change adds no new skip.

**Acceptance criteria:**
- `getSkippableSteps('S')` returns exactly `architecture_diagram`, `architecture_review`,
  `conflict_check`, `acceptance_specs`, `architecture_review_as_built`, `retro` (`steps.ts:69-233`) —
  unchanged before/after this change.
- No step definition in `steps.ts` gains or loses a `skippableForTiers` entry (diff guard).

## Story 4: The model rationale + HARNESS.md stay in sync after the tuning

As a maintainer, I want the tuned steps' `STEP_RATIONALE` and the generated HARNESS.md model table to
stay consistent, so the docs never drift from the resolver.

**Acceptance criteria:**
- `STEP_RATIONALE` (`model-table-metadata.ts:14`) has an entry for every tuned step and the
  model-table completeness test passes.
- `test/test_generate_model_table_wrapper.sh` and `test_harness_integrity.sh` are green after regen.

## Story 5 (negative): An S retry budget never drops below the #188 floor of 3

As the escalation ladder, I need any S `max_retries` to stay ≥3 so my model-bump rung (attempt 3) is
reachable — reconciling with `adr-2026-07-05-retry-as-escalation-ladder` Decision 4.

**Acceptance criteria:**
- Every `max_retries` in a `DEFAULT_STEP_TIER_OVERRIDES[*].S` row is `>= 3` (asserted by test).
- `plan.S.max_retries` stays `3`; `build.S.max_retries` is `3` (not 1 or 2).
- A test documents that a budget of 2 would truncate the ladder before the model bump (the #188
  rationale), guarding against a future cost-cut regression.

## Story 6 (negative): No evidence gate is tier-weakened for S

As the build/SHIP tail, I must run for S exactly as for L, so smallness can never skip a verification
gate.

**Acceptance criteria:**
- `shouldSkipForTier(step, 'S')` is `false` for every one of `build`, `build_review`, `wiring_check`,
  `manual_test`, `rebase`, `finish` (`steps.ts:130-262`) — a pinned tier-invariant gate-set test.
- The S profile changes only `model`/`effort`/`max_retries`; it sets no `disable` and adds no
  `skippableForTiers` — asserted by inspecting the resolved config for an S build step
  (`resolved.disabled === false`).
- An end-to-end resolution of an S feature dispatches `build_review`, `wiring_check`, `manual_test`
  and `finish` (none marked `skipped` by tier).

## Story 7 (negative): Escalation still fires for a mis-judged S

As a step whose S base effort was too low for the actual work, I want the retry ladder to climb, so a
mis-tiered S recovers instead of failing at the floor.

**Acceptance criteria:**
- For an S `explore` (base `effort: 'low'`), `escalateAttempt(model, 'low', 2, true)` bumps effort to
  `medium`, and attempt 3 bumps the model tier (`escalation.ts:76-93`) — the S base does not opt out
  of escalation.
- `escalate` resolves to `true` for S steps by default (`DEFAULT_STEP_ESCALATE`,
  `resolved-config.ts:170`); no S override sets `escalate: false`.

## Story 8 (negative): An S misjudgment upgrades mid-flight or fails safe — never corrupts

As the conductor, when an S tier turns out wrong, I want either a mid-flight re-tier or a clean halt —
never a corrupt/partial state.

**Acceptance criteria:**
- The conductor re-reads `state.complexity_tier` each iteration (`conductor.ts:1905`), so a tier
  revised at the `complexity` step (e.g. S→M) takes effect for subsequent steps without restart.
- If a step exhausts its (≥3) budget, the existing exhausted-retries HALT path fires unchanged (#188
  Decision 8) — the loop writes its halt marker and stops; no downstream step runs on a failed one.
- No S override introduces a code path that mutates `state` outside the existing
  `saveStepStatus`/resolver seams (diff guard — this change is table data only, plus the optional D5
  seed).
