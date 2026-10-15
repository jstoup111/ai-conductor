---
slug: source-grounded-plan-defects-pass-every-decide-gat
spec_hash: 2b5abfd7cc8c0139b5baec78b52961ab1d1f2ab4b9be7e75d5b59f8fe117ffdd
pr: https://github.com/jstoup111/ai-conductor/pull/3207
shipped: 2026-10-15
engine_version: 20261014T234454Z-805e0d2c452c
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This test-harness environment change has nothing to do with plan review. It keeps the tsx IPC socket path under the Unix-domain limit in deep worktrees and stops a managed gh bypass from leaking into the child process. It changes no production code and nothing users can see."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 1"
    outcome: remediated
    summary: "Verified: engineer-cli.ts:1390-1392 requires exactly one entry in the entire .docs/plans directory. Historical plans therefore prevent composer review, acceptance and acknowledgement from reaching their shared engine calls at :1397-1404. Select the active feature plan rather than requiring a repository with only one plan."
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 4"
    outcome: remediated
    summary: "Verified: plan-review-provider.ts:20-23 overrides an explicit host-provider preference by moving it behind non-host providers, and ignores a preference absent from the global list. Required same-provider/unknown-host notices are also missing: plan-review-runner.ts:106,117 only records independence, event-sinks.ts:62-64 disables rendering, and engineer-cli.ts:1405 only prints a clean-result message."
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5"
    outcome: remediated
    summary: "Verified: plan-review-runner.ts:96 exits provider iteration before validating structured output. Validation at :99-100 throws instead of trying the next provider, contrary to the required invalid-response fallback."
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5"
    outcome: remediated
    summary: "Verified: plan-review-contract.ts:96,132-133 requires outside-.docs source evidence for every lens, rejecting explicitly permitted reachability evidence consisting of the introducing plan line and searched paths; plan-review-runner.ts:37 excludes those artifact locations from the evidence map. Conversely, contract.ts:138-140 accepts dependency-order findings without the required dependency closure."
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 3"
    outcome: remediated
    summary: "Verified: plan-review-runner.ts:35 loads every Markdown decision-directory file, and :87-89 sends entire documents in round one. The approved input boundary requires Decision sections of in-scope ADRs, not unrelated reviews and decisions."
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 6"
    outcome: remediated
    summary: "Verified: plan-review-runner.ts:82,89 regenerates and supplies all candidates during round two. The reviewer is instructed to judge every supplied candidate, reopening unchanged surfaces beyond the approved scope of prior blocking/significant findings and changed artifact components."
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 7"
    outcome: remediated
    summary: "Verified: plan-review-artifact.ts:85 recognizes only D<n>. decision lines, omitting supported numbered Markdown decisions, including this feature's governing ADR. Consequently :119-120 contributes no decision digests and plan-review-gate.ts:18-22 can accept changed ADR decisions as fresh. The duplicate parser in plan-review-runner.ts:63 also omits them from round-two inputs. Use the established decision grammar represented by artifacts.ts:4450."
  - gate: architecture_review_as_built
    finding: "as-built:51ce5544-5b0b-4838-82db-2e83f32400ae:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 9"
    outcome: remediated
    summary: "Verified: decide-entry-policy.ts:194 returns landed-before-plan-review provenance, but conductor.ts:7264-7266 saves only the disposition status and discards its reason. The promised legacy-skip reason never reaches production state or events."
  - gate: architecture_review_as_built
    finding: "as-built:3f1c17e1-3263-46df-9177-e4de35f8d06e:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 4"
    outcome: remediated
    summary: "Verified: prior finding 2 remains partly unresolved. plan-review-runner.ts:148 emits the independence notice through optional onNotice. Composer supplies it, but step-runners.ts:1233-1238 does not, leaving interactive conduct silent for same-provider and unknown-host reviews."
  - gate: architecture_review_as_built
    finding: "as-built:3f1c17e1-3263-46df-9177-e4de35f8d06e:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5"
    outcome: remediated
    summary: "Verified: prior finding 3 remains partly unresolved. plan-review-runner.ts:124-130 validates only the outer response envelope before filtering findings. A schema-invalid response such as {findings:[{}]} becomes a clean counted round instead of falling through to the next provider. Separate schema failures from schema-valid findings rejected for insufficient evidence."
  - gate: architecture_review_as_built
    finding: "as-built:3f1c17e1-3263-46df-9177-e4de35f8d06e:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 5"
    outcome: remediated
    summary: "Verified: prior finding 4 remains partly unresolved. plan-review-contract.ts:145-146 requires a second-task reference but never requires dependency-closure evidence. Dependency-order findings without the closure remain accepted."
  - gate: architecture_review_as_built
    finding: "as-built:3f1c17e1-3263-46df-9177-e4de35f8d06e:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-source-grounded-adversarial-plan-review-step decision 7"
    outcome: remediated
    summary: "Verified new remediation regression: plan-review-runner.ts:37-42 now supplies only plan-cited ADR texts, while plan-review-artifact.ts:114-120 includes cited plus changed ADRs and plan-review-gate.ts:15-18 supplies all ADR texts. A changed, uncited ADR therefore appears only in the land digest, making a fresh review stale. Acknowledgement inherits the mismatch at runner.ts:169. This finding concerns filtering newly introduced since the prior review."
---

## Cost
input: 5670034
output: 633617
cache_read: 134922359
cache_creation: 4371056
cost_usd: 96.2659
dispatches: 80
retries: 18
halts: 11
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5669642, output: 390446, cache_read: 107775744, cache_creation: 0, cost_usd: 51.0031, dispatches: 51, cost_unmetered: 0
  claude: input: 392, output: 243171, cache_read: 27146615, cache_creation: 4371056, cost_usd: 45.2628, dispatches: 29, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","a77d2395-9594-416a-9f72-1f2500a20c2a","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 6
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 2, judged: 6
skip_reasons:
  disabled: 6
