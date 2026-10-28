# Complexity: Remove the coverage_binding step so stacked features resolve their children from the sealed plan

Tier: L

## Rationale

- Removes a whole lifecycle step: registry entry, gate predicate, rebase coverage refresh and clamp,
  gate-invalidation surface, code-stamp identity, retries and review defaults, model policy and
  generated model table rows, eight event variants and their sink declarations, and the
  `coverage-binding-envelope`, `-void`, and `-decide-set` engine modules.
- Re-sources about fifteen production readers across the child cursor, child lifecycle, task
  progress, task membership check, task CLI, acceptance evidence, finish publication, routing,
  dashboard, and observe surfaces from the envelope to one plan-derived slice topology.
- Touches a durable state machine (stacked child cursor, positions ref, child-region state) and
  moves its position-immutability guard from the step to `reseal`.
- Backward-compatibility handling for retired configuration keys and leftover persisted state, so
  in-flight feature branches keep loading.
- About 156 test files reference the step, including N=1 golden fixtures that must stay
  byte-identical apart from the removed step.
- Supersedes `adr-2026-08-31-coverage-binding-judge-step` and amends several approved ADRs that
  name the envelope as the source of child positions and ownership.
- Estimated about 18–22 plan tasks: under the 30-task land ceiling, so one spec. The operator
  delegated the remaining design calls (2026-10-23). No skill directory is deleted, because
  `skills/coverage-binding/` stays as the plan-time judge policy, so the two-feature deletion rule
  does not apply.

Per tier rules: architecture-diagram, full architecture-review, conflict-check, and coherence-check
apply; no PRD (technical track).
