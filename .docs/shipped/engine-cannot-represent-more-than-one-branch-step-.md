---
slug: engine-cannot-represent-more-than-one-branch-step-
spec_hash: 187d4de7f2620f64082e5bdddc763985bdd9bc5bdd89356d5e64778e1690762e
pr: https://github.com/jstoup111/ai-conductor/pull/3019
shipped: 2026-10-07
engine_version: 20261007T021826Z-70eda29b4b7f
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an engine-internal bound change unrelated to branch identity or child state. It is not user-facing on its own. It does tighten the coherence projection limit below a previously observed corpus maximum of 82,354 bytes, so a later feature with a large coherence artifact could exceed the bound."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This is documentation in the consumer-facing project config template for a Pi provider key, unrelated to this feature's intent. Consumers see it because it ships in the template."
    accepted: true
    decision: accept
    rationale: "Docs-only template entry for the existing llm_providers.pi.subagents key (added by #3017 without docs); it fixes the config-template test that is red on main."
    authority: jstoup111
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "This is a fail-closed refusal in the operator `task --child` path. It goes beyond the specified cases but follows the story's membership-validation intent and only fires when --child is given."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-4
    summary: "This bug fix makes worktree creation correct for nested slugs. Task 10 exercises such slugs through createWorktree, and story 3 requires them to keep working (a/b as feat/daemon-a/b). It is a supporting correctness change within the feature's intent, with no new operator-facing behavior beyond correct worktree creation. The prior audit lap had not seen it."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: child-leaf-probe-error-fallback
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/github-operations-cli.ts:93-100 converts every thrown Git error into an absent-ref result. A local probe transport failure followed by a successful origin probe therefore proceeds to authorization at :105-112, violating task 9's required refusal on probe errors. Preserve missing-ref fallback while propagating transport failures to leafRefExists's fail-closed handling."
  - gate: architecture_review_as_built
    finding: child-rewind-incomplete-rollback
    class: REMEDIABLE
    governing_clause: "adr-2026-08-19-operator-step-rewind-through-the-mutation-port decision 4"
    outcome: remediated
    summary: "Verified, 98% confidence: src/conductor/src/engine/rewind.ts:627-629 and :633-641 accept and mutate later-child or flat snapshots without last_step. Missing files read as empty state (state.ts:29). If a subsequent batch or verdict clearing fails, rollbackRewindState throws at rewind.ts:285; the reverse rollback loop at :328-342 then stops before restoring earlier stores. A valid selected child plus an empty later-child directory can therefore leave partial demotions after failure, contrary to D4's atomic recovery boundary. Validate rollback prerequisites before mutation or support restoring absent last_step through the mutation port."
---

## Cost
input: 2390889
output: 305244
cache_read: 39217694
cache_creation: 4404351
cost_usd: 56.3592
dispatches: 155
retries: 11
halts: 28
unmetered: count: 44, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2385693, output: 132600, cache_read: 30255104, cache_creation: 0, cost_usd: 23.4634, dispatches: 71, cost_unmetered: 0
  claude: input: 260, output: 172386, cache_read: 8909472, cache_creation: 4404351, cost_usd: 32.8933, dispatches: 57, cost_unmetered: 0
  pi: input: 4936, output: 258, cache_read: 53118, cache_creation: 0, cost_usd: 0.0025, dispatches: 27, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","017c53ef-7ba4-44a1-a4b8-576da27a7c2c","lifecycle-step","build_review"],step:execution\u0000["timing-rollup","persisted-ledger","0b0b161f-d16b-426f-baa6-ad657e575e20","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","1a757bdd-b0c5-45ad-be5b-ca2e1a890040","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","5134f027-c62d-45e6-9302-75a8d7739fdd","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","5c7e60fb-b184-49da-97a3-b7a66e99e0a3","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","c4d285f5-6e99-42fe-a51d-42afa50c4328","lifecycle-step","architecture_review_as_built"]

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 17
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 3
skip_reasons:
