---
slug: remediation-tasks-close-on-a-reported-commit-that-
spec_hash: 797de30f5a744f135c9ddb2c33e71154c172e172e117ccb2add2265a8eeba1df
pr: https://github.com/jstoup111/ai-conductor/pull/3384
shipped: 2026-10-23
engine_version: 20261023T170550Z-7949f582080b
findings:
  - gate: architecture_review_as_built
    finding: "as-built:508d3242-57a3-4443-ba57-f107390f06a9:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-21-remediation-closure-judgement decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/step-runners.ts:2939 passes step='build' into auxiliary provider execution. Only the preferred candidate receives the explicit review model/effort; fallback candidates resolve using that BUILD step (provider-execution.ts:626 and resolved-config.ts:373). Every candidate must resolve build_review policy while retaining BUILD lifecycle attribution."
  - gate: architecture_review_as_built
    finding: "as-built:508d3242-57a3-4443-ba57-f107390f06a9:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-06-reopened-task-resolution decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/remediation-closure-judgement.ts:125 constructs a globally stored obligation id from a close identity that excludes plan identity. Identical task/check/evidence/reopen-count values in different plans therefore collide. repair-obligations.ts:249 replays the other plan's obligation, then :372 rejects settlement, preventing the second plan's reopen. Scope the obligation id by canonical plan identity while preserving the specified close identity."
  - gate: architecture_review_as_built
    finding: "as-built:1b5f5cb0-ac57-41d2-91ee-54308620eab7:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-21-remediation-closure-judgement decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: repair commit 9fab5d2f41 introduces incorrect preferred-provider inheritance. provider-execution.ts:1535 drops the correctly resolved primary model/effort overrides, while both resolution sites (:954 and :978) use the review selection's first provider as inheritedProvider instead of the global provider. resolved-config.ts:330 consequently retains another provider's global defaults. For example, global Claude with defaults.model=opus and build_review.llm_provider=codex now sends opus to Codex when no review model is explicit. Previously step-runners.ts:2904-2910 resolved this correctly and its overrides preserved that result. This new regression violates D4 despite fixing fallback step selection."
---

## Cost
input: 2215760
output: 231760
cache_read: 47732331
cache_creation: 943672
cost_usd: 32.4176
dispatches: 37
retries: 8
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2215638, output: 161894, cache_read: 43868288, cache_creation: 0, cost_usd: 22.6976, dispatches: 25, cost_unmetered: 0
  claude: input: 122, output: 69866, cache_read: 3864043, cache_creation: 943672, cost_usd: 9.72, dispatches: 12, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","a20a0ec5-e2ae-4621-b7ee-99baf9a1672d","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
  disabled: 3
