# Implementation Plan: coherence_check L-tier model escalation (#2789)

**Date:** 2026-10-05
**Design:** none (technical track, Tier S — see `.docs/track/coherence-check-l-tier-model-escalation-is-documen.md`)
**Stories:** .docs/stories/coherence-check-l-tier-model-escalation-is-documen.md
**Conflict check:** Not required at Tier S

## Summary

Adds the missing `coherence_check` L-tier model pin to the Claude and Codex provider policies so an
L-tier coherence pass escalates as the coherence-check skill states, and brings the generated model
table and the skill's autonomous-path sentence in line. Four tasks.

## Technical Approach

- `resolveStepConfig` (`src/conductor/src/engine/resolved-config.ts`) already consults
  `policy.stepTierOverrides[step][tier]` below every operator-config layer and above the base
  `stepModels` entry. The fix is therefore data-only: add `coherence_check: { L: { model: 'opus' } }`
  to `CLAUDE_MODEL_POLICY.stepTierOverrides` and `coherence_check: { L: { model: 'gpt-5.6-sol' } }` to
  `CODEX_MODEL_POLICY.stepTierOverrides` in `src/conductor/src/engine/provider-model-policy-defaults.ts`,
  directly beside the existing `conflict_check` L entries. No effort override: effort stays `medium`.
- Local pattern: the `conflict_check` L-tier pin is the exact precedent — a per-provider entry in each
  policy's `stepTierOverrides`, not in `COMMON_TIER_OVERRIDES`, because the model id differs per
  provider. Search hint: `conflict_check: { L:` in the defaults file and its mirror in
  `src/conductor/test/engine/provider-model-policy.test.ts`.
- Production reachability: the provider catalog (`src/conductor/src/execution/provider-catalog.ts`)
  binds `CLAUDE_MODEL_POLICY`/`CODEX_MODEL_POLICY` as each descriptor's `modelPolicy`, and the existing
  wiring test binds every production step-resolution call to that policy. Tests resolve through
  `providerDescriptor('claude'|'codex').modelPolicy` so they exercise the policy the daemon dispatches with.
- `ARCHITECTURE.md`'s model-selection table is generated from the policies by `bin/generate-model-table`
  and drift-checked by `test/test_harness_integrity.sh`, so it must be regenerated in the same diff.
- The Pi policy is out of scope (the operator-confirmed boundary names Claude and Codex only).

## Prerequisites

- None.

## Tasks

### Task 1: Pin coherence_check to the deepest-tier model at L for Claude and Codex
**Story:** Story 1 — happy paths S1.1, S1.2
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/resolved-config.test.ts`, beside the `conflict_check uses opus at every tier` case: resolve `coherence_check` in phase `DECIDE` at tier `L` with no user config using `providerDescriptor('claude').modelPolicy` and assert model `opus`, effort `medium`; repeat with `providerDescriptor('codex').modelPolicy` asserting model `gpt-5.6-sol`, effort `medium`. Update the expected policy literal in `src/conductor/test/engine/provider-model-policy.test.ts` to include `coherence_check: { L: { model: 'opus' } }` (claude) and `{ L: { model: 'gpt-5.6-sol' } }` (codex).
2. Verify tests fail (RED).
3. Implement: add the two `coherence_check` entries to the `stepTierOverrides` of `CLAUDE_MODEL_POLICY` and `CODEX_MODEL_POLICY` in `provider-model-policy-defaults.ts`, following the `conflict_check` pattern (per-provider entry, model only, no effort key).
4. Verify tests pass (GREEN).
5. Commit: "fix(model-policy): pin coherence_check to the deepest model at L tier (#2789)".

**Done when:**
- `resolveStepConfig('coherence_check', 'DECIDE', providerDescriptor('claude').modelPolicy, undefined, { tier: 'L' })` returns model `opus` and effort `medium`, asserted in `resolved-config.test.ts`.
- `resolveStepConfig('coherence_check', 'DECIDE', providerDescriptor('codex').modelPolicy, undefined, { tier: 'L' })` returns model `gpt-5.6-sol` and effort `medium`, asserted in `resolved-config.test.ts`.
- `provider-model-policy.test.ts` asserts both policies' `stepTierOverrides.coherence_check` equal `{ L: { model: 'opus' } }` and `{ L: { model: 'gpt-5.6-sol' } }` respectively.

**Files likely touched:**
- src/conductor/src/engine/provider-model-policy-defaults.ts — two `stepTierOverrides` entries
- src/conductor/test/engine/resolved-config.test.ts — L-tier resolution test
- src/conductor/test/engine/provider-model-policy.test.ts — expected policy literal

**Dependencies:** none

### Task 2: Guard M/S/untiered resolution and operator precedence for coherence_check
**Story:** Story 1 — negative paths S1.3, S1.4, S1.5
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/resolved-config.test.ts` (same `describe` as Task 1): for each of `providerDescriptor('claude').modelPolicy` and `providerDescriptor('codex').modelPolicy`, resolve `coherence_check` in `DECIDE` at tier `M`, tier `S`, and with no tier option, asserting the base model (`sonnet` / `gpt-5.6-terra`) and effort `medium` (M case). Then resolve at tier `L` on the Claude policy with a user config of `{ steps: { coherence_check: { model: 'sonnet' } } }` and assert model `sonnet`.
2. Run; these assert behavior Task 1 must preserve and pass once Task 1 is in place.
3. Commit: "test(model-policy): coherence_check pin is L-only and yields to operator config (#2789)".

**Done when:**
- `resolveStepConfig('coherence_check', 'DECIDE', <claude policy>, undefined, { tier: 'M' })` returns model `sonnet` and effort `medium`, and the Codex policy returns `gpt-5.6-terra` and effort `medium`, asserted in `resolved-config.test.ts`.
- `resolveStepConfig('coherence_check', ...)` at tier `S` and with no tier returns `sonnet` under the Claude policy and `gpt-5.6-terra` under the Codex policy, asserted in `resolved-config.test.ts`.
- `resolveStepConfig('coherence_check', 'DECIDE', <claude policy>, { steps: { coherence_check: { model: 'sonnet' } } }, { tier: 'L' })` returns model `sonnet`, asserted in `resolved-config.test.ts`.

**Files likely touched:**
- src/conductor/test/engine/resolved-config.test.ts — preservation and precedence tests

**Dependencies:** Task 1

### Task 3: Regenerate the generated model-selection table
**Story:** Story 1 — happy paths S1.1, S1.2 (generated artifact derived from the policy)
**Type:** infrastructure

**Steps:**
1. Run `bin/generate-model-table` to rewrite the generated region of `ARCHITECTURE.md` from the updated policies.
2. Run `bin/generate-model-table --check` and confirm exit 0.
3. Commit: "chore(model-table): regenerate for coherence_check L-tier pin (#2789)".

**Done when:**
- `bin/generate-model-table --check` exits 0 against the committed `ARCHITECTURE.md`.
- The `coherence-check` row of the generated table names `opus` for L tier under Claude and `gpt-5.6-sol` for L tier under Codex.

**Files likely touched:**
- ARCHITECTURE.md — generated model-table region only

**Dependencies:** Task 1

### Task 4: Make the coherence-check skill's autonomous-path sentence match the policy
**Story:** Story 1 — happy paths S1.1, S1.2 (agent instruction describing the resolved behavior)
**Type:** refactor

**Steps:**
1. In `skills/coherence-check/SKILL.md` Section 2, replace the sentence claiming the autonomous path resolves the pin via `resolved-config.ts` "(wired in a later task)" with one stating that each provider policy's `stepTierOverrides.coherence_check.L` in `src/conductor/src/engine/provider-model-policy-defaults.ts` applies it (Claude: `opus`; Codex: `gpt-5.6-sol`), keeping the interactive-run guidance that follows.
2. Commit: "fix(coherence-check): describe the applied L-tier pin (#2789)".

**Done when:**
- `skills/coherence-check/SKILL.md` contains no occurrence of `wired in a later task`.
- `skills/coherence-check/SKILL.md` Section 2 names `provider-model-policy-defaults.ts`, `opus`, and `gpt-5.6-sol` for the autonomous L-tier path.

**Files likely touched:**
- skills/coherence-check/SKILL.md — Section 2 autonomous-path sentence

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──┬─> Task 2
         ├─> Task 3
         └─> Task 4
```

## Integration Points

- After Task 1: an L-tier daemon dispatch of `coherence_check` resolves to the pinned model through the
  provider catalog policy; existing wiring tests already bind production step resolution to that policy.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the Claude provider policy and no operator model configuration for `coherence_check`, when the resolved step config is computed for `coherence_check` at tier `L`, then the model is `opus` and the effort is `medium` | 1 | "`resolveStepConfig('coherence_check', 'DECIDE', providerDescriptor('claude').modelPolicy, undefined, { tier: 'L' })` returns model `opus` and effort `medium`, asserted in `resolved-config.test.ts`." | diff-local |
| Story 1 happy: Given the Codex provider policy and no operator model configuration for `coherence_check`, when the resolved step config is computed for `coherence_check` at tier `L`, then the model is `gpt-5.6-sol` and the effort is `medium` | 1 | "`resolveStepConfig('coherence_check', 'DECIDE', providerDescriptor('codex').modelPolicy, undefined, { tier: 'L' })` returns model `gpt-5.6-sol` and effort `medium`, asserted in `resolved-config.test.ts`." | diff-local |
| Story 1 negative: Given the Claude provider policy, when the resolved step config is computed for `coherence_check` at tier `M`, then the model stays `sonnet` (Codex: `gpt-5.6-terra`) with effort `medium` | 2 | "`resolveStepConfig('coherence_check', 'DECIDE', <claude policy>, undefined, { tier: 'M' })` returns model `sonnet` and effort `medium`, and the Codex policy returns `gpt-5.6-terra` and effort `medium`, asserted in `resolved-config.test.ts`." | diff-local |
| Story 1 negative: Given the Claude provider policy, when the resolved step config is computed for `coherence_check` at tier `S` or with no tier, then the model stays `sonnet` (Codex: `gpt-5.6-terra`) | 2 | "`resolveStepConfig('coherence_check', ...)` at tier `S` and with no tier returns `sonnet` under the Claude policy and `gpt-5.6-terra` under the Codex policy, asserted in `resolved-config.test.ts`." | diff-local |
| Story 1 negative: Given an operator config that sets `steps.coherence_check.model` to `sonnet`, when the resolved step config is computed for `coherence_check` at tier `L` on the Claude provider, then the model is `sonnet` — operator configuration still outranks the policy tier pin | 2 | "`resolveStepConfig('coherence_check', 'DECIDE', <claude policy>, { steps: { coherence_check: { model: 'sonnet' } } }, { tier: 'L' })` returns model `sonnet`, asserted in `resolved-config.test.ts`." | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
