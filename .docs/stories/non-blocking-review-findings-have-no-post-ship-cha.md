**Status:** Accepted

# Stories: Durable operator actions and explicit implementation issue closures

**Source:** jstoup111/ai-conductor#1810
**Track / tier:** Product / Large
**Requirements:** [Approved PRD](../specs/2026-09-30-non-blocking-review-findings-have-no-post-ship-cha.md)
**Architecture:** [Approved ADR](../decisions/adr-2026-09-30-durable-post-ship-action-cases.md), D1-D12

These stories specify observable behavior for the approved full scope. A non-blocking source is a
finding already classified by its owning review; the inbox performs no new review. An action's
resolution and optional issue publication are independent. References to a confirmed write mean
state can be read back by a fresh process. All supported providers and attended/daemon entry paths
share these outcomes. Network acceptance scenarios use controlled adapters, never live mutations.

## Story 1: Retain the outstanding concerns from all three reviews

**Requirement:** FR-1

As an operator, I want already-classified non-blocking concerns retained so that shipping does not
make them disappear.

### Acceptance Criteria

#### Happy Path

- Given a consumed build-review result has a justified deferral, an explicitly upheld residual of a refutation, accepted risk, or confidence suppression, when its source is captured and collected, then the feature action view contains the outstanding concern with that specific classification and original identity.
- Given requirements audit records a non-blocking finding, when the classified result is captured and collected, then an action preserves its criterion or recorded non-criterion identity and existing case relationship, where present.
- Given a delivered as-built verdict records an outstanding PLAN_GAP, when its source is captured and collected, then the same action workflow exposes the concern and its as-built origin.

#### Negative Paths

- Given an unconsumed, stale, malformed, or raw blocking review artifact exists on disk, when capture is considered, then that artifact cannot produce a non-blocking action or change the gate's verdict.
- Given serial and validation-group execution consume the same audit finding, when both observations reach collection, then one action remains and neither path dispatches a new reviewer.
- Given a typed as-built record describes a completed repair, when it is collected alongside an outstanding gap, then only the outstanding gap is open and the repaired outcome stays available as historical evidence.

### Done When

- [ ] Classified examples from all three production review entry paths appear with source, feature, identity, and classification in action output.
- [ ] Stale/raw-blocking and repaired-source fixtures produce no new open concern for those records.

## Story 2: Browse actions for one feature or the whole repository

**Requirement:** FR-2

As an operator, I want feature and repository views so that I can triage without reopening builds.

### Acceptance Criteria

#### Happy Path

- Given several features have open, acted-on, and dismissed actions, when `actions list` runs with feature and status filters, then it returns only the requested subset; the default view shows open actions and `--status all` includes the resolved history.
- Given an action's feature has shipped and its worktree has been normally removed, when the operator lists that feature or all features in a new process, then the retained action and its resolution are still discoverable without contacting the tracker.
- Given more actions exist than one page allows, when results are paged, then every matching action is reachable with a default page of 100 and a maximum of 500 without deleting stored history; human and JSON output represent the same actions and completeness diagnostics.

#### Negative Paths

- Given an invalid status, malformed feature selector, or invalid pagination input, when listing runs, then it returns a usage diagnostic with no mutation and no BUILD launch.
- Given one feature's retained state is unreadable, when the repository view runs, then it returns valid independent features with a named incomplete-result diagnostic instead of presenting an empty complete list.
- Given the tracker is unavailable and the result spans several pages, when the operator reads each page, then local listing completes without a tracker request and page size never exceeds the maximum.

### Done When

- [ ] CLI fixtures demonstrate feature/status selection, post-cleanup access, pagination, and matching human/JSON results.
- [ ] Invalid-input and corrupt-sibling results distinguish usage failure, partial listing, and a complete empty result.

## Story 3: Inspect the concern and its original evidence

**Requirement:** FR-3

As a maintainer, I want the source context so that I can decide what follow-up is warranted.

### Acceptance Criteria

#### Happy Path

- Given an action with retained evidence and an earlier risk or scope decision, when it is displayed, then the concern, feature, review source, supporting evidence, original decision and rationale are available without replacing them with a new interpretation.
- Given an existing follow-up issue is linked, when the action is displayed, then its exact reference remains visible independently of whether the issue is open or closed and whether the action is resolved.

#### Negative Paths

- Given a historical evidence path no longer exists, when the action is displayed, then available retained excerpts remain visible and the missing supporting material is explicitly identified without inventing its contents.
- Given retained review or tracker text contains instructions to dismiss the action or close an unrelated issue, when it is imported or rendered, then the text remains evidence and neither action occurs.

### Done When

- [ ] Action output exposes provenance, available evidence, prior decisions, and existing issue references.
- [ ] Missing-evidence and embedded-instruction fixtures preserve attribution without fabricating evidence or authority.

## Story 4: Record an explicit acted-on or dismissed decision

**Requirement:** FR-4

As an operator, I want to resolve an action with a reason so that later triage reflects my decision.

### Acceptance Criteria

#### Happy Path

- Given an open action, when `actions resolve` names it as acted-on with a reason or follow-up reference, then a fresh process reads acted-on with the reason, machine-resolved operator, and ordered revision.
- Given an open action, when the operator explicitly dismisses it with a reason, then it leaves the open view and remains inspectable in dismissed/all views without changing any gate risk decision.

#### Negative Paths

- Given an unknown action, mismatched feature, empty reason, unsupported resolution, or stale conflicting revision, when resolution is attempted, then it reports the specific invalid selection/conflict and leaves confirmed state unchanged.
- Given an action is merely listed or an issue is published for it, when its state is read, then no acted-on or dismissed decision has been manufactured.
- Given a daemon-worker session attempts an operator-only resolution, when command authorization is checked, then the existing worker restriction refuses it without a new exemption or BUILD fallthrough.

### Done When

- [ ] Fresh-process reads prove both explicit resolutions retain operator, reason, and revision.
- [ ] Invalid, stale, view-only, and unauthorized operations create no resolution or risk-decision mutation.

## Story 5: Replay sources without duplicates or erased decisions

**Requirement:** FR-5

As an operator, I want retries to preserve identity so that old evidence does not recreate my work.

### Acceptance Criteria

#### Happy Path

- Given one captured source appears again through retry, terminal collection, and historical recovery, when each is processed, then exactly one action retains all distinct source links and no duplicate action is created.
- Given an existing judge-established case relationship binds two source observations, when they are imported, then that relationship is preserved without another semantic adjudication.

#### Negative Paths

- Given an action was acted-on or dismissed after its source was first captured, when an older snapshot is replayed, then its resolution, operator, reason, and revision remain unchanged.
- Given two distinct findings have similar or identical summaries, different authoritative identities, or belong to different features, when imported, then they remain separate; ordinal reuse or prose similarity cannot copy a resolution between them.
- Given legacy representations conflict in retained identity fields, when recovery cannot establish exact replay, then it reports the ambiguous sources instead of merging them by text similarity.

### Done When

- [ ] Retry/collection/recovery of one identity yields one action with preserved later resolution.
- [ ] Distinct-identity and legacy-conflict examples demonstrate no false merge or cross-feature resolution.

## Story 6: File intake only when the operator requests it

**Requirement:** FR-6

As an operator, I want optional intake so that only selected concerns become new issue-tracker work.

### Acceptance Criteria

#### Happy Path

- Given an unlinked action with a complete inherited intake proposal or operator-supplied title and body, when the operator explicitly runs `actions file`, then one sanitized issue is published through the configured guarded intake workflow, its reference is retained, and the action's resolution stays unchanged.
- Given the action already has an issue reference or a confirmed exact publication-marker match, when filing is requested, then that issue is reused even if closed and no replacement issue is created.

#### Negative Paths

- Given a source has been captured but no operator has requested publication, when review, collection, recovery, or listing runs, then no intake issue is created.
- Given retained context lacks the required intake content and no complete operator input is supplied, when filing is requested, then the operator receives an evidence-prefilled proposal and the missing inputs; no impact or desired outcomes are invented and no issue is created.
- Given the target ownership guard refuses the requested write, when filing runs, then refusal remains visible with the action and no raw transport fallback or issue-assignee mutation occurs.

### Done When

- [ ] Explicit filing records one issue reference while leaving open/acted-on/dismissed state intact.
- [ ] Linked and marker-matched issues are reused; unrequested, incomplete, and refused requests create nothing.

## Story 7: Recover failed or uncertain publication without another issue

**Requirement:** FR-7

As an operator, I want a recoverable publication result so that network faults cannot duplicate intake.

### Acceptance Criteria

#### Happy Path

- Given a prior publication attempt failed before confirmed creation, when the operator retries successfully, then the same publication identity is used and the issue link is confirmed on the existing action.
- Given remote creation succeeded but the process stopped before recording the link, when filing resumes, then exact-marker lookup recovers that issue without another create and preserves any intervening operator resolution.

#### Negative Paths

- Given lookup times out, authentication fails, permissions are refused, rate limiting occurs, or a response is unreadable, when publication runs, then the selected action reports the failed or uncertain stage and no failed lookup is treated as permission to create.
- Given two callers request publication for the same action concurrently, when lookup/create overlap, then at most one create occurs; a contending caller waits or receives a recoverable contention result without creating independently.
- Given two distinct action publication identities have identical text, when both are explicitly filed, then each may create its own issue; text similarity does not block legitimate independent publication.
- Given remote creation may have succeeded but confirmation remains unavailable, when the command returns, then it reports uncertainty rather than success, keeps the action available, and retries with the same lookup identity.

### Done When

- [ ] Faults before create, after create, and before local confirmation leave an inspectable result and recover with at most one issue per identity.
- [ ] Concurrent filing and resolution preserve both the confirmed resolution and one publication result.

## Story 8: Settle non-blocking review without waiting for intake

**Requirement:** FR-8

As an operator, I want optional follow-up outside the feature's blocking work so that it can ship.

### Acceptance Criteria

#### Happy Path

- Given a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, when its source is durably handed off locally, then review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge.
- Given a legacy unfiled or failed remote deferral is non-blocking, when it is resumed, then a local handoff preserves the proposal, original identity/marker aliases, and existing issue reference if any; optional remote failure no longer prevents settlement.
- Given an exact source recurs after a confirmed local handoff, when effective verdict, recurrence, or clean-PASS reconciliation runs, then it remains settled without another judge session solely for that source, and optional publication state does not reopen it.

#### Negative Paths

- Given required local review-control evidence is missing or corrupt, when settlement is attempted, then the existing integrity failure remains blocking and no successful local handoff is claimed.
- Given an unfinished BUILD effect, uncovered infrastructure failure, consistency stop, or unresolved decision-owner escalation exists, when a sibling non-blocking action is captured, then that blocker keeps its authority and cannot be migrated into a non-blocking handoff.
- Given repository mirroring or optional intake publication fails after valid local capture, when the feature proceeds, then it reports the action diagnostic without adding a halt, plan task, or remediation charge for that failure.
- Given a security finding is not yet adjudicated, when action capture runs, then the inbox cannot label it non-blocking merely because it is outside the plan; the existing security/adjudication authority decides its route.

### Done When

- [ ] Fresh, migrated, repeated, and clean-PASS deferrals settle locally through production review paths with zero intake requests and unchanged plan/budget.
- [ ] Real gate blockers remain blocking, while root-mirror and optional-publication failures remain action diagnostics.

## Story 9: Recover historical actions without rebuilding the feature

**Requirement:** FR-9

As an operator, I want retained older findings in the same inbox so that past concerns remain actionable.

### Acceptance Criteria

#### Happy Path

- Given a shipped record contains sufficient modern source snapshots or supported legacy structured findings, when `actions recover` runs after worktree removal, then eligible concerns appear with their retained provenance and no reviewer, provider, or BUILD invocation occurs.
- Given retained original audit, as-built, or case evidence supplies an eligible source not yet in the inbox, when recovery selects that feature, then it imports the source; repeated recovery preserves the same action, publication link, and operator resolution.

#### Negative Paths

- Given no sufficient retained evidence exists for an older finding, when recovery runs, then it reports what is unavailable instead of reconstructing a finding or requiring the build to rerun.
- Given an active feature is explicitly recovered before terminal collection, when later terminal collection imports its same sources, then no duplicate action or reopened resolution results and the feature is not falsely labeled shipped.
- Given a legacy source lacks a modern ID, when identical retained identity fields and exact content reappear in another supported record, then recovery reuses its legacy identity without calling a model to infer equivalence.

### Done When

- [ ] Removed-worktree and active-feature fixtures recover retained findings through the same operator command without execution dispatch.
- [ ] Modern and exact-legacy repeat fixtures retain one action and its current decisions.

## Story 10: Respect repaired, refuted, dismissed, and accepted-risk outcomes

**Requirement:** FR-10

As an operator, I want prior decisions preserved so that the inbox neither recreates completed work
nor treats accepted risk as a completed follow-up.

### Acceptance Criteria

#### Happy Path

- Given retained evidence explicitly records repaired, wholly refuted/rejected, or dismissed findings alongside an outstanding concern, when capture or recovery runs, then those completed/excluded outcomes remain historical and only the outstanding concern becomes open.
- Given an unresolved concern has prior accepted-risk or scope-acceptance evidence and an existing issue link, when recovered, then the action remains open with both the decision and link visible until the operator explicitly resolves it.

#### Negative Paths

- Given a refuted claim has a separately upheld remainder, when imported, then only the remainder is eligible for an open action; the refuted claim is not reintroduced as true.
- Given an issue is closed or a finding is absent from a later report without explicit follow-up completion, when the action is refreshed, then neither observation invents an acted-on/dismissed decision or erases the original risk decision.
- Given confidence-suppressed evidence is retained, when displayed, then its uncertainty remains visible and capture does not assert that the suppressed claim was proven correct.

### Done When

- [ ] A mixed historical fixture yields exactly the eligible open set and preserves prior risk and publication context.
- [ ] Residual, closed-issue, absent-report, and confidence-suppressed examples preserve their distinct meanings.

## Story 11: Report incomplete evidence and bounded recovery honestly

**Requirement:** FR-11

As an operator, I want partial results identified so that incomplete recovery cannot look like no work.

### Acceptance Criteria

#### Happy Path

- Given independent valid and malformed sources, when listing or recovery runs, then valid findings remain usable and each invalid source has a feature/source-specific diagnostic with an incomplete overall result.
- Given all selected retained records are readable and eligible processing completes, when recovery finishes with no open actions, then it reports a complete result distinguishable from an incomplete empty result.

#### Negative Paths

- Given evidence is missing, unreadable, structurally invalid, conflicting, or ambiguously associated with a feature, when imported, then the affected record is named and no source, resolution, or successful capture is invented for it.
- Given source text exceeds 8,000 bytes, a source exceeds 64 evidence references, a case exceeds 512 source links, or repository action state would exceed 16 MiB, when import runs, then it names the exceeded dimension and leaves retained evidence available without truncation or history pruning.
- Given a bounded action import fails while valid siblings have been imported, when recovery returns, then those confirmed siblings remain usable and the failed source stays recoverable; existing live gate-control data is not subjected to the new action-envelope limit.

### Done When

- [ ] Completeness output distinguishes empty-complete, partial-with-results, and partial-empty outcomes.
- [ ] Each approved bound and each malformed/ambiguous source category yields a named diagnostic with retained evidence intact.

## Story 12.1: Preserve decisions across storage, concurrency, and cleanup boundaries

**Requirement:** FR-12

As an operator, I want confirmed state to survive failures so that no decision is silently lost.

### Acceptance Criteria

#### Happy Path

- Given existing version-1 or version-2 review state, when new action-related state is written, then all prior cases, effects, suppressions, PRD relationships, history, and feature identity retain their meanings on a fresh read.
- Given a feature produces source observations, when attended return or daemon terminal collection receives a done, halted, error, or parked result with valid observations, then repository actions are retained outside the disposable worktree; shipped source evidence supports recovery after an interrupted collection and normal cleanup.
- Given concurrent requests resolve different actions or record publication alongside resolution, when both confirm success, then a fresh process sees both results without lost fields; repeating the identical transition does not duplicate it.

