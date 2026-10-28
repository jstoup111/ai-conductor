# Complexity: routed repair opens a new round while an earlier round is still open

Tier: M

## Rationale

- Changes durable routing-state semantics governed by an APPROVED ADR
  (`adr-2026-10-12-routed-whole-feature-repair` decisions 6 and 7): admission gains a
  no-other-non-closed-round fence, reconciliation gains a marker-owner-first order, and the
  routed host exit takes ownership of advancing its round.
- Touches four existing production modules across the routing and restack layers and both
  conductor exit call sites: `routing/routed-exit.ts`, `routing/round-admission.ts`,
  `restack/stack-preflight.ts`, `conductor.ts`.
- Needs adversarial crash/resume coverage over ref-backed compare-and-swap state: resume after a
  halted exit, two rounds already open (the observed wedge), and a stuck state that must end in a
  retryable stop naming every open round.
- No new module, service, dependency, or persisted format; single repo; depends on #3446 for the
  preflight stop path → not L. Durable-state blast radius and an ADR amendment → not S.

Per tier M: architecture-diagram required, lightweight architecture-review, stories,
conflict-check, plan, coherence-check, plan-review. Technical track — no PRD.
