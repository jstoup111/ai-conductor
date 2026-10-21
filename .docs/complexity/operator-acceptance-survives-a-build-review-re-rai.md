# Complexity: Operator acceptance survives a build_review re-raise (respec of #3271)

Tier: L
Stacked-Delivery: approved

## Rationale

- **Durable schema change.** The feature-scoped remediation case store (`remediation-case-store.ts`,
  exact-keyed and fail-closed) moves from v2 to v3. Three additions: an operator-acceptance mark on
  a case, a `carried` source outcome, and a carry-event outbox. v2 must stay readable and be upgraded
  on write, following the existing v1→v2 precedent.
- **New operator authority surface.** A new TTY-gated `build-review` subcommand resolves a blocking
  remediation case. That is the first operator write to case state. It must be decided in an ADR
  against `adr-2026-08-13-stable-build-review-finding-dispositions` D2/D4 and
  `adr-2026-08-29-build-review-remediate-case-adjudication` D2.
- **Crash-safe occurrence.** The carry event moves from emit-after-persist to an outbox drained
  through `EventPersister` eventId dedup. This extends the dedup set that today covers only routing
  and observation events.
- **Cross-cutting consumers.** Affected: coordinator finalize and reuse classification, the
  reconciler, decision stops, clean-PASS settlement in `conductor.ts`, the effective verdict and its
  `step-runners.ts`/`artifacts.ts` callers, adjudication context, the findings CLI, PR accepted-risk
  rendering, and the `remediate` skill contract.
- **Prior attempt failed at M.** The reverted #3308 spec was scoped Medium with lightweight review.
  It halted after exhausting its laps on design-level contradictions. A full architecture review is
  warranted.
