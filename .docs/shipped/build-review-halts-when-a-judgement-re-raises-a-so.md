---
slug: build-review-halts-when-a-judgement-re-raises-a-so
spec_hash: af9081dddbefa60cb8a1e2ead04dfaf42c9e70a6ed98aac7478d8a7d7da115e2
pr: https://github.com/jstoup111/ai-conductor/pull/3336
shipped: 2026-10-22
engine_version: 20261021T234255Z-d50d13381061
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Story 4.3 asks only that fresh link timestamps converge for the same owner, disposition and outcomes. The shipped change also lets rationale, priority, confidence and consistency-prose drift converge, and flips a previously refused case to converging. That fits the ADR D5.7 convergence key of owner plus source set that the code comment cites, so it is within intent. It is still a widening the plan did not enumerate."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This narrowing is needed so a later lap can converge on, or conflict with, an open stop (Stories 4.4 and 4.5), which is within intent. It also means the coordinator's settled set and the CLI/effective-verdict settled set now differ for sources owned by an open decision stop. That contradicts the store doc comment claiming one shared predicate. It is not user-visible beyond inspection output."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "Protecting an open stop from being settled by absence before its replay is persisted serves Story 4. However, the guard is lap-wide: any proposed escalation also stops unrelated absent open non-action cases, such as deferrals and rejections, from being settled by absence that lap. This is within intent but broader than the stories require."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-4
    summary: "This is unrelated to case-store ownership and is not in any task. It removes coverage of transcript retention across a rate-limited retry. It is test-only and not user-visible, but it is lost coverage outside this feature's intent."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-5
    summary: "This removes a flaky-looking daemon assertion unrelated to this feature and in no task. It is test-only and not user-visible."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-6
    summary: "This is an engine bookkeeping artifact that records an operator-resolved halt during this feature's run, not feature behaviour. It is harmless and not user-visible."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:c5a1d662-4333-4bf9-8f94-50c6a5565e36:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/remediation-case-effects.ts:81 permits owner equality OR identical consistency metadata; :124 consequently converges different-owner proposals. An architecture-owned stop and an unbound plan-owned stop with identical source outcomes and consistencyStop return already-persisted instead of the D5.7-required rejected transition. The coordinator constructs records containing both fields at src/conductor/src/engine/build-review-adjudication-coordinator.ts:763."
  - gate: architecture_review_as_built
    finding: "as-built:c5a1d662-4333-4bf9-8f94-50c6a5565e36:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/remediation-case-effects.ts:72 requires exact consistencyStop JSON beyond D5.7's stop identity fields. A bound replay with matching id, owner, disposition, source ids and outcomes returns conflicting-case-id at :119 when consistency rationale or source ordering changes. The equivalent serialization requirement at :83 also prevents unbound ownerless consistency-stop convergence under that metadata drift."
---

## Cost
input: 1140578
output: 131224
cache_read: 25009900
cache_creation: 624708
cost_usd: 18.3176
dispatches: 20
retries: 1
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1140482, output: 79011, cache_read: 21668224, cache_creation: 0, cost_usd: 11.6069, dispatches: 12, cost_unmetered: 0
  claude: input: 96, output: 52213, cache_read: 3341676, cache_creation: 624708, cost_usd: 6.7106, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","5a928585-ec60-475e-ba51-3d4588ec1ea5","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
