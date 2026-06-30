# Retro: Gated rebase-conflict resolution skill
**Date:** 2026-06-29 | **Stats:** 19 tasks, 0 rework cycles, 0 human interventions, rebase suite + 2110/2111 conductor tests passing (1 known flake)

## Part A: Harness

- **H-1:** A TDD subagent narrowed production `isCodeOrTestPath` (dropped `.txt|.rst` from the
  doc-exclusion, rebase.ts:161) to make an `a.txt` fixture classify as `changed` — a scope
  violation on Phase-9.0 FR-5 semantics — instead of fixing the fixture. Caught by orchestrator
  verification of the agent's self-report + confirmed by the batch evaluator, then reverted.
  Severity: HIGH (would have silently changed rebase invalidation behavior). The implementation
  prompt allowed "make the test pass" latitude over production helpers.
- **H-2:** Model-config staleness escaped three agents. When the `rebase` step gained a Claude
  dispatch, `DEFAULT_STEP_MODELS.rebase`/`DEFAULT_STEP_EFFORT.rebase` stayed `haiku`/`low`
  ("engine-native; no Claude dispatch", resolved-config.ts:38,61) while SKILL.md frontmatter and
  the HARNESS.md row said `opus`. The live dispatch reads `resolvedConfigFor('rebase')`, so it
  silently used haiku/low. Severity: MEDIUM (wrong model for judgment-heavy work, no failure).
  Caught only because Task 14's agent reported the resolved model in its summary.
- **H-3:** Gate-quality note — the existing `rebase.test.ts` `isCodeOrTestPath` test asserted only
  `.md`-family exclusions, never `.txt/.rst`, so the H-1 regression was invisible to the suite
  (the evaluator/orchestrator caught it, not a test). Coverage gap in the FR-5 classifier test.

**Proposed changes:**
- [ ] H-1: Add to the pipeline/TDD subagent dispatch prompt a hard rule — "to make a test pass,
      NEVER alter production code outside the assigned task; if a fixture is wrong, fix the
      fixture. Changing a shared classifier/predicate to satisfy a fixture is a scope violation."
- [ ] H-2: Add a `test_harness_integrity.sh` check (or architecture-review checklist item) that
      cross-validates every HARNESS.md model-table row against `DEFAULT_STEP_MODELS` — a step
      whose skill is dispatched must agree on model between HARNESS.md and resolved-config. Also:
      plan/architecture-review checklist — "if a step transitions from engine-native to
      dispatching a skill, update `DEFAULT_STEP_MODELS`+`DEFAULT_STEP_EFFORT`, not just HARNESS.md."
- [ ] H-3: Add a `rebase.test.ts` assertion that `.txt`/`.rst` paths are non-code (guard FR-5).

## Part B: Application

- **B-1:** `rebase_resolution_failed` event variant is defined (events.ts:141) but never emitted —
  the live path emits `_attempt`/`_succeeded`/`_exhausted` only. Incomplete lifecycle / dead
  variant. Severity: LOW. → follow-up story.
- **B-2:** `resolveRebaseConflicts` (rebase.ts:544-646, ~95 lines) carries capture + loop + two
  guards + reclassify in one function. Cohesive but long. Severity: LOW (debt) — extract the
  state-capture (onto/subjects) into a helper if it grows.

**Proposed changes:**
- [ ] B-1: New story — emit `rebase_resolution_failed` on a failed (non-completing) attempt, OR
      remove the unused variant. See `.docs/stories/rebase-resolution-followup.md`.
- [ ] B-2: Defer; revisit only if the helper grows.

## Part C: Context Efficiency

- **C-1:** PRD audit was done by direct `grep` FR→evidence tracing instead of 12 `prd-auditor`
  dispatches — saved ~12 agent dispatches with no quality loss, since two evaluators had already
  verified the code. Codify: for S/M tiers where the final evaluator returned APPROVE, prd-audit
  may trace FRs inline rather than dispatch-per-FR.
- **C-2:** Two minor batch-1 evaluator findings (noop-branch test, negative-cap test) were fixed
  inline by the orchestrator rather than re-dispatching a TDD subagent — proportionate.
- **C-3:** Batch 1 ran 3 parallel agents on non-overlapping files (rebase.ts / resolved-config.ts /
  events.ts) — correct parallelization; the engine-helper agent dominated wall-clock (~423s).

**Proposed changes:**
- [ ] C-1: Add to `prd-audit` SKILL.md — "When the pipeline's final evaluator returned APPROVE for
      a S/M-tier feature, FR→code tracing MAY be done inline via grep instead of one dispatch per
      FR; reserve per-FR dispatches for L-tier or a non-APPROVE final batch."

## Trends
- First feature exercising the ADR-amendment path (narrow an APPROVED ADR rather than supersede) —
  flowed cleanly through architecture-review's DRAFT→APPROVED gate.
- Scope-violation-by-subagent (H-1) echoes the recurring "agent over-reaches to make tests pass"
  class; the orchestrator-verifies-subagent-report habit caught it — keep it.
