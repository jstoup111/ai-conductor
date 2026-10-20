---
slug: preserve-self-build-provider-transcripts-on-failed
spec_hash: 643488b30067c82f9101af766c54c6acf94a73e03394836b62e2b1d2e1282f6c
pr: https://github.com/jstoup111/ai-conductor/pull/3242
shipped: 2026-10-20
engine_version: 20261019T223530Z-89c498bda849
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an unplanned change to how the full-suite executor builds its child environment, apparently made to keep fixtures inside the Vitest temp root. It applies only when the Vitest root variable is set, and no operator-facing behavior changes."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This is an unplanned test-containment tweak to an unrelated integrity fixture. It changes no shipped behavior."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "This changes the existing scratch-home layout for members with unsafe characters. It shares the injective encoding used for capture directory names, so it serves the feature's goal of collision-free, path-safe captures. Ordinary member names such as rubric-a are unchanged."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-4
    summary: "Halt attribution now follows the step being dispatched. That is broader than transcript capture, because it can change the 'Halting step' an operator sees. Remediation task rem-prd-audit-R2 explicitly required settling HALTs against the dispatching step, so the change is within intent."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-5
    summary: "The extra token read on each sweep exists only so interrupted-capture redaction can mask the injected daemon token. That serves the credential-redaction goal, at the cost of one more token read per maintenance sweep."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:f5129d7b-d727-475f-88be-7b6474ba1374:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 2"
    outcome: remediated
    summary: "Verified, 100% confidence: interrupted Claude homes are deleted without harvesting. provider-scratch.ts:507 selects self-host-claude-* children, but sandbox-build-env.ts:289 creates harness-selfbuild-* children; provider-scratch.ts:417 then removes the home. Paths are under src/conductor/src/engine/self-host/."
  - gate: architecture_review_as_built
    finding: "as-built:f5129d7b-d727-475f-88be-7b6474ba1374:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: failed attempts remain pending and can be pruned by later success. src/conductor/src/engine/self-host/transcript-retention.ts:108 queues by step, while conductor.ts:2378 subscribes only to terminal settlement events. Retry paths at conductor.ts:10880, :11108, :11253, :11275, :12297, and configured-member retry :15134 do not settle failed captures. Subsequent success at :2391 or :14180 can prune them together. Preserve attempt/member ownership and settle failed attempts before retry."
  - gate: architecture_review_as_built
    finding: "as-built:f5129d7b-d727-475f-88be-7b6474ba1374:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 3"
    outcome: remediated
    summary: "Verified, 100% confidence: normal Claude harvesting misses the injected daemon token. src/conductor/src/engine/self-host/sandbox-build-env.ts:214 reads ambient process.env, while conductor.ts:5749 injects the token only into the child environment. The legacy path also restores ambient credentials before teardown at conductor.ts:5573. Pass the actual injected token into capture metadata for both paths."
  - gate: architecture_review_as_built
    finding: "as-built:f5129d7b-d727-475f-88be-7b6474ba1374:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 3"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/self-host/transcript-sanitize.ts:45 masks known secrets after JSON serialization. Auth values containing quotes, backslashes, or control characters become escaped and no longer match the decoded secret used at line 8. Mask decoded string values before serialization."
  - gate: architecture_review_as_built
    finding: "as-built:f5129d7b-d727-475f-88be-7b6474ba1374:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/self-host/transcript-retention.ts:198 includes every capture directory in eviction eligibility, although only timestamp metadata is filtered to retained captures at :245. The cap at :159 can therefore evict pending or unfinished captures before their verdict. Restrict eviction to retained captures."
  - gate: architecture_review_as_built
    finding: "as-built:f5129d7b-d727-475f-88be-7b6474ba1374:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 98% confidence: the daemon sweep has no retention subscriber. src/conductor/src/engine/self-host/provider-scratch.ts:160 creates a feature persistence scope; event-persister.ts:435 installs persistence but no TranscriptRetention. Interrupted captures receive neither retained events nor cap enforcement until a later Conductor is constructed. transcripts-cli.ts:80 excludes them meanwhile. Wire retention into the sweep's worktree-scoped lifetime."
  - gate: architecture_review_as_built
    finding: "as-built:f5129d7b-d727-475f-88be-7b6474ba1374:7"
    class: REMEDIABLE
    governing_clause: "Task 11"
    outcome: remediated
    summary: "Verified, 100% confidence: TranscriptRetention.stop at src/conductor/src/engine/self-host/transcript-retention.ts:81 has only test callers. Searches for retention.stop and transcriptRetention.stop found no production cleanup invocation. Wire the introduced lifecycle method into its production owner's cleanup."
  - gate: architecture_review_as_built
    finding: "as-built:a5658f97-9892-439c-9093-a3977dc97c40:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: prior retry finding remains unresolved. src/conductor/src/engine/provider-execution.ts:867 and :1035 supply provider candidate index as capture attempt; conductor.ts:5741 and :5755 forward it, while the legacy path uses constant attempt 1 at :5564. With the stable runId from step-runners.ts:1079, successive same-provider retries reuse the capture path, allowing later success to prune earlier failure evidence. Additionally, conductor.ts:2396-2400 passes configured-member identity into retry settlement, but capture member comes from auxiliaryMember at provider-execution.ts:1035; transcript-retention.ts:119 requires exact equality. Preserve lifecycle attempt identity and correctly match auxiliary captures when settling retries."
  - gate: architecture_review_as_built
    finding: "as-built:a5658f97-9892-439c-9093-a3977dc97c40:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: the new sweep retention wiring prematurely settles live pending captures. src/conductor/src/engine/self-host/provider-scratch.ts:159-164 constructs retention and reconciles every worktree before checking ownership. transcript-retention.ts:198-200 treats every unsettled capture as abandoned, then :205-207 makes it cap-eligible. Sweeps run beside live workers through daemon.ts:1797 and :720 under daemon-maintenance.ts:32 and :52-53. Scope sweep retention to recovered interrupted captures, or establish abandoned ownership before reconciliation. This regression was introduced by the R7 repair."
  - gate: architecture_review_as_built
    finding: "as-built:3bf9cf25-07e2-4345-9c7c-c4c12d992c07:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: prior finding as-built:a5658f97-9892-439c-9093-a3977dc97c40:1 remains unresolved. Capture identity now uses the retry-budget counter, which resets at src/conductor/src/engine/conductor.ts:9900 and is decremented for redispatch at :10857, :10943, :11051, :11325, :11463, :12343, and :12528. src/conductor/src/engine/step-runners.ts:1854-1855 and :1959-1960 pair that counter with a stable runId; provider-execution.ts:916 and :1091 forward it into capture identity. Auxiliary attempts also restart at provider-execution.ts:1476-1486. Consequently transcript-harvest.ts:50 can produce the same capture path for successive dispatches, overwriting earlier evidence; transcript-retention.ts:176 does not settle retries with equal attempt numbers. The configured-member mismatch also persists: conductor.ts:2408-2412 passes the configured member, but transcript-retention.ts:177 exact-matches it against captures whose member is absent or an auxiliary rubric ID (provider-execution.ts:1486). Configured retry sites conductor.ts:8098 and :15340 therefore leave those failed captures pending, and subsequent success at :2426-2431 can prune them."
  - gate: architecture_review_as_built
    finding: "as-built:3f3dfbc5-1c54-4dc8-877e-f4bad77f9875:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: the auxiliary portion of prior finding as-built:3bf9cf25-07e2-4345-9c7c-c4c12d992c07:1 remains unresolved. src/conductor/src/engine/provider-execution.ts:1497 retries failed auxiliary executions without settling their captures; :1508 allocates distinct paths but preserves no failed disposition. Its callback at :382 emits only provider_attempt. Later success reaches conductor.ts:896 and transcript-retention.ts:231, which settle every pending owner/run capture and prune failed attempts alongside successful ones at :284. All auxiliary callers share this defect: step-runners.ts:2693 (rebase regrade), :2754 (residue routing), :3780 (build-review rubric), and :4609 (schema-backed build-review branch). Paths above are under src/conductor/src/engine/. Other supplied prior repairs are present."
  - gate: architecture_review_as_built
    finding: "as-built:f6c5e9fe-2d6f-4ad5-beeb-fa42629e76be:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-10-retain-self-host-provider-transcripts decision 4"
    outcome: remediated
    summary: "Verified, 99% confidence: prior finding as-built:3f3dfbc5-1c54-4dc8-877e-f4bad77f9875:1 remains unresolved. The new failure callback constructs a configured rubric owner at src/conductor/src/engine/provider-execution.ts:1517, but actual provider-home and Claude captures use the enclosing transcriptOwner at src/conductor/src/engine/conductor.ts:6106 and :6122. Settlement at conductor.ts:2535 forwards the callback owner unchanged, so the exact lookup at src/conductor/src/engine/self-host/transcript-retention.ts:225 misses the captured identity. Later successful terminal settlement at conductor.ts:942 prunes the still-pending failed capture through transcript-retention.ts:229. Both production build-review branches are affected: src/conductor/src/engine/step-runners.ts:3805 and :4634. The shared callback also serves rebase regrade and residue routing at :2718 and :2779; preserve their actual capture identity through the same repair."
