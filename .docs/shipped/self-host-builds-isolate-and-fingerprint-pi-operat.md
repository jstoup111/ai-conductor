---
slug: self-host-builds-isolate-and-fingerprint-pi-operat
spec_hash: a557dce7f28834b16fec6d71dc404cb72a1a7d295bf579347234e516375b358b
pr: https://github.com/jstoup111/ai-conductor/pull/2991
shipped: 2026-10-05
engine_version: 20261004T174827Z-4925f7bb7cbf
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "test/engine/github-bot-cli-entry.test.ts:10-12, test/engine/github-bot-read-identity.test.ts:19-21, test/engine/github-bot-token-confinement.test.ts:17-19: each adds a hoisted `vi.resetModules()` ahead of its `node:child_process` mock. No plan task lists these files (commit 8732a0972)."
    accepted: true
---

## Cost
input: 2363592
output: 270167
cache_read: 49915674
cache_creation: 1169206
cost_usd: 36.9769
dispatches: 54
retries: 4
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2363282, output: 148168, cache_read: 42231808, cache_creation: 0, cost_usd: 20.6351, dispatches: 27, cost_unmetered: 0
  claude: input: 310, output: 121999, cache_read: 7683866, cache_creation: 1169206, cost_usd: 16.3419, dispatches: 27, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","d3016743-8f74-4937-8544-415e6bd849ed","lifecycle-step","finish"]

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 2, judged: 6
skip_reasons:
