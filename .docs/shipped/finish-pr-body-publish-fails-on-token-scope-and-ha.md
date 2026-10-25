---
slug: finish-pr-body-publish-fails-on-token-scope-and-ha
spec_hash: 6bc42c80c77ff17115e5c4ede8c92d928df51148088cb9c38d9f3623722c09eb
pr: https://github.com/jstoup111/ai-conductor/pull/3420
shipped: 2026-10-25
engine_version: 20261025T104004Z-5288497d86bd
---

## Cost
input: 2188005
output: 239897
cache_read: 51029998
cache_creation: 1339040
cost_usd: 38.5747
dispatches: 49
retries: 6
halts: 5
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2187849, output: 157034, cache_read: 45510784, cache_creation: 0, cost_usd: 25.1007, dispatches: 29, cost_unmetered: 0
  claude: input: 156, output: 82863, cache_read: 5519214, cache_creation: 1339040, cost_usd: 13.474, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 5
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 1, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:
  disabled: 5


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `64898260-84ca-4c3a-8997-6247202828cc` — source ids: `eventSpine:sha256:eaa3ae1a22824b95478be70bb57ad628ff77cb5131537b1895c7aaad9d0cd4bf`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->