# Track: Engine-enforced whole-feature simplify before first build_review

Track: technical

Scope boundary: BUILD's handoff to `build_review` requires one whole-feature simplify record with a CLEAN verdict, once per feature or stacked child, enforced at the completion predicate and at the retries-exhausted escape; the retry hint and no-task-progress stall breaker recognize the miss; the `simplify` and `tdd` skills tell the builder the feature-level pass is required and share the implementationQuality kind definitions. Excluded: changing batch-boundary simplify, changing `build_review` rubrics or their verdicts, re-gating features whose `build_review` already ran, and any per-batch record enforcement.

Engine-internal BUILD routing with no operator-facing product surface; acceptance criteria live in stories.
