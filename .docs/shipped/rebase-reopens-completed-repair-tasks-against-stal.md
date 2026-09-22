---
slug: rebase-reopens-completed-repair-tasks-against-stal
spec_hash: 5060489d6c75af0e466f10a7d727b32df519da9870a11794060ae13d9deb18b9
pr: https://github.com/jstoup111/ai-conductor/pull/2652
shipped: 2026-09-22
engine_version: 20260922T220754Z-95f2b12d2932
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-07-12-rebase-evidence-stamp-translation D8"
    outcome: remediated
    summary: "`rebase_citation_residue` omits `citingObligationIds` from the authoritative `ConductorEvent` schema."
---

## Cost
input: 1278332
output: 162309
cache_read: 27093509
cache_creation: 671451
cost_usd: 24.8285
dispatches: 28
retries: 0
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1278180, output: 99202, cache_read: 22881920, cache_creation: 0, cost_usd: 13.1119, dispatches: 16, cost_unmetered: 0
  claude: input: 152, output: 63107, cache_read: 4211589, cache_creation: 671451, cost_usd: 11.7166, dispatches: 12, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","59425b67-ce90-4f48-b7a0-41fccd743f3f","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","7d5febb3-9e20-4e69-b8c3-5dc28c493709","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","c524ff55-2a5b-4e37-9321-3b4ba65625d1","lifecycle-step","architecture_review_as_built"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
