# Complexity: Self-host boundary fingerprint re-walks the live checkout per reviewer

Tier: S

## Rationale

- One logical change inside the existing self-host live-boundary machinery: a dispatch-scoped shared snapshot in `src/conductor/src/engine/self-host/`, wired into the one `prepareCandidateSelfHost` closure in `src/conductor/src/engine/conductor.ts`.
- No models or persisted data, no external integrations, no auth, no CLI, hook, config, or event-schema change; the `self_host_boundary_fingerprint` event keeps its shape and only its frequency drops.
- One simple lifecycle (reference count plus dispatch-ended flag) decides when the single verification runs.
- Three stories: shared snapshot, drift still halts, one fingerprint line per snapshot.
- Stays within adr-2026-08-17-structural-live-checkout-containment (no exclusion added, same verify and containment semantics) and adr-2026-08-27-daemon-dispatcher-executor-seam D6 (windows remain scoped to one provider dispatch); no new ADR.

Per tier rules, architecture-diagram, architecture-review, conflict-check, and coherence-check are skipped.
