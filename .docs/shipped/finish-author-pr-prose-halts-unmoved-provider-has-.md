---
slug: finish-author-pr-prose-halts-unmoved-provider-has-
spec_hash: 98cd101e6977679dd9c8b6b79848695242bc2f18184bb5c2da01392e9cc69148
pr: https://github.com/jstoup111/ai-conductor/pull/3573
shipped: 2026-11-02
engine_version: 20261101T162011Z-b317a8dbaaa5
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This changes production prompt-file temp-root resolution for a test-suite reason unrelated to the PR prose handoff. In production the resolver now ends at tmpdir(), which reads TMPDIR at call time rather than the value captured at load, so operators see a difference only if TMPDIR changes mid-process."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "These are test-only hygiene edits unrelated to the feature's outcomes, with no effect on shipped behavior."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "This goes beyond any story criterion and beyond the task that added it, whose text describes restoring an order. It serves the feature's goal that an unauthored PR gets authored prose rather than halting, and the behavior is narrow and tested. A non-empty floored body with a halt signal still classifies as halt in prProse."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:33884d91-89f2-481f-8df6-22006fd67d64:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-31-engine-performs-finish-pr-prose-write decision 2"
    outcome: remediated
    summary: "Verified, 99% confidence: closing-reference preservation fails at src/conductor/src/engine/finish-pr-prose-handoff.ts:31 and :121. The matcher ignores Closes #42, allowing its removal; substring membership also accepts Closes owner/repo#420 as preserving Closes owner/repo#42. Recognize and compare complete closing references."
  - gate: architecture_review_as_built
    finding: "as-built:33884d91-89f2-481f-8df6-22006fd67d64:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-31-engine-performs-finish-pr-prose-write decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: unchanged revision_required prose enters the advancement check after a missing/invalid handoff at src/conductor/src/engine/finish-publication.ts:2043, or a failed guarded edit at :2023. advancedPublicationTransition at :1707 then returns publication_transition_unmoved, losing the required prose_not_returned/prose_invalid retry or publication_operation_failed cause. Preserve cause-specific routing when a revision pass has not moved."
  - gate: architecture_review_as_built
    finding: "as-built:33884d91-89f2-481f-8df6-22006fd67d64:3"
    class: REMEDIABLE
    governing_clause: "Task 1"
    outcome: remediated
    summary: "Verified, 99% confidence: PR_PROSE_HANDOFF_PATH at src/conductor/src/engine/finish-pr-prose-handoff.ts:5 has no production consumer. Repository-wide symbol search finds only its declaration and unit-test references; handoffPath at :34 uses a separate literal. Wire the task 1 export into production path resolution."
  - gate: architecture_review_as_built
    finding: "as-built:b92c36bd-23ba-4a9f-aad6-619ae8941360:1"
    class: REMEDIABLE
    governing_clause: "Task rem-prd-audit-judge-stale-rejudge"
    outcome: remediated
    summary: "Verified, 99% confidence: finish-publication.ts:2170 and :2192 return judgment_revision_changed, but the judge_pr_prose retry registry at :792 omits it. Validation at :981 therefore rejects both results, and routing at :898 returns an unknown-disposition halt instead of retrying. The production adapter forwards these results unchanged to conductor.ts:12313. These branches were introduced by remediation commit 491b7eb841 after the prior review."
---

## Cost
input: 3973288
output: 400516
cache_read: 67798670
cache_creation: 2286399
cost_usd: 53.1136
dispatches: 76
retries: 12
halts: 3
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 12
providers:
  codex: input: 3973096, output: 221719, cache_read: 58990208, cache_creation: 0, cost_usd: 29.484, dispatches: 53, cost_unmetered: 12
  claude: input: 192, output: 178797, cache_read: 8808462, cache_creation: 2286399, cost_usd: 23.6296, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","ccc0896b-b71c-4be5-a9c9-b3e7259d0823","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 6
rubrics:
  eventSpine: failures: 2, judged: 4
  implementationQuality: failures: 2, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `a11be1be-da05-48d3-a3e6-b6b3a45e9d55` — source ids: `eventSpine:sha256:56d58edd2446f4376fdb716b18ae459c4daa60478341d8214471521ed2ab6a7d`, `eventSpine:sha256:bba45de4d71e02022db106beb2a0eba6eaa323c36a532c68bbc2ae86f67d26fa`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->