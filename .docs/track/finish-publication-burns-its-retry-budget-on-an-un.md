# Track: FINISH publication burns its retry budget on an unreachable transition

Track: technical

Scope boundary: Balanced — make non-advancing publication retries structurally impossible at the
FINISH publication coordinator (observation fixed-point guard), plus a deterministic halt-PR
short-circuit so a `needs-remediation` PR resolves human-required before any judgment is
dispatched. Excluded: collapsing the judge verdict vocabulary and the observer's prose
classification into one shared domain model (the comprehensive option), and any change to the
retry-budget or progress-allowance constants themselves.

Engine-internal correctness fix to `finish-publication.ts` / `finish-publication-production.ts`;
no user-facing product capability, so acceptance criteria live directly in stories.
