# Intake origin: stale-manual-test-discovered-at-finish-is-unroutab

Source-Ref: jstoup111/ai-conductor#1613
Owner: jstoup111

## Desired outcome

- A stale manual_test (or other stale SHIP validator) discovered at FINISH re-runs that validator and retries FINISH without operator intervention.
- Genuinely failed or absent validators still halt (staleness ≠ failure).
