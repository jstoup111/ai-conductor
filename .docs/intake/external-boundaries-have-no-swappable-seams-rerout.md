# Intake origin: external-boundaries-have-no-swappable-seams-rerout

Source-Ref: jstoup111/ai-conductor#1989
Owner: jstoup111

## Desired outcome

- For each external boundary, the place where its implementation is chosen is a single wiring/configuration point per entry point (`conduct` CLI, daemon); switching source or destination requires no edits to core engine modules.
- The full set of external-boundary interfaces is enumerable in one place, and a newly added external call that bypasses them is rejected mechanically before merge.
- Existing behavior is unchanged for every current adapter; the migration can land boundary-by-boundary rather than big-bang.
