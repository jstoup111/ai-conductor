---
slug: admitted-whole-feature-fixes-in-a-stacked-feature-
spec_hash: 96d2177f2d77619a531ce2655b461522c73bc99c2252c40c98a357c92d9105b9
pr: https://github.com/jstoup111/ai-conductor/pull/3243
shipped: 2026-10-15
engine_version: 20261015T110702Z-c3b061a18062
findings:
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:1"
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Verified, 99%: transitionHost at src/conductor/src/engine/routing/route-record-store.ts:170 has no production caller. Repository-wide symbol searches find only its definition; admission manually changes host state at routing/round-admission.ts:22. Wire the planned transition primitive into admission."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:2"
    class: REMEDIABLE
    governing_clause: "Task 100"
    outcome: remediated
    summary: "Verified, 99%: isLegalHostTransition at src/conductor/src/engine/routing/route-types.ts:31 is referenced only by the unreachable transitionHost; isLegalRoundPhaseTransition at :112 has no production caller. Neither transition guard participates in the shipped admission path."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 7"
    outcome: remediated
    summary: "Verified, 99%: routing begins too late at src/conductor/src/engine/conductor.ts:4587. The same call has already reached leaf append at :4425, task membership recording, seeding and commit, and ordinary pending-repair creation at :4549. Prepared-record/marker admission must precede these mutations; routed successes and routing halts currently leave ordinary leaf-side changes behind."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 2"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/conductor.ts:4611 passes proposed repair-task IDs as owning task IDs, ignoring the admitted parent binding attached at :4284. routing/round-router.ts:69 repeats that fallback. Valid repairs whose new task IDs differ from their owning authored/rem task therefore halt or derive the wrong owner."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 3"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:4612 classifies residue solely by an empty gap.tasks array. ADR-only findings and refusal rework contain proposed repair tasks, so they incorrectly enter mechanical ownership instead of the residue judge. At routing/round-router.ts:80 the judge projection also discards the gap and governing evidence, supplying only item IDs and numeric positions (placement-context insufficiency: 95%). Preserve admitted finding provenance and substantive placement context."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:6"
    class: REMEDIABLE
    governing_clause: "Task 34"
    outcome: remediated
    summary: "Verified, 99%: src/conductor/src/engine/conductor.ts:4616 passes dispatchResidueRoutingJudgement without its receiver. routing/residue-routing-call.ts:155 invokes judge(prompt), while step-runners.ts:2676 immediately accesses this.resolvedConfigFor. The real runner throws before provider dispatch, exhausting both routing attempts. Bind or wrap the runner method."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 3"
    outcome: remediated
    summary: "Verified, 99%: mixed-round semantics diverge at conductor.ts:4618, which replaces original FAIL rows with the generic 'manual_test: FAIL'; routing/round-router.ts:109, which allocates new rem blocks even for existing-task hint-only items; and :99, which chooses the lowest host across all items rather than task-owned hosts when residue coexists. Preserve FAIL evidence, keep existing-task mixed items hint-only, and derive the FAIL host from task-bound work."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 4"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:4609 supplies no citedPaths, so routing/round-router.ts:73 and :85 always classify empty input in production. Both item constructors at :77 and :89 discard selectHost's prerequisite-paths reason. Additionally routing/cannot-host.ts:84 selects the leaf without checking its current tip for every prerequisite or halting on missing paths. Wire prerequisite evidence, retain host-movement reasons, and verify the leaf fallback."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 6"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:4617 supplies leafPlan but no hostPlans; routing/round-router.ts:112 defaults the latter to an empty array. Production allocation therefore never reserves IDs from child-branch plans, contrary to the required union of leaf and every host plan."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:10"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 7"
    outcome: remediated
    summary: "Verified, 99%: routing/round-admission.ts:29 returns immediately after the marker transaction, and conductor.ts:4625 returns the BUILD route without draining its outbox. The only production drain is restack/stack-preflight.ts:116. Admission events must reach the event spine before leaf navigation, not wait for a later preflight."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:11"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 7"
    outcome: remediated
    summary: "Verified, 99%: routing/round-admission.ts:61 produces navigate-leaf-to-build, but its sole consumer at restack/stack-preflight.ts:120 discards it as clear and skips cursor resolution. Conductor resume at conductor.ts:6237 receives no navigation action. A crash after marker admission therefore does not perform the required recovery rewind."
  - gate: architecture_review_as_built
    finding: "as-built:42556ff2-1c9f-43fe-9251-d8a92b05d8b3:12"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 7"
    outcome: remediated
    summary: "Verified, 99%: restack/stack-preflight.ts:120 returns early for admitted rounds, and :129 returns early for non-repair-pending cursors; both bypass the open-round/baseRefreshDue check and deferred-base-refresh emission at :135. Apply the deferral contract before these exits so every relevant open-round refresh request emits its required refusal."
  - gate: architecture_review_as_built
    finding: "as-built:00c86e24-0e00-4ff3-aed7-48632e032f48:1"
    class: REMEDIABLE
    governing_clause: "Task 36"
    outcome: remediated
    summary: "Verified, 99%: the new ordering change in fd1e0c4d4a lets an admitted BUILD fix bypass a sibling halt. conductor.ts:4394–4395 returns the early routing outcome; :4597–4604 considers only non-halt routedFixes; :4691–4702 creates the record and marker and returns BUILD before the halt check at :4715. This violates task 36 and the approved diagram's mixed-halt exclusion at .docs/architecture/admitted-whole-feature-fixes-in-a-stacked-feature-.md:40–42. Exclude mixed-halt work orders from early routing and let the existing ordinary append/halt path run, preserving the requested N=1 and routing-off ordering. This regression was introduced after the prior review."
---

## Cost
input: 2815620
output: 381699
cache_read: 86927453
cache_creation: 2438359
cost_usd: 63.2266
dispatches: 44
retries: 4
halts: 7
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2815436, output: 216275, cache_read: 76022784, cache_creation: 0, cost_usd: 38.2295, dispatches: 24, cost_unmetered: 0
  claude: input: 184, output: 165424, cache_read: 10904669, cache_creation: 2438359, cost_usd: 24.997, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","a1db95ff-6859-4bce-b796-6af83cb869c9","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 4
cache_hits: 0
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
  disabled: 4
