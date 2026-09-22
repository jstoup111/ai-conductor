---
slug: enforce-ownership-across-all-harness-github-operat
spec_hash: 6007a45db04f0922ea119d269034c5fd21c195cc8cff1d29dcaaab03e9fa8b57
pr: https://github.com/jstoup111/ai-conductor/pull/2541
shipped: 2026-09-22
engine_version: 20260922T121502Z-831f81942f9f
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "`src/conductor/src/engine/github-invocation-audit-cli.ts:23-56` adds a documented `github-boundary-audit` subcommand (`docs/reference/cli.md:1160`, wired at `src/conductor/src/index.ts:896`). No plan task lists this CLI entry in its Files or Done-when"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-09-11-github-operation-ownership D1"
    outcome: remediated
    summary: "Shipment-audit GraphQL reads invoke the raw injected GitHub runner instead of entering the typed GitHub operation interface."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-09-11-github-operation-ownership D7"
    outcome: remediated
    summary: "The production-boundary audit omits the shipped scripts runtime directory."
---

## Cost
input: 10783315
output: 2120459
cache_read: 692503056
cache_creation: 16788966
cost_usd: 522.3603
dispatches: 167
retries: 15
halts: 14
unmetered: count: 27, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10780849, output: 1050341, cache_read: 320023040, cache_creation: 0, cost_usd: 115.479, dispatches: 81, cost_unmetered: 0
  claude: input: 2466, output: 1070118, cache_read: 372480016, cache_creation: 16788966, cost_usd: 406.8814, dispatches: 86, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:build_review,step:execution\u0000["timing-rollup","persisted-ledger","27f0134d-63e8-42e6-9a0a-8d6856da35d8","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","74a1020f-0fba-42be-817e-62f780f0836d","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","c1003e56-4500-4e4a-a6f3-53bffc800015","lifecycle-step","build"],step:execution\u0000["timing-rollup","persisted-ledger","cad1f438-4d84-4836-9870-735b416fadb0","lifecycle-step","test_suite"]

## Build Review
laps_to_pass: 3
skipped: 3
cache_hits: 0
infrastructure_failures: 9
rubrics:
  security: failures: 6, judged: 12
  testQuality: failures: 1, judged: 14
skip_reasons:
  disabled: 3
