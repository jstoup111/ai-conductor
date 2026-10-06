---
slug: engine-prompts-direct-daemon-sessions-to-ai-conduc
spec_hash: 339de4a50f4bda2fcde687278048524156fed6bb78b376a82aa3f3c5dec7f006
pr: https://github.com/jstoup111/ai-conductor/pull/2920
shipped: 2026-10-06
engine_version: 20261006T122043Z-5c4e39f1a089
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-10-01-daemon-session-command-contracts decision 5"
    outcome: remediated
    summary: "Verified (99%): src/conductor/src/daemon-cli.ts:981 recursively creates the producer directory before src/conductor/src/execution/managed-session-context.ts:74-83 canonicalizes and checks containment. A pre-existing .pipeline/session-events symlink can therefore cause an outside directory write before rejection, violating D5’s requirement to reject symlink escapes rather than write outside the provisioned root."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-10-01-daemon-session-command-contracts decision 5"
    outcome: remediated
    summary: "Verified (99%): src/conductor/src/engine/closeout-tail.ts:148-156 emits malformed/oversized/invalid-attribution diagnostics through best-effort emit and then unconditionally acknowledges the producer record. src/conductor/src/ui/events.ts:24-45 swallows subscriber failures, so canonical persistence can fail while source progress advances, contrary to D5’s persistence-before-progress rule."
---

## Cost
input: 9975543
output: 1023155
cache_read: 225153498
cache_creation: 4765821
cost_usd: 160.2485
dispatches: 139
retries: 12
halts: 23
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 9974427, output: 585602, cache_read: 177677952, cache_creation: 0, cost_usd: 92.0169, dispatches: 84, cost_unmetered: 0
  claude: input: 1116, output: 437553, cache_read: 47475546, cache_creation: 4765821, cost_usd: 68.2316, dispatches: 55, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","f390803e-f2ca-4b84-9d29-5954dcc9bf3b","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 2
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 9
  security: failures: 0, judged: 9
  testQuality: failures: 0, judged: 8
skip_reasons:
