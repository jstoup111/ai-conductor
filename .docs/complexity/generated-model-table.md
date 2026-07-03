# Complexity: Generated HARNESS.md model-selection table

Tier: M

## Rationale

- **Subsystems touched:** two — the TS engine (`src/conductor/src/engine/resolved-config.ts`
  gains typed rationale/extra-row exports + a tsx generator script) and the bash integrity
  suite (`test/test_harness_integrity.sh` gains a content-drift check and a SKILL.md pin check).
- **New cross-file contract:** generated-region markers in HARNESS.md, a kebab→snake skill→step
  mapping, and an explicit exemption list for skills with no engine step. Getting these seams
  wrong recreates the drift hazard the feature removes.
- **No heavy signals:** no external integrations, no auth, no persistent state or state
  machines, no data models. Story count estimated 4–6.
- **Not S:** the drift-check contract and the node-dependency degradation policy warrant a
  lightweight architecture review and a conflict check.
- **Not L:** single repo, no runtime behavior change to the daemon/conductor engine itself
  (resolution precedence untouched), bounded surface.

Tier M ⇒ lightweight `/architecture-review`, `/architecture-diagram` and `/conflict-check`
run; PRD skipped (technical track — see `.docs/track/generated-model-table.md`).
