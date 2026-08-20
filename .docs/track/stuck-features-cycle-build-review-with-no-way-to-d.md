# Track: Stuck features cycle build_review with no way to disposition a finding

Track: product

Scope boundary: Improve `build_review` only, across all rubric items. Replace the single inline
grader with engine-managed rubric fan-out behind the existing public gate; give each rubric an
independent, default-enabled policy for model and fallback/retry ladders; default the fan-out ceiling
to five concurrent rubric sessions; add a local CLI as the only disposition input; and preserve
accepted findings in PR and shipped-record output. Other semantic gates, GitHub command ingestion,
and implementation/build work are excluded.

This is product work because operators gain a new CLI capability, configurable review behavior,
accepted-risk visibility, and reportable quality metrics.
