# Intake origin: re-kick-sentinel-can-strand-an-active-feature-outs

Source-Ref: jstoup111/ai-conductor#1232
Owner: jstoup111

## Desired outcome

- Every persisted re-kick signal reaches an observable lifecycle outcome: resumed, explicitly halted, processed/reaped, operator-parked, or reported as blocked by a named discovery gate.
- A discovery-gated feature is surfaced with the exact blocking requirement instead of appearing silently in progress.
- Recovery never bypasses legitimate eligibility, live-HALT, operator-park, or shipped-work dedup gates.
- A processed/merged feature carrying a stale sentinel is reaped or reported as processed, never re-dispatched.
