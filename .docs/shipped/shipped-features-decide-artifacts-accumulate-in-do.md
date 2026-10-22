---
slug: shipped-features-decide-artifacts-accumulate-in-do
spec_hash: 63b3d7467e6fcbf4f03c135523ab72e4aac38188e5583c14b6e887d36c3ed7bb
pr: https://github.com/jstoup111/ai-conductor/pull/3348
shipped: 2026-10-22
engine_version: 20261022T120907Z-f265ea536135
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "D4 needs exact approval for docs-prune's PR writes, but the change widens what the shared approval gate allows for every caller. This code is unchanged since the judged lap. The operator's prior decision on this widening is in the history for the engine to reconcile."
    accepted: true
    decision: accept
    rationale: "docs-prune is an operator command whose PR has no owned-feature provenance, so it needs interactive approval. The allowlist only permits approval; it never forces a prompt. The daemon ship path does not call requestExplicitGithubOperationApproval, and non-TTY sessions are refused."
    authority: jstoup111
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This changes how the test fixture's temp directory is contained, with no effect on shipped behavior. It is unchanged since the judged lap."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:1"
    class: REMEDIABLE
    governing_clause: "Task 6"
    outcome: remediated
    summary: "Verified: publishDocsPrune has no production caller. Searching production source finds only its definition, import and re-export. index.ts:1103 supplies no publisher; docs-prune-cli.ts:41 therefore refuses every nonempty selection. Wire the publisher through the CLI integration required by task 9."
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 4"
    outcome: remediated
    summary: "Verified: guarded publication and exact-request approvals are not composed. docs-prune.ts:33 invokes an injected push without a production guarded adapter; :37 and :41 submit PR writes without explicit approval; docs-prune-cli.ts:42 supplies an empty repository. All three remote writes need the approved authorization path. The approved diagram's publication sequence is consequently absent."
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 1"
    outcome: remediated
    summary: "Verified: docs-retention.ts:54-55 applies normalized matching to every family, including exact-plan families. A shipped 2026-10-01-alpha can select the unshipped 2026-10-20-alpha plan and dated markers. docs-prune.ts:52 uses a separate hard-coded family subset and raw basename comparison, missing dated collisions and ambiguous retros. Preserve family-specific identity and exclude ambiguous matches across the policy."
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 5"
    outcome: remediated
    summary: "Verified: docs-prune.ts:43 discards the newly created PR's URL, returning only the branch. docs-prune-cli.ts:43-45 therefore cannot include that URL in the required event."
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 5"
    outcome: remediated
    summary: "Verified: index.ts:1103 passes process.cwd() directly to docs-prune-cli.ts:30; event-persister.ts:532 writes beneath that directory. Invocation from a repository subdirectory writes a separate ledger instead of the required repository-root .pipeline/events.jsonl."
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 6"
    outcome: remediated
    summary: "Verified: the reconcile CLI call at shipment-evidence-cli.ts:164 omits specCommit. Consequently :244 supplies no history and :476 reads only the working-tree plan. This production repair consumer cannot recover a pruned plan, although the background repair consumer enables the lookup."
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 6"
    outcome: remediated
    summary: "Verified: shipment-audit.ts:157-171 invokes the shared lookup but discards its recovered bytes. Proposal hashing at :670 and historical verification at :720 still read the implementation head directly. The recovered pre-deletion plan never reaches the audit's content consumers."
  - gate: architecture_review_as_built
    finding: "as-built:bcd0cec8-cfc2-4b0b-be52-3e74b6bed4b1:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 6"
    outcome: remediated
    summary: "Verified: pruned-plan.ts:18 and :31 await readAt outside error handling. A failed parent-plan history read escapes without shipment-plan-pruned; in shipment-audit.ts:157 it aborts enumeration and reaches the whole-audit failure handler at :124 instead of classifying only that row unresolved. Normalize these read failures into the required refusal."
  - gate: architecture_review_as_built
    finding: "as-built:356a548d-7eef-48a9-aae0-8a24254fa9ea:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 4"
    outcome: remediated
    summary: "Verified: prior finding 2 remains. docs-prune.ts:35,43,49 pass raw repository/resource inputs to docs-prune-cli.ts:33-35, which casts them to canonical requests without decoding. github-operation-approval.ts:117,69 dereferences the missing target, preventing publication. Additionally, its approval eligibility at :149-152 excludes the create and feature-write access classes assigned to PR creation/edit. All three writes need canonical requests and supported exact-request approval."
  - gate: architecture_review_as_built
    finding: "as-built:356a548d-7eef-48a9-aae0-8a24254fa9ea:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 1"
    outcome: remediated
    summary: "Verified: the revised collision filter only partially resolves prior finding 3. docs-prune.ts:61 excludes every normalized-family path when multiple plans share an undated stem, including exact dated matches. With plans 2026-10-01-alpha and 2026-10-20-alpha, it excludes .docs/coherence/2026-10-01-alpha.md even when that exact stem is shipped. D1 excludes files matching only through ambiguous undated identity; preserve unambiguous exact matches."
  - gate: architecture_review_as_built
    finding: "as-built:356a548d-7eef-48a9-aae0-8a24254fa9ea:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 6"
    outcome: remediated
    summary: "Verified: prior finding 7 remains partially unresolved. Recovered bytes reach proposal hashing at shipment-audit.ts:644,675, but historical verification at :616 and :723-725 still reads the implementation-head plan directly without shared recovery. A plan absent at that commit can still fail verification despite available deletion history. Apply the shared missing-plan lookup to this consumer while preserving present-plan and shipment-evidence semantics."
  - gate: architecture_review_as_built
    finding: "as-built:a8fb031f-ae29-4ce7-bd18-43e238a6c61e:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts decision 4"
    outcome: remediated
    summary: "Verified (99%): docs-prune-cli.ts:89-94 now starts an existing-PR refresh from FETCH_HEAD but passes the full origin/main deletion set selected at docs-prune.ts:56-63. At docs-prune.ts:66, git rm attempts to delete paths already absent from that prune head, preventing refresh; the exact staged-path check also requires those already-deleted paths. Newly shipped files may likewise be absent from the older head. This regression was introduced in remediation commit 51a1d4988b, after the prior judged lap. It violates D4's idempotent refresh and the approved diagram's refresh sequence."
---

## Cost
input: 2964378
output: 364456
cache_read: 57895106
cache_creation: 2039605
cost_usd: 48.4249
dispatches: 60
retries: 11
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2964108, output: 204708, cache_read: 47761664, cache_creation: 0, cost_usd: 26.8853, dispatches: 31, cost_unmetered: 0
  claude: input: 270, output: 159748, cache_read: 10133442, cache_creation: 2039605, cost_usd: 21.5396, dispatches: 29, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","73c0fada-cb92-4e3f-9925-4377838e339c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 7
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 7
  testQuality: failures: 3, judged: 7
skip_reasons:
  disabled: 7
