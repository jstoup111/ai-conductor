# Track: coherence-rows-assert-story-task-coverage-that-not

Track: technical

Scope boundary: All three defects named in jstoup111/ai-conductor#1799 — (1) coherence rows
claiming story→task coverage that the plan text does not support, (2) accepted story criteria owned
by no task, surfacing at `acceptance_specs` instead of DECIDE, and (3) completion criteria pinned to
state outside the feature's own diff. Subsumes jstoup111/ai-conductor#1744 (accepted stories never
checked against the engine's own criterion extractor); the spec records the subsumption so #1744 can
be closed as covered when this ships. Excludes re-judging whether the feature satisfies its criteria
(owned by `prd_audit`, adr-2026-08-22-one-owner-per-review-question).

Internal harness validation machinery with no product-facing capability; acceptance criteria live
directly in stories, matching the #1740 coherence work's own track choice.
