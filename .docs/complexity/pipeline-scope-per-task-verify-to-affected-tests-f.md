# Complexity: pipeline — scope per-task VERIFY to affected tests

Tier: S

## Rationale

- Scope: one section of `skills/pipeline/SKILL.md` (step 3 VERIFY + step 4 FIX
  re-run wording), plus README/CHANGELOG upkeep. No `src/conductor` code, no new
  CLI surface, no hooks, no settings schema.
- No models, no external integrations, no auth, no state machines.
- Estimated 2–3 stories, single-batch build.
- Purely instructional (Markdown) change; validation via `test/test_harness_integrity.sh`.

Per tier rules: architecture-diagram, architecture-review, and conflict-check are
skipped; technical track additionally skips the PRD.
