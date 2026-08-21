# Track: cached-rubric-verdicts-survive-an-engine-change-so

Track: technical

Scope boundary: Minimal fix plus observability — admit an engine identity (engine version id AND per-rubric skill-text digest) into the build_review cache identity so a changed engine or rubric misses; a discard is logged naming the rubric and which identity mismatched. Out of scope: an operator cache-clear command, daemon-rollover bulk clearing, dashboard/KPI surfacing.

Engine cache correctness with no product-facing behavior; acceptance criteria live in stories.
