**Status:** Accepted

# Stories: Adopt Fable for recovery/failure-response steps (rebase, remediate, debugging)

Source: jstoup111/ai-conductor#189 (approved Fable rollout plan #186–#194), Approach A
(declarative pin flip mirroring the merged front-of-funnel spec #188 / PR #196). Track:
technical (no PRD). Tier: S.

Out of scope (deliberate): fable-unavailability degradation logic is #186's fallback ladder —
this spec only documents the manual `--model` override as the interim fallback (#186 is still
OPEN). All other steps' models/efforts are untouched.

Coordination note: the sibling front-of-funnel spec (#188) is merged but not yet built; both
specs edit `DEFAULT_STEP_MODELS` and the HARNESS.md table. Whichever builds second rebases via
the daemon's finish-time mechanism — the edits are on disjoint keys/rows, so the merge is
mechanical.

## Story: Engine defaults route rebase and remediate to Fable, with rebase at max effort

As the harness operator, I want the rebase and remediate steps resolved to the `fable` model by
default — with rebase escalated to `max` effort — so that the steps whose failures are silent or
human-interrupting (a wrong semantic merge reverts merged work; a wrong disposition misroutes a
rework cycle) run on the strongest model, at negligible cost given their low frequency.

**Requirement:** #189 sync point 1 (resolved-config.ts)

### Acceptance Criteria

#### Happy Path
- Given no user/phase config overrides, when `resolveStepConfig('rebase', ...)` runs, then the resolved model is `fable` and the resolved effort is `max`
- Given no overrides, when `resolveStepConfig('remediate', ...)` runs, then the resolved model is `fable` and the resolved effort remains `high`

#### Negative Paths
- Given a project YAML config setting `steps.rebase.model: opus`, when the step config is resolved, then the user override wins and the model is `opus` (precedence chain unchanged by the new defaults)
- Given no overrides, when `resolveStepConfig('finish', ...)` and `resolveStepConfig('build', ...)` run, then their models and efforts are byte-identical to before this change (no collateral drift in the constants records)

### Done When
- [ ] `DEFAULT_STEP_MODELS` in `src/conductor/src/engine/resolved-config.ts` has `rebase: 'fable'` and `remediate: 'fable'`; all other entries unchanged by this spec
- [ ] `DEFAULT_STEP_EFFORT` has `rebase: 'max'`; `remediate` stays `'high'`; all other entries unchanged
- [ ] Rationale comments on the four edited lines updated to name Fable and the failure-mode justification
- [ ] Unit tests in `src/conductor/test/engine/resolved-config.test.ts` assert: rebase resolves `fable`/`max`, remediate resolves `fable`/`high`, a user `model:` override on rebase still wins, and `finish` still resolves its prior model (collateral-drift guard)
- [ ] `rtk proxy npx vitest run` green in `src/conductor`

## Story: Skill frontmatter pins flipped for rebase, remediate, and debugging

As the harness operator, I want the standalone skill pins for rebase, remediate, and debugging
to say `model: fable` so that a session started on any default model still runs these
recovery skills on Fable — including `/debugging`, which is not an engine step and is governed
ONLY by its skill pin.

**Requirement:** #189 sync point 2 (SKILL.md pins)

### Acceptance Criteria

#### Happy Path
- Given the three SKILL.md files, when frontmatter is read, then `skills/rebase/SKILL.md`, `skills/remediate/SKILL.md`, and `skills/debugging/SKILL.md` each carry `model: fable` (each was `model: opus`)

#### Negative Paths
- Given the full `skills/` tree, when `grep '^model:' skills/*/SKILL.md` runs, then no skill OTHER than these three gained, lost, or changed a `model:` line in this spec's diff (no collateral pin drift)
- Given the edited frontmatter, when `test/test_harness_integrity.sh` runs, then the SKILL.md frontmatter check still passes (required fields intact, YAML valid)

### Done When
- [ ] `grep '^model:' skills/{rebase,remediate,debugging}/SKILL.md` shows exactly three `model: fable` lines
- [ ] `git diff --stat` for this spec touches no other `skills/*/SKILL.md`
- [ ] `test/test_harness_integrity.sh` exits 0

## Story: HARNESS.md model table synced, interim fallback documented, changelog updated

As a harness consumer, I want the human-readable model table to match the enforced config and
to state what happens when Fable is unavailable, so the three sync points never disagree and an
operator hitting an unavailable premium model has a documented escape hatch.

**Requirement:** #189 sync point 3 (HARNESS.md) + acceptance criterion 2 (interim fallback)

### Acceptance Criteria

#### Happy Path
- Given HARNESS.md's model-selection table, when read after the change, then the `debugging`, `remediate`, and `rebase` rows say `fable` with rationale text naming the failure mode each guards against (silent revert / false HALT–misroute / wrong root cause)
- Given HARNESS.md, when read, then a note near the model table documents the interim fallback: until #186's availability ladder lands, an operator whose environment lacks Fable overrides per-run with the `--model` CLI flag (or a `steps.<step>.model` config override)
- Given CHANGELOG.md, when read, then `## [Unreleased]` has a `### Changed` entry describing the recovery-steps Fable adoption, citing #189 and noting the #186 interim-fallback documentation

#### Negative Paths
- Given the updated table, when `test/test_harness_integrity.sh` runs, then the model-table check (every skill directory has a row) still passes — no row was dropped in the edit
- Given the table, when rows other than debugging/remediate/rebase are read, then they are byte-identical to before this spec (the doc does not overstate the rollout; front-of-funnel rows are #188's concern)

### Done When
- [ ] The three HARNESS.md rows updated to `fable` with failure-mode rationale; all other rows untouched by this spec's diff
- [ ] Interim-fallback note present in HARNESS.md naming the `--model` override and #186
- [ ] `CHANGELOG.md` `[Unreleased]` → `### Changed` entry present, citing #189
- [ ] `test/test_harness_integrity.sh` exits 0
