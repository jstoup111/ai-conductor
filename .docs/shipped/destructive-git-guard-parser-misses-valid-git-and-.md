---
slug: destructive-git-guard-parser-misses-valid-git-and-
spec_hash: 55541cece7e61770f9d36c5fa16c160c0bd1f40f6ce6f45848f836095ec8f0fd
pr: https://github.com/jstoup111/ai-conductor/pull/2997
shipped: 2026-10-06
engine_version: 20261006T095922Z-fd83edec5ce4
findings:
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-fail-closed-git-option-normalization decision 6"
    outcome: remediated
    summary: "[99% verified] hooks/claude/block-destructive-git.sh:115-120 exits parser evaluation on the first truthy verdict, including non-blocking `rebase-note` and conditionally blocking `branch-delete`. Later destructive commands in the same compound command are therefore not scanned."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-fail-closed-git-option-normalization decision 2"
    outcome: remediated
    summary: "[99% verified] The PATH normalizer still strips `no-` before exact-name resolution at src/conductor/src/engine/git-hook-assets.ts:93-103. Consequently valid `reset --no-refresh`, declared at src/conductor/src/engine/git-option-spec.ts:66, resolves as a forbidden negation of `refresh` and is refused."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-fail-closed-git-option-normalization decision 3"
    outcome: remediated
    summary: "[99% verified] The prior later-subcommand scan is present, but its remediation remains noncompliant with D3’s feature-repository scoping. src/conductor/src/engine/git-hook-assets.ts:182-190 finds a guarded command anywhere after the unknown global, then constructs the common-directory query only from argv before unknown_prefix_end. Consequently, recognized target selectors after the unknown token—`-C <path>`, repeated `-C`, `--git-dir <path>`, and `--git-dir=<path>`—are omitted. From a feature-worktree cwd, forms such as `--no-pag -C /outside HEAD reset --hard` are falsely refused against the feature repository; the reverse ordering can omit a required feature-repository refusal. This newly reachable path was introduced by the AB-3 remediation and also conflicts with the inherited D4 requirement that repository targeting honor `-C` and `--git-dir`."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-fail-closed-git-option-normalization decision 8"
    outcome: remediated
    summary: "[100% verified] The control inventory remains stale: docs/reference/settings-and-hooks.md:136 still describes pattern matching, while lines 288-290 still say non-canonical spellings pass until #2904 ships."
---

## Cost
input: 2633820
output: 284417
cache_read: 44155429
cache_creation: 1304070
cost_usd: 37.4671
dispatches: 92
retries: 3
halts: 10
unmetered: count: 35, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2633602, output: 141337, cache_read: 38073344, cache_creation: 0, cost_usd: 21.8105, dispatches: 38, cost_unmetered: 0
  claude: input: 218, output: 143080, cache_read: 6082085, cache_creation: 1304070, cost_usd: 15.6566, dispatches: 54, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","4466271a-1ce4-443c-b7b2-25b9ef05ac27","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 8
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
