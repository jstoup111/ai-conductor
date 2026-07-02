# Implementation Plan: Adopt Fable for front-of-funnel DECIDE steps

**Date:** 2026-07-02
**Design:** technical track — no PRD; decision record in `.memory/decisions/fable-front-of-funnel-decide.md`; source issue jstoup111/ai-conductor#190
**Stories:** `.docs/stories/fable-front-of-funnel-decide.md`
**Conflict check:** Skipped per Tier S (recorded in `.docs/complexity/fable-front-of-funnel-decide.md`)

## Summary

Declarative model-policy flip: point the front-of-funnel DECIDE steps (explore, prd,
architecture-review pre-impl, engineer) and the two pre-emptive Large-tier overrides
(plan.L, conflict_check.L) at `fable`, keeping all three sync points (resolved-config.ts,
SKILL.md pins, HARNESS.md table) in agreement. 10 tasks.

## Technical Approach

Three sync points must change together (HARNESS.md: "When you change one, change all three"):

1. **Engine** — `src/conductor/src/engine/resolved-config.ts`: three `DEFAULT_STEP_MODELS`
   entries (`explore`, `prd`, `architecture_review`) become `'fable'`; the
   `DEFAULT_STEP_TIER_OVERRIDES.plan.L` and `.conflict_check.L` model keys become `'fable'`.
   `DEFAULT_STEP_EFFORT` is untouched (explore/prd already `xhigh`, architecture_review
   `high`). Model strings pass through `llm-provider` verbatim (`model?: string`, no
   allowlist), so no provider change is needed — only the alias doc comment in
   `src/conductor/src/types/config.ts` (~line 65) is extended to mention `fable`.
2. **Skill pins** — flip `model: opus` → `model: fable` in `skills/explore/SKILL.md`,
   `skills/prd/SKILL.md`, `skills/architecture-review/SKILL.md` (frontmatter line 8 in each);
   **add** `model: fable` to `skills/engineer/SKILL.md` frontmatter, which today has no pin
   (pre-existing mismatch: the HARNESS.md table claims opus).
3. **Docs** — HARNESS.md model-selection table (rows ~87–94): engineer, explore, prd,
   architecture-review rows → `fable`; conflict-check and plan rows → `sonnet (S/M), fable (L)`;
   rationale cells updated to name Fable; the architecture-review row's "`--as-built` runs on
   **sonnet**" note is retained verbatim. Plus a CHANGELOG `[Unreleased]` → `### Changed` entry.

TDD shape: the engine flips are test-first against
`src/conductor/test/engine/resolved-config.test.ts` (existing assertions at lines ~184, ~197,
~203 pin `opus` and will go RED when updated to expect `fable` before the config edit).
Markdown edits are validated by `test/test_harness_integrity.sh` (frontmatter check, model-table
check) and targeted greps. Fable-unavailability degradation is explicitly OUT OF SCOPE —
deferred to #186's availability-probe/fallback-ladder; the CHANGELOG entry names that dependency.

## Prerequisites

- `npm install` already run in `src/conductor` of this worktree (each worktree needs its own).
- Test runner: `rtk proxy npx vitest run` (plain `npx vitest` output is swallowed by rtk).

## Tasks

### Task 1: RED — update engine default-model expectations to fable
**Story:** "Engine defaults route front-of-funnel DECIDE steps to Fable" (happy paths; as-built negative)
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/engine/resolved-config.test.ts`, update the explore-default assertion (~line 203) to `expect(resolveStepConfig('explore', 'DECIDE').model).toBe('fable')`; add/extend assertions that `prd` and `architecture_review` resolve to `fable` with efforts `xhigh`/`xhigh`/`high` respectively; add an assertion that `architecture_review_as_built` still resolves `sonnet`.
2. Run `rtk proxy npx vitest run test/engine/resolved-config.test.ts` — the fable expectations MUST fail (RED) while the as-built assertion passes.

**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts` — expectations flipped/added

**Dependencies:** none

### Task 2: GREEN — flip DEFAULT_STEP_MODELS entries
**Story:** same as Task 1
**Type:** happy-path

**Steps:**
1. In `src/conductor/src/engine/resolved-config.ts`, set `explore: 'fable'`, `prd: 'fable'`, `architecture_review: 'fable'` (update the trailing rationale comments to say Fable). Touch nothing else in the file.
2. Run the test file again — all Task 1 assertions pass (GREEN).
3. Commit: `feat(models): route explore/prd/architecture-review defaults to fable (#190)`

**Files likely touched:**
- `src/conductor/src/engine/resolved-config.ts` — three model strings + comments

**Dependencies:** Task 1

### Task 3: Negative test — user YAML override still beats the fable default
**Story:** "Engine defaults…" (negative path: precedence chain unchanged)
**Type:** negative-path

**Steps:**
1. In `resolved-config.test.ts`, confirm/extend the existing user-override test (~line 127 uses `{ prd: { model: 'opus' } }`) so a config-level `steps.explore.model: 'sonnet'` resolves to `sonnet` over the new `fable` default.
2. Verify it passes (precedence logic is untouched; this is a regression guard).
3. Commit: `test(models): user config override beats fable default`

**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts` — one negative-path test

**Dependencies:** Task 2

### Task 4: Negative test — BUILD/generation steps did not drift
**Story:** "Engine defaults…" (negative path: no BUILD-step drift)
**Type:** negative-path

**Steps:**
1. Add a test asserting `build`, `acceptance_specs`, and `stories` resolve to their pre-change models (`haiku`, `sonnet`, `sonnet`).
2. Verify it passes.
3. Commit: `test(models): pin BUILD-step models against drift`

**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts`

**Dependencies:** Task 2

### Task 5: RED→GREEN — L-tier overrides to fable, S/M pinned
**Story:** "Large-tier overrides for plan and conflict-check escalate to Fable; S/M unchanged" (all criteria)
**Type:** happy-path + negative-path

**Steps:**
1. Update the tier-override tests (~lines 181–197): `plan` at tier L resolves `{ model: 'fable', effort: 'xhigh' }`; `conflict_check` at L resolves `fable`. Keep/extend the S/M assertions: `plan` at S → `sonnet` + `medium`; `conflict_check` at M and at no-tier → `sonnet`.
2. Run — L expectations fail (RED).
3. In `resolved-config.ts`, set `plan.L: { effort: 'xhigh', model: 'fable' }` and `conflict_check.L: { model: 'fable' }` (update comments). S/M rows byte-identical.
4. Run — GREEN.
5. Commit: `feat(models): escalate plan.L and conflict_check.L to fable (#190)`

