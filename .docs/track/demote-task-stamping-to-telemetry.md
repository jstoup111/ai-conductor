# Track: Demote task-stamping from gate to telemetry (#773)

Track: technical

Internal harness machinery: rip out the per-task evidence-ledger GATING and replace the
per-task stamp completion authority with a single build-end LLM plan-completeness judgement
gate + the existing outcome gates. No user-facing product requirements; acceptance criteria
live directly in stories. No PRD.
