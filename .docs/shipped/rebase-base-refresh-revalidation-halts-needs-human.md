---
slug: rebase-base-refresh-revalidation-halts-needs-human
spec_hash: 300768263ffc948ee687ca9208bc499a058cf1f5a2df12c0892b7e335ce96dab
pr: https://github.com/jstoup111/ai-conductor/pull/3568
shipped: 2026-11-03
engine_version: 20261103T113615Z-112100c2807e
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "The change supplies the ref S3.4 needs at region entry, but it also changes the resume path: an unreadable marker route record stops before reconcile and bounded stall recording, and that halt does not name the ref."
    accepted: true
    decision: accept
    rationale: "Operator accepts: surfacing an unreadable route record as git-error instead of silently ignoring it is the safer behavior and in the spirit of the feature."
    authority: jstoup111
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This is a compile-time reshaping that lets enterRoutedHostRegion return the entered execution. Resolved values do not change, and it directly supports planned region-entry admission."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "The timeout affects tests only. The changed expectation follows the region-entry refusal wording from the planned Story 3 work and adds no behavior of its own."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-4
    summary: "Operators see different halt text. The settlement path lies outside the stories' region-entry scope, and the unreadable-ref refusal gains the ref but carries no recovery instruction."
    accepted: true
    decision: accept
    rationale: "Operator accepts: naming the unreadable route record in the halt is the same fail-closed surfacing accepted for NC-1; the generic git recovery hint would mislead for an unreadable ref."
    authority: jstoup111
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-5
    summary: "This is test-runner isolation unrelated to queue admission and changes no shipped engine behavior."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-6
    summary: "This removes a false positive for 'symbolic-ref -q HEAD' beside routing ref helpers, but it also weakens a structural guard against unauthorized routing ref writes. It is not user-visible, though it reduces future protection and merits operator attention."
    accepted: false
    authority: engine
---

## Cost
input: 4739153
output: 538938
cache_read: 86932833
cache_creation: 2697268
cost_usd: 69.9248
dispatches: 87
retries: 16
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 9
providers:
  codex: input: 4738897, output: 269335, cache_read: 74895360, cache_creation: 0, cost_usd: 40.5461, dispatches: 55, cost_unmetered: 9
  claude: input: 256, output: 269603, cache_read: 12037473, cache_creation: 2697268, cost_usd: 29.3787, dispatches: 32, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","1e79f864-7d28-41c0-b4e8-74803a559a36","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 7
  implementationQuality: failures: 2, judged: 7
  security: failures: 0, judged: 7
  testQuality: failures: 0, judged: 7
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:7145ca5a398377c8beb7df4891f04ae997530d68b506d3d31f45f5617c88449c` — rubric: implementationQuality

- Operator-resolved case: `a94108f9-fd4e-4509-81df-4073d10e358a` — source ids: `implementationQuality:sha256:7145ca5a398377c8beb7df4891f04ae997530d68b506d3d31f45f5617c88449c`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->