---
slug: routed-build-claim-with-null-fields-is-rejected-as
spec_hash: fdc44b671307cb7afff967ac02037c9aae57ab6982358c8365630922495ed978
pr: https://github.com/jstoup111/ai-conductor/pull/3717
shipped: 2026-11-15
engine_version: 20261115T195756Z-7a81fed9e811
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Neither change was planned. The null change alters visible behaviour: a routed BUILD that returns a JSON-null structured result now fails its attempt with a malformed-claim reason instead of being treated as no claim. It is fail-closed hardening that makes the closed parser agree with the provider schema, whose root must be an object, and it serves the plan's goal of field-level malformed details, so it falls within intent."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "The formatting changes no runtime behaviour, CLI output or persisted state, but it widens the diff well beyond the planned change. The Covers edits drop earlier features' traceability tags from these test files. Covers lines are test-annotation telemetry, not operator-visible output."
    accepted: false
    authority: engine
---

## Cost
input: 921274
output: 56586
cache_read: 12942088
cache_creation: 417619
cost_usd: 9.8823
dispatches: 23
retries: 0
halts: 1
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 921196, output: 38537, cache_read: 11370880, cache_creation: 0, cost_usd: 5.8658, dispatches: 16, cost_unmetered: 0
  claude: input: 78, output: 18049, cache_read: 1571208, cache_creation: 417619, cost_usd: 4.0165, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","a5c7b5ae-edd6-4137-857d-7770a1ee75a1","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  implementationQuality: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  paths-unmatched: 2
