---
slug: refusing-a-newly-raised-over-scope-criterion-halts
spec_hash: 6b17c34c103c4d746ca3078da23933d662bfc81b7ee7c92b6f771c97d3ec30c9
pr: https://github.com/jstoup111/ai-conductor/pull/3570
shipped: 2026-11-01
engine_version: 20261101T162011Z-b317a8dbaaa5
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an unplanned change to replay semantics. It stops a stale clear from overturning a later reversal, but a verbatim reinstatement of an earlier decision is also ignored without a defect. Rendered halts do not re-offer an accepted criterion, so reaching that sequence needs a hand-written clear; no ordinary operator flow changes."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This test-infrastructure isolation change is unrelated to PRD widening capture. It affects only how one test allocates temp directories and changes no engine or operator-visible behavior."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:2ce44a8d-b0d4-428f-ab14-48ea4375a54b:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: migration bypasses capture validation. prd-widening-entry.ts:34-39 passes fully decided cleared rows into migration before reading the offered verdict. prd-widening-capture.ts:151-156 strips their offer references; prd-widening-migration.ts:164-199 and :278-283 persist them. With v1 history, an unoffered story, an unavailable verdict, or a tampered NC offer can therefore produce durable authority before capture rejects it. Apply D3 validation before importing cleared rows, while preserving valid stored legacy history."
  - gate: architecture_review_as_built
    finding: "as-built:2ce44a8d-b0d4-428f-ab14-48ea4375a54b:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: prd-widening-capture.ts:322-324 recognizes modern references only by offerEntryId. In a fully decided block, deleting that property while retaining originalCaseId/originalSource sends an NC entry through legacy capture at :328-329, bypassing persisted-offer validation at :372. Preserve and inspect all offer references before selecting legacy capture; altered modern offers must remain named defects."
  - gate: architecture_review_as_built
    finding: "as-built:2ce44a8d-b0d4-428f-ab14-48ea4375a54b:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 3"
    outcome: remediated
    summary: "Verified, 98% confidence: captureLegacyClear at prd-widening-capture.ts:231-240 automatically supersedes the latest same-source decision when incoming authority differs. After an offerless story acceptance is explicitly reversed, replaying the original acceptance can overwrite that refusal because accepted-widenings.ts:442-455 bypasses replay detection for supersessions. Both story callers (:330 and :367) inherit this behavior. Preserve old-clear replay identity rather than manufacturing a new reversal from the latest decision."
  - gate: architecture_review_as_built
    finding: "as-built:2ce44a8d-b0d4-428f-ab14-48ea4375a54b:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: a malformed priorDecision causes prd-widening-capture.ts:122-123 to discard an otherwise readable criterion; :355-356 emits malformed-entry without it. The changed conductor handling at :3735 and :3741-3745 consequently emits prd-audit:entry and renders recovery without the criterion. Retain readable criterion identity on this rejection path, as the amended D3 requires."
---

## Cost
input: 4012910
output: 372933
cache_read: 54646605
cache_creation: 1793232
cost_usd: 43.7649
dispatches: 85
retries: 10
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 10
providers:
  codex: input: 4012688, output: 225025, cache_read: 47359360, cache_creation: 0, cost_usd: 25.0025, dispatches: 56, cost_unmetered: 10
  claude: input: 222, output: 147908, cache_read: 7287245, cache_creation: 1793232, cost_usd: 18.7624, dispatches: 29, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","e6ec1f84-04da-4a7e-809a-d70356152010","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 8
  implementationQuality: failures: 3, judged: 8
  security: failures: 0, judged: 8
  testQuality: failures: 1, judged: 8
skip_reasons:
