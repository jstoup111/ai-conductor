---
slug: unusable-provider-candidate-throws-instead-of-fall
spec_hash: f8488dea3ee94581bbd6c6ff803df823518b17ee636923ab611fa2ea3fdcc56c
pr: https://github.com/jstoup111/ai-conductor/pull/2538
shipped: 2026-09-14
engine_version: 20260914T134752Z-60233f3ba6d3
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-08-24-refused-step-status decision 1"
    outcome: remediated
    summary: "Rebase setup_stop writes a needs-human HALT but returns success without recording the environmental refusal as refused."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-09-10-shared-step-lifecycle-telemetry decision 4"
    outcome: remediated
    summary: "The generic serial success path reports rebase setup_stop as step_completed done before the tail emits its halt."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task 6"
    outcome: remediated
    summary: "One-shot attribution, complexity, and rebase consumers collapse or ignore setup-only exhaustion instead of preserving it to the owning step."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever decision 4"
    outcome: remediated
    summary: "CI-fix persists an internal needs-human bit with no operator-clearable marker or supported resume path."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "adr-2026-08-24-refused-step-status D1"
    outcome: remediated
    summary: "Setup-only environmental exhaustion closes the open step as `step_failed` instead of recording a typed refusal."
---

## Cost
input: 3331367
output: 460660
cache_read: 85266114
cache_creation: 1068078
cost_usd: 55.5379
dispatches: 42
retries: 10
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3331021, output: 317828, cache_read: 74039040, cache_creation: 0, cost_usd: 35.671, dispatches: 28, cost_unmetered: 0
  claude: input: 346, output: 142832, cache_read: 11227074, cache_creation: 1068078, cost_usd: 19.8668, dispatches: 14, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
skip_reasons:
