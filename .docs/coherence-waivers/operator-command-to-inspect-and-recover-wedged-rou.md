Waives: outcome-1, outcome-2, outcome-4

Rationale: on 2026-10-29 the operator scoped this spec to outcome 3 of jstoup111/ai-conductor#3459. The other
three outcomes already have a home in jstoup111/ai-conductor#3445, whose spec (PR #3462) is merged on main and
awaiting build:

- **outcome-1** (no admission leaves an earlier open round unable to advance): #3445 Story 2's kind-aware
  admission fence, and Story 3's marker-first drain of a feature already holding two open rounds.
- **outcome-2** (preflight that cannot proceed always writes a named HALT): #3445 Story 4's bounded `mechanical`
  stall HALT naming every non-closed round, and #3446's preflight stop path.
- **outcome-4** (single-open-round features unchanged): #3445 keeps the single-round path as today. This spec
  changes no engine path, and its close refuses to act on the sole non-closed round.
