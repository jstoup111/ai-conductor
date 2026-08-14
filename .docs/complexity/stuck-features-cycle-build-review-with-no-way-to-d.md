# Complexity: Stuck features cycle build_review with no way to disposition a finding

Tier: L

## Rationale

This change crosses several load-bearing engine boundaries: five concurrent model-judged rubric
branches with independent provider-native model and fallback/retry policies; a capped join whose
default ceiling is five sessions; new shipped skill contracts and model-table registration; a
versioned structured-finding identity and operator-disposition state machine; a new authorized CLI
write path; event-spine extensions and aggregate metrics; and accepted-risk propagation into PR and
shipped-record evidence.

Compatibility also matters across legacy verdicts, existing `build_review.enabled` behavior,
provider fallback, daemon re-dispatch, worktree-local state, and per-rubric disablement. The likely
story set spans configuration, concurrency, grading, identity, authorization, routing, reporting,
shipment, and negative/race paths, which exceeds Medium scope.
