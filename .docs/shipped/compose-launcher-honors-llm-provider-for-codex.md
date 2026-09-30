---
slug: compose-launcher-honors-llm-provider-for-codex
spec_hash: 1249452de9569db78b5807b2c8d59ba3664e85ec4c677597497cb5a4e6b38b5b
pr: https://github.com/jstoup111/ai-conductor/pull/2844
shipped: 2026-09-30
engine_version: 20260930T103720Z-7384b902bf38
findings:
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-1
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 11"
    outcome: remediated
    summary: "Verified at 99% confidence: production compose/engineer wiring still invokes catalog-wide discovery and requires Claude before spawning the selected host. This violates D11 and Task 6, and can prevent a Codex-selected launch when Claude is absent."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-2
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 10"
    outcome: remediated
    summary: "99% verified: with no project config, loadLaunchConfig reopens ~/.ai-conductor/config.yml through the project-config loader. Valid user-only keys such as conductor, spec_owner, or github_bot are rejected before D10's merged user-level provider selection can launch Codex."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-4
    class: REMEDIABLE
    governing_clause: "adr-2026-09-20-operator-launched-sessions-retain-conductor-authority decision 4"
    outcome: remediated
    summary: "99% verified: the provider-agnostic interactive spawn seam does not require attached stdin and stdout TTYs. A non-interactive invocation can therefore launch an unmarked authority-bearing session, contrary to D4's structural refusal requirement."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-5
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 11"
    outcome: remediated
    summary: "98% verified: ENOENT diagnostics report host.defaultExecutable instead of the resolved executable actually passed to spawn. When CODEX_EXECUTABLE points to a missing custom path, D11's error does not name that executable."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-6
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 9"
    outcome: remediated
    summary: "99% verified: skills/composer/SKILL.md and operator documentation still state that the launcher is Claude-only and must not imply Codex launch support. This contradicts D9 and the approved architecture review's explicit commitment to replace that text."
---

## Cost
input: 1948989
output: 213564
cache_read: 36332515
cache_creation: 1060865
cost_usd: 27.0273
dispatches: 50
retries: 3
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1948703, output: 125260, cache_read: 28556416, cache_creation: 0, cost_usd: 15.4813, dispatches: 27, cost_unmetered: 0
  claude: input: 286, output: 88304, cache_read: 7776099, cache_creation: 1060865, cost_usd: 11.5461, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","c4d1e55f-b08a-48f2-a446-8a133a9981a4","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 1, judged: 5
skip_reasons:
