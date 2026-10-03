---
slug: fence-ship-validator-verdict-artifacts-from-build-
spec_hash: dfc88f4dc121a1d7b72fc9ee9db9987441659505110cedffaa421dc512a88ba3
pr: https://github.com/jstoup111/ai-conductor/pull/2908
shipped: 2026-10-03
engine_version: 20261002T011715Z-89506a82fed2
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "skills/pipeline/SKILL.md:262-263, skills/tdd/SKILL.md:40-41, test/test_skill_pipeline_contract.sh:128 — a sixth path, `.pipeline/prd-audit.json`, is fenced beyond the plan's five-artifact list"
    accepted: true
---

## Cost
input: 662250
output: 66641
cache_read: 8937233
cache_creation: 351661
cost_usd: 8.6663
dispatches: 19
retries: 0
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 662144, output: 40585, cache_read: 6943104, cache_creation: 0, cost_usd: 5.0177, dispatches: 9, cost_unmetered: 0
  claude: input: 106, output: 26056, cache_read: 1994129, cache_creation: 351661, cost_usd: 3.6487, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","fcf9dbf3-30eb-43cf-8357-9ed69fd9a68d","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
