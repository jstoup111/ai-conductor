# Track: Plan task structure becomes one strict compiled contract, not drifting markdown regexes

Track: technical

Scope boundary: Full task contract — every machine-consumed per-task field (ids, titles,
dependency edges, declared paths, Done-when, story ids, verify-only, slices, bodies, digests)
comes from one plan compiler; every other task-heading regex in the engine is removed. New plans
(format-marked) compile under a strict closed grammar and are refused at land on violation;
unmarked legacy plans compile in a tolerant legacy mode with byte-identical outputs (including
task digests) to today's parsers, so in-flight builds and merged-unbuilt specs do not break.
Excluded: backfilling/rewriting committed plans, a committed JSON sidecar, and deleting the
legacy mode (a later, separate feature once no unshipped unmarked plans remain).

Internal engine machinery with no product-facing behavior; acceptance lives in stories.
Source: intake jstoup111/ai-conductor#623.