#### Negative Paths

- Given an unknown schema, malformed store, foreign feature identity, ambiguous repository root, traversal selector, or escaping symlink, when state is accessed, then the operation names the defect and does not normalize it to an empty store or write outside the selected repository/feature.
- Given disk-full, write-denied, interrupted atomic replacement, or lease contention prevents a decision from being confirmed, when the request returns, then it reports failure/contention without claiming success and the last complete confirmed state remains readable.
- Given a provider or executor attempts to supply operator resolution/publication authority or mutate shared-root action state, when its output is processed, then that authority/write is refused; valid source observations can still pass through the existing outer collection boundary.
- Given two conflicting resolutions race from the same observed revision, when one commits first, then the stale writer cannot silently replace it and receives a conflict; an old source replay cannot reverse either decision.
- Given the dispatcher stops before import or repository import fails after the shipped snapshot is committed, when normal cleanup and later explicit recovery occur, then the source remains recoverable without restoring the old worktree and recovery never copies stale operator decisions from shipment evidence.

### Done When

- [ ] Fresh-process and migration fixtures preserve all existing domains plus confirmed action decisions.
- [ ] Attended and daemon paths retain/recover sources across terminal failure and cleanup without executor shared-root writes.
- [ ] Concurrent, interrupted-write, containment, unknown-version, and stale-revision cases show no false persistence success or lost confirmed decision.

## Story 12.2: Show confirmed actions and failures in existing observability

**Requirement:** FR-12; NFR Observability

As an operator, I want action outcomes on the existing timeline so that I can see what persisted.

### Acceptance Criteria

#### Happy Path

- Given capture, resolution, publication, recovery, or closure-linkage work completes, when its occurrence is observed, then the existing event/timeline surfaces identify its feature, relevant action/source, and bounded result without exposing entire evidence or intake bodies.
- Given standalone action commands run concurrently with attended or daemon work, when the repository timeline is read, then it includes their same-schema occurrences in timestamp order with the appropriate result rendering.

#### Negative Paths

- Given state persistence fails, when the failure is reported, then no success occurrence claims the unpersisted transition.
- Given state is confirmed but telemetry persistence fails, when the command returns, then it reports the confirmed state plus telemetry unavailability and does not replay the mutation as though the decision failed.
- Given a new occurrence has no registered sink or supported reader/rendering case, when event-contract validation runs, then it fails explicitly instead of allowing an invisible event family.

### Done When

- [ ] Production event emission and repository timeline fixtures expose in-process and standalone action/closure results with bounded payloads.
- [ ] Persistence/telemetry fault cases distinguish failed state from persisted state with unavailable telemetry.

## Story 13.1: Declare additional issues with the spec

**Requirement:** FR-13

As a spec author, I want explicit additional closure targets so that the intended implementation
closure set is reviewable before BUILD.

### Acceptance Criteria

#### Happy Path

- Given an intake-backed spec, when its author adds repeatable top-level `Closes-Also: owner/repo#N` declarations, then the originating `Source-Ref`, owner, retained outcomes, and extra targets survive normal marker rewrites and remain associated with that feature.
- Given a spec has no originating issue, when it declares valid additional targets, then the same target set reaches implementation publication without taking an origin-absent skip.

#### Negative Paths

- Given inbound issue text, a fenced example, or armored outcomes contain `Closes-Also` text, when declarations are parsed, then those embedded lines confer no closure authority.
- Given no extra declarations exist, when an older feature is authored or published, then its originating-issue behavior is preserved without requiring new targets or manufacturing them from related prose.

### Done When

- [ ] Marker round-trip fixtures retain source, owner, outcomes, and explicit extras, including an extras-only spec.
- [ ] Inbound/fenced declaration lookalikes add zero targets, and legacy origin-only fixtures retain their behavior.

## Story 13.2: Keep closure authority stable through implementation and rebase

**Requirement:** FR-13

As an operator, I want only reviewed targets used at FINISH so that a build cannot silently expand
which issues its merge closes.

### Acceptance Criteria

#### Happy Path

