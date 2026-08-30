# Complexity: cumulative kickback cap recovery

Tier: M

## Rationale

- One operator-facing command family with inspect and mutating recovery behavior.
- One durable state machine: cumulative budget consumption, operator credit/reset or extension,
  and subsequent halt/resume behavior must remain coherent across daemon dispatches.
- One existing integration surface, the conductor event spine, gains auditable intervention
  behavior without a parallel channel.
- The change spans CLI parsing/dispatch, ledger state, halt diagnostics, event persistence,
  behavioral tests, and canonical operator documentation.
- No new service, provider integration, authentication boundary, or data store is required.

This matches the issue's `size: M` label and the adjacent shipped convergence-counter feature,
which was also assessed Medium. Operator confirmed Tier M on 2026-08-29.
