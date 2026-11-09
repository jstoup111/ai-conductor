# Complexity: manual_test attempts halt without testing when no pipeline dir is supplied

Tier: S

## Rationale

- About four production files, one logical change per outcome: `src/conductor/src/engine/manual-test-record-cli.ts`
  (optional `--pipeline-dir`, derived from the git toplevel), the manual_test branch of the
  post-dispatch verdict handshake in `src/conductor/src/engine/conductor.ts`, the manual_test retry
  hint in `src/conductor/src/engine/remediation-hints.ts`, and `skills/manual-test/SKILL.md`.
- No new module, layer, dependency, or persisted format. The CLI change is additive: an explicit
  absolute `--pipeline-dir` keeps working unchanged.
- No APPROVED ADR mandates `--pipeline-dir` for `manual-test-record` (the absolute-path ADR,
  adr-2026-07-07-finish-record-primitive, governs `finish-record` only). Root resolution follows the
  existing `ai-conductor task` precedent (`git rev-parse --show-toplevel`, task-cli.ts).
- Scope limited to manual_test by operator decision; prd_audit and as-built handshakes unchanged.

## Assumptions

| Assumption | Confidence | Basis | Impact if wrong | Status |
|---|---|---|---|---|
| A feature's project root equals the git toplevel of the manual_test agent's cwd | 90% | inferred | results land in another `.pipeline`; mitigated by refusing when `<toplevel>/.pipeline` is absent | APPROVED by operator 2026-11-08 |

Per tier rules, architecture-diagram, architecture-review, conflict-check, coherence-check, and
plan-review are skipped.
