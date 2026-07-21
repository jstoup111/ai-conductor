# Complexity: Post-rebase delta-aware gate invalidation (#655)

Tier: M

## Signals
- **New models / schemas:** none (adds a static gate→surface map + one event type).
- **Integrations / auth:** none.
- **State machines:** modifies the existing gate/tail invalidation state machine
  (`applyRebaseVerdicts` + `advanceTail`/`markDownstreamStale`) — no new state machine.
- **Story count:** moderate — delta path-set computation, declarative gate→input-surface map,
  delta-gated invalidation set, delta-gated downstream-stale sweep, per-gate preserve/re-run
  audit event, fail-closed fallback, plus happy + negative acceptance paths.
- **Blast radius:** touches the ship-critical rebase invalidation path; correctness (fail-closed)
  matters, so a lightweight architecture review + conflict-check are warranted.

## Rationale
Contained to `src/conductor/src/engine/{rebase,rebase-translate,conductor}.ts` + `types/events.ts`
with no new subsystems. Not Small (it changes ship-critical gating semantics and needs an
auditable decision trail + fail-closed guarantees); not Large (no new models/integrations/auth,
single subsystem). Matches the GitHub `size: M` label.

Per tier M: run architecture-diagram + lightweight architecture-review + conflict-check; produce
stories + plan.
