---
slug: preserve-self-build-provider-transcripts-on-failed
spec_hash: 643488b30067c82f9101af766c54c6acf94a73e03394836b62e2b1d2e1282f6c
pr: https://github.com/jstoup111/ai-conductor/pull/3242
shipped: 2026-10-20
engine_version: 20261019T223530Z-89c498bda849
---

## Cost
input: 11600485
output: 1244770
cache_read: 214062800
cache_creation: 9546286
cost_usd: 199.2327
dispatches: 248
retries: 15
halts: 29
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 11599597, output: 717475, cache_read: 181247232, cache_creation: 0, cost_usd: 105.7498, dispatches: 120, cost_unmetered: 0
  claude: input: 888, output: 527295, cache_read: 32815568, cache_creation: 9546286, cost_usd: 93.4829, dispatches: 128, cost_unmetered: 0

## Time
state: partial
reason: provider-outside-active-union

## Build Review
laps_to_pass: 2
skipped: 6
cache_hits: 12
infrastructure_failures: 7
rubrics:
  eventSpine: failures: 7, judged: 23
  implementationQuality: failures: 29, judged: 30
  security: failures: 0, judged: 40
  testQuality: failures: 2, judged: 40
skip_reasons:
  disabled: 6


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 3

- Finding: `sha256:05b510bbf2a69b565a07169b0b01d8e732b835dc54539b5029d130f872bdfd31` — rubric: implementationQuality
- Finding: `sha256:aed854eafd2e0914df24e687c44480b5ba9df4591c09589b6e32733fb37074ec` — rubric: implementationQuality
- Finding: `sha256:f2750b60497cfd4a0537bc5f27a95c7d523d26483d054c410b478ac05a23a9fd` — rubric: implementationQuality

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->