---
slug: nothing-proves-a-faithful-fake-still-matches-its-r
spec_hash: af5ade76de63a21e6fde05e869b4e743372c02790f497fec3ff838d00278253b
pr: https://github.com/jstoup111/ai-conductor/pull/3680
shipped: 2026-11-09
engine_version: 20261109T141237Z-60702f2beb31
findings:
  - gate: architecture_review_as_built
    finding: "as-built:67b681d3-c624-476a-8479-20c3c7526f9a:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 7"
    outcome: remediated
    summary: "Verified, 95% confidence: src/conductor/test/structural/boundary-contract-obligation.test.ts:73 unconditionally reads every registered path before invoking the checker at line 94. A missing contract, fake, fake-leg, or real-leg file therefore throws ENOENT without the boundary and violated rule required by D7. This also prevents collecting subsequent violations. Preserve missing paths as absent map entries so the checker produces its missing-file diagnostics."
---

## Cost
input: 1614110
output: 136025
cache_read: 24362278
cache_creation: 691944
cost_usd: 17.8965
dispatches: 38
retries: 4
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1613990, output: 85343, cache_read: 21306240, cache_creation: 0, cost_usd: 10.7356, dispatches: 25, cost_unmetered: 0
  claude: input: 120, output: 50682, cache_read: 3056038, cache_creation: 691944, cost_usd: 7.1609, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","1e69c9ca-8867-4570-a38c-a068c75ab355","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  implementationQuality: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 2, judged: 3
skip_reasons:
  paths-unmatched: 3
