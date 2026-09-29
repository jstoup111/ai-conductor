---
slug: daemon-commits-co-authored-by-the-configured-bot
spec_hash: 98816ee3ae1ac512019a6b0a0deea1a41fe496595dcca62dc036da730bfef4e4
pr: https://github.com/jstoup111/ai-conductor/pull/2839
shipped: 2026-09-29
engine_version: 20260929T224340Z-3ed99833a1db
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/github-invocation-audit.ts:354-369 — registers runBotIdentityRead as a guarded dynamic-runner forwarder owned by tracker-client.ts; file is on no task's Files line"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-001
    class: REMEDIABLE
    governing_clause: "adr-2026-09-11-github-operation-ownership decision 10"
    outcome: remediated
    summary: "[verified, 99%] The hook exits for an empty index at git-hook-assets.ts:108-112 before the co-author stanza at lines 114-119. Required --allow-empty daemon commits therefore cannot receive the trailer, violating D10.3 and Plan Task 6."
  - gate: architecture_review_as_built
    finding: AB-002
    class: REMEDIABLE
    governing_clause: "adr-2026-09-11-github-operation-ownership decision 10"
    outcome: remediated
    summary: "[verified, 97%] runDaemonMode installs the resolver without a fallback event emitter at daemon-cli.ts:861, before the daemon emitter exists at line 1137. Default rebase-resolution and CI-fix preparation supply no emitter, so failed identity resolution can omit D10.6's required spine warning."
  - gate: architecture_review_as_built
    finding: AB-003
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "[verified, 98%] worktree-prepare.ts:250-252 emits after a co-author write/removal failure but does not remove an existing .pipeline/co-author file. A stale trailer can remain active, contradicting Task 8's fail-open no-trailer outcome."
  - gate: architecture_review_as_built
    finding: AB-004
    class: REMEDIABLE
    governing_clause: "Task 4"
    outcome: remediated
    summary: "[verified, 99%] tracker-client.ts:400 converts 401/403 responses to GithubBotAuthRefusalError('auth-refused'), while bot-co-author.ts:50 maps every error of that class to token-unavailable. Task 4 requires identity-read-failed for 401/403 identity reads."
  - gate: architecture_review_as_built
    finding: AB-005
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "[verified, 99%] The sealed mechanical invariant is absent: daemon-commit-co-author-guard.test.ts does not exist, so future daemon commit sites can bypass the shared helper without the required repository test naming the site."
  - gate: architecture_review_as_built
    finding: AB-006
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "[verified, 99%] Default rebase-resolution and CI-fix worktrees call prepareWorktree without an events emitter (autoresolve.ts:377-379; ci-fix.ts:573-675). If writing or removing .pipeline/co-author fails, worktree-prepare.ts:250-255 swallows the failure and emits only through opts?.events, so these daemon paths continue without Task 8's required bot_co_author_skipped warning. The resolver's daemon-wide fallback emitter cannot cover this later filesystem failure."
  - gate: architecture_review_as_built
    finding: AB-007
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "[verified, 99%] bot-co-author.ts:84-87 suppresses failure to remove stale .pipeline/co-author state and returns normally. worktree-prepare.ts:244 then continues, while git-hook-assets.ts:108-112 reads any surviving stale file. If replacement and cleanup both fail, later commits can receive stale bot attribution, contradicting Task 8's explicit no-file/no-trailer postcondition."
---

## Cost
input: 2528265
output: 313726
cache_read: 42353082
cache_creation: 1064366
cost_usd: 34.8933
dispatches: 54
retries: 5
halts: 6
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2528009, output: 186222, cache_read: 34717696, cache_creation: 0, cost_usd: 20.8001, dispatches: 34, cost_unmetered: 0
  claude: input: 256, output: 127504, cache_read: 7635386, cache_creation: 1064366, cost_usd: 14.0932, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","932f2dba-3f11-4f20-a098-c60fcdf803c2","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
