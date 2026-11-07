# Complexity: write-tests skill outlived its machinery replacement and is half-wired (#1389)

Tier: S

Rationale: no engine (`src/conductor/src/`) code changes. The work is one agent-instruction trim
(`.agents/skills/write-tests/SKILL.md`), one agent-instruction correction
(`.agents/skills/scope-check/SKILL.md`), one committed git symlink (`.claude/skills/write-tests`), and
one new repository-integrity check that follows the existing `test/check_*.sh` + `test/test_*.sh`
mutation-fixture pattern (`check_skill_invocation_policy.sh` is the precedent), wired into
`test/test_harness_integrity.sh` and classified in `test/shell_tests.manifest`. No models, external
integrations, auth, schema, CLI, hook, or settings surface. The release-gate classifier
(`classifyBreakingSurfaces`) flags no surface: the symlink is an addition outside `skills/`. No new
architectural decision, so no ADR. Expected stories: 2. Per tier rules: prd, architecture-diagram,
architecture-review, conflict-check, coherence-check, and plan-review are skipped.
