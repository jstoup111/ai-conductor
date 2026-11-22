---
slug: manual-test-report-left-in-product-worktree-blocks
spec_hash: f66b84f8017e2ff9c7ccd16467b545ae7f0e0bb8523c0f7499043d5143d78e48
pr: https://github.com/jstoup111/ai-conductor/pull/3713
shipped: 2026-11-22
engine_version: 20261122T020604Z-3379a47ff8d4
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is fail-closed hardening that keeps Story 1's refusals atomic (S1.6) and its path handling correct for unusual names. It serves the stories even though no plan task names it."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "These are canonicalization churn. Operator-visible output, CLI results and persisted state are unchanged."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "These repair flaky or failing tests under aggregate-suite load so test_suite can pass. Repairs to failing tests fall within intent. No production behavior changes."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-4
    summary: "This record was written by the engine's halt-record machinery during this feature's lifecycle. It is not feature implementation and does not change product behavior."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:d51e428e-79a7-418a-907e-bb14cb0d7ae6:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 4"
    outcome: remediated
    summary: "Source-verified (95% confidence): validator-residue.ts:63 introduces a direct clock read through new Date(), and src/conductor/test/structural/boundary-allowlist.txt:449 adds its exception. D4 explicitly requires the boundary allowlist to shrink only. The older layer-ratchet review permits reviewed layer exceptions, but does not amend this later boundary decision."
---

## Cost
input: 4240614
output: 299324
cache_read: 78360933
cache_creation: 2591617
cost_usd: 50.9614
dispatches: 110
retries: 7
halts: 12
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 2
providers:
  codex: input: 4240316, output: 236498, cache_read: 70467328, cache_creation: 0, cost_usd: 27.3921, dispatches: 57, cost_unmetered: 2
  claude: input: 298, output: 62826, cache_read: 7893605, cache_creation: 2591617, cost_usd: 23.5694, dispatches: 53, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","3af89d78-2e73-4f2b-803d-300dde199078","lifecycle-step","build_review"],step:execution\u0000["timing-rollup","persisted-ledger","8015ea72-3ccf-49bc-814d-2d3e89ad88a3","lifecycle-step","finish"]

## Build Review
laps_to_pass: 9
skipped: 15
cache_hits: 6
infrastructure_failures: 17
rubrics:
  eventSpine: failures: 0, judged: 12
  implementationQuality: failures: 10, judged: 13
  security: failures: 0, judged: 14
  testQuality: failures: 0, judged: 6
skip_reasons:
  paths-unmatched: 15


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `bc067aa0-ee3c-4529-8102-161e329d74a1` — source ids: `implementationQuality:sha256:15f9a3c80600333d36daa3c50821b1562c4e605943054c7be5089e8eab20433a`
- Operator-resolved case: `bcd12a91-060c-410e-b094-fdb3c653a426` — source ids: `implementationQuality:sha256:8d1a9121702110cf2cf75012a9246d889a383852b4c9267827d9710908cd7da7`, `implementationQuality:sha256:740fec5371df00677d06737687325f36634e9eb6f86da008b747e97e244153b2`
- Operator-resolved case: `b9068cb0-469a-4afc-89b4-13cec2df5e83` — source ids: `implementationQuality:sha256:ca38d2b1dfd194682daf7603c73979b269d24d9eed17eea8579a925432427cd0`
- Operator-resolved case: `475205a4-fb5e-425f-8f24-db45207e0b16` — source ids: `implementationQuality:sha256:ceee668040631d88df6bac8ef6559fe9e6b1418a63bedc399b3aa6a9b6f20c27`, `implementationQuality:sha256:fc73364d3693d407c7d367cfed0c36d857c2dea433a07a4586eed453dd5ce5d6`
- Operator-resolved case: `fb1865d8-d5d3-4480-9900-e2f6f6b5a872` — source ids: `implementationQuality:sha256:234c856cb5a03fd3e66da54ac688577515fe78f5aeed9f2fdd4a12db27c6ef5c`
- Operator-resolved case: `31412247-7fa5-477c-8653-06b064392c4a` — source ids: `implementationQuality:sha256:0e9846dd7d495cdd8211e52f3cd5c2c6aa511e9a168d09afcc81077d451752fb`, `implementationQuality:sha256:f5ffa010ae9f2f9a17048b55a9260749d5db9d08975abdadf51c4cef8e3db0b0`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->