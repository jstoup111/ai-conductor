**Status:** Accepted

# Stories: build_review re-raises already-decided findings every lap and never converges

Technical track, intake jstoup111/ai-conductor#3294. The governing decisions are
adr-2026-10-24-lap-monotonic-build-review-scope D1 to D10, and the amendments it records on
adr-2026-08-13-engine-managed-build-review-rubric-branches 2,
adr-2026-08-13-stable-build-review-finding-dispositions 2,
adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D2 and D5, and
adr-2026-10-19-build-review-finding-severity-advisory-threshold D4.

Intake desired outcomes, used in the Requirement lines:
- outcome 1: an accepted or rejected finding does not halt or kick back when an equivalent is raised
  later under a new id;
- outcome 2: a later lap does not re-litigate settled code unless it changed;
- outcome 3: a feature with no new defects passes in a bounded number of laps after its last repair;
- outcome 4: a genuinely new defect, including a repair-introduced one, still kicks back.

Fixture shorthand:
- L1, L2 and L3 are consecutive build_review laps of one feature, or of one stacked child.
- H is a hunk identified by its path and its `+`/`-`-only content hash.
- Changed H means a hunk at the same path whose `+`/`-` content differs.
- M is the merge base the lap reviewed.
- R is a rubric: testQuality, security, implementationQuality, or a custom rubric.
- "Non-blocking" means the finding's source is one of:
  - matched by an exact operator disposition;
  - finalized in the remediation case store;
  - below the confidence floor;
  - below the severity threshold;
  - recorded out of delta.
- The scope record is the `reviewScope` field of the rubric's lap branch artifact.

## Story 1: Each lap records its review scope, and uncertainty falls back to a full review

**Requirement:** outcome 2; ADR D1, D3

As the build_review engine, I want every rubric lap to record which hunks it judged against which
merge base, and to fall back to a full review whenever that record cannot be trusted, so that
narrowing a later lap never hides unreviewed code.

### Acceptance Criteria

#### Happy Path
- Given a feature's first build_review lap, when R is judged, then R's scope record has mode `full`, reason `first-lap`, sequence 1, the lap's merge base and head, no predecessor lap, every current hunk in reviewed hunks, and an empty out-of-delta list.
- Given L1 recorded R at merge base M and L2 reviews the same merge base M with unchanged contract and projection versions, when L2 decides R's scope, then R's mode is `delta` with reason `delta` and its predecessor lap is L1.
- Given L1 recorded R at merge base M and L2 reviews a different merge base, when L2 decides R's scope, then R's mode is `full` with reason `merge-base-changed`, whatever cause the rebase kickback recorded, including `feature-repair` on a restacked child.
- Given any lap's scope decision for R, when it is made, then one `build_review_review_scope` event is persisted carrying the rubric, lap id, mode, reason, delta hunk count and settled hunk count, and it is not rendered to the operator log.

#### Negative Paths
- Given L1's scope record for R is missing because the worktree's pipeline state was recreated, when L2 decides R's scope, then R's mode is `full` with reason `first-lap` and every current hunk is reviewed.
- Given L1's branch artifact for R exists but its scope record cannot be parsed, when L2 decides R's scope, then R's mode is `full` with reason `record-unreadable`, and the unreadable artifact is neither rewritten nor deleted.
- Given L2 ran a `record-unreadable` full lap for L1's unreadable record of R, when L3 decides R's scope, then L1's record is ignored and L3 is not `full` because of it.
- Given L1 recorded R under projection v4 and L2 runs under a different projection or contract version, when L2 decides R's scope, then R's mode is `full` with reason `version-changed`.
- Given L1 failed R with an infrastructure fault and so recorded no scope for R, when L2 decides R's scope, then L1 contributes no reviewed hunks for R and only earlier successful laps of R at merge base M can settle anything.
- Given a rebase that moved the merge base of a stacked child whose kickback cause is `feature-repair`, when the child's next lap decides scope, then no rubric of that child is delta-scoped against records from the old merge base.
- Given R already has a readable scope record at the current lap id, merge base and policy identity, as after a mechanical retry, a halt-clear re-dispatch or a disposition-only rejoin, when the lap decides R's scope, then it reuses that record's scope unchanged and R's earlier reviewed hunks are not lost.
- Given L1 recorded R and before L2 the rubric's skill bundle digest, custom declaration, or provider, model or effort changes, when L2 decides R's scope, then R's mode is `full` with reason `version-changed`.
- Given L1 recorded R and before L2 only the engine build identity changes, when L2 decides R's scope, then R's mode is `delta`.

### Done When
- [ ] Frontier unit tests cover each `full` reason, the `delta` decision, the feature-repair restack case, a policy-identity change and the same-head scope reuse.
- [ ] A branch-artifact round-trip test proves the scope record persists mode, reason, sequence, merge base, head, policy identity, predecessor lap, reviewed hunks, delta hunks and out-of-delta ids.
- [ ] An event-persister test proves `build_review_review_scope` is persisted with the listed fields and not rendered.

## Story 2: A hunk a prior lap settled leaves the next lap's delta until it changes

**Requirement:** outcomes 1 and 2; ADR D2

As the build_review engine, I want a hunk that a prior lap judged, and on which nothing still
blocks, to drop out of later laps' delta until its content changes, so that decided code is not
judged again.

### Acceptance Criteria

#### Happy Path
- Given L1 reviewed H for R at merge base M and raised no finding on H, when L2 at M decides R's scope with H unchanged, then H is settled and absent from R's delta hunks.
- Given L1 raised finding F on H and the operator accepted F by exact disposition, or the judge finalized F's source with disposition `reject`, `defer`, `refute` or `advisory`, when L2 at M decides scope with H unchanged, then H is settled.
- Given L1 raised finding F on H and F's case is a resolved `act` case with an applied action effect, when L2 at M decides scope with H unchanged, then H is settled.
- Given L1 raised finding F on H and F was below R's confidence floor or below R's severity threshold in L1, when L2 decides scope with both thresholds unchanged, then H is settled.
- Given H is settled after L2 and its content changes before L3, when L3 decides R's scope, then the changed hunk is in R's delta hunks.
- Given a pure rebase that keeps H's `+`/`-` content but shifts its line numbers, when H is compared with prior records at the same merge base, then H keeps its identity and its settled state.

#### Negative Paths
- Given L1 raised F on H and F's case is an open `act` case, or a `failed` or `reserved` act case, when L2 decides scope with H unchanged, then H is not settled and stays in R's delta hunks.
- Given L1 raised F on H and F's case is an `act` case whose action effect is applied but which is still open, when L2 decides scope, then H is not settled and stays in R's delta hunks.
- Given L1 settled H only because F was below R's severity threshold, and the operator then lowers or removes that threshold so F is no longer below it, when L2 decides scope, then H is not settled and is judged again.
- Given H was settled by security in L1, when L2 decides implementationQuality's scope, then security's record does not settle H for implementationQuality.
- Given two adjacent edits fuse H and a neighbouring settled hunk into one hunk with a new content hash, when the next lap decides scope, then the fused hunk is in the delta and neither original hunk's settled state is applied to it.
- Given L1 raised a blocking finding F on H that is still unresolved, and L2 judged H and raised nothing, when L3 decides scope with H unchanged, then H is not settled, because F from L1 still blocks.
- Given an open act case whose action effect is not applied and whose source maps to no current hunk on path P, when R's scope is decided, then every current hunk on P is in R's delta, and when P has no current hunk R's lap is `full` with reason `open-source-unmapped`.
- Given an open act case whose action effect is applied and whose source's anchor hunk the repair rewrote, when R's scope is decided, then that source adds no hunk to R's delta beyond the unsettled hunks, and R's lap is not `full` because of it.
- Given testQuality's current test scope holds an unresolved marker or an indeterminate candidate that maps to H, when testQuality's scope is decided, then H is not settled.

### Done When
- [ ] Frontier tests cover each non-blocking route listed above, plus the unsettled routes: open, failed and reserved act cases, an applied but still-open act case, a changed threshold, and a fused hunk.
- [ ] A test proves settlement is per rubric and is evaluated against the current dispositions, case store and thresholds rather than a snapshot.
- [ ] A test proves a line-shifted, content-identical hunk keeps its settled state.

## Story 3: Rubrics judge only the delta, receive no case history, and are skipped when nothing is left

**Requirement:** outcomes 2 and 3; ADR D3, D4, D9

As a build_review rubric on any provider, I want to receive the delta to judge with the whole diff
as reference, and no history, so that I judge only unsettled code without being steered by earlier
decisions.

### Acceptance Criteria

#### Happy Path
- Given L2 is a delta lap for R, when R's projection is derived, then it is projection v4 with `changedFiles` listing the whole diff and a `reviewScope` naming mode `delta` and exactly R's delta hunks.
- Given L2 is a delta lap for a custom rubric, when its input is assembled, then the input carries the same `reviewScope` with mode and delta hunks.
- Given L2 is a delta lap for R and R's delta is empty, when the coordinator reaches R, then R is not dispatched and runs no preflight, its branch outcome is `scope-empty` with no findings and with its scope record, `build_review_rubric_skipped` is emitted with reason `scope-empty`, and R counts as non-failing in the aggregate.
- Given an earlier lap of R with the same v4 projection digest, covering the whole-diff references and the delta, and with the same engine identity and policy, when L2 looks up R's cache, then the earlier judged result is reused as a cache hit.
- Given the rubric and remediate skill contracts, when a Claude dispatch and a Codex dispatch render R, then both read the same skill text, which tells the rubric to judge the delta hunks, to treat the whole diff as context only, and to name a cause hunk in the delta for any finding outside it.

#### Negative Paths
- Given L2 is a delta lap for R, when R's projection is serialized, then it contains no prior findings, case records, dispositions, settled ids, suppression history or scope records of earlier laps.
- Given L1 and L2 have identical diffs but different delta hunks for R, when L2 looks up R's cache, then the lookup misses and R is judged again.
- Given L2 is a delta lap and testQuality's counterfactual preflight runs, when the preflight restores merge-base production content, then it covers every changed production file of the whole diff, not only files with delta hunks.
- Given every enabled rubric has an empty delta in L2, when the lap completes, then the lap passes with no rubric dispatch, no remediate dispatch and no kickback charge.
- Given R recorded a `scope-empty` result in L2, when L3 decides R's scope, then L2 adds no reviewed hunks for R and the hunks settled before L2 remain settled.
- Given R is `scope-empty` in L2, when judged-rate metrics and absence retirement are computed for L2, then R is counted as a skip with reason `scope-empty` and never as judged, and R gives no evidence that any of its sources is no longer raised.

### Done When
- [ ] Projection tests prove v4 projections carry the whole-diff `changedFiles` and the exact delta, and carry none of the excluded history fields.
- [ ] Coordinator tests prove the `scope-empty` result is recorded without dispatch, and that a changed delta misses the cache.
- [ ] A test proves the testQuality preflight input is unchanged by delta scoping.
- [ ] The build-review rubric skills and the custom rubric prompt state the delta contract in one provider-neutral text.

## Story 4: A finding outside the delta blocks only through a cause hunk in the delta

**Requirement:** outcomes 1, 2 and 4; ADR D5, D6

As the build_review engine, I want a later-lap finding on settled code to block only when the
reviewer names a delta hunk as its cause, and otherwise to be recorded without consequence, so that
a reworded re-raise of decided substance cannot halt or charge the feature.

### Acceptance Criteria

#### Happy Path
- Given L2 is a delta lap for security or implementationQuality and a non-critical finding is anchored on a settled hunk without a cause hunk, when the effective verdict is derived, then the finding is classified `outOfDelta`, is recorded in the lap's out-of-delta ids and the aggregate, and does not block.
- Given the same finding names as its cause hunk a hunk that is in L2's delta hunks, when the effective verdict is derived, then the finding is classified exactly as it would be without delta scoping and can block.
- Given a non-critical custom rubric finding whose source regions intersect only settled hunks, or a non-critical testQuality finding whose anchored test region intersects only settled hunks, when L2's effective verdict is derived, then the finding is `outOfDelta` unless it names a delta cause hunk.
- Given a lap with out-of-delta findings, when `build_review_outer_verdict` is emitted, then it carries their count.
- Given a finding with a cause hunk, when its id is computed, then the id equals the id the same finding would have without the cause hunk.
- Given an `outOfDelta` finding, when the gate-completion predicate, the conductor exits, the adjudication coordinator, clean-PASS settlement and `build-review findings` each classify it, then all of them report it as `outOfDelta`.

