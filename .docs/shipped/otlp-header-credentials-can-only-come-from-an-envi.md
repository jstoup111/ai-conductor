---
slug: otlp-header-credentials-can-only-come-from-an-envi
spec_hash: 24f2169e04325e0736b4312ac5b4e08941bceb0efbfa16081097f642eff0ab7a
pr: https://github.com/jstoup111/ai-conductor/pull/3531
shipped: 2026-10-29
engine_version: 20261029T135834Z-54bb2b838304
findings:
  - gate: architecture_review_as_built
    finding: "as-built:822d3823-8e16-4b50-ba76-fc9fc1629a5d:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-28-shared-credential-reference-resolver decision 2"
    outcome: remediated
    summary: "src/conductor/src/engine/credentials/command-source.ts:85 uses stdout.trim(), removing leading whitespace as well as trailing whitespace. D2 requires trailing-whitespace trimming before prefixing. Preserve leading whitespace. Confidence: 99%, verified source."
  - gate: architecture_review_as_built
    finding: "as-built:822d3823-8e16-4b50-ba76-fc9fc1629a5d:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-28-shared-credential-reference-resolver decision 5"
    outcome: remediated
    summary: "src/conductor/src/engine/otel/otel-header-provider.ts:30 creates a plain object and :34 assigns headers[header]. An accepted __proto__ header invokes the inherited setter instead of becoming an own property, silently omitting that configured header from both spool and direct requests. D5 requires every configured header before sending. Use a record construction that preserves arbitrary own keys. Confidence: 99%, verified source."
---

## Cost
input: 1828306
output: 176488
cache_read: 31550195
cache_creation: 675128
cost_usd: 19.9193
dispatches: 36
retries: 6
halts: 0
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 5
providers:
  codex: input: 1828186, output: 120306, cache_read: 28294528, cache_creation: 0, cost_usd: 12.7431, dispatches: 25, cost_unmetered: 5
  claude: input: 120, output: 56182, cache_read: 3255667, cache_creation: 675128, cost_usd: 7.1763, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","18fd51b9-a17e-47ae-9abf-948a7df45d75","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  implementationQuality: failures: 1, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 1, judged: 3
skip_reasons:
