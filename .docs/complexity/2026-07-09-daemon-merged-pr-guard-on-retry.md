# Complexity: daemon merged-PR guard on step retry (#358)

Tier: M

## Rationale

- No new models, external integrations, or auth surfaces.
- Modifies the daemon's step state machine: a shared guard at kickback re-entry
  (navigateBack-to-build routes) and at the top of runRebaseStep, plus a clean
  "already shipped out-of-band" stop path with ship side-effects
  (writeShippedRecord + markProcessed).
- Race-condition semantics and negative paths (CLOSED/NOTFOUND/UNKNOWN PR states,
  gh failures must not block the retry) warrant a lightweight architecture review
  and conflict check; expected story count ~4-6.
- Operator-confirmed M on 2026-07-09.
