---
slug: dependency-edges-are-hand-maintained-intake-and-de
spec_hash: c544a39b3db73c74547c1ed245f0f7ed6d97f1a51bbb7e526269790317993e0b
pr: https://github.com/jstoup111/ai-conductor/pull/3133
shipped: 2026-10-11
engine_version: 20261011T125659Z-cc1b0a49f473
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Land can write operator-named edges beyond the linkable-proposal set that ADR D3 and the plan describe. The operator explicitly names the edge, so this is within the dependency-confirmation intent, but it bypasses the self/closed/already-linked filtering applied to proposals and is visible on GitHub."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "Unrelated to the dependency feature. Likely prompted by this feature's plan growth changing the corpus maximum. It is not user-visible and harmless."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1"
    outcome: remediated
    summary: "Verified, 99%: structured dependency parsing is not shared consistently. issue-event-sync.ts:98 passes an entire field value to dependency-reconciler.ts:115, which accepts only one reference. The advertised '#123, #456' form input loses #456. Qualified same-repository fields are accepted by the Action but missed by body-only callers at land-dependency-gate.ts:203 and dependency-reconciler.ts:267. Paths are under src/conductor/src/engine/engineer/. Centralize raw-body form extraction and preserve the supported field grammar across all callers."
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/engineer/dependency-reconciler.ts:140 retains parsed edges even when their containing task-list text is flagged for manual review. For '- [ ] Phase 1 blocked by #10', the parser returns both an edge and a task-list flag. That edge reaches Action writes at intake/issue-event-sync.ts:104, land proposals at land-dependency-gate.ts:233, and drift findings at dependency-reconciler.ts:268. D1 requires task-list references to yield no edge."
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1"
    outcome: remediated
    summary: "Verified, 100%: the approved TrackerClient/BlockerResolver composition is replaced by a separate DependencyDriftTracker interface at src/conductor/src/engine/engineer/dependency-reconciler.ts:61, duplicated adapters at src/conductor/src/engine/engineer-cli.ts:689 and src/conductor/src/intake-loop-cli.ts:149, and private cycle detection at dependency-reconciler.ts:191 and :294. This also contradicts the approved feature diagram's REC→TRK and REC→RES relationships and drift-sweep ADR D2. Restore the approved component composition."
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 3"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/engineer/land-dependency-gate.ts:219 inherits buildSuggestions' five-item display cap, then :234 consumes only suggestions.shown. Additional known linkable overlaps in suggestions.omitted never become proposals or require decisions. Self filtering at :230 happens after capping. Include every eligible computed overlap in the blocking decision set."
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 3"
    outcome: remediated
    summary: "Verified behavior, 95% confidence in disposition: src/conductor/src/engine/engineer/land-dependency-gate.ts:216 uses the advisory branch-resolution helper without distinguishing tracker failure. intake/overlap-sources.ts:167 catches issue-state lookup errors and returns null; land-dependency-gate.ts:238 labels the result markerless and returns computed. An unreadable marked branch therefore bypasses the unavailable-check refusal and explicit skip. Preserve advisory local-git behavior while propagating failed tracker reads to the land gate."
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 4"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/engineer/land-dependency-gate.ts:127 returns proceed for an unavailable check with a skip before contradictory accept/decline validation at :136. Supplying the same target in both lists plus an outage skip can commit instead of producing dependency-decisions-invalid. Validate independently knowable decision contradictions before branching on proposal availability."
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-drift-sweep-on-intake-tick decision 2"
    outcome: remediated
    summary: "Verified, 100%: src/conductor/src/engine/engineer/dependency-reconciler.ts:266 includes completed blockers in actual, and :284 reports reverse-direction contradictions without checking their completion state. A completed blocker can therefore appear as a finding, contrary to D2's explicit exclusion. Preserve completed links for declaration satisfaction while excluding them from contradiction findings."
  - gate: architecture_review_as_built
    finding: "as-built:3263785f-cd0d-4abd-b81f-e3a6edd85ea9:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-drift-sweep-on-intake-tick decision 2"
    outcome: remediated
    summary: "Verified, 99%: production listings at src/conductor/src/engine/engineer-cli.ts:694 and src/conductor/src/intake-loop-cli.ts:154 stop at 1,000 open issues. The shared sweep lists once at dependency-reconciler.ts:241 and returns swept without completeness handling. Repositories beyond that bound silently omit issues despite D2 requiring every open issue to be checked. Complete the listing or explicitly report an indeterminate repository when completeness cannot be established."
  - gate: architecture_review_as_built
    finding: "as-built:87cef040-b68a-4e5b-a40b-f5bdc743aaf0:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-reconciler-and-edge-write-ownership decision 1"
    outcome: remediated
    summary: "Verified, 99%: the task-list repair remains source-insensitive. At src/conductor/src/engine/engineer/dependency-reconciler.ts:121 and :138, '### Depends on\\n- [ ] Phase 1 blocked by #10' creates a form-derived edge despite its manual-review flag; :141 filters only prose-derived edges. Conversely, :134 and :141 suppress an independent valid 'Blocked by #10.' declaration whenever a task-list line mentions the same target. These changed repair sites affect Action writes (intake/issue-event-sync.ts:94), land proposals (land-dependency-gate.ts:204), and sweep findings (dependency-reconciler.ts:248). Exclude ambiguous source text consistently before extraction, preserving independent valid declarations and manual-review records."
  - gate: architecture_review_as_built
    finding: "as-built:87cef040-b68a-4e5b-a40b-f5bdc743aaf0:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-09-dependency-drift-sweep-on-intake-tick decision 2"
    outcome: remediated
    summary: "Verified, 99%: the pagination repair introduces pull requests into the issue sweep. src/conductor/src/engine/tracker-client.ts:1009 switches to the repository Issues REST endpoint, then :1015–1025 maps every entry without filtering pull_request. Both audit and intake therefore sweep PRs as issue dependencies, potentially producing extraneous findings or indeterminate entries. This is newly changed code since the prior lap. Filter PR entries while retaining complete pagination. GitHub documents the mixed response and discriminator in [List repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)."
---

## Cost
input: 2169424
output: 336167
cache_read: 49505197
cache_creation: 2192311
cost_usd: 49.7055
dispatches: 48
retries: 0
halts: 6
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2169190, output: 129175, cache_read: 39796480, cache_creation: 0, cost_usd: 26.0845, dispatches: 23, cost_unmetered: 0
  claude: input: 234, output: 206992, cache_read: 9708717, cache_creation: 2192311, cost_usd: 23.621, dispatches: 25, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","1c98fc06-06dd-4613-8498-4d088e72752e","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 2
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 3, judged: 6
skip_reasons:
