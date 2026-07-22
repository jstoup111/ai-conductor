# Track: build-auth-token-check-and-classify

Track: product

Operator-facing capability with enumerable functional requirements — build-token state
reporting in `bin/install --check`, correct classification of invalid-token (401) failures,
and actionable missing-token messaging. Operator-confirmed product track (PRD authored).
Intake: jstoup111/ai-conductor#498. Approach B (check-and-classify) chosen over the guided
setup flow (A) and runtime-first self-healing (C).
