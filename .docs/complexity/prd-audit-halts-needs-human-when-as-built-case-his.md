# Complexity: remediation history handed off by file

Tier: M

## Rationale

- Changes one engine seam, the remediation projection (`remediation-projection.ts`), and its
  single caller in `conductor.ts`, plus the `remediate` skill that consumes the projection and
  the plan-contract validation that reads its history fields.
- Introduces one new per-attempt artifact (a frozen history snapshot file under `.pipeline/`)
  and changes the prompt-side projection shape for four dimensions. That is a contract change
  between the engine and a shipped skill, so it needs an architecture review and an ADR
  amendment to the bounded-inputs decisions that set the byte caps.
- No new module, service, dependency, external integration, or persisted consumer-facing
  schema; no CLI, hook, or settings change.
- Not Small: more than two production files, a skill contract change, and an ADR amendment.
  Not Large: one seam, one consumer, and no cross-feature state machine.
- Expected story count: about 4 (file handoff, index-only prompt, halt classing, skill reads
  the snapshot).
