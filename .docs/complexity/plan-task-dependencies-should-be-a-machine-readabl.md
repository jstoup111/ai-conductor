# Complexity: Plan task structure becomes one strict compiled contract

Tier: L

## Rationale

- Cross-cutting engine change: ~51 plan-parser call sites across ~33 engine files, plus at least
  six stray task-heading regexes (`remediation-task-append.ts`, `coherence-validator.ts`,
  `conductor.ts`, `attribution-inputs.ts`, `autoheal.ts`, the protected-artifact seal), and 17
  test files, all migrate onto one compiler.
- A new contract with two modes (strict for format-marked plans, tolerant legacy for unmarked
  plans) whose legacy outputs — including task digests that drive the #2929 reopen flow — must
  stay identical to today's parsers, or in-flight builds reopen finished tasks.
- Touches several safety-critical surfaces: spec land refusal, daemon discovery vetting of merged
  specs, the `.docs/plans` protected-artifact seal's remediation-append exception, build
  completion/evidence/park, and the shipped `/plan` skill authoring contract (consumer-facing).
- Expected ~15-20 tasks; a sliced/stacked plan is likely.

Per tier rules: architecture-diagram, full architecture-review, conflict-check, and
coherence-check are all required.