**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts` — tier expectations
- `src/conductor/src/engine/resolved-config.ts` — two override model keys

**Dependencies:** Task 2

### Task 6: Extend the model alias doc comment
**Story:** "Engine defaults…" (Done When: config.ts doc comment)
**Type:** infrastructure

**Steps:**
1. In `src/conductor/src/types/config.ts` (~line 65), change the `StepConfig.model` doc comment alias list to `("haiku"|"sonnet"|"opus"|"fable")`.
2. Run `rtk proxy npx vitest run` (type-check via test build) — green.
3. Commit: `docs(types): list fable among model aliases`

**Files likely touched:**
- `src/conductor/src/types/config.ts` — doc comment only

**Dependencies:** none

### Task 7: Flip the three existing SKILL.md pins
**Story:** "Skill frontmatter pins — three flipped, engineer's added" (happy path, first criterion)
**Type:** infrastructure

**Steps:**
1. In `skills/explore/SKILL.md`, `skills/prd/SKILL.md`, `skills/architecture-review/SKILL.md`, change frontmatter `model: opus` → `model: fable` (line 8 in each; no other frontmatter keys touched).
2. Run `test/test_harness_integrity.sh` — frontmatter check passes.
3. Commit: `feat(skills): pin explore/prd/architecture-review to fable (#190)`

**Files likely touched:**
- `skills/explore/SKILL.md`, `skills/prd/SKILL.md`, `skills/architecture-review/SKILL.md`

**Dependencies:** none

### Task 8: Add the missing engineer pin
**Story:** "Skill frontmatter pins…" (happy path: engineer pin added; negative: no collateral drift)
**Type:** infrastructure + negative-path

**Steps:**
1. Add `model: fable` to `skills/engineer/SKILL.md` frontmatter (after `phase:`, matching the other skills' key order).
2. Verify no collateral drift: `grep -l '^model:' skills/*/SKILL.md` — the ONLY skills whose `model:` lines changed vs `git diff` are the four in scope.
3. Run `test/test_harness_integrity.sh` — passes.
4. Commit: `feat(skills): add missing fable model pin to engineer (#190)`

**Files likely touched:**
- `skills/engineer/SKILL.md` — one frontmatter line added

**Dependencies:** Task 7 (so the no-drift grep sees the final state)

### Task 9: Sync HARNESS.md model table + CHANGELOG
**Story:** "HARNESS.md model table synced + docs and changelog" (all criteria)
**Type:** infrastructure + negative-path

**Steps:**
1. In HARNESS.md's model-selection table: engineer/explore/prd rows → `fable`; architecture-review row → `fable` retaining the "`--as-built` … runs on **sonnet**" note verbatim; conflict-check row → `sonnet (S/M), fable (L)`; plan row → `sonnet (S/M), fable (L)`; both keep their `**Enforced** via DEFAULT_STEP_TIER_OVERRIDES` notes. Update rationale cells to name Fable (front-of-funnel judgment; cheap generation, premium judgment).
2. Verify no row was dropped and BUILD-step rows (tdd, writing-system-tests, evaluator, domain-reviewer, code-review, architecture-diagram, stories) are unchanged.
3. Add to `CHANGELOG.md` under `## [Unreleased]` → `### Changed`: front-of-funnel DECIDE steps (explore, prd, pre-impl architecture-review, engineer) and plan.L/conflict_check.L tier overrides now default to `fable`; S/M tiers and `--as-built` unchanged; degradation when fable is unavailable arrives with the #186 fallback ladder; refs #190.
4. Run `test/test_harness_integrity.sh` — model-table + changelog checks pass.
5. Commit: `docs(harness): sync model table + changelog for fable front-of-funnel (#190)`

**Files likely touched:**
- `HARNESS.md` — six table rows + rationale
- `CHANGELOG.md` — one Changed entry

**Dependencies:** Tasks 2, 5 (table documents enforced reality)

### Task 10: Full-suite verification
**Story:** all (Done When: suites green)
**Type:** infrastructure

**Steps:**
1. `cd src/conductor && rtk proxy npx vitest run` — entire conductor suite green.
2. `test/test_harness_integrity.sh` — exits 0.
3. `grep -rn "'fable'" src/conductor/src/engine/resolved-config.ts` shows exactly 5 hits (3 defaults + 2 tier overrides); `grep '^model:' skills/{explore,prd,architecture-review,engineer}/SKILL.md` shows 4 × `model: fable`.
4. Commit anything outstanding; no fixup needed if Tasks 1–9 committed cleanly.

**Dependencies:** Tasks 1–9

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3
                 ├▶ Task 4
                 ├▶ Task 5 ─▶ Task 9 ─▶ Task 10
Task 6 ──────────────────────────────▶ Task 10
Task 7 ─▶ Task 8 ────────────────────▶ Task 10
```

## Integration Points

- After Task 5: the engine resolves every affected step/tier to fable — verifiable end-to-end via `resolveStepConfig` unit tests.
- After Task 9: all three sync points agree — verifiable via integrity suite + greps (Task 10).

## Verification

- [ ] All happy path criteria covered by at least one task (T1/T2 story 1, T5 story 2, T7/T8 story 3, T9 story 4)
- [ ] All negative path criteria covered by explicit tasks (T3 override precedence, T4 BUILD drift, T5 S/M pins + as-built in T1, T8 collateral drift, T9 table/row retention)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
