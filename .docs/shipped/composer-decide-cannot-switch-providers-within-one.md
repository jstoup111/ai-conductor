---
slug: composer-decide-cannot-switch-providers-within-one
spec_hash: e0bcf488d2315f93b879fb4f2f0de491aa8288079db9934b59da5655231e0e35
pr: https://github.com/jstoup111/ai-conductor/pull/3669
shipped: 2026-11-22
engine_version: 20261122T020604Z-3379a47ff8d4
---

## Cost
input: 14934827
output: 1587309
cache_read: 241593132
cache_creation: 7935776
cost_usd: 183.7966
dispatches: 3123
retries: 40
halts: 17
unmetered: count: 2917, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 14934309, output: 981984, cache_read: 212456448, cache_creation: 0, cost_usd: 102.3744, dispatches: 3052, cost_unmetered: 0
  claude: input: 518, output: 605325, cache_read: 29136684, cache_creation: 7935776, cost_usd: 81.4221, dispatches: 71, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","82f6ffb8-03fd-40c8-b385-3060d6428c84","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","ba698f72-bc36-43da-b8cd-31d2d7276de2","lifecycle-step","build_review"]

## Build Review
laps_to_pass: 2
skipped: 15
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 1, judged: 18
  implementationQuality: failures: 13, judged: 18
  security: failures: 0, judged: 18
  testQuality: failures: 0, judged: 18
skip_reasons:
  paths-unmatched: 15


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:c6e25f934968a488dc5f789e534f4a0fbfef5b985f8e58cc31ae3ac991e79ba6` — rubric: implementationQuality

- Operator-resolved case: `7ea973bb-a20d-4494-9584-96be0f23c375` — source ids: `implementationQuality:sha256:bf86922d7f49fb58f0a7ab4dafa2b2a3b8cb4df42255cf15db7afc6c1764532d`, `implementationQuality:sha256:8faee93f16143facba317f6195fa757ee3bb634b33d21bf748328f6cc2a66651`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->