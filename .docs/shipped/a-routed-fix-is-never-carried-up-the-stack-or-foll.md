---
slug: a-routed-fix-is-never-carried-up-the-stack-or-foll
spec_hash: 71c16f2f4dd3fd7bc553ff2c8154e51764a3ca43ee32080f9bddfd6e257b3564
pr: https://github.com/jstoup111/ai-conductor/pull/3389
shipped: 2026-10-24
engine_version: 20261024T094223Z-8d8e019bfff7
findings:
  - gate: architecture_review_as_built
    finding: "as-built:8ec7992b-c03d-4ce6-8b29-5d6c86e9317b:1"
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:7628 sets activeChildRequiresClosure=false for routed hosts, but :15249 requires it before reaching requestRoutedExit at :15260 and persistOnActiveEventSpine at :15274. Normal routed region completion therefore never invokes the new exit. Preflight only resumes built hosts and cannot repair this repairing-state stall."
  - gate: architecture_review_as_built
    finding: "as-built:8ec7992b-c03d-4ce6-8b29-5d6c86e9317b:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 13"
    outcome: remediated
    summary: "Verified, 99%: restack-executor.ts:720 persists synced before recording routeNew at :737. Recovery from that crash window, or earlier journal states promoted at restack-recovery.ts:780, reaches :816 without preparing the missing routed apply plan. route-record-store.ts:272 refuses it, leaving recovery unable to settle the route and marker."
  - gate: architecture_review_as_built
    finding: "as-built:8ec7992b-c03d-4ce6-8b29-5d6c86e9317b:3"
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "Verified, 99%: a concurrent routes/r1 change before apply-plan persistence causes restack-executor.ts:320 to throw and :765 to return generic unavailable. It bypasses the changed-ref HALT at :741–743; recovery likewise cannot build the missing plan. This race must produce the required needs-human HALT naming the changed route ref."
  - gate: architecture_review_as_built
    finding: "as-built:8ec7992b-c03d-4ce6-8b29-5d6c86e9317b:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 13"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:15268 rewrites an exit's existing detailed HALT through haltChildRegionRefusal at :811. routed-exit.ts:171 and :185 reduce restack failures to 'halted', so this handler erases cascade-cap/runbook details, rollback verification details and changed-ref diagnostics; it also replaces publication and foreign-round diagnostics. Preserve the originating HALT when wiring the exit."
  - gate: architecture_review_as_built
    finding: "as-built:47b81788-23b8-4084-b8b3-092c97b86ee2:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 13"
    outcome: remediated
    summary: "Verified, 99%: prior finding 4 persists. conductor.ts:15274 calls haltChildRegionRefusal, which unconditionally overwrites HALT at :813. routed-exit.ts:332 and :345–346 reduce restack failures to 'halted', losing cascade-cap/runbook, verification and changed-ref diagnostics; publication (:285–287) and foreign-round (:317–320) diagnostics are also replaced."
  - gate: architecture_review_as_built
    finding: "as-built:47b81788-23b8-4084-b8b3-092c97b86ee2:2"
    class: REMEDIABLE
    governing_clause: "Task 22"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:15253 excludes leaf targets before requestRoutedExit at :15263, making the newly added leaf-host exit at routed-exit.ts:238–251 unreachable from region completion. Leaf hosts remain repairing. This behavior was added after the prior review."
  - gate: architecture_review_as_built
    finding: "as-built:47b81788-23b8-4084-b8b3-092c97b86ee2:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 6"
    outcome: remediated
    summary: "Verified, 99%: newly added routed-exit.ts:100–102 leaves an entirely settled round open whenever the queue has entries; :123–145 always performs leaf return without checking other open rounds. Neither implements the approved distinction between closing before queue consumption and recording the final leaf return."
  - gate: architecture_review_as_built
    finding: "as-built:47b81788-23b8-4084-b8b3-092c97b86ee2:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 14"
    outcome: remediated
    summary: "Verified, 99%: new revalidation-queue.ts:102–105 keeps the revalidate round open whenever its acknowledgement empties the queue, without checking whether another round remains open. The approved last-entry exception requires both an empty queue and no other open round."
  - gate: architecture_review_as_built
    finding: "as-built:47b81788-23b8-4084-b8b3-092c97b86ee2:5"
    class: REMEDIABLE
    governing_clause: "Task 36"
    outcome: remediated
    summary: "Verified, 99%: new revalidation-queue.ts:93–109 acknowledges the freshly reread generation rather than the generation validated; admission at :64–73 captures no queue identity. Its closure check at :97–98 is outside the transaction at :106–110. A replacement generation or racing closure change can therefore be acknowledged instead of remaining queued."
  - gate: architecture_review_as_built
    finding: "as-built:47b81788-23b8-4084-b8b3-092c97b86ee2:6"
    class: REMEDIABLE
    governing_clause: "Task 26"
    outcome: remediated
    summary: "Verified, 99%: new routed-exit.ts:146–151 re-pends only three hardcoded gates, omitting configured post-region custom steps, and retains satisfied verdicts. selector.ts:62–64 still accepts those verdicts for pending state, so required leaf gates can be skipped."
  - gate: architecture_review_as_built
    finding: "as-built:47b81788-23b8-4084-b8b3-092c97b86ee2:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 15"
    outcome: remediated
    summary: "Verified, 99%: new routed-exit.ts:143–152 closes the round before restaging leaf gates and ignores state-read or mutation failure. A crash or refusal loses the restaging obligation: :123 accepts closed rounds immediately, and round-admission.ts:113–117 advances only open rounds."
  - gate: architecture_review_as_built
    finding: "as-built:4ac8742f-0363-4ef5-bf15-575623e619d5:1"
    class: REMEDIABLE
    governing_clause: "Task 36"
    outcome: remediated
    summary: "Verified, 99%: prior closure-CAS finding remains partially unresolved. revalidation-queue.ts:101–102 checks closed/cN before the transaction at :120–124, which guards only route, marker and queue. A closure change between those operations can still acknowledge stale validation. The new generation pin does not protect the closure."
  - gate: architecture_review_as_built
    finding: "as-built:4ac8742f-0363-4ef5-bf15-575623e619d5:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 13"
    outcome: remediated
    summary: "Verified, 99%: the newly added conductor.ts:15300–15303 branch treats deferred reconciliation as permission to jump to prd_audit. round-admission.ts:113–117 also returns deferred when advanceRound yields to the queue. This bypasses queue consumption and the parking-aware selector, allowing whole-feature progression before queued children are validated and before returning to the leaf."
  - gate: architecture_review_as_built
    finding: "as-built:4ac8742f-0363-4ef5-bf15-575623e619d5:3"
    class: REMEDIABLE
    governing_clause: "Task 22"
    outcome: remediated
    summary: "Verified, 99%: removing the leaf exclusion at conductor.ts:15249–15256 also admits ordinary cursor-selected leaves, whose activeChildRequiresClosure is true at :7631. They fall through to advanceChildRegion at :15316 and its unconditional closeChild call at child-lifecycle.ts:341. The routed-leaf repair must preserve ordinary leaves' exclusion from non-leaf closure and advancement."
  - gate: architecture_review_as_built
    finding: "as-built:f4e47dca-97b8-4edf-a7ae-d30f67c2283b:1"
    class: REMEDIABLE
    governing_clause: "Task 33"
    outcome: remediated
    summary: "Verified, 99%: newly added conductor.ts:15328 rejects successful queue admission because it requires source 'revalidating'. Admission creates a marker, child-cursor.ts:453 projects routedRepair, and execution-child.ts:55 therefore returns 'routed-host'. The same-loop queue path always HALTs before entering the admitted region."
  - gate: architecture_review_as_built
    finding: "as-built:f4e47dca-97b8-4edf-a7ae-d30f67c2283b:2"
    class: REMEDIABLE
    governing_clause: "Task rem-prd-audit-rem-vg3-s6-8"
    outcome: remediated
    summary: "Verified, 99%: newly added conductor.ts:16301–16304 returns steps.length for a parked selector result. Its caller at :15411 exits the loop and reaches completeRun at :15436, which marks the feature complete, emits feature_complete (:5648), and writes daemon DONE (:5659–5661) despite outstanding routed work."
  - gate: architecture_review_as_built
    finding: "as-built:aa44ce0f-6a0b-4786-9c9c-9babfa0d4a20:1"
    class: REMEDIABLE
    governing_clause: "Task rem-prd-audit-rem-vg4-s6-1"
    outcome: remediated
    summary: "Verified, 99%: the newly added leaf-state reload at conductor.ts:15371 runs only for none/aborted, but round-admission.ts:114–120 returns deferred after returnToLeaf closes the round. With the queue empty, execution falls through to conductor.ts:15385, which reloads only region state and jumps to acceptance_specs. The required full-state reload and CAS-baseline restoration therefore remain bypassed on the actual leaf-return path."
  - gate: architecture_review_as_built
    finding: "as-built:aa44ce0f-6a0b-4786-9c9c-9babfa0d4a20:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 17"
    outcome: remediated
    summary: "Verified, 99%: the new completeRun guard at conductor.ts:5657–5659 calls routedRoundOpen without establishing durable child state. With routing default-on, round-admission.ts:126,129 reads revalidate/routes refs for N=1 features. Both completion callers are affected: conductor.ts:15260 and :15468. This regression was introduced by commit 6d1d9a3175."
  - gate: architecture_review_as_built
    finding: "as-built:2332b902-9cbf-458f-b951-f31ecf2425ed:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 13"
    outcome: remediated
    summary: "Verified, 99%: newly added conductor.ts:15375–15381 treats deferred reconciliation plus an empty queue as completed leaf return. After a committed revalidation fix leaves r2 open, audit r1 can finish its leaf host and close because r2 remains open (routed-exit.ts:122–128). Reconciliation returns deferred and queue consumption returns none, so this branch dispatches prd_audit before r2 closes and before final leaf-return restaging. Continue reconciliation or establish completed leaf return before entering whole-feature gates."
  - gate: architecture_review_as_built
    finding: "as-built:2332b902-9cbf-458f-b951-f31ecf2425ed:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 14"
    outcome: remediated
    summary: "Verified, 99%: the newly broadened normalization fallback in restack-transition.ts:190–209 supplies an empty combined delta to both classifier consumers at :272 and :531 when the child owns unchanged code. This erases parent runtime changes along with inherited rem blocks, incorrectly preserving aggregate test classification and reporting empty wouldInvalidate. Separate freshness checks may still queue the child, but do not satisfy D14's required classifier-plus-freshness rule. Preserve parent runtime changes in aggregate invalidation inputs."
  - gate: architecture_review_as_built
    finding: "as-built:47c9e4b5-e301-4b49-8585-17599a948247:1"
    class: REMEDIABLE
    governing_clause: "Task rem-prd-audit-rem-vg4-s6-1"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:15378 reintroduces prior finding aa44ce0f…:1 by allowing full leaf-state restoration only for none/aborted. Successful returnToLeaf closes the final round, but round-admission.ts:117,120 returns deferred. Execution therefore falls through to conductor.ts:15397–15398, copying only region state and restarting acceptance instead of restoring the whole-feature state and CAS baseline."
---

## Cost
input: 8406627
output: 1004196
cache_read: 235036809
cache_creation: 5103296
cost_usd: 142.1278
dispatches: 124
retries: 14
halts: 12
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 8406229, output: 679761, cache_read: 203839232, cache_creation: 0, cost_usd: 88.5716, dispatches: 80, cost_unmetered: 0
  claude: input: 398, output: 324435, cache_read: 31197577, cache_creation: 5103296, cost_usd: 53.5562, dispatches: 44, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","72b401e3-4c8d-49fa-ad4f-ebf02a4491ac","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 17
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 1, judged: 13
  security: failures: 0, judged: 9
  testQuality: failures: 3, judged: 13
skip_reasons:
  disabled: 13
  leaf-only: 4
