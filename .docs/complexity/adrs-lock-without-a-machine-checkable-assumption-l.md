# Complexity: ADRs carry a machine-checked assumption ledger

Tier: M

## Rationale

- **One new parsing authority, two consumers.** A shared ADR assumption-ledger parser joins
  `adrApprovalStatus` / `parseAdrDecisions` in `src/conductor/src/engine/artifacts.ts`. It is
  consumed by the compose land gate (`engineer/land-spec.ts:592-660`, which already scopes approval,
  citability, and canonical-filename checks to the spec's added/changed ADRs and already computes the
  merge-base ADR tree) and by a new `architecture_review` gate predicate on the `/conduct` path.
- **A new gate surface and an enforcement change.** Neither `CUSTOM_COMPLETION_PREDICATES`
  (`artifacts.ts:2894`) nor `GATE_ONLY_PREDICATES` (`artifacts.ts:4201`, stories/plan only) has an
  `architecture_review` entry today. That step is `enforcement: 'advisory'` (`steps.ts:79`), and an
  advisory failure auto-skips in auto mode (`conductor.ts:12228-12240`). Making the predicate
  actually block means flipping the step to `gating`, which changes how any architecture-review
  failure is handled. That warrants an architecture review and an ADR.
- **Authoring surfaces.** `skills/architecture-review/templates/adr.md.template`,
  `skills/architecture-review/SKILL.md`, and `skills/verify-claims/SKILL.md` change so authors produce
  the section the gates require.
- **Why not L.** Both enforcement points extend existing gate families (the land 4e ADR rung; the
  stories/plan gate-only predicates) and reuse existing parsing, error-reason, and diff-scoping
  patterns. There is no new subsystem, event, CLI, hook, or settings surface. A daemon-discovery rung
  was considered and dropped by the operator. **Why not S.** Two gates on two paths, an enforcement
  change on a DECIDE step, and an artifact-format contract consumed by skills; conflict and coherence
  checks earn their keep.

Ceremony for Tier M: track + architecture diagram + lightweight architecture review (ADR APPROVED) +
stories + conflict-check + plan + coherence-check.
