# Track: prd_audit FR-coverage gate

Track: technical

Internal engine/gate correctness fix in `src/conductor/src/engine/artifacts.ts` — the `prd_audit`
completion predicate never verifies that every functional requirement has a verdict row, so a
report missing rows scores as a pass. No user-facing product capability; acceptance criteria live
directly in the stories. Source: intake jstoup111/ai-conductor#1398.
