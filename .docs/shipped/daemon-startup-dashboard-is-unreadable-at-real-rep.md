---
slug: daemon-startup-dashboard-is-unreadable-at-real-rep
spec_hash: 28fed11b42f9719cb08fd46517bfb1d6c6d46ab5a4ea3dc169267d60c722e7e7
pr: https://github.com/jstoup111/ai-conductor/pull/3440
shipped: 2026-10-26
engine_version: 20261026T134330Z-de66138a044b
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is unplanned dead code, about 170 lines. It changes no output, but it leaves a misleading second copy of the precedence logic in the production module. The plan intent is one renderer with two modes, so the old copy should be deleted."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This is an unplanned behavior change to parked-feature reconciliation. It feeds the 'parked need review' count. It is consistent with intent, because a parked spec that discovery still sees is not an orphan, and without it the new blocked partition would inflate review counts."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:5df9cbdf-8230-407b-be8f-7428086790bd:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-07-03-owner-gate-gated-channel decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: D3's unchanged exactly-one-bucket invariant is violated at src/conductor/src/engine/daemon-dashboard.ts:1159, where retained entries exclude neither IN-PROGRESS overlaps, and :1170, where processed entries exclude neither HALTED nor IN-PROGRESS overlaps. Full rendering with completed rows can list a spec twice. HALTED+PROCESSED is production-realizable: the scanner loads processed entries at :726 and handles HALT at :790–792 before processed-state handling at :798."
---

## Cost
input: 1818852
output: 192528
cache_read: 33229996
cache_creation: 756728
cost_usd: 24.0445
dispatches: 31
retries: 5
halts: 1
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1818726, output: 112002, cache_read: 28190720, cache_creation: 0, cost_usd: 15.3718, dispatches: 20, cost_unmetered: 0
  claude: input: 126, output: 80526, cache_read: 5039276, cache_creation: 756728, cost_usd: 8.6727, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","4d184202-4abc-4bd0-8bbf-60d6ddaba952","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
