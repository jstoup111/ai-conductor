---
slug: base-inherited-artifact-deletion-deadlocks-both-se
spec_hash: dab544348fe09664bde0bad4b3b757f82e2ae1246ac794efaef4199fdaedad19
pr: https://github.com/jstoup111/ai-conductor/pull/3041
shipped: 2026-10-08
engine_version: 20261007T164331Z-36ba0cf6988b
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an unplanned, stricter verdict change, but it is fail-closed. It serves ADR D4 (no write unless the composed verdict is ok) and outcome 3 (feature-authored deletions still halt). It is within intent, but operators can see it, because some rewritten-history verifications that used to rotate silently will now halt with an attributed reason."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This reordering was not in the plan. It keeps the existing input-error messages from being recast as provenance refusals now that inspection can need the base for inherited deletions. It is within intent and keeps user-visible behavior as it was."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "The new message follows from the classifier checking the missing base ref first, and it matches S6.4 (a missing base ref is undeterminable, never an authorship label). It is within story intent, but it changes a refusal first line that the plan said would stay the same."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: prune-only-baseline-advance
    class: REMEDIABLE
    governing_clause: "adr-2026-10-07-prune-base-inherited-deletions-from-the-seal decision 3"
    outcome: remediated
    summary: "Verified, 97% confidence: protected-artifact-seal.ts:1594 advances baselineCommit to HEAD even when every reseal target is inherited-deleted. At :1642 the writer suppresses the rotation entry, leaving only old-baseline→old-baseline prune lineage. Preserve the original baseline for prune-only reseals."
  - gate: architecture_review_as_built
    finding: reseal-prune-event-unwired
    class: REMEDIABLE
    governing_clause: "adr-2026-10-07-prune-base-inherited-deletions-from-the-seal decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/reseal-cli.ts:214 supplies no onRebaseline observer. CLI pruning therefore persists lineage but drops the required inherited-base-deletion event at protected-artifact-seal.ts:1726. Wire the observer to the existing event emitter with best-effort semantics."
  - gate: architecture_review_as_built
    finding: missing-refusal-attribution
    class: REMEDIABLE
    governing_clause: "adr-2026-10-07-prune-base-inherited-deletions-from-the-seal decision 7"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/protected-artifact-seal.ts:1162, :1185, :1283 and :1287 return inspection or rotation refusals without attribution. Add provenance-undeterminable attribution while preserving existing first lines."
  - gate: architecture_review_as_built
    finding: failed-deletion-probe-misattributed
    class: REMEDIABLE
    governing_clause: "adr-2026-10-07-prune-base-inherited-deletions-from-the-seal decision 2"
    outcome: remediated
    summary: "Verified, 97% confidence: src/conductor/src/engine/protected-artifact-seal.ts:1008 treats an unavailable or failed ls-tree probe as not-inherited with headTouchedPath=false. The new deletion classifier at :1092 consequently reports an uncommitted workspace deletion rather than provenance undeterminable. Propagate failed probes as indeterminate."
---

## Cost
input: 1742131
output: 179116
cache_read: 42550871
cache_creation: 718537
cost_usd: 24.6593
dispatches: 28
retries: 3
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1741985, output: 116098, cache_read: 38526848, cache_creation: 0, cost_usd: 16.8452, dispatches: 17, cost_unmetered: 0
  claude: input: 146, output: 63018, cache_read: 4024023, cache_creation: 718537, cost_usd: 7.814, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","03f4d94a-cafc-41ac-ae6f-174f21d94bc3","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","54115350-f24f-401b-9af5-b9b04ed40386","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","ae8d3b9b-51fb-4606-8bea-d5959f1d0038","lifecycle-step","architecture_review_as_built"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
