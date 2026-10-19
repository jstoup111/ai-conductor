---
slug: a-routed-fix-cannot-be-built-charged-and-reviewed-
spec_hash: a07aa66bc3f8ed5fc762cff9c18bf7385c165f0ff3251d98e034e9d8ac88f307
pr: https://github.com/jstoup111/ai-conductor/pull/3285
shipped: 2026-10-19
engine_version: 20261018T130307Z-2917a81aaac0
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Neither edit is planned. Both align test fixtures with existing configuration or confine temporary files; no shipped behavior changes."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "Unplanned refactor, needed because the git guard now reaches routing state. Dispatch behavior is unchanged."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "Not called out in the plan, but these changes make routed and flat settlement fail closed and keep progress evidence durable. Not user-visible."
    accepted: false
    authority: engine
---

## Cost
input: 20119396
output: 2400402
cache_read: 426757908
cache_creation: 17609937
cost_usd: 350.7079
dispatches: 349
retries: 34
halts: 37
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 20118178, output: 1325002, cache_read: 350602624, cache_creation: 0, cost_usd: 173.0844, dispatches: 166, cost_unmetered: 0
  claude: input: 1218, output: 1075400, cache_read: 76155284, cache_creation: 17609937, cost_usd: 177.6234, dispatches: 183, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","6c757752-837a-4ba2-9e0a-65633aa5c194","lifecycle-step","finish"]

## Build Review
laps_to_pass: 22
skipped: 2
cache_hits: 12
infrastructure_failures: 11
rubrics:
  eventSpine: failures: 10, judged: 16
  implementationQuality: failures: 55, judged: 56
  security: failures: 1, judged: 59
  testQuality: failures: 5, judged: 58
skip_reasons:
  disabled: 2


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 21

- Finding: `sha256:00a5592768d00434a5ad143423e9a1ddc6ef80260a4586862b4253fc152444f2` — rubric: implementationQuality
- Finding: `sha256:084772088eb84a87aa8260445e4d0364ff2c1cc268ab84ba1fde4c32fbee35e4` — rubric: implementationQuality
- Finding: `sha256:091c64d5b1694c3a1840061095ae262c0b1b97e22a19cb7efa7cfec8f99e0230` — rubric: implementationQuality
- Finding: `sha256:35a039574b5d1db6cb6ba8219248c90d7669aa07c5ce1da262ddbd3ee63af103` — rubric: implementationQuality
- Finding: `sha256:51d2abe81f75d4439965b50cd593263b7f0713c561f4fea68f5dfda832f82a5d` — rubric: eventSpine
- Finding: `sha256:66b504d3b0c710681f2fa682611a98b428fb58b2d8e4659a62c4b3ec89f25b0c` — rubric: eventSpine
- Finding: `sha256:67877c17bc3ec44e4b719747b2e7d78e20bd2648d6e322cf8d4b6e2d53e9b4bf` — rubric: implementationQuality
- Finding: `sha256:815a838082ab1e204cdf1a1e4075e9ac382cb563cf597516fb32259a7cb15e8c` — rubric: implementationQuality
- Finding: `sha256:85fb1066aa043ecef796405a994748d2cb15fb0dedc6b608d913d7d3578d3665` — rubric: implementationQuality
- Finding: `sha256:a148908b2fc9efea57822524d665bcda11047358f7305a1c0e4c89bf3af3aa43` — rubric: implementationQuality
- Finding: `sha256:a68aee6afc7705c4c952c517ef97245b951c3f98de518b448a5b15fdec2a9264` — rubric: implementationQuality
- Finding: `sha256:ae292657ba4d8920f0703cd84fe6378dabd36e52b541951f3a91af9a7c78ca83` — rubric: eventSpine
- Finding: `sha256:b7021da07c486c1a57111c32e0e28f12c697f85ab6ca2915dced86e80378e098` — rubric: implementationQuality
- Finding: `sha256:c7b9b20857076801532933658cbd629bb674576073b424c0fbb41f42430df04f` — rubric: implementationQuality
- Finding: `sha256:cfab3f2cebf95acf3508f227db518323264991af98b462dbb4cf4d5593ab4266` — rubric: implementationQuality
- Finding: `sha256:d696acee9c920ae2bd6c639d28d00e0a5c45be66f8a9b9826f35d81f69ecf644` — rubric: eventSpine
- Finding: `sha256:dd69e9754ac3b565c42a1e9c56539ca88975e48becc8ea03c8918c9a746c5d29` — rubric: implementationQuality
- Finding: `sha256:ddefb256c8c518cb6dd1c67c5b32f2d27f1c722f1f7048ab89244b040692df7b` — rubric: eventSpine
- Finding: `sha256:f006bbd908a17a85b19f23597857e09e4bf0a19d8df4a0546fee3dd95b75c134` — rubric: implementationQuality
- Finding: `sha256:f865a5c26853011e92850884d780c96ef5abcedc926b281ea1a982f39d6635c9` — rubric: eventSpine
- Finding: `sha256:fa3bde84851e6e11776407d3f435595f01155c6a00fde3b1a0d7fa9df282d7a1` — rubric: eventSpine

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->