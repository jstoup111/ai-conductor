---
slug: rubric-cache-identity-is-sha-anchored-so-a-rebase-
spec_hash: 915998db1ce59f1bb22c2190443f11054308cb35e62eb76f3c4eb7372be0f265
pr: https://github.com/jstoup111/ai-conductor/pull/1601
shipped: 2026-08-15
engine_version: 20260815T212431Z-a350c09d818d
---

## Cost
input: 64879850
output: 707740
cache_read: 107409127
cache_creation: 3474959
cost_usd: 69.2909
dispatches: 107
retries: 25
halts: 0
unmetered: count: 17, duration_ms: 0
cost_unmetered: count: 56
providers:
  codex: input: 64878888, output: 260921, cache_read: 60677120, cache_creation: 0, cost_usd: 0, dispatches: 56, cost_unmetered: 56
  claude: input: 962, output: 446819, cache_read: 46732007, cache_creation: 3474959, cost_usd: 69.2909, dispatches: 37, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 7
skipped: 0
cache_hits: 79
infrastructure_failures: 13
rubrics:
  completeness: failures: 4, judged: 28
  rootCause: failures: 14, judged: 30
  scope: failures: 13, judged: 35
  tautology: failures: 17, judged: 34
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

- Finding: `sha256:1d88051ab483275406d04341eddbfdfdf8077dbd04988ce65666f8b81b402732`
  **Rubric:** scope
  **Summary:** Revert or obtain an accepted scope widening for the copy-equivalence fixture repair: it adds a result-schema field and changes the expected malformed-response repair-loop call count from 8 to 12, while its own comment states that it tracks a pre-existing contract rather than the planned cache-identity work.
  **Rationale:** Operator-authorized rebase-reconciliation widening, third keying of the same copy-equivalence fixture repair: the result-schema field and invocation counts reconcile the fixture with the merged #1605 engine (schema-validated results, bounded repair turn). Substance accepted twice before (9a9463e2, c9fb982a); identity drift tracked as #1611.
  **Operator:** james-stoup
  **Accepted at:** 2026-08-15T23:37:29.084Z

- Finding: `sha256:9a9463e23b263e806c2b7ca8de24b34624c23d9b687b7f0bec5cb3fc07f01e83`
  **Rubric:** scope
  **Summary:** Revert or separately authorize the unrelated copy-equivalence fixture correction; adding an explicit verdict and changing the malformed-response retry count from 8 to 12 do not exercise the planned cache identity, projection-version, rebase-hit, or cross-feature-isolation behavior.
  **Rationale:** Operator-authorized rebase-reconciliation widening: the copy-equivalence retry-count change reflects the merged #1605 validate-and-repair loop adding a bounded second invocation; the fixture must match rebased production behavior.
  **Operator:** james-stoup
  **Accepted at:** 2026-08-15T22:49:03.622Z

- Finding: `sha256:a7075dbd85ad655071e329ad3888bdbceff44c4ca941779adea3b1826bc22cab`
  **Rubric:** scope
  **Summary:** Revert or separately authorize the acceptance-fixture prompt parser rewrite; the plan authorizes content-based cache identity, v2 projection fixtures, and coordinator cache tests, but not changing how three pre-existing acceptance scenarios extract projections from prompts.
  **Rationale:** Operator-authorized rebase-reconciliation widening: the acceptance-fixture prompt parser rewrite reconciles the fixture with the merged #1605 engine (schema-embedded rubric prompts); reverting would fail the suite against the rebased production code.
  **Operator:** james-stoup
  **Accepted at:** 2026-08-15T22:49:03.303Z

- Finding: `sha256:c9fb982a5e5336cd5c6e507dc25b32ab25f9622a5a60788e257e013106ef0e7a`
  **Rubric:** scope
  **Summary:** Revert the unrelated copy-equivalence test response and invocation-count corrections or obtain a scope widening; no approved task changes malformed-result retry behavior or this test's provider-result fixture.
  **Rationale:** Operator-authorized rebase-reconciliation widening (re-keyed duplicate of accepted 9a9463e2 from lap-3123b99: same copy-equivalence retry/fixture reconciliation with the merged #1605 repair loop).
  **Operator:** james-stoup
  **Accepted at:** 2026-08-15T23:05:21.108Z

- Finding: `sha256:f8cfc46a67ad33f5fa44f2754e0e91acb83d90088aa490a6ddd97b7e6aec8f5e`
  **Rubric:** scope
  **Summary:** Revert the unrelated acceptance-test prompt-parsing refactor or record explicit scope authorization; the plan covers cache identity, projection v2 fixtures, and rebase/selectivity tests, but does not authorize replacing the existing prompt parser across unrelated acceptance scenarios.
  **Rationale:** Operator-authorized rebase-reconciliation widening (re-keyed duplicate of accepted a7075dbd from lap-3123b99: same acceptance-test prompt-parsing reconciliation with the merged #1605 engine).
  **Operator:** james-stoup
  **Accepted at:** 2026-08-15T23:05:20.869Z
<!-- build-review-accepted-risk:end -->