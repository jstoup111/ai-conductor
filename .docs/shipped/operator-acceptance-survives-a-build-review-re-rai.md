---
slug: operator-acceptance-survives-a-build-review-re-rai
spec_hash: 635f4c7d8babc94a7f5d617c1ca87d05d1eb675cddf245ca391d36f73f4481ae
pr: https://github.com/jstoup111/ai-conductor/pull/3358
shipped: 2026-10-23
engine_version: 20261022T120907Z-f265ea536135
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "Test-isolation/flake fixes unrelated to operator-acceptance carry; production behavior only changes when a test-root env var is set, so not user-visible."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3"
    outcome: remediated
    summary: "Verified, 99%: operator-resolved cases without acceptance origins cannot persist a carried link. remediation-case-reconciler.ts:306 constructs empty origin arrays, while remediation-case-store.ts:619 and :621 require nonempty arrays, so mutation validation rejects the promised carry."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3"
    outcome: remediated
    summary: "Verified, 99%: carry classification occurs after action authorization and filtering at build-review-adjudication-coordinator.ts:706 and :713, preceding classification at :724. build-review-adjudication.ts:34 rejects all actions when any proposal escalates; an escalation later recognized as carried therefore suppresses independent sibling actions."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3"
    outcome: remediated
    summary: "Verified, 99%: carry does not exclusively bypass disposition-specific processing. remediation-case-reconciler.ts:264 and :334 allow a carried defer binding to reopen an applied action and reserve a deferral; :278 rejects a carried refute binding to a previously refuted case. build-review-adjudication-coordinator.ts:709 still resolves refutation evidence before carry classification, :902 emits refutation for carried proposals, and :1034–1051 still invokes deferral effects without excluding carried cases."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:4"
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "Verified, 99%: the operatorAccepted context branch is unreachable in production. Both assembler calls at build-review-adjudication-coordinator.ts:631 and :673 omit carryInput, which build-review-adjudication-context.ts:406 requires to produce the marker."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 4"
    outcome: remediated
    summary: "Verified, 99%: build-review-effective.ts:57 and :59 declare child and adjudicationEnabled optional, and :222 defaults the dependency argument to {}. Missing scope inputs therefore remain compilable, contrary to the required API boundary."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5"
    outcome: remediated
    summary: "Verified, 99%: retirement remains incomplete and independently decided. remediation-case-reconciler.ts:104–107 ignores acceptance origins, carried links, and healthy absence of reserved actions; :385–412 retains separate absence rules excluding failed/reserved effects. remediation-case-effects.ts:210–218 independently decides reserved-action retirement, and :252–255 supplies no accepted sources. conductor.ts:5367–5381, :5391–5397 and :5419–5423 retain clean-PASS obligation checks without the shared predicate, leaving qualifying failed actions blocking."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 6"
    outcome: remediated
    summary: "Verified, 99%: no retirement transition produces the required atomic outbox occurrence. Writes at build-review-adjudication-coordinator.ts:444/:460, remediation-case-effects.ts:224/:263 and remediation-case-reconciler.ts:398/:412 are followed by ordinary emissions at coordinator :266/:278/:361/:467/:884 and conductor.ts:5406. These events lack eventId and can be lost after a crash between persistence and emission."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 6"
    outcome: remediated
    summary: "Verified, 99%: outbox draining is wired only into coordinator failure handling (:203) and successful finalization (:526). It is absent at coordinator entry, immediately after carry mutation (:806), and throughout conductor.ts:5332–5426 clean-PASS settlement. Direct returns at coordinator :172 and :586 bypass delivery."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 7"
    outcome: remediated
    summary: "Verified, 99%: clean-PASS blocking reasons at conductor.ts:5380 and :5423 omit the required resolve-case recovery command and child scope."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:10"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 9"
    outcome: remediated
    summary: "Verified, 99%: conductor.ts:13520–13524 treats every listed disposition as effective carry authority. build-review-dispositions.ts:531–540 does not filter invalid contract versions, while build-review-effective.ts:254–264 recognizes their invalidation without deleting them. Invalidated origins can therefore authorize new carry."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:11"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 8"
    outcome: remediated
    summary: "Verified, 98%: finish-publication-production.ts:1312–1314 and shipped-record-cli.ts:209 read only the flat case store. Neither gathers child-scoped case history, so child carried findings and operator resolutions never reach the publication renderer."
  - gate: architecture_review_as_built
    finding: "as-built:412e01d1-fa70-4a1e-9e1f-92deb755dd39:12"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 8"
    outcome: remediated
    summary: "Verified, 97%: build-review-cli.ts:301 equates a disposition's inspected sourceLapId with an origin's recording lapId. Acceptance stamps the inspected lap at :528, whereas finalize stamps its current lap at build-review-adjudication-coordinator.ts:410. When recording follows acceptance on a later lap, available operator/rationale details are incorrectly reported unavailable."
  - gate: architecture_review_as_built
    finding: "as-built:810b64e4-ebb3-4e54-8e08-2ff367172ea0:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3"
    outcome: remediated
    summary: "Verified, 99%; prior finding 2 remains. build-review-adjudication-coordinator.ts:726 passes the original judgement to authorization. build-review-adjudication.ts:34 rejects all actions for any escalation, including one already classified as carried. Coordinator :727 then drops independent sibling actions, contrary to D3."
  - gate: architecture_review_as_built
    finding: "as-built:810b64e4-ebb3-4e54-8e08-2ff367172ea0:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 3"
    outcome: remediated
    summary: "Verified, 99%; prior finding 3 remains partially unresolved. build-review-adjudication-coordinator.ts:897–905 still emits remediation_case_refuted for carried refute proposals without excluding carriedCaseRefs. Carry preserves the original disposition and must not report a refutation that never occurred."
  - gate: architecture_review_as_built
    finding: "as-built:810b64e4-ebb3-4e54-8e08-2ff367172ea0:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5"
    outcome: remediated
    summary: "Verified, 99%; prior finding 6 remains. Retirement is independently decided at remediation-case-reconciler.ts:398 and :420 and remediation-case-effects.ts:212. Reserved-action absence retirement requires an option at reconciler :113 that coordinator finalize :407 does not supply. conductor.ts:5381–5385 still blocks missing-work-order cases before shared retirement at :5402. Eligible failed/reserved actions therefore remain blocked on these paths."
  - gate: architecture_review_as_built
    finding: "as-built:810b64e4-ebb3-4e54-8e08-2ff367172ea0:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5"
    outcome: remediated
    summary: "Verified, 98%; regression introduced by the retirement repair. remediation-case-effects.ts:266–271 now admits reserved actions covered by acceptance origins, but :288 changes only resolution, leaving their effects reserved. D5 requires reserved effects to become failed with a retirement diagnostic."
  - gate: architecture_review_as_built
    finding: "as-built:810b64e4-ebb3-4e54-8e08-2ff367172ea0:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 7"
    outcome: remediated
    summary: "Verified, 99%; prior finding 9 remains partially unresolved. conductor.ts:5385 still emits a clean-PASS missing-work-order halt without the required build-review resolve-case command or child scope. Only the later settlement halt was repaired."
  - gate: architecture_review_as_built
    finding: "as-built:1548a2d2-069e-4970-86dd-f55d413fd421:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-09-10-portable-build-review-policy decision 9"
    outcome: remediated
    summary: "Verified, 98%: the new authorization repair at src/conductor/src/engine/build-review-adjudication-coordinator.ts:725 changes a blocked consistency judgment to consistent when its implicated sources are carried. The original blocked judgment still produces a durable stop at :875, while sibling actions can reach publication and charging through :997. D9 requires blocked consistency to prevent all action effects. This contradictory authorization behavior is newly introduced by the repair."
  - gate: architecture_review_as_built
    finding: "as-built:1548a2d2-069e-4970-86dd-f55d413fd421:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5"
    outcome: remediated
    summary: "Verified, 99%: prior retirement-ownership finding remains partially unresolved. src/conductor/src/engine/remediation-case-effects.ts:212 independently selects reserved-action retirement, and src/conductor/src/engine/remediation-case-reconciler.ts:439 independently selects non-action absence retirement. Both previously reported sites still bypass the required shared retirement predicate."
  - gate: architecture_review_as_built
    finding: "as-built:1548a2d2-069e-4970-86dd-f55d413fd421:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5"
    outcome: remediated
    summary: "Verified, 99%: the new retirement transformation at src/conductor/src/engine/remediation-case-reconciler.ts:129 converts only reserved action effects to failed. The predicate at :116 accepts fully covered deferral cases too. Consequently coordinator finalize at src/conductor/src/engine/build-review-adjudication-coordinator.ts:413 and clean-PASS settlement at src/conductor/src/engine/conductor.ts:5405 can resolve an accepted reserved deferral while leaving its effect reserved. This narrowing was introduced by the latest repair; D5 requires every retired reserved effect to become failed with a diagnostic."
  - gate: architecture_review_as_built
    finding: "as-built:8cf22922-6467-4270-8008-a3b605090c5c:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 7"
    outcome: remediated
    summary: "Verified, 99%: child-scoped recovery commands at src/conductor/src/engine/build-review-adjudication.ts:94 and src/conductor/src/engine/conductor.ts:5441 place --child after --case. The detector at src/conductor/src/cli.ts:219–221 requires --child before --case. These commands therefore bypass resolution dispatch and reach the unknown-command rejection at src/conductor/src/index.ts:1424–1436. The reducer site is newly introduced by the R17c repair; the clean-PASS site retains the same recovery-command defect."
  - gate: architecture_review_as_built
    finding: "as-built:0e2e8e4f-f501-492a-aa1e-cfde14a2d3eb:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-20-operator-acceptance-is-durable-case-state decision 5"
    outcome: remediated
    summary: "Verified, 99%: the new absence-health calculation at src/conductor/src/engine/conductor.ts:13540 ignores custom-rubric infrastructure failures. infrastructureFailureRubrics contains only built-in failures (build-review-aggregate.ts:517); custom composition preserves that array unchanged (build-review-effective.ts:137). Healthy built-ins plus a failed custom rubric and no reduced-coverage decision therefore authorize absence retirement. The incorrect signal reaches coordinator retirement sites at build-review-adjudication-coordinator.ts:265, :284, :354, :422 and :875, allowing absent reserved/failed actions to resolve without a mechanically healthy lap. This concerns the newly introduced R17d repair in commit 3c6b152407; clean-PASS settlement already checks custom failures correctly."
---

## Cost
input: 5757271
output: 740892
cache_read: 175420554
cache_creation: 5040774
cost_usd: 116.7722
dispatches: 76
retries: 12
halts: 13
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5756927, output: 475632, cache_read: 149315712, cache_creation: 0, cost_usd: 65.9185, dispatches: 40, cost_unmetered: 0
  claude: input: 344, output: 265260, cache_read: 26104842, cache_creation: 5040774, cost_usd: 50.8537, dispatches: 36, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","6f9eefaf-1ac9-4db7-91f4-b24c0a503826","lifecycle-step","build"],step:execution\u0000["timing-rollup","persisted-ledger","89b1108b-6160-4b1c-abfa-0febad9270da","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 12
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 10
  testQuality: failures: 0, judged: 11
skip_reasons:
  disabled: 11
  leaf-only: 1
