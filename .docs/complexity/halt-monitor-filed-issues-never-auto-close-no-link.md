# Complexity: halt-monitor issue auto-close

Tier: M

## Rationale

- **Integrations:** one — GitHub issue read/comment/close via the existing DI `gh`
  seam (`pr-labels.ts`); no new auth surface (operator `gh` credentials).
- **State:** one new persisted ledger (slug→issue#, status) plus parsing of the
  monitor's `monitor.log` verdict lines; rebuildable, no migrations.
- **Models/schema:** none beyond the ledger JSON.
- **State machines:** trivial per-entry lifecycle (filed → stamped → closed).
- **Side effects:** outward-facing (closes real GitHub issues) — needs idempotency,
  dry-run safety, and quota discipline, which pushes this above Small.
- **Estimated stories:** 5–7.

Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check all run.