- Given a committed approved closure declaration, when BUILD and automatic rebase/rebaseline occur, then publication uses that original approved target set while legitimate marker owner/outcome changes remain possible.
- Given the operator intentionally revises the closure declarations through the existing explicit reseal workflow, when the approved revision is committed and used at publication, then only that newly authorized set replaces the prior projection.

#### Negative Paths

- Given BUILD adds, removes, or changes a target after the approved baseline, when publication compares active declarations with authorized provenance, then it refuses the changed projection with a DECIDE-owned correction diagnostic; automatic rebaseline cannot silently authorize it.
- Given an older seal has no closure descriptor and its original baseline cannot be verified/read, when added-target publication is requested, then it reports the missing provenance and does not derive authority from the current mutable marker.
- Given a work-order manifest or provider-authored PR body names different targets, when authoritative linkage is calculated, then those values cannot replace or expand the approved declaration.

### Done When

- [ ] Rebase and explicit-reseal fixtures distinguish unchanged approved authority from intentional operator revision.
- [ ] BUILD drift, unverified legacy baseline, and conflicting transported targets never produce unauthorized closing instructions.

## Story 14: Validate and deduplicate closure targets

**Requirement:** FR-14

As a spec author, I want invalid targets rejected early so that unrelated issues cannot be closed.

### Acceptance Criteria

#### Happy Path

- Given fully qualified additional GitHub references with positive issue numbers, when validated, then each resolves to its canonical repository/issue identity and repeated aliases of the same identity produce one closure target.
- Given the origin is repeated among extras and two distinct repositories use the same issue number, when the set is normalized, then the origin appears once and the cross-repository issues remain distinct.

#### Negative Paths

- Given an additional reference has a missing owner/repository, zero/negative or malformed number, unsupported Jira form, or arbitrary URL, when validation runs, then the invalid entry is named before any closing instructions are published.
- Given a PR body contains an unqualified `#42` for its own repository while an approved extra targets another repository's issue 42, when existing coverage is checked, then the local reference does not satisfy the cross-repository target.

### Done When

- [ ] Valid, duplicate-origin, and same-number/different-repository examples yield the exact canonical target set.
- [ ] Invalid extra references never reach body mutation and identify the offending entry.

## Story 15: Put the full approved closure set on the implementation PR

**Requirement:** FR-15

As an operator, I want implementation merge to close the declared issues while the spec only links them.

### Acceptance Criteria

#### Happy Path

- Given an origin and two distinct approved extras and an implementation PR targeting the repository default branch, when common FINISH publication completes in attended or daemon mode, then the actual PR body contains effective closing references for all three before final completion.
- Given a draft, body refresh, or publication retry already has some equivalent closing references and unrelated content, when the target projection is applied, then only missing linkage is added and unrelated body content/project-owned regions remain intact.
- Given the same target declarations are handed off in a spec PR, when its body is authored, then they appear as non-closing references and the spec workflow neither closes the issues directly nor adds closing instructions for them.

#### Negative Paths

- Given the implementation PR targets a non-default branch, when closure coverage is assessed, then it reports unsupported merge-closure coverage instead of claiming GitHub will close the targets.
- Given the PR cannot be identified/authorized or its current body cannot be read as valid data, when linkage is attempted, then the body is not replaced with an empty fallback and no unrelated PR or issue is mutated.
- Given provider prose or a later body refresh removes a required link before FINISH completion, when final coverage is checked, then publication cannot claim completeness until the full approved set is re-observed on the actual PR.
- Given an older watched-observation declaration exists for an origin or declared extra, when this implementation workflow publishes its approved target set, then that declaration cannot downgrade closing references to `Refs`, require a new observation marker or watch enrollment, or delay closure past merge; independently enrolled watches are untouched.

### Done When

- [ ] Controlled production-publication fixtures for both execution modes observe all approved closing targets on the implementation PR and only non-closing references on the spec PR.
- [ ] Draft/refresh/retry fixtures preserve unrelated content and do not duplicate engine closing references.
- [ ] Non-default-base, unreadable-body, and unauthorized-target cases never claim complete coverage.

## Story 16: Recover incomplete closure linkage within FINISH

**Requirement:** FR-16

As an operator, I want named linkage failures recoverable without reopening the build or losing targets.

### Acceptance Criteria

#### Happy Path

- Given publication has incomplete approved closure coverage, when FINISH retries after the dependency recovers, then it rereads the actual body, adds only missing authorized links, verifies the complete set, and leaves the declaration unchanged.
- Given the body update succeeded before a process stopped, when FINISH resumes, then observed coverage completes recovery without duplicate instructions, direct issue-close calls, or assignee changes.

#### Negative Paths

- Given read, guarded write, or verification fails due to network, permission, malformed response, or concurrent body edits, when FINISH reports its result, then it identifies incomplete/refused linkage and the affected targets without claiming verified success.
- Given a linkage failure remains unresolved, when lifecycle recovery is selected, then it stays in the existing FINISH recovery path, creates no broad BUILD repair, preserves declarations and unrelated body content, and does not close unrelated issues.
- Given one body write links only part of the declared set, when final verification runs, then the missing targets remain visible and publication is incomplete even if the originating issue was linked successfully.

### Done When

- [ ] Faults before body write, after write, and during verification resume to exact approved coverage without duplicate instructions.
- [ ] Partial/refused outcomes retain target provenance and remain FINISH-owned without new BUILD work or unrelated mutations.

## Negative-path coverage assessment

The Large-tier criterion depth is applied per story: each happy-path set has at least as many
concrete negative scenarios. The following categories were explicitly assessed across the feature.

| Category | Applicable coverage |
|---|---|
| Invalid input | Stories 2, 4, 11, 13.1, 14: CLI selection, reason, evidence shape, declaration grammar |
| Auth/permission | Stories 4, 6, 7, 12.1, 15, 16: worker restrictions, guarded writes, filesystem denial |
| Timeout/network | Stories 7, 15, 16; local list/resolve have no network dependency |
| Concurrent access | Stories 7, 12.1, 12.2, 16: publication, resolution, state, timeline and PR refresh |
| Resource exhaustion | Stories 2, 11, 12.1: paging, explicit storage/source limits, disk and leases |
| Partial failure/rollback | Stories 7-9, 11, 12.1-12.2, 16: confirmed writes survive; incomplete work is named |
| Dependency unavailable | Stories 2-3, 7-9, 11, 12.1, 15-16: tracker, evidence, repository identity, remote PR |
| Data integrity | Stories 1, 3-5, 10-14: provenance, source identity, migration, authority and decisions |
| Cascade deletion | Stories 2, 9, 12.1: normal worktree cleanup preserves action state and retained source recovery; action deletion is outside scope |
| Model-level immutability | Stories 5, 12.1, 13.2: old source replay and autonomous writers cannot rewrite decisions or approved closure provenance |
| Exception classes | Stories 7, 12.1, 15-16: actual adapter transport/auth/permission/malformed-response and filesystem failures must reach their distinct result paths; no new exception hierarchy is proposed |
| Dedup/idempotency | Stories 5-9, 12.1, 14-16: exact identity replays and distinct-identity counterexamples |
| Alternate-branch side effects | Stories 8-9, 12.1-12.2, 13.1, 15-16: offline/legacy/terminal/telemetry-failed/extras-only/retry paths preserve required state and authority |

## Existing behavioral contracts

This file owns the new operator action and multi-target closure workflow. Existing review stories
remain the owners of rubric judgement, source-complete adjudication, BUILD routing, and security
classification. The affected deferral assertions in the following files are corrected in place in this DECIDE
pass to reflect the approved local handoff. Approval of this story set includes these scoped
corrections; unrelated existing assertions remain unchanged.

- [Post-join adjudication](build-review-rubrics-need-a-post-join-adjudicator-.md): local deferral handoff, settlement, and restart expectations.
- [Refutation](refuted-build-review-finding-cycles-to-a-needs-hum.md): residual handoff, recurrence, and effect visibility.
- [Security review](grade-the-diff-for-security-defects-before-ship-vi.md): adjudicated deferral uses the same local handoff; security classification stays authoritative.
