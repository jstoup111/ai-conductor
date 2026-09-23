# Intake origin: release-gate-halts-a-finished-build-for-a-waiver-m

Source-Ref: jstoup111/ai-conductor#2230
Owner: jstoup111

## Desired outcome

- A build whose flagged breaking surface is determinable as internal-only ships with a committed, gate-valid waiver (or a real migration block when consumer action exists) without an operator halt; the authored disposition is visible for operator review on the PR before merge (the daemon never merges — ADR-005/ADR-010 review point is preserved).
- A surface the pipeline cannot confidently classify still halts exactly as today.
