---
slug: automatic-rebase-preserves-merges-carrying-unique-
spec_hash: 04d5a43079d86c0f372924afb4565fbaca0c139a382b2f1c531d17385c0836a6
pr: https://github.com/jstoup111/ai-conductor/pull/2861
shipped: 2026-10-01
engine_version: 20260930T225148Z-18b2a2a206ea
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: the dedicated refusal HALT is now reachable, but flattenRefusalRecipe still omits the required git -C <worktree> command, concrete base argument, merge-stop instruction, and git rebase --continue."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-07-12-rebase-evidence-stamp-translation decision 10"
    outcome: remediated
    summary: "Verified, 99% confidence: absorption remains broken. Planning records side-lineage targets as synthetic flattened SHAs (rebase.ts:938-943), but translation records the post-image only under the original merge SHA and then looks up map[syntheticSha] (rebase-translate.ts:122-133). Those side-lineage and flattened-successor absorption points remain residue. An ancestry-only merge also records only its first planned successor, not the first later surviving successor."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "adr-2026-06-29-rebase-conflict-resolution-dispatch decision 2"
    outcome: remediated
    summary: "Verified, 99% confidence: the expected-subjects expression at rebase.ts:1907 is parsed as (expectedSubjects ?? condition) ? ORIG_HEAD subjects : []. A present replay-list array therefore still selects onto..ORIG_HEAD subjects, so FR-9 rejects intentionally omitted ancestry and side-lineage subjects."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 6"
    outcome: remediated
    summary: "Verified, 98% confidence: a flattened replay that pauses on an ordinary conflict loses its flatten data before resolver completion, so the successful resolved path emits no required rebase_merge_audit event."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 7"
    outcome: remediated
    summary: "Verified, 98% confidence: failed or malformed rev-list --merges output falls back to the plain mutating rebase instead of producing the required fail-closed refusal. Related planning failures throw rather than returning the shared refusal contract."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: the shared refusal contract still permits empty D5 identity fields. Malformed merge output and planning failures use emptyPlan(), while the refusal builder defaults mergeSha, both parents, and flattenedSha to empty strings (rebase.ts:989-1028). A failed merge-list command is instead converted to conflict_halt (rebase.ts:1014-1015,1381-1390)."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "adr-2026-06-29-rebase-conflict-resolution-dispatch decision 2"
    outcome: remediated
    summary: "Verified, 98% confidence: flattened FR-9 subject capture fails open. A failed subject lookup for an ordinary picked entry becomes an empty string and is filtered out, after which the real replay still starts (rebase.ts:1050-1058). FR-9 can therefore omit a picked commit instead of refusing."
  - gate: architecture_review_as_built
    finding: AB-8
    class: REMEDIABLE
    governing_clause: "Task 1"
    outcome: remediated
    summary: "Verified, 99% confidence: RebaseOutcome consumer exhaustiveness is not mechanically enforced as planned. The conductor, re-kick, and autoresolve use ordinary conditional branches without an assert-never/exhaustive assignment (conductor.ts:14328-14335,15190-15194; daemon-rekick.ts:972-983; autoresolve.ts:1213-1247), so removing a flatten_refused branch does not inherently make typecheck fail."
  - gate: architecture_review_as_built
    finding: AB-9
    class: REMEDIABLE
    governing_clause: "adr-2026-09-11-github-operation-ownership decision 10"
    outcome: remediated
    summary: "Verified, 99% confidence: the flattened commit-tree invocation at rebase.ts:937-940 supplies a raw message instead of withDaemonCoAuthorTrailer, violating D10's every-daemon-commit/shared-helper rule. The static guard misses it because the argument array begins with '-c' rather than 'commit-tree'."
  - gate: architecture_review_as_built
    finding: AB-10
    class: REMEDIABLE
    governing_clause: "adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 9"
    outcome: remediated
    summary: "Verified, 98% confidence: rebase.ts:1050 validates only the beginning of rev-list --merges output. A valid SHA followed by a malformed line proceeds into planning instead of producing D9's generic malformed-output start failure."
  - gate: architecture_review_as_built
    finding: AB-11
    class: REMEDIABLE
    governing_clause: "adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 5"
    outcome: remediated
    summary: "Verified at 99% from current source: D5 requires exhaustive RebaseOutcome handling, but applyRebaseVerdicts (rebase.ts:2322), recordRebaseStepCompletion (rebase.ts:2610), and emitRebaseEvent (rebase.ts:2811) lack a never-checked terminal branch. A future outcome can therefore be silently marked satisfied/done or emit no terminal event."
---

## Cost
input: 5449630
output: 818602
cache_read: 118991175
cache_creation: 3560266
cost_usd: 107.706
dispatches: 106
retries: 9
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5448742, output: 372011, cache_read: 91715456, cache_creation: 0, cost_usd: 52.0253, dispatches: 44, cost_unmetered: 0
  claude: input: 888, output: 446591, cache_read: 27275719, cache_creation: 3560266, cost_usd: 55.6807, dispatches: 62, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","175e65d6-b98a-41ed-bc73-9960743965a7","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 2
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 12
  security: failures: 0, judged: 12
  testQuality: failures: 8, judged: 12
skip_reasons:
