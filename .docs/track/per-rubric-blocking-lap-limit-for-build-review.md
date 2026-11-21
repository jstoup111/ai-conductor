# Track: Per-rubric blocking-lap limit for build_review

Track: technical

Scope boundary: a per-rubric `max_blocking_laps` key for built-in and custom build_review rubrics; an engine default of 2 for `implementationQuality` and unlimited for every other rubric; `0` meaning unlimited; demotion of a lap-limited rubric's otherwise-unresolved findings to the existing advisory bucket before adjudication; a durable per-rubric blocking-lap count in `.pipeline/engine-state.json`; the demotion reported on `build_review_outer_verdict`, the daemon log, and `build-review findings`; and this repository's `testQuality.max_blocking_laps: 3`. Excluded: changes to severity grading, confidence floors, the remediate judgement, kickback budgets, the recurrence lineage limit, case-store schema, and the PR-body advisory region.

Engine-internal review-gate behavior with no product surface beyond configuration; acceptance criteria live in stories. Operator-directed (direct PR, no intake issue); the operator decided "default 2, but configurable" for implementationQuality.
