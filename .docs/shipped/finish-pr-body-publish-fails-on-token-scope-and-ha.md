---
slug: finish-pr-body-publish-fails-on-token-scope-and-ha
spec_hash: 6bc42c80c77ff17115e5c4ede8c92d928df51148088cb9c38d9f3623722c09eb
pr: https://github.com/jstoup111/ai-conductor/pull/3420
shipped: 2026-10-25
engine_version: 20261025T104004Z-5288497d86bd
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Supplying flushSessionEvents in child mode needs a running tail, so starting one serves the planned FINISH attribution and matches the event-spine principle of one reader re-emitting onto the bus. Its effect still reaches beyond FINISH: child-mode runs now also persist and render build_review and session-producer events they previously dropped. The change has no Scope: trailer, and neither reseal rationale names it. It stays within the feature's intent, because it is the minimal wiring that makes the planned flush exist in child mode."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This operator-visible terminal and daemon-log line was not planned. It directly serves outcome-2 by surfacing the publish failure to the operator, and the existing dedicated-renderer invariant lists (terminal-renderer.test.ts, event-sinks.test.ts) require a handler for any render:true type, so it stays within intent."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:7242ec34-c619-4dae-b187-fcee92142c0c:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-24-finish-surfaces-guarded-publish-failures decision 3"
    outcome: remediated
    summary: "Verified, 98% confidence: finish-publication-production.ts:1779 swallows a failed pre-pass flush and subscribes anyway at :1780. A ledger read failure leaves its offset unchanged (closeout-tail.ts:48–51); a subsequent successful poll can therefore deliver an older same-PR failure during this subscription and falsely attribute it to the current pass at :1793. This violates D3's pre-subscribe drain boundary. The faulty pre-drain handling was introduced in remediation commit 3408450e6a, so it is eligible for this re-review."
---

## Cost
input: 2147588
output: 239131
cache_read: 50875630
cache_creation: 1339040
cost_usd: 38.4538
dispatches: 48
retries: 6
halts: 5
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2147432, output: 156268, cache_read: 45356416, cache_creation: 0, cost_usd: 24.9798, dispatches: 28, cost_unmetered: 0
  claude: input: 156, output: 82863, cache_read: 5519214, cache_creation: 1339040, cost_usd: 13.474, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","fd7d2acc-6dbb-45c3-a085-e24bbf8040b7","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 5
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 1, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:
  disabled: 5


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `64898260-84ca-4c3a-8997-6247202828cc` — source ids: `eventSpine:sha256:eaa3ae1a22824b95478be70bb57ad628ff77cb5131537b1895c7aaad9d0cd4bf`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->