#### Negative Paths
- Given an `outOfDelta` finding in L2, when the lap is adjudicated, then the finding is not among the remediate judge's live sources, routes no BUILD work, emits no kickback and charges nothing to the kickback ledger.
- Given an `outOfDelta` finding, when operator accepted risk is listed or published, then the finding does not appear as accepted risk.
- Given a non-critical finding that names a cause hunk not present in L2's delta hunks, or a cause hunk on a path the diff does not change, when the effective verdict is derived, then the cause is ignored and the finding is `outOfDelta`.
- Given a custom or testQuality finding whose region intersects no hunk and whose path has a delta hunk, when L2's effective verdict is derived, then the finding is in scope and can block.
- Given a full lap, whether the first lap or one forced by a merge-base change, when the effective verdict is derived, then no finding is classified `outOfDelta`.
- Given a finding whose exact source id is already settled or carried, when it also lies outside the delta, then it is classified settled or carried, not `outOfDelta`.
- Given L2 is a delta lap and a finding with reviewer severity `critical` in any rubric is anchored on a settled hunk without a cause hunk, when the effective verdict is derived, then it is not `outOfDelta` and is classified exactly as it would be without delta scoping, so an unaccepted, unsettled critical finding blocks.
- Given a judged result whose cause hunk is malformed, for example a missing content hash or extra keys, when the result is parsed, then it is rejected exactly like any other contract-invalid result.

### Done When
- [ ] Effective-verdict tests for the built-in and custom reducers cover the class order, accepted, then settled or carried, then `outOfDelta`, then replication, suppressed, advisory and unresolved, and each case above.
- [ ] Parser tests prove the optional cause hunk is accepted by the v4 built-in and v2 custom contracts and changes no finding id.
- [ ] An adjudication test proves `outOfDelta` sources are excluded from live sources and from charging.

## Story 5: A defect a repair introduced still kicks back and counts against the repaired case's lineage

**Requirement:** outcomes 3 and 4; ADR D7

As the adjudication engine, I want a new act case in code a repair just changed to continue that
repair's recurrence lineage, so that chains of repair-introduced defects are bounded rather than
starting fresh every lap.

### Acceptance Criteria

#### Happy Path
- Given L1 raised source S1 on path P, its act case C1 was applied, and L2 raises a new source S2 on a delta hunk of P with no exact-source owner, when the judge returns an unbound act case for S2, then the case kicks back to BUILD and the engine stamps `recurrenceOf` C1.
- Given two candidate act cases with applied effects, each owning a source raised in the predecessor lap on the same path, when the engine chooses a provenance owner, then it picks the one whose lineage has more applied attempts, breaking a tie by the lowest case id.
- Given a provenance lineage that already holds three applied attempts, when another unbound act case on a delta hunk joins it, then the build halts with the existing recurrence-limit halt, which names the lineage, before any effect reservation.
- Given the judge declares `distinctFrom` naming the provenance candidate with a non-empty reason, when the case is reconciled, then it starts a fresh lineage and the declaration is persisted.

#### Negative Paths
- Given L2 raises a new act source on a delta hunk of a path where no act case with an applied effect owns a source raised in L1 on that path, when the case is reconciled, then no `recurrenceOf` is stamped and the case is a fresh lineage.
- Given an act case with an applied effect that owns no source raised in the predecessor lap, when L2's new act case on the same path is reconciled, then that case is not a provenance candidate.
- Given an unbound act case that already has an exact-source owner, when it is reconciled, then the existing recurrence rule applies and provenance is not consulted.
- Given a new act case bound by `existingCaseId`, or a case whose disposition is not `act`, when it is reconciled, then provenance stamps nothing.
- Given commits in the interval carry `Task:` trailers that name other tasks, when provenance is derived, then the trailers have no effect on the chosen owner.

### Done When
- [ ] Coordinator tests cover provenance stamping, the candidate tie-break, the lineage-limit halt, and `distinctFrom` opt-out.
- [ ] Tests cover each non-candidate case above.
- [ ] `skills/remediate/SKILL.md` states that `distinctFrom` may name a provenance candidate.

