# Complexity: A halt leaves no committed, pushed record for the operator to pick up from

Tier: M

## Rationale

**Signals present**

- Touches the engine's single halt seam, which ~30 call sites reach — a change there is
  blast-radius-wide even though no call site is edited.
- Introduces a new committed artifact contract (`.docs/halted/<slug>.md`) that operators and
  future features will read, so its shape needs an approved decision record.
- Adds git side effects (stage, commit, push) inside a path that is contractually forbidden from
  failing, which is a real error-handling design rather than a code change.
- Adds a state transition: halted → resolved, with an idempotency requirement in both directions.
- Additive `ConductorEvent` union members, so the telemetry spine is touched.

**Signals absent**

- No new model, no third-party integration, no authentication, no new CLI verb, no schema
  migration of persisted state, no config key.

Four stories, a single new module plus one seam edit, and one ADR. That is squarely Medium: too
much contract for Small (a new committed artifact and a bus change both want architecture review),
and far short of Large (no cross-cutting redesign, no multi-component state machine).
