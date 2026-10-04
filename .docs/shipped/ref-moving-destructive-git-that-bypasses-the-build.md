---
slug: ref-moving-destructive-git-that-bypasses-the-build
spec_hash: def3b850e4fa936d1fa7519065fc9d79d435ef37e8b77509ebd7b017b441fbd5
pr: https://github.com/jstoup111/ai-conductor/pull/2969
shipped: 2026-10-04
engine_version: 20261004T114847Z-0e5c5e599a67
findings:
  - gate: architecture_review_as_built
    finding: AR-AB-003
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 15"
    outcome: remediated
    summary: "Verified 99%: D15 remains violated at all six engine-operation proof sites. src/conductor/test/engine/ref-hooks-engine-unaffected.test.ts:43, :45, :58, :65, :72, and :75 use makeGitRunner, which invokes bare `git` with ambient PATH and, for these calls, ambient HOME at src/conductor/src/engine/rebase.ts:123-128. They bypass the fixture's absolute-real-git and empty-HOME adapter at ref-hooks-engine-unaffected.test.ts:22-25. AR-AB-001 and AR-AB-002 are resolved; no new ADR or diagram violation was found."
  - gate: architecture_review_as_built
    finding: AR-AB-001
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 11"
    outcome: remediated
    summary: "Verified 100%: both prepared-stage chaining sites discard the repository hook's status. src/conductor/src/engine/git-hook-assets.ts:234-236 and :269-271 invoke the chained hook and then unconditionally exit 0, contrary to D11's requirement to return its status."
  - gate: architecture_review_as_built
    finding: AR-AB-002
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 12"
    outcome: remediated
    summary: "Verified 98%: the reference-transaction fast paths execute git subprocesses. src/conductor/src/engine/git-hook-assets.ts:205-206 calls git for every non-prepared stage, while :212-213 calls git before determining whether a prepared transaction contains a branch deletion. D12 requires every other stage and line to pass with no git call."
---

## Cost
input: 2372580
output: 314040
cache_read: 40886046
cache_creation: 1638673
cost_usd: 36.4281
dispatches: 64
retries: 5
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2372198, output: 158321, cache_read: 32168192, cache_creation: 0, cost_usd: 17.6977, dispatches: 27, cost_unmetered: 0
  claude: input: 382, output: 155719, cache_read: 8717854, cache_creation: 1638673, cost_usd: 18.7304, dispatches: 37, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","22f6637d-a992-475f-a99b-c724e9a45ff8","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","97b5e7ee-dd2f-4e15-af77-53db858eac2f","lifecycle-step","finish"]

## Build Review
laps_to_pass: 8
skipped: 0
cache_hits: 5
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 9
  security: failures: 0, judged: 9
  testQuality: failures: 8, judged: 9
skip_reasons:
