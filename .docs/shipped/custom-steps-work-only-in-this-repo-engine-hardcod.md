---
slug: custom-steps-work-only-in-this-repo-engine-hardcod
spec_hash: f97cb380cc0fc99f6e9c6e5d912e4cb4c16f62278b6306acd0a570ecbb6991f6
pr: https://github.com/jstoup111/ai-conductor/pull/2653
shipped: 2026-09-23
engine_version: 20260922T220754Z-95f2b12d2932
---

## Cost
input: 2396323
output: 323250
cache_read: 65667548
cache_creation: 1163838
cost_usd: 43.8441
dispatches: 47
retries: 4
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2396125, output: 228898, cache_read: 59863552, cache_creation: 0, cost_usd: 23.8058, dispatches: 29, cost_unmetered: 0
  claude: input: 198, output: 94352, cache_read: 5803996, cache_creation: 1163838, cost_usd: 20.0382, dispatches: 18, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","0481f60b-e6ae-429c-808c-0537de052355","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","6a97d7f8-72d4-4a5b-9631-7d12b15a6a75","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","83370572-2b1a-40bf-b6c5-3a615f8baacd","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","89a2444b-5d9b-4181-9150-44f531c313b3","lifecycle-step","architecture_review_as_built"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 5
  testQuality: failures: 1, judged: 5
skip_reasons:
