# Implementation Plan: Adopt Fable for recovery/failure-response steps (rebase, remediate, debugging)

**Date:** 2026-07-02
**Design:** technical track — no PRD; source issue jstoup111/ai-conductor#189 (approved Fable rollout plan #186–#194)
**Stories:** `.docs/stories/fable-recovery-steps.md`
**Conflict check:** Skipped per Tier S (recorded in `.docs/complexity/fable-recovery-steps.md`)

## Summary

Declarative model-policy flip for the three failure-response steps: rebase → `fable`/`max`,
remediate → `fable`/`high` in the engine defaults; rebase/remediate/debugging skill pins →
`fable`; HARNESS.md table rows synced plus an interim `--model` fallback note (until #186's
availability ladder lands). 7 tasks.

## Technical Approach

Three sync points must change together (HARNESS.md: "When you change one, change all three"):

1. **Engine** — `src/conductor/src/engine/resolved-config.ts`: `DEFAULT_STEP_MODELS.rebase`
   and `.remediate` become `'fable'`; `DEFAULT_STEP_EFFORT.rebase` becomes `'max'`
   (`remediate` stays `'high'`). `'max'` is already a member of `EffortLevel`
   (`src/conductor/src/types/config.ts:11`) — no type change. Model strings pass through
   `llm-provider` verbatim, so no provider change. `debugging` is NOT an engine step (it has
   no `DEFAULT_STEP_MODELS` entry) — it is governed solely by its skill pin (sync point 2).
2. **Skill pins** — flip `model: opus` → `model: fable` in `skills/rebase/SKILL.md`,
   `skills/remediate/SKILL.md`, `skills/debugging/SKILL.md` (frontmatter line 8 in each).
3. **Docs** — HARNESS.md model-selection table: the `debugging` (~line 101), `remediate`
   (~line 107), and `rebase` (~line 108) rows → `fable`, rationale cells updated to name the
   failure mode each guards (wrong root cause → band-aid fixes; false HALT / misrouted
   disposition; wrong semantic merge → silent revert of merged work). Add an interim-fallback
   note near the table: until #186 lands, an environment lacking Fable overrides per-run via
   the `--model` CLI flag or a `steps.<step>.model` config override. Plus a CHANGELOG
   `[Unreleased]` → `### Changed` entry citing #189.

TDD shape: the engine flips are test-first against
`src/conductor/test/engine/resolved-config.test.ts` (no existing assertions pin
rebase/remediate models — Task 1 adds them expecting `fable`, RED before the config edit).
Markdown edits are validated by `test/test_harness_integrity.sh` and targeted greps.

Coordination: the sibling front-of-funnel spec (#188, merged spec PR #196) also edits
`DEFAULT_STEP_MODELS` and the HARNESS.md table but on **disjoint keys/rows**
(explore/prd/architecture_review vs rebase/remediate; different table rows). Whichever builds
second rebases via the daemon's finish-time mechanism; the merge is mechanical. Do NOT touch
the front-of-funnel keys/rows in this build. Fable-unavailability degradation logic is OUT OF
SCOPE (deferred to #186) — this spec only documents the manual override.

## Prerequisites

- `npm install` run in `src/conductor` of the build worktree (each worktree needs its own).
- Test runner: `rtk proxy npx vitest run` (plain `npx vitest` output is swallowed by rtk).

## Tasks

### Task 1: RED — add engine expectations for rebase/remediate on fable
**Story:** "Engine defaults route rebase and remediate to Fable, with rebase at max effort" (happy paths)
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/engine/resolved-config.test.ts`, add assertions: `resolveStepConfig('rebase', ...)` resolves `model: 'fable'` and `effort: 'max'`; `resolveStepConfig('remediate', ...)` resolves `model: 'fable'` and `effort: 'high'`.
2. Run `rtk proxy npx vitest run test/engine/resolved-config.test.ts` — the four expectations MUST fail (RED) against the current `opus`/`high` defaults.

**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts` — new assertions

**Dependencies:** none

### Task 2: GREEN — flip the rebase/remediate defaults
**Story:** same as Task 1
**Type:** happy-path

**Steps:**
1. In `src/conductor/src/engine/resolved-config.ts`, set `DEFAULT_STEP_MODELS.rebase: 'fable'`, `DEFAULT_STEP_MODELS.remediate: 'fable'`, `DEFAULT_STEP_EFFORT.rebase: 'max'`. Update the trailing rationale comments on those lines to name Fable and the failure mode (silent revert / misrouted disposition). Touch nothing else in the file — in particular no front-of-funnel keys.
2. Run the test file again — Task 1 assertions pass (GREEN).
3. Commit: `feat(models): route rebase/remediate defaults to fable, rebase at max effort (#189)`

**Files likely touched:**
- `src/conductor/src/engine/resolved-config.ts` — two model strings, one effort string, comments

**Dependencies:** Task 1

### Task 3: Negative test — user YAML override still beats the fable default
**Story:** "Engine defaults…" (negative path: precedence chain unchanged)
**Type:** negative-path

**Steps:**
1. In `resolved-config.test.ts`, add a test that a config-level `steps.rebase.model: 'opus'` resolves to `opus` over the new `fable` default (mirror the existing user-override test shape, ~line 127).
2. Verify it passes (precedence logic untouched; regression guard).
3. Commit: `test(models): user config override beats fable default on rebase`

**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts` — one negative-path test

**Dependencies:** Task 2

### Task 4: Negative test — collateral-drift guard on untouched steps
**Story:** "Engine defaults…" (negative path: no collateral drift)
**Type:** negative-path

**Steps:**
1. Add a test asserting `finish` and `build` resolve to their pre-change models/efforts (`haiku`/`low` each).
2. Verify it passes.
3. Commit: `test(models): pin finish/build against drift`

**Files likely touched:**
- `src/conductor/test/engine/resolved-config.test.ts`

**Dependencies:** Task 2

### Task 5: Flip the three SKILL.md pins
**Story:** "Skill frontmatter pins flipped for rebase, remediate, and debugging" (all criteria)
**Type:** infrastructure + negative-path

**Steps:**
1. In `skills/rebase/SKILL.md`, `skills/remediate/SKILL.md`, `skills/debugging/SKILL.md`, change frontmatter `model: opus` → `model: fable` (line 8 in each; no other frontmatter keys touched).
2. Verify no collateral drift: `git diff --stat` touches no other `skills/*/SKILL.md`; `grep '^model:' skills/{rebase,remediate,debugging}/SKILL.md` shows exactly three `model: fable` lines.
3. Run `test/test_harness_integrity.sh` — frontmatter check passes.
4. Commit: `feat(skills): pin rebase/remediate/debugging to fable (#189)`

**Files likely touched:**
- `skills/rebase/SKILL.md`, `skills/remediate/SKILL.md`, `skills/debugging/SKILL.md`

**Dependencies:** none

### Task 6: Sync HARNESS.md rows + interim fallback note + CHANGELOG
**Story:** "HARNESS.md model table synced, interim fallback documented, changelog updated" (all criteria)
**Type:** infrastructure + negative-path

**Steps:**
1. In HARNESS.md's model-selection table, update the `debugging`, `remediate`, and `rebase` rows to `fable`, rewriting each rationale cell to name the guarded failure mode (debugging: a wrong root cause produces band-aid fixes; remediate: a false HALT is a human interrupt, a wrong disposition misroutes a rework cycle; rebase: a wrong semantic merge silently reverts merged work). Touch no other rows.
2. Add a short interim-fallback note near the table: these premium pins assume Fable availability; until the #186 availability ladder lands, override per-run with the `--model` CLI flag or a `steps.<step>.model` config entry.
3. Add to `CHANGELOG.md` under `## [Unreleased]` → `### Changed`: recovery/failure-response steps (rebase, remediate, debugging) now default to `fable` (rebase at `max` effort); interim `--model` fallback documented pending #186; refs #189.
4. Run `test/test_harness_integrity.sh` — model-table + changelog checks pass; verify no row dropped.
5. Commit: `docs(harness): sync model table + interim fable fallback for recovery steps (#189)`

**Files likely touched:**
- `HARNESS.md` — three table rows + one note
- `CHANGELOG.md` — one Changed entry

**Dependencies:** Task 2 (table documents enforced reality)

### Task 7: Full-suite verification
**Story:** all (Done When: suites green)
**Type:** infrastructure

**Steps:**
1. `cd src/conductor && rtk proxy npx vitest run` — entire conductor suite green.
2. `test/test_harness_integrity.sh` — exits 0.
3. `grep -n "'fable'" src/conductor/src/engine/resolved-config.ts` shows this spec's 2 hits on the rebase/remediate lines (plus any front-of-funnel hits if #188 built first — do not remove those); `grep '^model:' skills/{rebase,remediate,debugging}/SKILL.md` shows 3 × `model: fable`.
4. Commit anything outstanding; no fixup needed if Tasks 1–6 committed cleanly.

**Dependencies:** Tasks 1–6

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3
                 ├▶ Task 4
                 └▶ Task 6 ─▶ Task 7
Task 5 ────────────────────▶ Task 7
```

## Integration Points

- After Task 2: the engine resolves rebase/remediate to fable (rebase at max) — verifiable via `resolveStepConfig` unit tests.
- After Task 6: all three sync points agree and the interim fallback is documented — verifiable via integrity suite + greps (Task 7).

## Verification

- [ ] All happy path criteria covered by at least one task (T1/T2 story 1, T5 story 2, T6 story 3)
- [ ] All negative path criteria covered by explicit tasks (T3 override precedence, T4 collateral drift, T5 pin-drift + integrity, T6 row retention)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
