# Track: Gate kickback counter resets every dispatch, so no-progress cycles never terminate

Track: technical

Issue: jstoup111/ai-conductor#984

Internal conductor-engine correctness fix: the anti-ping-pong kickback bound and the #647 D2
no-op-escalation baseline are both run-local state, so neither survives a daemon re-dispatch, the
progress witness is falsifiable by an empty commit, and `wiring_check` bypasses D2 entirely. No
user-facing product capability and no new operator-facing requirements — acceptance criteria live
directly in the stories, so no PRD is authored.

## Selected approach (operator-confirmed)

**A — Persist + retree the existing D2 ledgers, and wire `wiring_check` in.** Move `kickbackCounts`
and `kickbackToBuildContext` into a per-feature `.pipeline/` JSON ledger; change the progress
witness from the HEAD commit sha to the HEAD tree hash; add the D2 capture/check pair to the
`wiring_check` self-heal block.

### Rejected alternatives

- **B — Generalized progress witness** (replace the per-gate counters with a monotone-change
  witness across every gate). Rejected as the wrong size for this defect: it redesigns the
  settled anti-ping-pong seam and carries regression risk across all gates, when the filed
  outcomes are reachable by making already-reviewed machinery durable and tree-keyed. The
  underlying idea is sound and is recorded as a possible future consolidation, not this change.
- **C — Minimal blindspot fix** (tree hash + wire `wiring_check`, ledgers stay run-local).
  Rejected because it does not satisfy the issue's primary desired outcome — the limit must hold
  across daemon re-dispatches, not only within a single conductor run. It would leave the filed
  livelock reachable over enough laps.
