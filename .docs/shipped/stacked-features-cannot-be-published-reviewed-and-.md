---
slug: stacked-features-cannot-be-published-reviewed-and-
spec_hash: 474180df87406325a626f0c970e59489d0539fd184d97470069a73c584aa6125
pr: https://github.com/jstoup111/ai-conductor/pull/3311
shipped: 2026-10-21
engine_version: 20261021T104534Z-ab27d89b2af7
findings:
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:1"
    class: REMEDIABLE
    governing_clause: "Task 11"
    outcome: remediated
    summary: "Verified: assembleStack has no production caller; source-wide searches find only its definition at src/conductor/src/engine/finish-publication-production.ts:248. assemble_stack is selected at finish-publication.ts:499 but has no executing effect and falls through to a false advanced result at :2207. Wire the journaled retarget into FINISH."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:2"
    class: REMEDIABLE
    governing_clause: "Task 12"
    outcome: remediated
    summary: "Verified: native stack creation, prefix extension and verification are not composed into publication. assembleStack ends after retargeting at src/conductor/src/engine/finish-publication-production.ts:330. No production stack_assembled emitter exists; source-wide searches find only its type and sink registration."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:3"
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "Verified: publicationProgressAllowance at src/conductor/src/engine/finish-publication.ts:443 has no production caller. conductor.ts:10137 still uses the fixed fourteen-transition allowance for stacked features instead of eighteen."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1"
    outcome: remediated
    summary: "Verified: ordinary leaf pushes now read the publication ref, breaking N=1 Git-argv parity. src/conductor/src/engine/remote-git-operations.ts:315 invokes the new guard without a child-state gate; stack-tip-guard.ts:75 reads activePublicationRecord, which runs the publication-ref rev-parse at stack-publication-record.ts:142."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:5"
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "Verified: production child establishment passes incompatible Git adapters. src/conductor/src/engine/finish-publication-production.ts:354 casts the options-required, stdout-only runner to the exit-code/stdin runner used at :355, :357, :392, :419, :443 and :445. makeProductionGit requires options at pr-labels.ts:129; readSealedPositions calls without them at stack-publication.ts:214. Production therefore reports unreadable positions before publishing children."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 2"
    outcome: remediated
    summary: "Verified: membership and record replacement violate the durable-record contract. src/conductor/src/engine/finish-publication-production.ts:450 invents the leaf position as last-child + 1, so sealed [1,3,5] becomes [1,3,4]; :393 compares an existing leaf against MAX_SAFE_INTEGER and rejects completed records on retry. Separately, activePublicationRecord hides torn-down records at stack-publication-record.ts:164, while production :392 obtains its CAS expectation through that reader; writer :190 then expects ZERO_SHA and cannot replace the existing torn-down ref."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 4"
    outcome: remediated
    summary: "Verified: closure-chain verification omits the final child-to-leaf edge. src/conductor/src/engine/stack-publication.ts:247 removes the leaf from the returned positions, and :271 checks only adjacent entries in that shortened list. The production caller at finish-publication-production.ts:357 therefore never proves that the leaf contains the last child's closure."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5"
    outcome: remediated
    summary: "Verified: stack observation does not verify remote identity. src/conductor/src/engine/stack-publication.ts:363 reads only state/isDraft, omitting bases and head SHAs; :390 accepts any parseable stack JSON as valid. :421-424 trusts the stored verified flag without checking current ordered membership or pushed tips. Wrong bases, reordered/empty stacks and rewritten heads can escape detection."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 6"
    outcome: remediated
    summary: "Verified: production bodies use placeholder inputs rather than sealed evidence. src/conductor/src/engine/finish-publication-production.ts:410-413 supplies a generic slice name, empty stories/tasks/diffstat and branch names instead of final child PR references; :434 also uses a generic PR title. No production path updates final navigation on all members or adds it to the leaf while preserving captured regions."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:10"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 7"
    outcome: remediated
    summary: "Verified: readiness remains leaf-only. src/conductor/src/engine/finish-publication-production.ts:964 derives ready solely from the leaf's isDraft, and :1148-1163 repairs only state.pr_url. finish-publication.ts:2076 invokes that callback without child flips, child postconditions or per-flip membership/head verification. A ready leaf can therefore conceal draft children."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:11"
    class: REMEDIABLE
    governing_clause: "Task 20"
    outcome: remediated
    summary: "Verified: haltStackTipDiverged at src/conductor/src/engine/stack-publication.ts:179 has no production caller. FINISH treats diverged as an assembly state at finish-publication.ts:499. Child chain, PR, body and push failures at finish-publication-production.ts:358, :382, :417 and :428 all become generic publication retries at finish-publication.ts:1828. Required member-specific divergence/needs-human halts and stack_tip_diverged emission are missing."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:12"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11"
    outcome: remediated
    summary: "Verified: write guards have uncovered paths. Retarget goes from finish-publication-production.ts:320 to tracker-client.ts:354 without the tip guard. remote-git-operations.ts:317 drops mismatched-member identities, and stack-publication.ts:340 converts the failure to read-failed. Initial child-push retries compare remote/recorded tips at stack-publication.ts:318 before reaching intent recovery, falsely diverging after a remotely successful interrupted push. Also restack/stack-preflight.ts:84 and :108 run recovery before the freeze; restack-recovery.ts:617 can launch an unguarded follow-on restack."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:13"
    class: REMEDIABLE
    governing_clause: "Task 7"
    outcome: remediated
    summary: "Verified: validateStackPayload at src/conductor/src/engine/stack-publication.ts:130 has no production caller. tracker-client.ts:345-354 authorizes ownership then transports without record-bound stack membership, stack-number or retarget-base validation. The production retarget call at finish-publication-production.ts:320 also omits this validation."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:14"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 13"
    outcome: remediated
    summary: "Verified: src/conductor/src/engine/github-operations-cli.ts:123 refuses unrecorded children only when an active publication record exists. Missing, unreadable or torn-down records bypass the condition and continue at :128, permitting pre-FINISH child publication. Also github-operations.ts:296 permits only repository targets for stack.read, omitting the approved known-stack-number target."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:15"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 14"
    outcome: remediated
    summary: "Verified: stack_member_redrafted names the leaf PR but assigns the last non-leaf child's position at src/conductor/src/engine/finish-publication-production.ts:403. The event must identify the sealed leaf position."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:16"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 8"
    outcome: remediated
    summary: "Verified: audit excludes children too late and at the wrong level. src/conductor/src/engine/shipment-audit.ts:527 examines child body declarations before classification; :545-563 returns plan-level absent whenever a child mentions that plan, before considering legitimate leaf candidates at :565. A child can therefore suppress or make ambiguous a valid leaf shipment."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:17"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 9"
    outcome: remediated
    summary: "Verified: malformed member-state responses are made terminal instead of retried. src/conductor/src/engine/stack-publication.ts:78 accepts any object, and :84 classifies missing/unknown state as unreachable. mergeable-sweep.ts:883 then records tornDown through stack-publication.ts:114, preventing later re-observation."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:18"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 10"
    outcome: remediated
    summary: "Verified: revert detection at src/conductor/src/engine/mergeable-sweep.ts:263 neither restricts merged PRs to the default branch nor retrieves the body to verify GitHub's revert line. :266-268 treats any search result number as a revert, allowing unrelated mentions or merges into child branches to produce reverted lifecycle state."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:19"
    class: REMEDIABLE
    governing_clause: "Task 29"
    outcome: remediated
    summary: "Verified: stack cleanup is wired only into the sweep. src/conductor/src/engine/daemon-park-cli.ts:258-282 reclaims a worktree without publication reads, reachability, child cleanup or tornDown marking. park-reconciliation.ts:1251 deletes ordinary conductor refs but never retires the retained publication record. Source-wide search finds deleteStackChildren's only caller at mergeable-sweep.ts:898."
  - gate: architecture_review_as_built
    finding: "as-built:4ffd3258-fa03-4302-969d-81436940737d:20"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12"
    outcome: remediated
    summary: "Verified: cleanup does not implement per-member retention or resumable failure handling. mergeable-sweep.ts:876-897 skips every child deletion when one member is unreachable; stack-publication.ts:114 marks tornDown and sweep :838 permanently skips later cleanup. stack-teardown.ts:78 treats already-deleted branches and Git probe errors as kept, so partial-delete retries can never finish ref cleanup and errors do not stop remaining deletions. Sweep :922 catches teardown failure without retaining the entry, while :875 retains even successfully deleted stacks and :911 can add the entry twice."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:1"
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "Verified; prior finding 5 remains. The replacement Git adapter at src/conductor/src/engine/finish-publication-production.ts:223 discards options.input, but stack-publication-record.ts:183 requires serialized JSON on stdin for hash-object. Both establishment and assembly use this adapter, so production record persistence still lacks the required input transport."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1"
    outcome: remediated
    summary: "Verified; prior finding 4 remains, with another violation introduced by the repair. Ordinary leaf pushes reach the publication-ref read through remote-git-operations.ts:316 and stack-tip-guard.ts:75. Additionally, finish-publication-production.ts:1334 unconditionally calls readyStackChildren, whose :280 reads the publication ref even for N=1. Both break the required unchanged Git argv."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 2"
    outcome: remediated
    summary: "Verified; prior finding 6 is only partially resolved. finish-publication-production.ts:557 obtains the old CAS receipt correctly, but :559 rejects changed positions in torn-down records and :573/:609 reuse their members as active content. The final append at :620 duplicates a retained leaf. Old receipt identity must support CAS without carrying obsolete membership into a new publication."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5"
    outcome: remediated
    summary: "Verified; prior finding 2 now has wiring but assembly remains noncompliant. finish-publication-production.ts:424/:429 discovers by leaf instead of member 1, missing existing prefix stacks. :471-480 adds missing members before validating the prefix/order at :482 and does not check other stack ownership. :485 marks verified without checking member head SHAs against pushed tips."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5"
    outcome: remediated
    summary: "Verified; prior finding 8 remains. stack-publication.ts:386 observes only state/isDraft, omitting bases and heads; :413-414 accepts any parseable stack response as valid. :444-447 trusts the stored verified flag without comparing current ordered membership or pushed tips."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 6"
    outcome: remediated
    summary: "Verified; prior finding 9 remains. finish-publication-production.ts:577-580 supplies generic names, empty stories/tasks/diffstat and branch references; :604 uses a generic title. assembleStack at :337-490 never refreshes final navigation on every member or adds navigation to the leaf with captured-region preservation."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 7"
    outcome: remediated
    summary: "Verified; prior finding 10 remains after partial repair. finish-publication-production.ts:1334 flips children before the leaf at :1345-1351. The per-child stack read at :286 discards its response through :265, and :295 omits head SHA, so flips lack membership/head verification. Snapshot readiness at :1133 remains leaf-only, allowing a ready leaf to bypass draft children."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:8"
    class: REMEDIABLE
    governing_clause: "Task 20"
    outcome: remediated
    summary: "Verified; prior finding 11 is partially resolved but divergence handling remains incomplete. finish-publication.ts:510 routes observed diverged into assembly instead of halting. Retarget divergence at finish-publication-production.ts:380/:398/:402 throws generic errors routed to retry at finish-publication.ts:2109. Typed divergence at production :547/:483 omits stack_tip_diverged emission, and :305 explicitly supplies no event emitter."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11"
    outcome: remediated
    summary: "Verified; prior finding 12 remains at three paths. Retarget at finish-publication-production.ts:405 reaches tracker-client.ts:354 without the tip guard. Initial child-push retries at stack-publication.ts:339-352 compare receipts before outstanding-intent recovery. stack-preflight.ts:84/:108 runs recovery before its freeze at :162, and restack-recovery.ts:617 can invoke an unguarded follow-on restack."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:10"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11"
    outcome: remediated
    summary: "Verified in changed repair code: remote-git-operations.ts:318 unconditionally writes a divergence HALT for every refused push, including the halt-record push from halt-record.ts:236 and post-finish best-effort pushes. These callers must skip/report refusal; the halt-record path must not write another HALT."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:11"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 13"
    outcome: remediated
    summary: "Verified; prior finding 14 remains. github-operations-cli.ts:123 refuses an unrecorded child only when an active record exists; missing, unreadable or torn-down records bypass the restriction. github-operations.ts:296 also still restricts stack.read to repository targets, omitting the approved known-stack-number target."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:12"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 8"
    outcome: remediated
    summary: "Verified; prior finding 16 remains. shipment-audit.ts:527 examines child body declarations before classification. :545-563 returns plan-level absent on a child match before evaluating legitimate leaf candidates at :565, allowing child mentions to suppress or make ambiguous a valid leaf shipment."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:13"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 9"
    outcome: remediated
    summary: "Verified; prior finding 17 remains. stack-publication.ts:78 accepts malformed member-state objects and :84 treats missing/unknown state as unreachable. mergeable-sweep.ts:883 then records tornDown through stack-publication.ts:114, and sweep :838 skips future observation instead of retrying indeterminate evidence."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:14"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 10"
    outcome: remediated
    summary: "Verified; prior finding 18 remains. mergeable-sweep.ts:263 searches merged PRs without restricting the base and requests only numbers. :266-268 treats any returned number as proof of a revert, without checking the required revert line in a merged PR on the default branch."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:15"
    class: REMEDIABLE
    governing_clause: "Task 29"
    outcome: remediated
    summary: "Verified; prior finding 19 remains. daemon-park-cli.ts:258-282 reclaims without publication reads, gated child cleanup or tornDown marking. park-reconciliation.ts:1251 cleans ordinary refs without retiring the retained publication record. deleteStackChildren still has only the sweep caller at mergeable-sweep.ts:898."
  - gate: architecture_review_as_built
    finding: "as-built:50e9230c-92ea-45af-911e-0d5e2e2a59a9:16"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12"
    outcome: remediated
    summary: "Verified; prior finding 20 remains. mergeable-sweep.ts:876-897 skips all child deletion when one member is unreachable, then tornDown prevents further cleanup. stack-teardown.ts:78-80 treats already-deleted refs and Git failures as kept, preventing completion after partial deletion and continuing after probe errors. Sweep :922-927 loses entries on caught teardown failure; :875 retains successfully deleted stacks, and :911 can append an entry twice."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:1"
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "Verified: the prior record-persistence defect remains beneath the repaired adapter. finish-publication-production.ts:297 forwards stdin, but both production roots inject makeProductionGit (index.ts:1864,1888; daemon-cli.ts:94,1917,1938). Its transport at src/conductor/src/engine/pr-labels.ts:145 never supplies stdin to hash-object. Forward serialized record data through the actual production transport."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1"
    outcome: remediated
    summary: "Verified: prior N=1 Git-argv drift remains. src/conductor/src/engine/remote-git-operations.ts:315 unconditionally enters the guard; :168 reaches stack-tip-guard.ts:75, which reads the publication ref without a durable-child-state gate. The repaired readiness gate does not fix ordinary leaf pushes."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 4"
    outcome: remediated
    summary: "Verified: preassembly observation still skips recorded-member base/head verification. src/conductor/src/engine/stack-publication.ts:400 performs those checks only when requireDraft is false; :482 passes true for unverified records, and :488 returns unassembled. A changed draft member can therefore reach assembly mutations before its divergence is detected."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5"
    outcome: remediated
    summary: "Verified: prior other-stack protection remains incomplete. src/conductor/src/engine/finish-publication-production.ts:647,653,658 discovers member 1, then :674 creates or :704 adds members without checking whether the remaining members belong to another stack. Prefix ordering and post-assembly head verification are repaired, but foreign membership must refuse before create/add."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 6"
    outcome: remediated
    summary: "Verified in new navigation-refresh code: src/conductor/src/engine/finish-publication-production.ts:775 supplies undefined as the child template, so stack-member-body.ts:131-136 rejects children containing valid template regions. The leaf rewrite at production :759-782 also writes the current body without reinserting authoritative captures; replaceStackNavigation at :273-277 searches unmasked text and can modify an opaque region. Pass the template for child checks and preserve captured leaf regions through the established rewrite mechanism."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:6"
    class: REMEDIABLE
    governing_clause: "Task 20"
    outcome: remediated
    summary: "Verified: divergence handling remains partially repaired. Generic retarget divergence errors at src/conductor/src/engine/finish-publication-production.ts:573,591,595 still become retries at finish-publication.ts:2115. Typed divergence at production :692,717,722,738,847 returns human-required without emitting stack_tip_diverged. Route every such site through member-specific divergence handling; observed-divergence routing itself is now fixed."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11"
    outcome: remediated
    summary: "Verified: prior intent-recovery and freeze gaps remain. src/conductor/src/engine/stack-publication.ts:341-354 compares remote and pushed receipts before recovering an outstanding initial-push intent. restack/stack-preflight.ts:84,108 runs journal recovery before its freeze at :162; restack/restack-recovery.ts:617 can launch an unguarded follow-on restack. The later direct-follow-on guard does not cover recovery."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:8"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11"
    outcome: remediated
    summary: "Verified: caller mapping remains incomplete after removing the low-level HALT. src/conductor/src/engine/remote-git-operations.ts:320 discards mismatched members; ship-draft-pr.ts:463-479 turns the refusal into push failure, and finish-publication.ts:1805-1811 retries instead of recording member-specific divergence. The changed post-finish path throws 'stack-tip-mismatch' at post-finish-shipped-record.ts:171,176, but :181 matches only 'published stack tip mismatch', entering rollback at :104-140 instead of retaining the local commit. Retarget fencing also remains confined to assembly at finish-publication-production.ts:605; the CLI path through github-operations-cli.ts:273 and tracker-client.ts:345-354 has no equivalent fence."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:9"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 13"
    outcome: remediated
    summary: "Verified: prior CLI authorization gaps remain. src/conductor/src/engine/github-operations-cli.ts:123-128 refuses unlisted children only when an active record exists, allowing missing, unreadable and torn-down records to bypass the restriction. Record-bound payload validation now runs in production assembly at finish-publication-production.ts:326, but the CLI runner at github-operations-cli.ts:273 reaches tracker-client.ts:345-354 without validating stack membership, recorded stack number or retarget base. Known-stack-number stack.read targeting is repaired."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:10"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 8"
    outcome: remediated
    summary: "Verified: the audit repair fixes one legitimate leaf candidate but retains child influence over multiple candidates. src/conductor/src/engine/shipment-audit.ts:567-575 returns plan-level absent when a child mentions the plan before :579 can report multiple legitimate candidates as ambiguous. Excluded child bodies must not decide the plan-level result."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:11"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 9"
    outcome: remediated
    summary: "Verified: prior malformed-state handling remains. src/conductor/src/engine/stack-publication.ts:78 accepts objects with missing or unknown state; :84 classifies them unreachable. The report writer at :114 marks tornDown, and mergeable-sweep.ts:842-846 skips subsequent observation. These responses must remain indeterminate and retryable."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:12"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12"
    outcome: remediated
    summary: "Verified: prior cleanup defects remain at multiple sites. src/conductor/src/engine/mergeable-sweep.ts:881-905 skips all child deletion when one member is unreachable, then :842-846 prevents later cleanup. Its :863 active-record lookup hides plain tornDown receipts, bypassing child cleanup and falling into ordinary ref cleanup at :925. stack-teardown.ts:81 treats ordinary non-ancestry as failure rather than keeping that member; :88 accepts an exit-code-1 deletion failure and continues. The sweep catch at :929-934 still drops retry enrollment. Successful-delete retention and duplicate survivor insertion are repaired."
  - gate: architecture_review_as_built
    finding: "as-built:b7fc4b39-1c39-42cc-af27-d49d726213d4:13"
    class: REMEDIABLE
    governing_clause: "Task 29"
    outcome: remediated
    summary: "Verified: park reconciliation still lacks publication retirement: src/conductor/src/engine/park-reconciliation.ts:1251 performs ordinary ref cleanup without marking the retained publication tornDown. New reclaim wiring at daemon-park-cli.ts:317-324 refuses worktree removal when child-cleanup proof is unavailable, instead of retaining children while removing the worktree. Its :326 deletes children before worktree removal at :343, reversing the approved cleanup order. Closed-unmerged tornDown marking is now present."
  - gate: architecture_review_as_built
    finding: "as-built:e20b4b34-3cf2-40e4-a3a9-79b729f886dd:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5"
    outcome: remediated
    summary: "Verified, 99%: the preassembly repair now rejects the correctly unretargeted leaf. stack-publication.ts:399-401 requires every later member, including the leaf, to target its predecessor. establishChildPrs writes the complete membership before retargeting at finish-publication-production.ts:1005-1007; re-observation at finish-publication.ts:1878 therefore reaches the divergence halt at stack-publication.ts:478 before assemble_stack can run. The same check also skips the first child's base when retarget.from is absent. Make base verification phase-aware while retaining first-child verification. This is changed repair code from commit 8d32472a30."
  - gate: architecture_review_as_built
    finding: "as-built:e20b4b34-3cf2-40e4-a3a9-79b729f886dd:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1"
    outcome: remediated
    summary: "Verified, 99%: prior N=1 argv drift remains after repair bdbd4ec61a. remote-git-operations.ts:176 now calls hasDurableChildState on ordinary leaf pushes, adding the two for-each-ref commands at child-cursor.ts:140 and :146. The production path defaults to direct Git at remote-git-operations.ts:162. Avoiding publication-ref reads alone does not preserve the required unchanged Git argv."
  - gate: architecture_review_as_built
    finding: "as-built:e20b4b34-3cf2-40e4-a3a9-79b729f886dd:3"
    class: REMEDIABLE
    governing_clause: "Task rem-prd-audit-rem-v3-read-indeterminate"
    outcome: remediated
    summary: "Verified, 99%: the indeterminate-read repair covers only the first readiness read. finish-publication-production.ts:428 performs validated stack.read, then :438 performs another read. A timeout on that second read is caught at :443 and converted into a terminal stack-tip-diverged HALT at :450-452. Preserve retryable indeterminate routing for this remaining read-failure path."
  - gate: architecture_review_as_built
    finding: "as-built:e20b4b34-3cf2-40e4-a3a9-79b729f886dd:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12"
    outcome: remediated
    summary: "Verified, 99%: two defects remain in teardown repair 04cda5ce81. stack-teardown.ts:72 treats a valid OPEN/CLOSED unreachable member as failed, stopping deletion of later independently proven children rather than keeping that member. Conversely, :80 continues on non-ancestry before checking a failed local-ref probe at :84, allowing later deletions after a Git error. Keep members whose proof legitimately fails; stop and retain retry enrollment on observation errors."
  - gate: architecture_review_as_built
    finding: "as-built:1220f850-f604-43bf-8e86-983ff8a18a5d:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1"
    outcome: remediated
    summary: "Verified, 99%: the October 20 amendment requires durable ref detection even without disposable metadata. remote-git-operations.ts:176 skips the stack guard and child-cursor.ts:303 returns no-child when hasStackedChildEvidence finds neither child directories nor an envelope. A recreated worktree can therefore bypass published-stack protection and use flat state despite surviving refs. The N=1 assertions at test/engine/n1-golden-renderings.test.ts:443,544-545,569-570 also retain the superseded prohibition on local probes instead of recording them separately. These are changed repair sites governed by the newly supplied amendment."
  - gate: architecture_review_as_built
    finding: "as-built:1220f850-f604-43bf-8e86-983ff8a18a5d:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5"
    outcome: remediated
    summary: "Verified, 99%: changed observation code at src/conductor/src/engine/stack-publication.ts:399-406 accepts the leaf's predecessor base only after retarget.phase becomes observed. A crash after GitHub applies retarget but before the observed CAS leaves phase intended and base retarget.to; observation declares divergence and halts before finish-publication-production.ts:627-628 can recover. Admit both journaled bases during intended-phase recovery while rejecting unrelated bases."
  - gate: architecture_review_as_built
    finding: "as-built:1220f850-f604-43bf-8e86-983ff8a18a5d:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5"
    outcome: remediated
    summary: "Verified, 99%: new checks at src/conductor/src/engine/stack-publication.ts:402-403 hardcode main for both the first child and unretargeted leaf when retarget.from is absent. Establishment uses input.baseBranch at finish-publication-production.ts:919,950 and initially records membership without retarget metadata at :1002,1011-1013. A different resolved base therefore causes false divergence before assembly. Supply the actual pre-stack base; return indeterminate when it cannot be established."
  - gate: architecture_review_as_built
    finding: "as-built:9bd5b029-d96f-42c5-91b2-9fa92eb01810:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 3"
    outcome: remediated
    summary: "Verified, 99%: commit c58f8d86d2 introduces a malformed-response regression at src/conductor/src/engine/stack-publication.ts:485-487. A same-length membership response containing null, a scalar or an array now becomes confirmed divergence and reaches the terminal halt callback at :550-552; previously it returned indeterminate. Distinguish malformed entries requiring retry from a genuinely removed member."
  - gate: architecture_review_as_built
    finding: "as-built:9bd5b029-d96f-42c5-91b2-9fa92eb01810:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11"
    outcome: remediated
    summary: "Verified, 99%: prior divergence-identity findings remain partially unresolved. In src/conductor/src/engine/finish-publication-production.ts, the helper at :400-405 throws detail without member positions; affected callers are :615, :633, :638, :683, :747 and :773. Direct throws at :669 and :937 likewise lose positions. Membership mismatch at :447-448 names the upcoming flip rather than affected members; :503-504 emits all members for one child's failure. finish-publication.ts:2138-2140 forwards exception text, and conductor.ts:890 overwrites the earlier member-specific HALT with that text. Preserve affected identities through every effect disposition and final HALT. This continues the supplied prior mapping findings and task rem-prd-audit-rem-s10-6-diverged-positions-halt."
  - gate: architecture_review_as_built
    finding: "as-built:8a420a54-6238-4d04-a1a9-31708ff5b987:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11"
    outcome: remediated
    summary: "Verified, 99%: prior finding as-built:9bd5b029-d96f-42c5-91b2-9fa92eb01810:1 remains partially unresolved. finish-publication-production.ts:405 throws detail without member positions; affected callers are :626, :644, :649, :695, :759 and :785. finish-publication.ts:2138-2140 forwards that text, and conductor.ts:11415 then :890 overwrites the earlier member-specific HALT. Latest commit ea9114178b removed the positions suffix. Event identities are repaired, but these six final HALT paths still fail to name the mismatched positions."
---

## Cost
input: 10397120
output: 1504675
cache_read: 329083716
cache_creation: 10330388
cost_usd: 234.0093
dispatches: 110
retries: 30
halts: 20
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10396700, output: 822907, cache_read: 278394752, cache_creation: 0, cost_usd: 127.5914, dispatches: 60, cost_unmetered: 0
  claude: input: 420, output: 681768, cache_read: 50688964, cache_creation: 10330388, cost_usd: 106.4179, dispatches: 50, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","bfebbdaa-bc2d-481f-a586-c89fc4e15d35","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 15
cache_hits: 5
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 15
  testQuality: failures: 1, judged: 15
skip_reasons:
  disabled: 15
