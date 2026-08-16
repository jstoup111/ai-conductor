---
slug: rubric-cache-identity-is-sha-anchored-so-a-rebase-
spec_hash: 915998db1ce59f1bb22c2190443f11054308cb35e62eb76f3c4eb7372be0f265
pr: https://github.com/jstoup111/ai-conductor/pull/1601
shipped: 2026-08-15
engine_version: 20260815T212431Z-a350c09d818d
---

## Cost
input: 64879850
output: 707740
cache_read: 107409127
cache_creation: 3474959
cost_usd: 69.2909
dispatches: 108
retries: 25
halts: 0
unmetered: count: 18, duration_ms: 0
cost_unmetered: count: 56
providers:
  codex: input: 64878888, output: 260921, cache_read: 60677120, cache_creation: 0, cost_usd: 0, dispatches: 56, cost_unmetered: 56
  claude: input: 962, output: 446819, cache_read: 46732007, cache_creation: 3474959, cost_usd: 69.2909, dispatches: 37, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 7
skipped: 0
cache_hits: 79
infrastructure_failures: 13
rubrics:
  completeness: failures: 4, judged: 28
  rootCause: failures: 14, judged: 30
  scope: failures: 13, judged: 35
  tautology: failures: 17, judged: 34
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Three scope findings were operator-accepted at ship (finding ids:
`sha256:1d88051a…`, `sha256:9a9463e2…`, `sha256:a7075dbd…`, plus two
superseded keyings). Full summaries, rationales, and acceptance metadata are
retained in the feature's local build-review disposition store, not published
here.
<!-- build-review-accepted-risk:end -->