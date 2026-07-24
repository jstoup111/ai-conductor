**Status:** Accepted

# Stories: Adopt Fable for front-of-funnel DECIDE steps

Source: jstoup111/ai-conductor#190 (approved Fable rollout plan #186–#194), Approach A
(declarative pin flip). Track: technical (no PRD). Tier: S.

> **Provider-aware amendment (#902, approved 2026-07-23):** The model assertions
> in this historical Fable rollout describe the built-in **Claude** policy.
> Codex uses the independent per-step policy in
> `model-and-effort-resolution-provider-aware-902.md`; standalone skill pins
> remain the Claude interactive path. The original `explore`/`prd` `xhigh`
> effort text was first superseded by #607's `medium` setting, then #902's
> operator-approved fit review set the current Claude base to `high`;
> `explore.S` remains the separate `low` override.

Out of scope (deliberate): fable-unavailability degradation is #186's fallback ladder;
`architecture-review --as-built` stays sonnet; all BUILD generation steps keep their models.

## Story: Engine defaults route front-of-funnel DECIDE steps to Fable

As the harness operator, I want explore, prd, and architecture-review (pre-impl) resolved to
the `fable` model by default so that the highest-cascade DECIDE judgments run on the strongest
model while generation-heavy steps stay cheap.

### Acceptance Criteria

#### Happy Path
- Given Claude is selected with no user/phase config overrides, when `resolveStepConfig('explore', 'DECIDE')` runs, then the resolved model is `fable` and effort is `high`
- Given Claude is selected with no overrides, when `resolveStepConfig('prd', ...)` runs, then model is `fable` and effort is `high`
- Given no overrides, when `resolveStepConfig('architecture_review', ...)` runs, then model is `fable` and effort remains `high`

#### Negative Paths
- Given a project YAML config setting `steps.explore.model: sonnet`, when the step config is resolved, then the user override wins and the model is `sonnet` (precedence chain unchanged by the new default)
- Given no overrides, when `resolveStepConfig('architecture_review_as_built', ...)` runs, then the model is still `sonnet` (the compliance mode is NOT escalated)
- Given no overrides, when `resolveStepConfig('build', ...)` / `('acceptance_specs', ...)` / `('stories', ...)` run, then their models are byte-identical to before this change (no BUILD/generation step drifts)

### Done When
- [ ] `DEFAULT_STEP_MODELS` in `src/conductor/src/engine/resolved-config.ts` has `explore: 'fable'`, `prd: 'fable'`, `architecture_review: 'fable'`; all other entries unchanged
- [ ] The current Claude effort policy has `explore: 'high'` and `prd: 'high'`, while `explore.S` remains `low`, matching the superseding #902 decision
- [ ] Unit tests in `src/conductor/test/engine/resolved-config.test.ts` updated: the explore-default assertion expects `fable`; a test asserts `architecture_review_as_built` still resolves `sonnet`
- [ ] `StepConfig.model` doc comment in `src/conductor/src/types/config.ts` lists `fable` among the aliases
- [ ] `rtk proxy npx vitest run` green in `src/conductor`

## Story: Large-tier overrides for plan and conflict-check escalate to Fable; S/M unchanged

As the harness operator, I want the pre-emptive Large-tier escalations for plan and
conflict-check to point at `fable` so that whole-set reasoning at L scale (where a miss is
silent, not retryable) gets the strongest model — while S/M tiers keep their cheap defaults.

### Acceptance Criteria

#### Happy Path
- Given `complexity_tier: L`, when `plan` resolves, then model is `fable` and effort is `xhigh`
- Given `complexity_tier: L`, when `conflict_check` resolves, then model is `fable`

#### Negative Paths
- Given `complexity_tier: S`, when `plan` resolves, then model stays the base default (`sonnet`) with effort `medium` — the S override gains no model key
- Given `complexity_tier: M` (or no tier recorded), when `conflict_check` resolves, then model is `sonnet` (no escalation leaks to non-L tiers)

### Done When
- [ ] `DEFAULT_STEP_TIER_OVERRIDES.plan.L` is `{ effort: 'xhigh', model: 'fable' }` and `DEFAULT_STEP_TIER_OVERRIDES.conflict_check.L` is `{ model: 'fable' }`; S/M rows byte-identical
- [ ] Tier-override unit tests updated to expect `fable` on L and assert S/M unchanged
- [ ] `rtk proxy npx vitest run` green in `src/conductor`

## Story: Skill frontmatter pins — three flipped, engineer's added

As the harness operator, I want the standalone skill pins to match the engine policy so a
session started on any default model still runs explore/prd/architecture-review/engineer on
Fable — including the engineer skill, whose pin was missing entirely despite the HARNESS.md
table claiming opus.

### Acceptance Criteria

#### Happy Path
- Given the four SKILL.md files, when frontmatter is read, then `skills/explore/SKILL.md`, `skills/prd/SKILL.md`, `skills/architecture-review/SKILL.md` each carry `model: fable` (was `opus`) and `skills/engineer/SKILL.md` now carries `model: fable` (was absent)

#### Negative Paths
- Given the full `skills/` tree, when `grep -l '^model:' skills/*/SKILL.md` runs, then no skill OTHER than these four gained, lost, or changed a `model:` line (no collateral pin drift)
- Given the edited frontmatter, when `test/test_harness_integrity.sh` runs, then the SKILL.md frontmatter check still passes (required fields intact, YAML valid)

### Done When
- [ ] `grep '^model:' skills/{explore,prd,architecture-review,engineer}/SKILL.md` shows exactly four `model: fable` lines
- [ ] `git diff --stat` touches no other `skills/*/SKILL.md`
- [ ] `test/test_harness_integrity.sh` exits 0

## Story: HARNESS.md model table synced + docs and changelog

As a harness consumer, I want the human-readable model table to match the enforced config so
the three sync points (resolved-config.ts, SKILL.md pins, HARNESS.md) never disagree.

### Acceptance Criteria

#### Happy Path
- Given HARNESS.md's model-selection table, when read after the change, then the engineer, explore, and prd rows say `fable`; the architecture-review row says `fable` with its `--as-built runs on sonnet` note retained; the conflict-check and plan rows say `sonnet (S/M), fable (L)` with their **Enforced via `DEFAULT_STEP_TIER_OVERRIDES`** notes retained; rationale text updated to name Fable
- Given CHANGELOG.md, when read, then `## [Unreleased]` has a `### Changed` entry describing the front-of-funnel Fable adoption and referencing #190

#### Negative Paths
- Given the updated table, when `test/test_harness_integrity.sh` runs, then the model-table check (every skill directory has a row) still passes — no row was dropped in the edit
- Given the table, when the `architecture-review --as-built` and BUILD-step rows are read, then they are unchanged (sonnet/current models) — the doc does not overstate the rollout

### Done When
- [ ] All six affected HARNESS.md rows updated; `grep -c 'fable' HARNESS.md` ≥ 6; as-built note still names sonnet
- [ ] `CHANGELOG.md` `[Unreleased]` → `### Changed` entry present, citing #190 and the #186 degradation dependency
- [ ] `test/test_harness_integrity.sh` exits 0
