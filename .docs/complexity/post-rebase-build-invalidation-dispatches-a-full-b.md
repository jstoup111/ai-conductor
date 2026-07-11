# Complexity: post-rebase gate-first re-verify (issue #420)

Tier: M

## Rationale

- **State-machine change in the gate loop's invalidation path** — `applyRebaseVerdicts` gains a
  mechanical pre-verify before writing kickback verdicts; ordering and fail-closed semantics must
  be preserved (medium signal).
- **No new models, integrations, auth, or schema** — pure engine control-flow + events (keeps it
  out of L).
- **Integration-test surface is real but bounded** — `test/integration/rebase-loop.test.ts`
  encodes today's behavior (`buildRuns === 2`) and must be inverted plus extended with the
  genuinely-pending-work case; unit tests on `applyRebaseVerdicts` targets (keeps it out of S).
- **Oscillation hazard** (review-kickback rework must never be short-circuited) requires an
  explicit negative-path story — design care beyond a Small fix.

Story count estimate: 3–5. Architecture-review: lightweight (M).