---

## Cost
input: 11575387
output: 1244109
cache_read: 213971664
cache_creation: 9546286
cost_usd: 199.1563
dispatches: 247
retries: 15
halts: 29
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 11574499, output: 716814, cache_read: 181156096, cache_creation: 0, cost_usd: 105.6735, dispatches: 119, cost_unmetered: 0
  claude: input: 888, output: 527295, cache_read: 32815568, cache_creation: 9546286, cost_usd: 93.4829, dispatches: 128, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","9b793b8a-1760-4838-b763-b899d9e7e9cf","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 6
cache_hits: 12
infrastructure_failures: 7
rubrics:
  eventSpine: failures: 7, judged: 23
  implementationQuality: failures: 29, judged: 30
  security: failures: 0, judged: 40
  testQuality: failures: 2, judged: 40
skip_reasons:
  disabled: 6


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 3

- Finding: `sha256:05b510bbf2a69b565a07169b0b01d8e732b835dc54539b5029d130f872bdfd31` — rubric: implementationQuality
- Finding: `sha256:aed854eafd2e0914df24e687c44480b5ba9df4591c09589b6e32733fb37074ec` — rubric: implementationQuality
- Finding: `sha256:f2750b60497cfd4a0537bc5f27a95c7d523d26483d054c410b478ac05a23a9fd` — rubric: implementationQuality

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->