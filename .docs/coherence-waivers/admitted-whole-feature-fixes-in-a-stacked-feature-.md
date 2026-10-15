Waives: outcome-2, outcome-4

Rationale: jstoup111/ai-conductor#3210 is spec B of the four-spec delivery of
`adr-2026-10-12-routed-whole-feature-repair` (decision 18), split by operator decision on
2026-10-12, with the routing setting off until #3212 ships. In this DECIDE pass (2026-10-14) the
operator confirmed a self-contained scope for this spec and moved the parts that need #3211's
machinery to #3211. No part of either outcome is dropped; each has a named home:

- **outcome-2** (admitted work goes to its owning child): task-bound work, ADR-decision-only
  findings and refusal rework are delivered here by Stories 2 and 3. Routing a standalone or
  FAIL-only `manual_test` FAIL and a post-region custom-step kickback needs #3211's taskless
  admission charging, so it is delivered by jstoup111/ai-conductor#3211.
- **outcome-4** (recorded first; a crash at any point recovers): recording the round and the marker
  before any change, the routing events, and crash recovery of admission are delivered here by
  Stories 5, 6 and 7. The fallback chain written by a verified reroute, and crash recovery of host
  region entry, settlement and the reroute, are delivered by jstoup111/ai-conductor#3211; crash
  recovery of the routed exit and re-validation by jstoup111/ai-conductor#3212.
