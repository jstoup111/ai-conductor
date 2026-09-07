---
slug: refuse-daemon-auto-resume-of-an-operator-action-ha
spec_hash: 8cb6a2a66727778ebd0defe8711b15ef55f60e87c94fff16dbe41a2e77459c95
pr: https://github.com/jstoup111/ai-conductor/pull/2398
shipped: 2026-09-07
engine_version: 20260907T025756Z-de24783f71d8
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-07-28-total-halt-classification-legacy-boundary D2"
    outcome: remediated
    summary: "Both new read-side consumers auto-resume `legacy` HALTs without the required explicit compatibility log annotation."
---

## Cost
input: 705313
output: 91732
cache_read: 19428609
cache_creation: 435145
cost_usd: 14.3563
dispatches: 19
retries: 1
halts: 0
unmetered: count: 6, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 705209, output: 53467, cache_read: 15479040, cache_creation: 0, cost_usd: 6.7133, dispatches: 8, cost_unmetered: 0
  claude: input: 104, output: 38265, cache_read: 3949569, cache_creation: 435145, cost_usd: 7.643, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
