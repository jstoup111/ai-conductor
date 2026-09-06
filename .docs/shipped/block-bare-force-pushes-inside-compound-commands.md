---
slug: block-bare-force-pushes-inside-compound-commands
spec_hash: 492022128b0406537b114146f61083871f45ee0337ca150cddec5d3bf1f68224
pr: https://github.com/jstoup111/ai-conductor/pull/2221
shipped: 2026-09-06
engine_version: 20260906T030606Z-bfc8d7361f81
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "`src/conductor/test/tmpdir-leak-guard.ts:79` — commit 17ac4a5aa adds `moshi-codex-rl.json` to `IGNORED_TMPDIR_PREFIXES` (and `src/conductor/test/tmpdir-leak-guard.test.ts:193,204`), widening an unrelated test-infrastructure guard; neither file appears in the plan's task **Files:** lists and the commit carries no `Scope:` trailer"
    accepted: false
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "`src/conductor/test/integration/session-hooks-provisioning.test.ts:88` — commit 318a1f678 deletes the pre-existing `expect(raw).not.toMatch(/\\/home\\//)` assertion from an unrelated integration test; the file is not in the plan's **Files:** lists and the commit carries no `Scope:` trailer"
    accepted: false
---

## Cost
input: 884083
output: 108212
cache_read: 18283078
cache_creation: 434422
cost_usd: 14.6732
dispatches: 20
retries: 1
halts: 2
unmetered: count: 6, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 883965, output: 59515, cache_read: 14735616, cache_creation: 0, cost_usd: 7.3372, dispatches: 9, cost_unmetered: 0
  claude: input: 118, output: 48697, cache_read: 3547462, cache_creation: 434422, cost_usd: 7.336, dispatches: 5, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
