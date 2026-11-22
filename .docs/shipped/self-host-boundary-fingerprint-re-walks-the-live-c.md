---
slug: self-host-boundary-fingerprint-re-walks-the-live-c
spec_hash: 43b167fc798be9a304871b7fe2feb17773d2f067d35b033a8bc6be24fec6bab4
pr: https://github.com/jstoup111/ai-conductor/pull/3710
shipped: 2026-11-22
engine_version: 20261122T020604Z-3379a47ff8d4
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Layout-only churn beyond the planned files. It changes no operator-visible output, CLI result, or persisted state."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "These are fail-closed hardening changes that let a shared dispatch snapshot abandon timed-out preparations and verify each live-checkout root against its own containment verdict. They serve Story 1 criterion 5 and Story 2 criteria 5 to 7."
    accepted: false
    authority: engine
---

## Cost
input: 4079874
output: 344629
cache_read: 55302091
cache_creation: 3104603
cost_usd: 55.5152
dispatches: 90
retries: 7
halts: 8
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4079604, output: 228315, cache_read: 47890432, cache_creation: 0, cost_usd: 26.8687, dispatches: 56, cost_unmetered: 0
  claude: input: 270, output: 116314, cache_read: 7411659, cache_creation: 3104603, cost_usd: 28.6465, dispatches: 34, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","8061d4f0-5144-4d70-9bf6-34af6b05248c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 9
cache_hits: 0
infrastructure_failures: 4
rubrics:
  eventSpine: failures: 0, judged: 8
  implementationQuality: failures: 8, judged: 9
  security: failures: 0, judged: 9
  testQuality: failures: 1, judged: 9
skip_reasons:
  paths-unmatched: 9


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `a81fbd10-3fad-45b2-a07c-f15436577f33` — source ids: `implementationQuality:sha256:2bf1b43547897984d70d3615af22f2ce74ee8e1e0673d6a2eabf4b1ffb2c4bfa`, `implementationQuality:sha256:e7e714a8b26232ed441d2cab28475b798c4fe4084c08be7320607c5f53738732`
- Operator-resolved case: `18137a66-539c-41a3-8c62-519b9ce057ad` — source ids: `implementationQuality:sha256:75a9106aec3b9b27700cbb4c36e734c36d84aa8b89a4a637f7bcd95e1d4951a8`
- Operator-resolved case: `f36a4e85-e952-4e4e-a0a6-9f9674bff4e0` — source ids: `implementationQuality:sha256:c611b9f1004b513d0ca21641f0a3cef174e3fe4873e971384ff1cef14f2af9c2`, `testQuality:sha256:f2d452f92fc73fe55a091bfcef8a5b3b956173e529b3d2cef16aa8c24a4dbace`
- Operator-resolved case: `22b509a2-9cfb-49d2-92bf-6798ab59432f` — source ids: `implementationQuality:sha256:cc850170dd0608b584be8b213f567b0d35d89ef577265440a1f1d8789f255e5b`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->