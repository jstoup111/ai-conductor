---
slug: finish-author-pr-prose-halts-unmoved-provider-has-
spec_hash: 98cd101e6977679dd9c8b6b79848695242bc2f18184bb5c2da01392e9cc69148
pr: https://github.com/jstoup111/ai-conductor/pull/3573
shipped: 2026-11-02
engine_version: 20261101T162011Z-b317a8dbaaa5
---

## Cost
input: 3984192
output: 400628
cache_read: 67832974
cache_creation: 2286399
cost_usd: 53.1136
dispatches: 77
retries: 12
halts: 3
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 13
providers:
  codex: input: 3984000, output: 221831, cache_read: 59024512, cache_creation: 0, cost_usd: 29.484, dispatches: 54, cost_unmetered: 13
  claude: input: 192, output: 178797, cache_read: 8808462, cache_creation: 2286399, cost_usd: 23.6296, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 6
rubrics:
  eventSpine: failures: 2, judged: 4
  implementationQuality: failures: 2, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `a11be1be-da05-48d3-a3e6-b6b3a45e9d55` — source ids: `eventSpine:sha256:56d58edd2446f4376fdb716b18ae459c4daa60478341d8214471521ed2ab6a7d`, `eventSpine:sha256:bba45de4d71e02022db106beb2a0eba6eaa323c36a532c68bbc2ae86f67d26fa`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->