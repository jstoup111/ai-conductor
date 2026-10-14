---
slug: whole-feature-audit-fixes-cannot-land-in-the-stack
spec_hash: 230def3879f3d531531af794282eb00f57e46e53331a9237c50b2b277f29415d
pr: https://github.com/jstoup111/ai-conductor/pull/3219
shipped: 2026-10-14
engine_version: 20261013T232617Z-b88e1a809619
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "These edits change no production behavior. They split real-git scenarios and adapt one assertion to the argv shim. One effect is a narrower assertion: accumulation of repeated alternating cascade charges across several applied repairs is no longer exercised. No decision on this rescoping appears in the supplied history, so it remains an open, harmless widening."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:77070691-a42f-4abe-9b72-9ba12c0c8b0d:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 18"
    outcome: remediated
    summary: "Default-off behavior changes: src/conductor/src/engine/routing/execution-child.ts:24, :35 and :44 turn an un-overlaid repair-pending cursor into an executable cursor target. conductor.ts:2470, :6162 and :6932 accept it where they previously refused. The --from path bypasses preflight at conductor.ts:6120, allowing BUILD entry before stack repair. Verified source; 98% confidence."
  - gate: architecture_review_as_built
    finding: "as-built:77070691-a42f-4abe-9b72-9ba12c0c8b0d:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 6"
    outcome: remediated
    summary: "Cleanup can permanently strand routing refs: src/conductor/src/engine/restack/restack-refs-cleanup.ts:113 records a failed routing probe, but :121 and :126 still delete closure refs. Subsequent cleanup skips routing at :110 because its eligibility evidence is gone. Both mergeable-sweep.ts:526 and park-reconciliation.ts:1142 use this path. Verified source control flow; 99% confidence."
  - gate: architecture_review_as_built
    finding: "as-built:77070691-a42f-4abe-9b72-9ba12c0c8b0d:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 16"
    outcome: remediated
    summary: "The durable outbox boundary accepts incomplete events: src/conductor/src/engine/routing/route-types.ts:148 validates envelope identity/time but requires only an inner event.type. Both record parsers share this boundary. route-record-store.ts:81 persists only the inner event, so missing eventId/occurredAt defeats replay deduplication and original timestamps at event-persister.ts:298 and :218. Verified source; 99% confidence."
---

## Cost
input: 4396906
output: 420480
cache_read: 121110277
cache_creation: 1556303
cost_usd: 61.7998
dispatches: 43
retries: 12
halts: 4
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4396766, output: 327968, cache_read: 113083520, cache_creation: 0, cost_usd: 45.8932, dispatches: 30, cost_unmetered: 0
  claude: input: 140, output: 92512, cache_read: 8026757, cache_creation: 1556303, cost_usd: 15.9066, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","edbbdb92-80c5-4ac8-818b-efdeac3a737b","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