## Story 6: The remediate judge sees what prior findings said, within a fixed budget

**Requirement:** outcome 1; ADR D8

As the remediate judge, I want each prior case's recent sources to show the finding text and
locations they came from, so that I can bind an equivalent re-raise to its decided case.

### Acceptance Criteria

#### Happy Path
- Given a prior case whose sources were raised in laps whose branch artifacts exist, when the adjudication context is built, then each of its latest 4 sources carries a digest with rubric, concern kind, a summary of at most 1000 bytes, at most 8 evidence locations and the lap id.
- Given the digests of all prior cases fit in 64 KiB, when the context is built, then every eligible source carries its digest and `priorDigestsOmitted` is zero.

#### Negative Paths
- Given the digests exceed 64 KiB, when the context is built, then the oldest digests are dropped first until the budget holds, `priorDigestsOmitted` counts them, and the context still builds and dispatches.
- Given a prior source whose lap artifact is missing or unreadable, when the context is built, then that source carries no digest and the context still builds.
- Given a case with more than 4 sources, when the context is built, then only its 4 most recent sources carry digests.
- Given a context whose prior cases, current sources and plan context leave less than 64 KiB under the existing 256 KiB limit, including the maximum case history, when digests are added, then they use only the remaining headroom and the context never overflows because of them.

### Done When
- [ ] Context-builder tests cover the digest shape, the per-source and per-case caps, the budget's oldest-first drop, and missing artifacts.
- [ ] A serialization test proves a context that fits without digests still fits with them, at the maximum case history.
- [ ] `skills/remediate/SKILL.md` states that digests are binding context, never report text.

## Story 7: The #3294 shapes converge

**Requirement:** outcomes 1, 2, 3 and 4; ADR D2 to D7; architecture review condition 3

As the operator, I want the shapes that cost 27 to 31 laps on 2026-10-18 to converge, so that large
self-host features stop halting on decided substance.

### Acceptance Criteria

#### Happy Path
- Given an implementationQuality finding on L1's hunk H whose case the judge finalized as `reject`, and L2 re-raises the same concern on unchanged H under a different concern kind and wording, when L2 is adjudicated, then the re-raise is `outOfDelta`, the feature does not halt, and no kickback is charged.
- Given a finding accepted by exact operator disposition on L1's hunk H, and L2 re-raises the same concern on unchanged H under a new id, when L2 is adjudicated, then the re-raise is `outOfDelta` and no operator re-acceptance is needed.
- Given L1 kicked back one act case and its repair changed only hunk H2, when L2 runs with no new defect, then only H2 is judged and build_review passes on L2.
- Given L1 kicked back and the repair introduced a genuine defect in hunk H2, when L2 runs, then the defect is raised on H2, kicks back, and is recorded as a recurrence of the repaired case.
- Given a custom rubric whose finding ids change every lap, when L2 judges a feature whose only change since L1 is in another file, then the custom rubric raises nothing on L1's settled hunks that blocks.

#### Negative Paths
- Given a change in L2's delta that breaks unchanged code on settled hunk H, when the reviewer names the delta hunk as cause, then the finding blocks and kicks back.
- Given a base refresh between L1 and L2, when L2 re-raises an unchanged finding on unchanged H with the same concern kind, then L2 is a full lap, the finding keeps its L1 id, and the existing exact-id settlement applies.
- Given a repair chain in which every repair introduces a new defect on the hunk it changed, when the fourth applied attempt in the lineage is due, then the feature halts with the recurrence-limit halt instead of continuing to kick back.
- Given a stacked child whose parent was repaired and restacked between L1 and L2, when the child's L2 runs, then L2 is a full lap and the child's unchanged hunks keep their L1 ids, so exact-id settlement still applies.
- Given a delta lap in which every finding any rubric raises is `outOfDelta`, when the lap completes, then build_review passes without a remediate dispatch.

### Done When
- [ ] Integration tests drive multi-lap fixtures through the runner and the adjudication coordinator, one for each shape above.
- [ ] Each test asserts the lap count, the kickback charges and any halt reason.
