---
slug: shipped-is-fire-and-forget-no-reconciliation-sweep
spec_hash: c1acea8af13a4ce8488002a1fadf92aaf70641d10045507d9a2efe3c0f2d16f4
pr: https://github.com/jstoup111/ai-conductor/pull/3149
shipped: 2026-10-11
engine_version: 20261011T230829Z-d677b3f7832c
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is test-only hygiene that stops one test's environment variable leaking into another. It changes no production or user-visible behavior."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "The restored conflict-label clear goes slightly beyond a pure restore: it changes the bookkeeping in the persisted watch entry. GitHub label behavior is unchanged (one removal, and mergeable is not added that tick), and the end state matches the old two-tick outcome. It is within the intent of the operator's refusal decision, which was to keep automatic conflict-label clearing."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:117a42c6-b25c-4112-8e0a-36773132ef2d:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-shipped-pr-readiness-verdict decision 3"
    outcome: remediated
    summary: "Verified, 100%: mergeable-sweep.ts:664-665 removes ci-failed before the indeterminate guard at :685. Indeterminate observations carrying that label therefore mutate GitHub, violating D3."
  - gate: architecture_review_as_built
    finding: "as-built:117a42c6-b25c-4112-8e0a-36773132ef2d:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-shipped-pr-readiness-verdict decision 5"
    outcome: remediated
    summary: "Verified, 100%: event-sinks.ts:220 retains ci_failed persist:false, while event-persister.ts:502 subscribes only to persisted event types. Both sweep emissions at mergeable-sweep.ts:759 and :796 reach the emitter but cannot reach the promised daemon ledger."
  - gate: architecture_review_as_built
    finding: "as-built:117a42c6-b25c-4112-8e0a-36773132ef2d:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-shipped-pr-readiness-verdict decision 1"
    outcome: remediated
    summary: "Verified, 99%: mergeable-sweep.ts:545 replaces state after terminal lifecycle handlers at :476 and :532. MERGED, CLOSED, or NOTFOUND returned by the re-read bypass their lifecycle handling and reach classification at :589."
  - gate: architecture_review_as_built
    finding: "as-built:117a42c6-b25c-4112-8e0a-36773132ef2d:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-shipped-pr-readiness-verdict decision 2"
    outcome: remediated
    summary: "Verified, 100%: production read failures return UNKNOWN with readFailure (pr-labels.ts:612-623). The re-read marks that resolved sentinel completed (mergeable-sweep.ts:545-546), then skips classification at :558-570. Failed re-reads therefore receive no required indeterminate verdict."
---

## Cost
input: 2127894
output: 248499
cache_read: 40086967
cache_creation: 1931502
cost_usd: 38.7994
dispatches: 61
retries: 3
halts: 8
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2127658, output: 117664, cache_read: 33377152, cache_creation: 0, cost_usd: 19.3878, dispatches: 27, cost_unmetered: 0
  claude: input: 236, output: 130835, cache_read: 6709815, cache_creation: 1931502, cost_usd: 19.4116, dispatches: 34, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","f51a8a2b-47ec-4d70-9d19-146287e4caf5","lifecycle-step","finish"]

## Build Review
laps_to_pass: 5
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 5, judged: 9
  security: failures: 0, judged: 9
  testQuality: failures: 4, judged: 9
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:1728ce92320f24a44ff4b44887d15d2273bf10a9ff94630c96201287aabc6644` — rubric: eventSpine

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->