---
slug: destructive-git-prevention-is-absent-in-self-host
spec_hash: a4d39ca2e679e011d9b0c8a509c3b742b966b301f07fcd53dc022437ddef5699
pr: https://github.com/jstoup111/ai-conductor/pull/2773
shipped: 2026-10-03
engine_version: 20261003T122408Z-086e998df5dd
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/full-suite-verifier.ts:1033-1083 — when acquiring the test_suite lock times out and current evidence is not reusable, the verifier waits one lock-retry interval and re-inspects; a PASS published by the concurrent holder in that window is returned as REUSED instead of FAILED"
    accepted: true
    decision: accept
    rationale: "Operator: narrow per-worktree test_suite lock publication race fix; only re-reads same-code evidence, no gate relaxation"
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/test/engine/protected-artifact-seal.test.ts — the execa module mock and its exact git-argv-sequence assertions are replaced by a PATH-shim git that exits non-zero only on `diff`; no production file changes"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.3
    summary: "src/conductor/src/engine/smoke-runner.ts:12-13,160-161 — the smoke runner now launches vitest as `process.execPath` plus the package-resolved `vitest.mjs` entry, instead of a bare `vitest` resolved from the child PATH, for every smoke file it runs"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.4
    summary: "src/conductor/test/self-host-verification-entries.test.ts:31 and test/acceptance/full-suite-verification-gate.acceptance.test.ts:264 — test expectations changed from `verification.mode: 'aggregate'` to `{ mode: 'changed', full_suite: 'once' }` to match the repository's committed .ai-conductor/config.yml:159-162"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.5
    summary: "docs/contributing/testing.md:200-202,424-439 — the contributor smoke inventory now lists the git-guard Claude/Codex smoke files and states that credentialed capabilities need the provider binary; the same edit also refreshes repository-wide test-file counts and adds unrelated pre-existing smoke files and a `credentialed:pi` row"
    accepted: true
  - gate: architecture_review_as_built
    finding: adr-d1-real-git-not-guaranteed-absolute
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 1"
    outcome: remediated
    summary: "Verified, 99% confidence: resolveRealGit returns join(entry, 'git') without enforcing an absolute path, so a relative PATH entry produces a relative real-git sidecar (git-guard.ts:3,10-15,24-28)."
  - gate: architecture_review_as_built
    finding: adr-d1-guard-regular-file-not-enforced
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 1"
    outcome: remediated
    summary: "Verified, 98% confidence: writeFile/chmod and stat follow an existing symlink, so provisioning and verification do not enforce the required regular, non-symlink guard file (git-guard.ts:19-28,41-46)."
  - gate: architecture_review_as_built
    finding: adr-d2-codex-child-path-replaced
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 2"
    outcome: remediated
    summary: "Verified, 99% confidence: ordinary Codex invocationEnv has no PATH, so withGitGuardPath gives the spawned child only the guard directory, while shell_environment_policy receives guard plus process.env.PATH; the required inherited-PATH prepend is not delivered consistently (child-environment.ts:34-36; codex-provider.ts:330-334,1032-1059)."
  - gate: architecture_review_as_built
    finding: adr-d3-config-probe-fails-open
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: after finding the engine marker, a failed core.hooksPath probe returns null; both providers then launch unguarded instead of failing closed (git-guard.ts:34-40; claude-provider.ts:666-700; codex-provider.ts:302-334)."
  - gate: architecture_review_as_built
    finding: adr-d4-extra-git-fast-path
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 4"
    outcome: remediated
    summary: "Verified, 100% confidence: every named command performs a real-git alias config query before classification, contradicting the immediate-exec/no-extra-git-call requirement for commands that cannot be destructive (git-hook-assets.ts:29-37)."
  - gate: architecture_review_as_built
    finding: adr-d4-git-dir-equals-bypass
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: global parsing handles only separate --git-dir and -C arguments; canonical --git-dir=<path> becomes the apparent command and bypasses destructive classification (git-hook-assets.ts:21-29,42-81)."
  - gate: architecture_review_as_built
    finding: adr-d5-plus-refspec-gap
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: the ADR refuses every plus-prefixed refspec, but the implementation matches only plus-prefixed values containing a colon (git-hook-assets.ts:43-46)."
  - gate: architecture_review_as_built
    finding: adr-d5-target-alias-bypass
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 5"
    outcome: remediated
    summary: "Verified, 98% confidence: alias lookup omits the parsed -C/--git-dir prefix, so a target-repository alias can remain unexpanded and reach real git without destructive classification (git-hook-assets.ts:21-35)."
  - gate: architecture_review_as_built
    finding: adr-d6-environment-claim-pattern
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: --force\\b also matches --force-with-lease, incorrectly exempting lease claims, while bare force is recognized only immediately after push and misses forms such as git push origin --force (environment-claim-audit.ts:207-212)."
  - gate: architecture_review_as_built
    finding: adr-d8-multiple-heredoc-bodies-not-dropped
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 8"
    outcome: remediated
    summary: "Verified, 96% confidence: the scanner stores one delimiter and selects only the first opener on a line, so later bodies from a command declaring multiple heredocs are scanned as command text instead of being dropped (block-destructive-git.sh:57-81)."
  - gate: architecture_review_as_built
    finding: adr-d10-proof-and-inventory-absent
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 10"
    outcome: remediated
    summary: "Verified, 100% confidence: required provider/run-mode adapter coverage, provider-specific live guard smokes, and the settings-and-hooks control inventory are absent. Only the guard-script and review-exemption guard tests exist, and docs/reference/settings-and-hooks.md:130-136 still documents only the operator hook."
  - gate: architecture_review_as_built
    finding: adr-d1-trailing-slash-real-git-self-resolution
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 1"
    outcome: remediated
    summary: "Verified, 100% confidence: resolveRealGit excludes only a lexical `.pipeline/bin` suffix. Trailing-slash, dot-segment, or symlink spellings can select the guard itself as the recorded real git."
  - gate: architecture_review_as_built
    finding: adr-d2-build-review-exemption-not-applied
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 2"
    outcome: remediated
    summary: "Verified, 100% confidence: built-in-only review laps use the prepared feature worktree and step-runners.ts:4091 adds `readOnlyReview` only for custom-policy laps. Claude, Codex, and Pi therefore install the guard during built-in-only build_review dispatches, contrary to the approved exemption."
  - gate: architecture_review_as_built
    finding: adr-d3-missing-hooks-directory-fails-open
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 3"
    outcome: remediated
    summary: "Verified, 100% confidence: ensureGitGuardForDispatch returns null when `.pipeline/git-hooks` is missing before reading the still-configured worktree core.hooksPath, allowing a prepared worktree to launch unguarded."
  - gate: architecture_review_as_built
    finding: adr-d4-safe-command-extra-git-query
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 4"
    outcome: remediated
    summary: "Verified, 100% confidence: `worktree` is absent from git-hook-assets.ts:31's immediate-exec allowlist, so `git worktree list` performs an extra alias-config query. Task 21 explicitly requires exactly one byte-identical real-git invocation."
  - gate: architecture_review_as_built
    finding: adr-d6-audit-exempts-unguarded-review
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 6"
    outcome: remediated
    summary: "Verified, 100% confidence: DispatchEnvironmentFacts has no `gitGuardInstalled` fact, conductor.ts:6759-6762 supplies none, and environment-claim-audit.ts:216-218 exempts bare-force claims unconditionally. Unguarded review and unprepared dispatches can therefore receive a false exemption."
  - gate: architecture_review_as_built
    finding: adr-d5-quoted-alias-tokenization-bypass
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: Bash `read -r -a` does not implement Git's quote-aware alias parsing. A valid alias such as `reset '--hard'` evades guard classification, after which real Git parses it as destructive `reset --hard`."
  - gate: architecture_review_as_built
    finding: adr-d2-pi-provider-unprotected
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 2"
    outcome: remediated
    summary: "Verified, 98% confidence: Pi is now a built-in production provider, but PiProvider invokes its subprocess without guard verification or a guarded child PATH. The approved decision makes every provider adapter's child-environment construction the enforcement point."
  - gate: architecture_review_as_built
    finding: adr-d10-proof-and-inventory-incomplete
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 10"
    outcome: remediated
    summary: "Verified, 99% confidence: Pi is now a guarded built-in adapter, but no Pi guard-specific live smoke proves `command -v git` and destructive-command refusal, and docs/reference/settings-and-hooks.md still describes only Claude and Codex coverage."
  - gate: architecture_review_as_built
    finding: plan-task-19-missing-hooks-repair-not-delivered
    class: REMEDIABLE
    governing_clause: "Task 19"
    outcome: remediated
    summary: "Verified, 100% confidence: git-guard.ts:71-73 throws when the configured hooks directory is missing instead of repairing the guard and launching guarded as Task 19 requires; no missing-hooks test exists in git-guard.test.ts."
  - gate: architecture_review_as_built
    finding: adr-d1-self-resolved-sidecar-still-accepted
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 1"
    outcome: remediated
    summary: "Verified, 99% confidence: git-guard.ts:77-87 validates the real-git sidecar using only absoluteness and a lexical `.pipeline/bin` substring check. An absolute symlink or normalized alias resolving back to the guard can remain trusted, so Task 18's canonical/content repair is incomplete."
  - gate: architecture_review_as_built
    finding: adr-d8-quoted-heredoc-opener-suppresses-later-command
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: block-destructive-git.sh recognizes heredoc openers before removing quoted spans. Quoted text such as `echo '<<EOF'` can register a nonexistent delimiter and suppress scanning of a later real destructive command."
  - gate: architecture_review_as_built
    finding: plan-task-16-default-suite-proof-incomplete
    class: REMEDIABLE
    governing_clause: "Task 16"
    outcome: remediated
    summary: "Verified, 99% confidence: the amended Task 16 requires an executable assertion that every live-provider test is smoke-only and excluded from default Vitest. smoke-entry-point.test.ts only enumerates known smoke files; the broader execution-policy scan neither recognizes Pi nor adapter-based live invocations, so the universal criterion remains unproved."
  - gate: architecture_review_as_built
    finding: adr-d3-missing-pipeline-fails-open
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 3"
    outcome: remediated
    summary: "Verified, 100% confidence: ensureGitGuardForDispatch returns null when .pipeline is absent before reading worktree-scoped core.hooksPath. A configured prepared worktree whose .pipeline directory was deleted therefore launches unguarded, contrary to fail-closed re-verification and Task 19's requirement that only a cwd without .git may skip the config probe."
  - gate: architecture_review_as_built
    finding: adr-d6-force-claim-punctuation
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: an unquoted claim ending in `git push --force.` is tokenized as `--force.` and is incorrectly refuted, even though it names the guard-refused bare-force operation."
  - gate: architecture_review_as_built
    finding: adr-d8-spaced-quoted-heredoc-not-dropped
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 8"
    outcome: remediated
    summary: "Verified, 99% confidence: the hook's quote mask preserves a quoted heredoc delimiter only immediately after `<<` or one space after it. A valid opener such as `cat <<  'EOF'` is masked before delimiter detection, leaving destructive text in its body scannable and falsely refused."
  - gate: architecture_review_as_built
    finding: adr-d6-audit-exemption-not-dispatch-bound
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 6"
    outcome: remediated
    summary: "Verified, 100% confidence: Task 22 is not implemented. DispatchEnvironmentFacts has no gitGuardInstalled fact, conductor supplies none, and bare-force claims are exempted unconditionally. Unguarded build_review and unprepared dispatches can therefore receive a false exemption."
  - gate: architecture_review_as_built
    finding: adr-d5-config-env-global-option-bypass
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 5"
    outcome: remediated
    summary: "100% confidence: the global-option parser does not consume Git's valid --config-env=<name>=<envvar> form, documented by [Git 2.53](https://git-scm.com/docs/git/2.53.0). It becomes the apparent subcommand, so a following reset --hard bypasses destructive classification and reaches real Git."
  - gate: architecture_review_as_built
    finding: adr-d8-shell-quote-removal-and-comment-openers
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 8"
    outcome: remediated
    summary: "99% confidence: heredoc detection retains raw escaped or mixed-quoted delimiters and recognizes openers inside comments. Bash performs delimiter quote removal and ignores comment text, so forms such as <<\\EOF, <<E\"OF\", or # <<EOF can suppress scanning of a later destructive command. See the [Bash redirection](https://www.gnu.org/software/bash/manual/html_node/Redirections.html) and [comment](https://www.gnu.org/software/bash/manual/html_node/Comments.html) rules."
  - gate: architecture_review_as_built
    finding: adr-d4-branch-reachability-target-prefix-omitted
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 4"
    outcome: remediated
    summary: "100% confidence: branch -D classification invokes merge-base and for-each-ref without the parsed -C/--git-dir prefix. From a foreign repository, the guard can judge reachability against the wrong repository and permit deletion of an unreachable feature branch."
  - gate: architecture_review_as_built
    finding: adr-d10-parser-limit-missing-from-control-inventory
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 10"
    outcome: remediated
    summary: "Verified, 98% confidence: the approved D5 amendment defers non-canonical Git spellings to #2904 and requires that limit under D10, but docs/reference/settings-and-hooks.md:280 does not record it. A remaining example is the unclassified `branch -d -f` spelling."
  - gate: architecture_review_as_built
    finding: adr-d5-branch-force-misclassified-as-delete
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: git-hook-assets.ts:82 treats --force alone as forced deletion without requiring --delete. Valid `git branch --force <name> <start>` operations can therefore be refused outside the approved refusal matrix."
  - gate: architecture_review_as_built
    finding: adr-d3-repair-error-can-omit-guard-path
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 3"
    outcome: remediated
    summary: "Verified, 98% confidence: git-guard.ts:40 resolves real Git and probes the common directory outside the guard-path-wrapping error boundary. Those repair failures remain fail-closed but can omit the required `.pipeline/bin/git` path from the diagnostic."
  - gate: architecture_review_as_built
    finding: adr-d10-control-inventory-contradicts-shipped-classifier
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-engine-git-guard-on-agent-path decision 10"
    outcome: remediated
    summary: "Verified at 99% confidence: the control inventory says --config-env forms and Git-quoted aliases pass through unclassified until #2904, while git-hook-assets.ts:24-26 and :36-57 explicitly classify those forms. The documented D10 limit therefore contradicts shipped behavior and the D5 deferral amendment."
---

## Cost
input: 10293187
output: 1410892
cache_read: 212299539
cache_creation: 5442794
cost_usd: 170.8942
dispatches: 403
retries: 21
halts: 29
unmetered: count: 241, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10291843, output: 703398, cache_read: 164630016, cache_creation: 0, cost_usd: 92.4348, dispatches: 325, cost_unmetered: 0
  claude: input: 1344, output: 707494, cache_read: 47669523, cache_creation: 5442794, cost_usd: 78.4594, dispatches: 78, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","30de71e9-454c-4761-b438-264fb3b2d5d5","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 7
  security: failures: 0, judged: 12
  testQuality: failures: 2, judged: 12
skip_reasons:
