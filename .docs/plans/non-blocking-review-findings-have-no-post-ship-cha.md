# Implementation Plan: Durable post-ship actions and explicit implementation closures

**Date:** 2026-09-30
**Status:** Approved — operator confirmed 2026-09-30
**Source:** jstoup111/ai-conductor#1810
**Design:** [Approved PRD](../specs/2026-09-30-non-blocking-review-findings-have-no-post-ship-cha.md)
**Stories:** .docs/stories/non-blocking-review-findings-have-no-post-ship-cha.md
**Conflict check:** Clean as of 2026-09-30; [operator-approved resolutions](../conflicts/2026-09-30-non-blocking-review-findings-have-no-post-ship-cha.md)
**Architecture:** [Approved ADR](../decisions/adr-2026-09-30-durable-post-ship-action-cases.md)

## Summary

Implement the approved operator inbox, optional guarded filing, exact historical recovery, and
complete implementation-merge closure linkage in 40 scoped tasks. This exceeds the 20-task
advisory threshold: nominal 2–5 minute task slices total 80–200 minutes of task execution before
shared gates or retries, not a delivery-time estimate. Splitting remains an option, but this plan
preserves the operator-confirmed full scope; no oversized-plan exception is needed.

## Technical Approach

Extend RemediationCaseStore to v3 with explicit feature and repository-action scope factories.
Feature state holds consumed source observations and applied local handoff effects. Repository
state owns attributable operator resolution and independent publication transitions. Capture follows
existing classification, then serializable terminal effects cross the dispatcher boundary; versioned
source snapshots in the existing shipped record preserve recovery after cleanup. Exact identifiers
and existing judged relationships govern replay; history text never becomes semantic authority.

Use the same repository action service behind list/resolve/file/recover. Local operations remain
offline. Optional intake uses the canonical guarded intake seam, stable effect markers, a separate
per-action publication lease over the network operation, and short feature-state leases for reserve
and confirmation. Typed partial/failure results preserve usable siblings and never become review
halt or task-budget authority. ConductorEvent and existing timeline consumers carry occurrences.

Closure declarations live as top-level Closes-Also entries in the existing intake marker. A
selective descriptor in the existing protected seal commits the approved target projection and
survives automatic rebase. Explicit operator reseal alone changes that authority. One guarded batch
body projection preserves project regions and verifies all references through common FINISH before
readiness/final completion. New implementation closure follows the approved merge-time policy even
with older watched markers; spec handoff uses non-closing references. GitHub host semantics are
verified through the adapter contract and default-branch checks, not by live test issue closures.

Existing patterns and bounded departures:

- RemediationCaseStore.mutate supplies lease/read/validate/atomic-replace; keep that ordering and
  preserved sibling domains. Scope factories and v3 records are additive, not a new storage service.
- FeatureTerminalEffects and onFeatureTerminalEffects supply dispatcher-owned root writes. Reuse
  their serializable payload/after-release collection boundary; no worker permission expansion.
- remediationEffectMarker and fileIntakeIssue supply exact lookup/guarded publication. Depart from
  holding a feature mutation lease over network I/O: a separate per-action publication lease permits
  concurrent resolution without duplicate create. Tasks 21–23 carry that departure explicitly.
- appendRecordedShipmentFindings supplies committed retention; persist source snapshots rather than
  mutable root decisions. Remediation/ship evidence and action state remain separate authorities.
- Common FINISH already observes before acting and verifies after writing. Add a typed linkage
  transition; replace ambiguous boolean/empty-body-fallback assumptions on this path only.

## Prerequisites and execution contract

- Stories and architecture are accepted; all predecessor corrections are already DECIDE changes.
  No task below modifies another feature's protected artifact. The operator approved the plan on 2026-09-30.
- Rediscover source symbols at BUILD entry; candidate filenames below are bounded implementation
  targets, not assumptions that line coordinates or private helper names are fixed.
- Tasks estimate one focused change at 2–5 minute granularity. Negative tasks are grouped only by
  the named failure boundary, with explicit scenario permutations; there is no generic cleanup task.
- Every task follows scoped TDD: write the named failing behavioral fixture, run its selector through
  ai-conductor scoped-run for RED, implement the named seam, rerun the affected selector for GREEN,
  and commit that task's completed change. Test files below are existing or explicitly new fixtures;
  name test layers and behavioral assertions as supplied by the checks, not source-text snapshots.
- Use real local files/Git only where persistence/rebase semantics are under test. Inject provider,
  process and hosted-service adapters and prove they are reached before destructive arguments.
  Await every concurrent branch; use controlled barriers/clocks, no real network, tmux or sleeps.
- Each criterion below is planned lower-layer behavioral coverage (unit or focused integration at
  its named production boundary). BUILD-entry writing-system-tests owns any needed acceptance
  dispositions/specs and genuine RED evidence; do not duplicate every negative permutation there.
  test_suite owns aggregate verification; SHIP validators own completed-feature validation.
- CLI pagination is the implementation detail --limit (100 default, 500 maximum) plus --cursor.
  Cursor identity is tied to canonical feature/status selection; reject mismatched selection.
  Cursor reads are bounded pages, not a promise of a cross-page transaction under concurrent edits.

## Tasks

### Task 1: Extend the case envelope without changing existing domains

**Story:** Story 12.1; S12.1.1
**Type:** infrastructure
**Coverage disposition:** planned lower-layer unit proof for S12.1.1

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add the v3 envelope and discriminated postShipSources/postShipCases shapes. Introduce explicit feature and repository-action factory scopes; preserve v1/v2 selectors, effects, suppressions, PRD records and feature identity. Upgrade only on an actual atomic write; old/unknown writers refuse instead of normalizing.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for RemediationCaseStore.read/mutate supplies existing version-1 or version-2 review state, exercises new action-related state is written, and asserts all prior cases, effects, suppressions, PRD relationships, history, and feature identity retain their meanings on a fresh read.
- The feature-scope factory rejects operator resolutions/publication requests and the repository-action factory rejects gate-control records; schema validation preserves sibling-domain data on every accepted mutation.
- The v3 schema round-trip retains separate postShipSources/postShipCases collections and immutable source observations; read-only v1/v2 access does not rewrite bytes, an actual write upgrades atomically, and a legacy writer refuses v3 without dropping fields.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`; `src/conductor/test/engine/remediation-case-store.test.ts`
**Dependencies:** none

### Task 2: Refuse invalid repository identity and unsafe action paths

**Story:** Story 12.1; S12.1.4
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S12.1.4

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Reuse resolveMainRepoRootStrict and canonical shipment/plan identity. Resolve containment before opening a store; disallow arbitrary store paths and symlinks escaping the canonical feature action directory. Distinguish absent state from unsupported or corrupt state; return typed diagnostics without repair-by-empty-state.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for repository-action scope factory and RemediationCaseStore validators supplies an unknown schema, malformed store, foreign feature identity, ambiguous repository root, traversal selector, or escaping symlink, exercises state is accessed, and asserts the operation names the defect and does not normalize it to an empty store or write outside the selected repository/feature.
- The repository-action factory resolves the main root once at the outer composition boundary and creates independent feature lease paths; a failing identity check makes zero mutation calls.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`; `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/post-ship-actions.test.ts`
**Dependencies:** Task 1

### Task 3: Serialize action decisions and preserve confirmed writes under faults

**Story:** Story 12.1; S12.1.3, S12.1.5, S12.1.7
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S12.1.3, S12.1.5, S12.1.7

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Extend the existing lease/read/validate/atomic-replace pattern to ordered action revisions and independent resolution/publication fields. Compare observed revision under the lease. Replay identical requests idempotently; return a conflict for stale differing decisions. Inject filesystem failures and deterministic lease interleavings, never sleeps.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for RemediationCaseStore.mutate and post-ship action transition service supplies concurrent requests resolve different actions or record publication alongside resolution, exercises both confirm success, and asserts a fresh process sees both results without lost fields; repeating the identical transition does not duplicate it.
- The unit fixture for RemediationCaseStore.mutate and post-ship action transition service supplies disk-full, write-denied, interrupted atomic replacement, or lease contention prevents a decision from being confirmed, exercises the request returns, and asserts it reports failure/contention without claiming success and the last complete confirmed state remains readable.
- The unit fixture for RemediationCaseStore.mutate and post-ship action transition service supplies two conflicting resolutions race from the same observed revision, exercises one commits first, and asserts the stale writer cannot silently replace it and receives a conflict; an old source replay cannot reverse either decision.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`; `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/remediation-case-store.test.ts`; `src/conductor/test/engine/post-ship-actions.test.ts`
**Dependencies:** Task 1, Task 2

### Task 4: Capture classified build-review observations at the owning route

**Story:** Story 1, Story 8; S1.1, S1.4, S8.7
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S1.1, S1.4, S8.7

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add typed normalization for consumed justified deferrals, upheld residuals, accepted-risk records and confidence suppressions. Reuse existing finding/case IDs and freshness evidence. Wire after authoritative classification; exercise the real coordinator entry with controlled providers, persist source observations, and pass them through the real importer. No new judgement prompt.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for build-review adjudication coordinator capture boundary and action importer supplies a consumed build-review result has a justified deferral, an explicitly upheld residual of a refutation, accepted risk, or confidence suppression, exercises its source is captured and collected, and asserts the feature action view contains the outstanding concern with that specific classification and original identity.
- The integration fixture for build-review adjudication coordinator capture boundary and action importer supplies an unconsumed, stale, malformed, or raw blocking review artifact exists on disk, exercises capture is considered, and asserts that artifact cannot produce a non-blocking action or change the gate's verdict.
- The integration fixture for build-review adjudication coordinator capture boundary and action importer supplies a security finding is not yet adjudicated, exercises action capture runs, and asserts the inbox cannot label it non-blocking merely because it is outside the plan; the existing security/adjudication authority decides its route.

**Files:** `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/src/engine/build-review-adjudication-coordinator.ts`; `src/conductor/src/engine/conductor.ts`; `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`
**Dependencies:** Task 1, Task 7

### Task 5: Capture audit and delivered as-built observations in both result paths

**Story:** Story 1; S1.2, S1.3, S1.5, S1.6
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S1.2, S1.3, S1.5, S1.6

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Normalize recorded non-blocking audit outcomes and delivered typed PLAN_GAP findings after shared classification/freshness checks. Preserve criterion, NC source and existing case identity. Use one adapter in serial and validation-group result handling; keep completed repaired outcomes as historical evidence. Bound the fixture to consumption and collection, not a complete conductor lifecycle.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies requirements audit records a non-blocking finding, exercises the classified result is captured and collected, and asserts an action preserves its criterion or recorded non-criterion identity and existing case relationship, where present.
- The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies a delivered as-built verdict records an outstanding PLAN_GAP, exercises its source is captured and collected, and asserts the same action workflow exposes the concern and its as-built origin.
- The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies serial and validation-group execution consume the same audit finding, exercises both observations reach collection, and asserts one action remains and neither path dispatches a new reviewer.
- The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies a typed as-built record describes a completed repair, exercises it is collected alongside an outstanding gap, and asserts only the outstanding gap is open and the repaired outcome stays available as historical evidence.

**Files:** `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/src/engine/conductor.ts`; `src/conductor/test/engine/conductor-post-ship-actions.test.ts`
**Dependencies:** Task 1, Task 7

### Task 6: Project prior outcomes without fabricating operator completion

**Story:** Story 10; S10.1, S10.2, S10.3, S10.4, S10.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S10.1, S10.2, S10.3, S10.4, S10.5

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Use a closed source-outcome discriminator to distinguish open follow-up from repaired, rejected/refuted, dismissed and accepted-risk evidence. Preserve uncertainty and original decision evidence. An explicit upheld residual has its own eligible subject. Do not infer completion from an issue state or absent later finding.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for post-ship source eligibility and action projection supplies retained evidence explicitly records repaired, wholly refuted/rejected, or dismissed findings alongside an outstanding concern, exercises capture or recovery runs, and asserts those completed/excluded outcomes remain historical and only the outstanding concern becomes open.
- The unit fixture for post-ship source eligibility and action projection supplies an unresolved concern has prior accepted-risk or scope-acceptance evidence and an existing issue link, exercises recovered, and asserts the action remains open with both the decision and link visible until the operator explicitly resolves it.
- The unit fixture for post-ship source eligibility and action projection supplies a refuted claim has a separately upheld remainder, exercises imported, and asserts only the remainder is eligible for an open action; the refuted claim is not reintroduced as true.
- The unit fixture for post-ship source eligibility and action projection supplies an issue is closed or a finding is absent from a later report without explicit follow-up completion, exercises the action is refreshed, and asserts neither observation invents an acted-on/dismissed decision or erases the original risk decision.
- The unit fixture for post-ship source eligibility and action projection supplies confidence-suppressed evidence is retained, exercises displayed, and asserts its uncertainty remains visible and capture does not assert that the suppressed claim was proven correct.

**Files:** `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/post-ship-actions.test.ts`
**Dependencies:** Task 1

### Task 7: Import sources by exact identity without reopening resolved cases

**Story:** Story 5; S5.1, S5.2, S5.3, S5.4, S5.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S5.1, S5.2, S5.3, S5.4, S5.5

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Build stable source keys from existing case relationships or authoritative report+subject identity. Record all source links in one repository mutation; replay is inert against later resolutions. Keep exact legacy digests namespaced by feature and source kind. Return ambiguity diagnostics for inconsistent identity fields; never use summaries, ordinals alone or a new semantic judge.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for post-ship source importer supplies one captured source appears again through retry, terminal collection, and historical recovery, exercises each is processed, and asserts exactly one action retains all distinct source links and no duplicate action is created.
- The unit fixture for post-ship source importer supplies an existing judge-established case relationship binds two source observations, exercises they are imported, and asserts that relationship is preserved without another semantic adjudication.
- The unit fixture for post-ship source importer supplies an action was acted-on or dismissed after its source was first captured, exercises an older snapshot is replayed, and asserts its resolution, operator, reason, and revision remain unchanged.
- The unit fixture for post-ship source importer supplies two distinct findings have similar or identical summaries, different authoritative identities, or belong to different features, exercises imported, and asserts they remain separate; ordinal reuse or prose similarity cannot copy a resolution between them.
- The unit fixture for post-ship source importer supplies legacy representations conflict in retained identity fields, exercises recovery cannot establish exact replay, and asserts it reports the ambiguous sources instead of merging them by text similarity.

**Files:** `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/post-ship-actions.test.ts`
**Dependencies:** Task 1, Task 2, Task 3, Task 6

### Task 8: Settle deferral through one durable local source-and-effect mutation

**Story:** Story 8; S8.1, S8.4
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S8.1, S8.4

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add a distinct applied post-ship effect referencing its retained source. Validate and persist both together through the feature store; preserve proposed intake content without dispatching publication. Exercise the production coordinator/effect path and the actual required-evidence failure path. An applied handoff is never a false deferral:applied remote issue.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for applyBuildReview local post-ship handoff effect supplies a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, exercises its source is durably handed off locally, and asserts review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge.
- The integration fixture for applyBuildReview local post-ship handoff effect supplies required local review-control evidence is missing or corrupt, exercises settlement is attempted, and asserts the existing integrity failure remains blocking and no successful local handoff is claimed.
- The local post-ship effect and its referenced source are committed in one feature-store mutation; injected interruption leaves either both persisted or neither, and no local handoff is represented as remote deferral:applied.

**Files:** `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/src/engine/remediation-case-validator.ts`; `src/conductor/src/engine/remediation-case-artifact.ts`; `src/conductor/test/engine/remediation-case-effects.test.ts`; `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`
**Dependencies:** Task 1, Task 4

### Task 9: Migrate eligible legacy deferral effects while preserving publication recovery

**Story:** Story 8; S8.2
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S8.2

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Convert only non-blocking unfiled/failed deferrals and eligible residual effects to the local handoff atomically. Retain effect IDs as aliases, intake proposal, exclusion rationale and known URLs. Applied legacy issues stay linked. No migration may finalize an unfinished BUILD effect or forge remote success.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for legacy deferral migration in remediation effect recovery supplies a legacy unfiled or failed remote deferral is non-blocking, exercises it is resumed, and asserts a local handoff preserves the proposal, original identity/marker aliases, and existing issue reference if any; optional remote failure no longer prevents settlement.
- Migration fixtures for a reserved BUILD effect, contradictory store and already-linked issue respectively refuse conversion, preserve original bytes on invalid input, and retain the existing issue without a create request.

**Files:** `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/src/engine/remediation-case-store.ts`; `src/conductor/test/engine/remediation-case-effects.test.ts`
**Dependencies:** Task 8

### Task 10: Align effective verdict, recurrence and clean-PASS settlement

**Story:** Story 8; S8.3, S8.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S8.3, S8.5

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Update exhaustive effect readers, coverage reducers, adjudication context and settlement selectors together. Only confirmed local handoff settles a deferral/residual. Keep source-complete judge bindings, action routing, decision-owner/consistency stops, infrastructure precedence, and cumulative charges. Exercise exact recurrence and clean-PASS entry points with no remote dependency.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an exact source recurs after a confirmed local handoff, exercises effective verdict, recurrence, or clean-PASS reconciliation runs, and asserts it remains settled without another judge session solely for that source, and optional publication state does not reopen it.
- The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an unfinished BUILD effect, uncovered infrastructure failure, consistency stop, or unresolved decision-owner escalation exists, exercises a sibling non-blocking action is captured, and asserts that blocker keeps its authority and cannot be migrated into a non-blocking handoff.

**Files:** `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/src/engine/build-review-adjudication.ts`; `src/conductor/src/engine/build-review-adjudication-coordinator.ts`; `src/conductor/src/engine/remediation-case-reconciler.ts`; `src/conductor/src/engine/conductor.ts`; `src/conductor/src/engine/build-review-adjudication-context.ts`; `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts`; `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`
**Dependencies:** Task 8, Task 9

### Task 11: Collect terminal source payloads through the dispatcher and attended return

**Story:** Story 12.1, Story 8, Story 9; S12.1.2, S12.1.6, S8.6, S9.4
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S12.1.2, S12.1.6, S8.6, S9.4

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Extend the serializable terminal payload with validated feature identity and source observations. Feature executors never resolve/write root action state. Dispatcher collection imports after claim release and before existing terminal cleanup; attended return uses the same importer. Carry valid observations for done/halted/error/parked outcomes and report mirror failure as an action diagnostic. Reuse terminal-effects callbacks rather than add a poller.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies a feature produces source observations, exercises attended return or daemon terminal collection receives a done, halted, error, or parked result with valid observations, and asserts repository actions are retained outside the disposable worktree; shipped source evidence supports recovery after an interrupted collection and normal cleanup.
- The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies a provider or executor attempts to supply operator resolution/publication authority or mutate shared-root action state, exercises its output is processed, and asserts that authority/write is refused; valid source observations can still pass through the existing outer collection boundary.
- The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies repository mirroring or optional intake publication fails after valid local capture, exercises the feature proceeds, and asserts it reports the action diagnostic without adding a halt, plan task, or remediation charge for that failure.
- The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies an active feature is explicitly recovered before terminal collection, exercises later terminal collection imports its same sources, and asserts no duplicate action or reopened resolution results and the feature is not falsely labeled shipped.
- Both production outer-return paths import only after releasing the feature claim and before terminal cleanup; the executor returns serializable sources without resolving or writing the repository action store.

**Files:** `src/conductor/src/engine/feature-executor.ts`; `src/conductor/src/engine/daemon.ts`; `src/conductor/src/engine/daemon-runner.ts`; `src/conductor/src/daemon-cli.ts`; `src/conductor/src/index.ts`; `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/feature-executor.test.ts`; `src/conductor/test/engine/post-ship-terminal-collection.test.ts`
**Dependencies:** Task 4, Task 5, Task 7, Task 10

### Task 12: Retain versioned sources in shipped records before cleanup

**Story:** Story 12.1, Story 2; S12.1.8, S2.2
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S12.1.8, S2.2

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Extend recordedShipmentFindings/appendRecordedShipmentFindings with bounded versioned source snapshots and stable IDs. The shipped record carries review evidence and prior outcomes, never mutable root action decisions. Wire both shipped-record CLI and shared FINISH production writer. Keep current committed-record reap authority; exercise interrupted import followed by cleanup/recovery through real local filesystem seams.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for shipment source serialization and shipped-record/FINISH publication entry supplies the dispatcher stops before import or repository import fails after the shipped snapshot is committed, exercises normal cleanup and later explicit recovery occur, and asserts the source remains recoverable without restoring the old worktree and recovery never copies stale operator decisions from shipment evidence.
- The integration fixture for shipment source serialization and shipped-record/FINISH publication entry supplies an action's feature has shipped and its worktree has been normally removed, exercises the operator lists that feature or all features in a new process, and asserts the retained action and its resolution are still discoverable without contacting the tracker.

**Files:** `src/conductor/src/engine/shipment-association.ts`; `src/conductor/src/engine/shipped-record-cli.ts`; `src/conductor/src/engine/finish-publication-production.ts`; `src/conductor/test/engine/shipment-association.test.ts`; `src/conductor/test/engine/post-ship-retention.test.ts`
**Dependencies:** Task 1, Task 7

### Task 13: Register operator action commands without BUILD or worker fallthrough

**Story:** Story 2, Story 4; S2.4, S4.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S2.4, S4.5

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add list/resolve/file/recover dispatch with strict semantic IDs, named arguments and bounded pagination. Register before BUILD selection and retain existing daemon-worker command restrictions; add no exemption. Invalid combinations return usage diagnostics without constructing mutating services. Exercise the real CLI dispatch with process/tracker boundaries mocked.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for CLI actions command parser and pre-build dispatch authorization supplies an invalid status, malformed feature selector, or invalid pagination input, exercises listing runs, and asserts it returns a usage diagnostic with no mutation and no BUILD launch.
- The integration fixture for CLI actions command parser and pre-build dispatch authorization supplies a daemon-worker session attempts an operator-only resolution, exercises command authorization is checked, and asserts the existing worker restriction refuses it without a new exemption or BUILD fallthrough.
- All four actions subcommands dispatch before BUILD selection; invalid command combinations return usage diagnostics, and operator-only file/resolve/recover mutations retain the existing worker authorization restriction.

**Files:** `src/conductor/src/actions-cli.ts`; `src/conductor/src/cli.ts`; `src/conductor/src/index.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 2

### Task 14: List filtered and paginated actions entirely offline

**Story:** Story 2; S2.1, S2.3, S2.6
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S2.1, S2.3, S2.6

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Read the repository action scopes with open as default and feature/status filters. Expose --limit with default100/max500 and an opaque continuation cursor; reject invalid limits/cursors through task13 parsing. Page presentation only, never prune stored history. Share one result projection across human and JSON modes; do not construct a tracker for local listing.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for actions list repository query and human/JSON renderers supplies several features have open, acted-on, and dismissed actions, exercises `actions list` runs with feature and status filters, and asserts it returns only the requested subset; the default view shows open actions and `--status all` includes the resolved history.
- The integration fixture for actions list repository query and human/JSON renderers supplies more actions exist than one page allows, exercises results are paged, and asserts every matching action is reachable with a default page of 100 and a maximum of 500 without deleting stored history; human and JSON output represent the same actions and completeness diagnostics.
- The integration fixture for actions list repository query and human/JSON renderers supplies the tracker is unavailable and the result spans several pages, exercises the operator reads each page, and asserts local listing completes without a tracker request and page size never exceeds the maximum.

**Files:** `src/conductor/src/actions-cli.ts`; `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 7, Task 13

### Task 15: Render retained evidence, uncertainty and prior decisions as data

**Story:** Story 3; S3.1, S3.2, S3.3, S3.4
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S3.1, S3.2, S3.3, S3.4

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Expose bounded source summaries, evidence links/excerpts, prior risk decisions, confidence classification and known follow-up references from durable state. Render unavailable material explicitly. Reuse inbound sanitization for display where applicable, and never interpret source prose as a transition, target declaration or command.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for action detail projection used by actions list supplies an action with retained evidence and an earlier risk or scope decision, exercises it is displayed, and asserts the concern, feature, review source, supporting evidence, original decision and rationale are available without replacing them with a new interpretation.
- The integration fixture for action detail projection used by actions list supplies an existing follow-up issue is linked, exercises the action is displayed, and asserts its exact reference remains visible independently of whether the issue is open or closed and whether the action is resolved.
- The integration fixture for action detail projection used by actions list supplies a historical evidence path no longer exists, exercises the action is displayed, and asserts available retained excerpts remain visible and the missing supporting material is explicitly identified without inventing its contents.
- The integration fixture for action detail projection used by actions list supplies retained review or tracker text contains instructions to dismiss the action or close an unrelated issue, exercises it is imported or rendered, and asserts the text remains evidence and neither action occurs.

**Files:** `src/conductor/src/actions-cli.ts`; `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 6, Task 14

### Task 16: Resolve selected actions with attributable durable decisions

**Story:** Story 4; S4.1, S4.2, S4.3, S4.4
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S4.1, S4.2, S4.3, S4.4

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Require feature/action, --as acted-on|dismissed and a non-empty reason; resolve machine operator using the existing identity seam. Use revisioned leased transitions and reread confirmation, then render the new state. Support internal expected-revision comparison without trusting caller-authored operator identity. Listing and publication may not call the resolution transition.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for actions resolve command and action transition service supplies an open action, exercises `actions resolve` names it as acted-on with a reason or follow-up reference, and asserts a fresh process reads acted-on with the reason, machine-resolved operator, and ordered revision.
- The integration fixture for actions resolve command and action transition service supplies an open action, exercises the operator explicitly dismisses it with a reason, and asserts it leaves the open view and remains inspectable in dismissed/all views without changing any gate risk decision.
- The integration fixture for actions resolve command and action transition service supplies an unknown action, mismatched feature, empty reason, unsupported resolution, or stale conflicting revision, exercises resolution is attempted, and asserts it reports the specific invalid selection/conflict and leaves confirmed state unchanged.
- The integration fixture for actions resolve command and action transition service supplies an action is merely listed or an issue is published for it, exercises its state is read, and asserts no acted-on or dismissed decision has been manufactured.

**Files:** `src/conductor/src/actions-cli.ts`; `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 3, Task 13, Task 14

### Task 17: Recover retained modern sources through the operator command

**Story:** Story 9; S9.1, S9.2, S9.3
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S9.1, S9.2, S9.3

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Enumerate selected committed shipped snapshots first, then available typed audit/as-built/case sources using canonical shipment association. Feed the same source importer as terminal collection. Missing worktrees do not trigger a checkout, reviewer or BUILD. Return explicit unavailable evidence when no supported source can establish the concern.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for actions recover command and post-ship recovery service supplies a shipped record contains sufficient modern source snapshots or supported legacy structured findings, exercises `actions recover` runs after worktree removal, and asserts eligible concerns appear with their retained provenance and no reviewer, provider, or BUILD invocation occurs.
- The integration fixture for actions recover command and post-ship recovery service supplies retained original audit, as-built, or case evidence supplies an eligible source not yet in the inbox, exercises recovery selects that feature, and asserts it imports the source; repeated recovery preserves the same action, publication link, and operator resolution.
- The integration fixture for actions recover command and post-ship recovery service supplies no sufficient retained evidence exists for an older finding, exercises recovery runs, and asserts it reports what is unavailable instead of reconstructing a finding or requiring the build to rerun.

**Files:** `src/conductor/src/actions-cli.ts`; `src/conductor/src/engine/post-ship-recovery.ts`; `src/conductor/test/engine/post-ship-recovery.test.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 7, Task 12, Task 13

### Task 18: Recover exact legacy sources and diagnose ambiguous associations

**Story:** Story 11, Story 9; S9.5, S11.3
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S9.5, S11.3

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add closed decoders for structured historical shipped findings and explicit recorded audit/as-built/case evidence. Assign canonical exact-record digest keys only when retained identity fields agree; no arbitrary-prose extraction or fuzzy equivalence. Keep parser defects source-specific, and never infer a resolution from absent evidence.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for post-ship legacy evidence decoders supplies a legacy source lacks a modern ID, exercises identical retained identity fields and exact content reappear in another supported record, and asserts recovery reuses its legacy identity without calling a model to infer equivalence.
- The unit fixture for post-ship legacy evidence decoders supplies evidence is missing, unreadable, structurally invalid, conflicting, or ambiguously associated with a feature, exercises imported, and asserts the affected record is named and no source, resolution, or successful capture is invented for it.

**Files:** `src/conductor/src/engine/post-ship-recovery.ts`; `src/conductor/test/engine/post-ship-recovery.test.ts`
**Dependencies:** Task 6, Task 7, Task 17

### Task 19: Return partial recovery and listing without truncating histories

**Story:** Story 11, Story 2; S2.5, S11.1, S11.2, S11.4, S11.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S2.5, S11.1, S11.2, S11.4, S11.5

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Use per-source result objects and collect valid siblings independently. Enforce UTF-8 source text8000bytes,64 references,512 links/case and16MiB repository-action envelope before mutation. Do not apply the new envelope limit to live gate control. Preserve retained sources on overflow; distinguish complete-empty from partial-empty/results in both command renderers.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies one feature's retained state is unreadable, exercises the repository view runs, and asserts it returns valid independent features with a named incomplete-result diagnostic instead of presenting an empty complete list.
- The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies independent valid and malformed sources, exercises listing or recovery runs, and asserts valid findings remain usable and each invalid source has a feature/source-specific diagnostic with an incomplete overall result.
- The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies all selected retained records are readable and eligible processing completes, exercises recovery finishes with no open actions, and asserts it reports a complete result distinguishable from an incomplete empty result.
- The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies source text exceeds 8,000 bytes, a source exceeds 64 evidence references, a case exceeds 512 source links, or repository action state would exceed 16 MiB, exercises import runs, and asserts it names the exceeded dimension and leaves retained evidence available without truncation or history pruning.
- The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies a bounded action import fails while valid siblings have been imported, exercises recovery returns, and asserts those confirmed siblings remain usable and the failed source stays recoverable; existing live gate-control data is not subjected to the new action-envelope limit.

**Files:** `src/conductor/src/engine/post-ship-recovery.ts`; `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/src/actions-cli.ts`; `src/conductor/test/engine/post-ship-recovery.test.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 14, Task 17, Task 18

### Task 20: Prepare and file complete intake only on explicit request

**Story:** Story 6; S6.1, S6.3, S6.4
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S6.1, S6.3, S6.4

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Use an inherited complete proposal or --title/--body-file; otherwise return an evidence-prefilled proposal and required missing inputs. Reuse Observed/Impact/Desired outcomes/Hypotheses validation and sanitization from fileIntakeIssue. Establish an explicit file request boundary; automatic review/import/list paths have no publication request. Leave resolution independent.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for actions file command using guarded canonical intake service supplies an unlinked action with a complete inherited intake proposal or operator-supplied title and body, exercises the operator explicitly runs `actions file`, and asserts one sanitized issue is published through the configured guarded intake workflow, its reference is retained, and the action's resolution stays unchanged.
- The integration fixture for actions file command using guarded canonical intake service supplies a source has been captured but no operator has requested publication, exercises review, collection, recovery, or listing runs, and asserts no intake issue is created.
- The integration fixture for actions file command using guarded canonical intake service supplies retained context lacks the required intake content and no complete operator input is supplied, exercises filing is requested, and asserts the operator receives an evidence-prefilled proposal and the missing inputs; no impact or desired outcomes are invented and no issue is created.

**Files:** `src/conductor/src/actions-cli.ts`; `src/conductor/src/engine/post-ship-publication.ts`; `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/test/engine/post-ship-publication.test.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 3, Task 13, Task 15, Task 21

### Task 21: Reserve stable publication identity and reuse known issues

**Story:** Story 6, Story 7; S6.2, S7.1, S7.5
**Type:** happy-path
**Coverage disposition:** planned lower-layer unit proof for S6.2, S7.1, S7.5

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Extract/reuse remediationEffectMarker recovery primitives without coupling them to gate settlement. Reserve one action publication ID under a short feature-state lease, retain legacy marker aliases, then lookup known/exact issue references including closed matches. Distinct action IDs never deduplicate by text. Persist confirmed URL on the selected action without resolving it.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for post-ship publication reservation and exact-marker lookup supplies the action already has an issue reference or a confirmed exact publication-marker match, exercises filing is requested, and asserts that issue is reused even if closed and no replacement issue is created.
- The unit fixture for post-ship publication reservation and exact-marker lookup supplies a prior publication attempt failed before confirmed creation, exercises the operator retries successfully, and asserts the same publication identity is used and the issue link is confirmed on the existing action.
- The unit fixture for post-ship publication reservation and exact-marker lookup supplies two distinct action publication identities have identical text, exercises both are explicitly filed, and asserts each may create its own issue; text similarity does not block legitimate independent publication.

**Files:** `src/conductor/src/engine/post-ship-publication.ts`; `src/conductor/src/engine/remediation-case-effects.ts`; `src/conductor/test/engine/post-ship-publication.test.ts`
**Dependencies:** Task 3, Task 7, Task 9

### Task 22: Classify publication refusal and uncertain network results

**Story:** Story 6, Story 7; S6.5, S7.3, S7.6
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S6.5, S7.3, S7.6

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Return closed failure/reason variants for target ownership, auth, timeout, rate-limit, malformed response and uncertain create. A lookup failure cannot advance to create. Persist recoverable diagnostics with the stable reservation; no raw transport fallback, success inference, issue-assignee mutation or resolution transition.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for guarded post-ship publication result reducer supplies the target ownership guard refuses the requested write, exercises filing runs, and asserts refusal remains visible with the action and no raw transport fallback or issue-assignee mutation occurs.
- The integration fixture for guarded post-ship publication result reducer supplies lookup times out, authentication fails, permissions are refused, rate limiting occurs, or a response is unreadable, exercises publication runs, and asserts the selected action reports the failed or uncertain stage and no failed lookup is treated as permission to create.
- The integration fixture for guarded post-ship publication result reducer supplies remote creation may have succeeded but confirmation remains unavailable, exercises the command returns, and asserts it reports uncertainty rather than success, keeps the action available, and retries with the same lookup identity.

**Files:** `src/conductor/src/engine/post-ship-publication.ts`; `src/conductor/src/actions-cli.ts`; `src/conductor/test/engine/post-ship-publication.test.ts`; `src/conductor/test/engine/actions-cli.test.ts`
**Dependencies:** Task 20, Task 21

### Task 23: Serialize remote creation and recover a crash after create

**Story:** Story 7; S7.2, S7.4
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S7.2, S7.4

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Hold an action-publication lease across lookup/create, never the shared feature-state lease across network I/O. On confirmation reacquire state, reread and merge publication fields only. A crash reuses the reservation and marker lookup. Deterministic barriers model two callers and an intervening resolution; await every branch.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for per-action publication lease and reserve/effect/confirm protocol supplies remote creation succeeded but the process stopped before recording the link, exercises filing resumes, and asserts exact-marker lookup recovers that issue without another create and preserves any intervening operator resolution.
- The unit fixture for per-action publication lease and reserve/effect/confirm protocol supplies two callers request publication for the same action concurrently, exercises lookup/create overlap, and asserts at most one create occurs; a contending caller waits or receives a recoverable contention result without creating independently.
- The publication service releases the feature-state lease before invoking the controlled tracker, while retaining the per-action publication lease; a concurrent resolution can commit and its operator/reason/revision survive URL confirmation.

**Files:** `src/conductor/src/engine/post-ship-publication.ts`; `src/conductor/test/engine/post-ship-publication.test.ts`
**Dependencies:** Task 3, Task 21, Task 22

### Task 24: Declare bounded action and closure events with exhaustive sinks

**Story:** Story 12.2; S12.2.5
**Type:** infrastructure
**Coverage disposition:** planned lower-layer unit proof for S12.2.5

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add review_action_captured/resolved/publication/recovery and issue_closure_linkage variants with bounded IDs and closed result/reason fields. Declare persist/render/audit/OTel handling explicitly. Add reader/render handlers rather than relying on a permissive unknown-event branch; unit/type-contract fixtures detect missing handling.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for ConductorEvent union and EVENT_SINKS exhaustiveness supplies a new occurrence has no registered sink or supported reader/rendering case, exercises event-contract validation runs, and asserts it fails explicitly instead of allowing an invisible event family.
- The event contract rejects raw intake bodies, complete source snapshots and credential-shaped fields as unsupported payload fields; every new variant has an explicit bounded serialization shape.

**Files:** `src/conductor/src/types/events.ts`; `src/conductor/src/engine/event-sinks.ts`; `src/conductor/src/ui/create-renderer.ts`; `src/conductor/src/otel/otel-visualizer.ts`; `src/conductor/test/engine/post-ship-events.test.ts`
**Dependencies:** none

### Task 25: Merge standalone action occurrences into the repository timeline

**Story:** Story 12.2; S12.2.2
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S12.2.2

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Extend the existing reader union/parser and renderer to consume the same ConductorEvent variants from per-invocation single-writer ledgers under .pipeline/review-action-events. Merge in timestamp order with existing records; construct one owning emitter/EventPersister per standalone invocation. No new poller or multi-writer root events file.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for readDaemonTimeline and daemon-observe CLI action event rendering supplies standalone action commands run concurrently with attended or daemon work, exercises the repository timeline is read, and asserts it includes their same-schema occurrences in timestamp order with the appropriate result rendering.
- The timeline production reader includes same-schema action events from two concurrent invocation ledgers together with existing daemon records, and never requires a watcher process to make them visible.

**Files:** `src/conductor/src/engine/daemon-ledger-readers.ts`; `src/conductor/src/engine/daemon-observe-cli.ts`; `src/conductor/src/actions-cli.ts`; `src/conductor/test/engine/daemon-ledger-readers.test.ts`; `src/conductor/test/engine/daemon-observe-cli.test.ts`
**Dependencies:** Task 13, Task 24

### Task 26: Separate persisted-state success from telemetry failure

**Story:** Story 12.2; S12.2.3, S12.2.4
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S12.2.3, S12.2.4

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Introduce a small result-reporting adapter called after persistence confirmation; report state result and telemetry delivery separately. Inject an EventPersister failure after successful state confirmation and a store failure before emission. A telemetry error never retries the mutation or converts confirmed state into failed state.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for post-ship transition reporting through owning emitter/EventPersister supplies state persistence fails, exercises the failure is reported, and asserts no success occurrence claims the unpersisted transition.
- The unit fixture for post-ship transition reporting through owning emitter/EventPersister supplies state is confirmed but telemetry persistence fails, exercises the command returns, and asserts it reports the confirmed state plus telemetry unavailability and does not replay the mutation as though the decision failed.

**Files:** `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/src/engine/post-ship-publication.ts`; `src/conductor/src/actions-cli.ts`; `src/conductor/test/engine/post-ship-events.test.ts`
**Dependencies:** Task 3, Task 22, Task 24

### Task 27: Parse strict additional GitHub targets and canonicalize identity

**Story:** Story 14; S14.1, S14.2, S14.3
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S14.1, S14.2, S14.3

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add a closed parser beside source-ref for positive fully qualified owner/repo#N extras. Retain original parseWorkRef compatibility for the origin. Normalize target identity for dedup including repeated origin; distinguish repositories with the same number. Validate the entire explicit set before constructing any body update.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for additional-closure target parser and canonical set projection supplies fully qualified additional GitHub references with positive issue numbers, exercises validated, and asserts each resolves to its canonical repository/issue identity and repeated aliases of the same identity produce one closure target.
- The unit fixture for additional-closure target parser and canonical set projection supplies the origin is repeated among extras and two distinct repositories use the same issue number, exercises the set is normalized, and asserts the origin appears once and the cross-repository issues remain distinct.
- The unit fixture for additional-closure target parser and canonical set projection supplies an additional reference has a missing owner/repository, zero/negative or malformed number, unsupported Jira form, or arbitrary URL, exercises validation runs, and asserts the invalid entry is named before any closing instructions are published.

**Files:** `src/conductor/src/engine/engineer/source-ref.ts`; `src/conductor/src/engine/engineer/closure-targets.ts`; `src/conductor/test/engine/engineer/closure-targets.test.ts`
**Dependencies:** none

### Task 28: Preserve top-level closure declarations through marker rewrites

**Story:** Story 13.1; S13.1.1, S13.1.3
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S13.1.1, S13.1.3

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Parse repeatable Closes-Also lines only outside fenced/armored evidence; preserve Source-Ref, Owner and armored outcomes on every write path. Keep closure declarations separate from inbound issue prose. Extend marker writer/readers rather than create another authority artifact; use round-trip fixtures including owner/outcome updates.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for writeIntakeMarker and closure declaration reader supplies an intake-backed spec, exercises its author adds repeatable top-level `Closes-Also: owner/repo#N` declarations, and asserts the originating `Source-Ref`, owner, retained outcomes, and extra targets survive normal marker rewrites and remain associated with that feature.
- The integration fixture for writeIntakeMarker and closure declaration reader supplies inbound issue text, a fenced example, or armored outcomes contain `Closes-Also` text, exercises declarations are parsed, and asserts those embedded lines confer no closure authority.

**Files:** `src/conductor/src/engine/engineer/intake-marker.ts`; `src/conductor/src/engine/engineer/closure-targets.ts`; `src/conductor/test/engine/engineer/intake-marker.test.ts`
**Dependencies:** Task 27

### Task 29: Carry extras-only declarations and retain origin-only compatibility

**Story:** Story 13.1; S13.1.4
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S13.1.4

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Allow a marker carrying explicit extras without Source-Ref. Audit owner/outcome rewrite callers for loss of declarations and replace origin-only short circuits where targets are the relevant condition. Preserve the lenient origin grammar and non-GitHub origin no-op semantics; no extras means no targets manufactured from prose. Common publication task36 owns proof of extras reaching an actual PR.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for spec authoring/land marker producers and shared closure-target resolver supplies no extra declarations exist, exercises an older feature is authored or published, and asserts its originating-issue behavior is preserved without requiring new targets or manufacturing them from related prose.
- Land/marker production fixtures retain a valid extras-only marker through origin-absent and owner-update branches, with Source-Ref still absent and all explicitly declared target identities unchanged.

**Files:** `src/conductor/src/engine/engineer/land-spec.ts`; `src/conductor/src/engine/engineer/intake-marker.ts`; `src/conductor/src/engine/engineer/closure-targets.ts`; `src/conductor/test/engine/engineer/intake-marker.test.ts`; `src/conductor/test/engine/engineer/closure-targets.test.ts`
**Dependencies:** Task 27, Task 28

### Task 30: Bind closure declarations to approved committed seal provenance

**Story:** Story 13.2; S13.2.1, S13.2.3
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S13.2.1, S13.2.3

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Add the descriptor with source commit, canonical intake path and parsed-target digest to the existing seal. Read committed projection at initial sealing; carry the descriptor unchanged through all automatic rotation/rebaseline heads. Compare active declaration at publication; mutable owner/outcome changes do not alter closure authority. Use local Git only to prove actual rebase semantics.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for protected-artifact seal closure descriptor and publication authority resolver supplies a committed approved closure declaration, exercises BUILD and automatic rebase/rebaseline occur, and asserts publication uses that original approved target set while legitimate marker owner/outcome changes remain possible.
- The integration fixture for protected-artifact seal closure descriptor and publication authority resolver supplies BUILD adds, removes, or changes a target after the approved baseline, exercises publication compares active declarations with authorized provenance, and asserts it refuses the changed projection with a DECIDE-owned correction diagnostic; automatic rebaseline cannot silently authorize it.
- The seal descriptor records the committed source path, commit and canonical target-set digest; publication reads and verifies that committed projection, automatic rebaseline preserves the descriptor, and unrelated owner/outcome changes leave it unchanged.

**Files:** `src/conductor/src/engine/protected-artifact-seal.ts`; `src/conductor/src/engine/engineer/closure-targets.ts`; `src/conductor/test/engine/protected-artifact-seal.test.ts`; `src/conductor/test/engine/engineer/closure-targets.test.ts`
**Dependencies:** Task 27, Task 28

### Task 31: Refuse missing legacy provenance and untrusted transported targets

**Story:** Story 13.2; S13.2.4, S13.2.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer unit proof for S13.2.4, S13.2.5

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. For a seal lacking the descriptor, derive only from a verified readable original baseline; if impossible, return a named added-target recovery refusal without adopting current marker bytes. Resolve the authorized set independently of manifest and provider PR prose; transported values are context only. Preserve empty-extra legacy handling.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for legacy seal descriptor derivation and authoritative closure resolver supplies an older seal has no closure descriptor and its original baseline cannot be verified/read, exercises added-target publication is requested, and asserts it reports the missing provenance and does not derive authority from the current mutable marker.
- The unit fixture for legacy seal descriptor derivation and authoritative closure resolver supplies a work-order manifest or provider-authored PR body names different targets, exercises authoritative linkage is calculated, and asserts those values cannot replace or expand the approved declaration.

**Files:** `src/conductor/src/engine/protected-artifact-seal.ts`; `src/conductor/src/engine/engineer/closure-targets.ts`; `src/conductor/test/engine/protected-artifact-seal.test.ts`; `src/conductor/test/engine/engineer/closure-targets.test.ts`
**Dependencies:** Task 30

### Task 32: Extend explicit operator reseal for intentional closure revisions

**Story:** Story 13.2; S13.2.2
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S13.2.2

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Extend the existing operator-only explicit reseal command to enumerate the closure projection revision using committed bytes. Reuse scope checks, machine operator identity, drift refusal and existing audit/event path. Replace only the explicitly selected closure descriptor; never turn automatic rebaseline or a blanket marker fingerprint into approval.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for reseal CLI and scoped protected-artifact-seal writer supplies the operator intentionally revises the closure declarations through the existing explicit reseal workflow, exercises the approved revision is committed and used at publication, and asserts only that newly authorized set replaces the prior projection.
- The reseal entry fixture refuses an uncommitted projection or unrelated unlisted protected drift, preserves every other sealed entry, and records operator-attributed reseal evidence through the existing audit path.

**Files:** `src/conductor/src/engine/reseal-cli.ts`; `src/conductor/src/engine/protected-artifact-seal.ts`; `src/conductor/test/engine/reseal-cli.test.ts`; `src/conductor/test/engine/protected-artifact-seal.test.ts`
**Dependencies:** Task 30, Task 31

### Task 33: Project missing closing references without damaging PR body regions

**Story:** Story 14, Story 15; S14.4, S15.2
**Type:** happy-path
**Coverage disposition:** planned lower-layer unit proof for S14.4, S15.2

**Steps:**
1. Add the scoped unit fixtures named by the Done-when checks and establish RED with the affected selector.
2. Replace one-target body coverage assumptions with a pure canonical set projection. Recognize equivalent closing keywords outside masked project regions; an unqualified #N covers only the PR repository. Add only missing engine references, preserving unrelated bytes and project-owned regions. Use the same projection for draft creation and body refresh.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The unit fixture for shared multi-target issue-reference body projector supplies a PR body contains an unqualified `#42` for its own repository while an approved extra targets another repository's issue 42, exercises existing coverage is checked, and asserts the local reference does not satisfy the cross-repository target.
- The unit fixture for shared multi-target issue-reference body projector supplies a draft, body refresh, or publication retry already has some equivalent closing references and unrelated content, exercises the target projection is applied, and asserts only missing linkage is added and unrelated body content/project-owned regions remain intact.

**Files:** `src/conductor/src/engine/engineer/issue-ref.ts`; `src/conductor/src/engine/ship-draft-pr.ts`; `src/conductor/test/engine/engineer/issue-ref.test.ts`; `src/conductor/test/engine/ship-draft-pr.test.ts`
**Dependencies:** Task 27

### Task 34: Link all targets non-closing in specification handoff

**Story:** Story 15; S15.3
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S15.3

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Read the explicit spec target projection and compose deduplicated Refs entries for origin/extras, including extras-only specs. Keep guarded writeback and existing spec best-effort resource retention. Do not reuse the implementation Closes projection or introduce direct issue-close calls.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for engineer handoff/openSpecPr reference composition supplies the same target declarations are handed off in a spec PR, exercises its body is authored, and asserts they appear as non-closing references and the spec workflow neither closes the issues directly nor adds closing instructions for them.
- The handoff entry fixture with no origin and two extras retains two non-closing Refs entries across retry, makes zero issue-close/assignee calls, and returns the existing spec PR with a named diagnostic on writeback failure.

**Files:** `src/conductor/src/engine/engineer/handoff.ts`; `src/conductor/src/engine/engineer/issue-ref.ts`; `src/conductor/test/engine/engineer/handoff-issue-ref.test.ts`
**Dependencies:** Task 28, Task 29, Task 33

### Task 35: Refuse unsafe or unsupported implementation PR linkage

**Story:** Story 15; S15.4, S15.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S15.4, S15.5

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Resolve exact PR ownership/repository/default base before update; return complete/incomplete/refused with stage and targets. Read/validate actual remote body without empty-body fallback. Use executeGithubOperation for one batch edit and reread confirmation; no mutation when identity, ownership or body validation fails.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for guarded batch issue-link publication adapter supplies the implementation PR targets a non-default branch, exercises closure coverage is assessed, and asserts it reports unsupported merge-closure coverage instead of claiming GitHub will close the targets.
- The integration fixture for guarded batch issue-link publication adapter supplies the PR cannot be identified/authorized or its current body cannot be read as valid data, exercises linkage is attempted, and asserts the body is not replaced with an empty fallback and no unrelated PR or issue is mutated.

**Files:** `src/conductor/src/engine/engineer/issue-ref.ts`; `src/conductor/test/engine/engineer/issue-ref.test.ts`
**Dependencies:** Task 30, Task 31, Task 33

### Task 36: Wire complete target linkage into common FINISH before readiness

**Story:** Story 13.1, Story 15; S13.1.2, S15.1, S15.6
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S13.1.2, S15.1, S15.6

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. After prose/region restoration and before ready/final outcome, resolve approved targets and apply/verify shared linkage. Attended and daemon production adapters use the same operation. Convert the daemon tail helper to a compatibility call to that operation, with no origin-only bypass. Exercise actual FINISH entry with faithful GitHub fake for origin+extras, extras-only and a removed-link body refresh.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for common FINISH coordinator and production composition supplies a spec has no originating issue, exercises it declares valid additional targets, and asserts the same target set reaches implementation publication without taking an origin-absent skip.
- The integration fixture for common FINISH coordinator and production composition supplies an origin and two distinct approved extras and an implementation PR targeting the repository default branch, exercises common FINISH publication completes in attended or daemon mode, and asserts the actual PR body contains effective closing references for all three before final completion.
- The integration fixture for common FINISH coordinator and production composition supplies provider prose or a later body refresh removes a required link before FINISH completion, exercises final coverage is checked, and asserts publication cannot claim completeness until the full approved set is re-observed on the actual PR.

**Files:** `src/conductor/src/engine/finish-publication.ts`; `src/conductor/src/engine/finish-publication-production.ts`; `src/conductor/src/engine/engineer/issue-ref.ts`; `src/conductor/src/daemon-cli.ts`; `src/conductor/test/engine/finish-publication-production-wiring.test.ts`; `src/conductor/test/engine/finish-publication.test.ts`
**Dependencies:** Task 29, Task 33, Task 35

### Task 37: Keep approved merge closure independent of watched declarations

**Story:** Story 15; S15.7
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S15.7

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Apply the operator-approved merge-time policy for origin/extras irrespective of older observed-close markers. Spec linkage remains Refs. Add a targeted production-publication fixture with a watched marker and independently enrolled watch evidence to prove the operation neither enrolls, deletes nor rewrites that evidence. No observation parser, mandatory marker gate or sweep is added.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for common implementation closure policy projection supplies an older watched-observation declaration exists for an origin or declared extra, exercises this implementation workflow publishes its approved target set, and asserts that declaration cannot downgrade closing references to `Refs`, require a new observation marker or watch enrollment, or delay closure past merge; independently enrolled watches are untouched.
- The common target projection produces the same effective implementation closing set with or without an older watched declaration, and land/publication introduces no observation-marker prerequisite or watcher dispatch.

**Files:** `src/conductor/src/engine/engineer/closure-targets.ts`; `src/conductor/test/engine/finish-publication-production-wiring.test.ts`
**Dependencies:** Task 36

### Task 38: Resume interrupted linkage by observing the actual PR body

**Story:** Story 16; S16.1, S16.2
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S16.1, S16.2

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. On retry reread the body and target provenance, then repair only missing approved references. Distinguish pre-write failure from after-write interruption by observed remote state, without a new local publication-progress ledger. Keep source declarations unchanged and use the existing bounded FINISH transition recovery.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for FINISH closure transition resume path supplies publication has incomplete approved closure coverage, exercises FINISH retries after the dependency recovers, and asserts it rereads the actual body, adds only missing authorized links, verifies the complete set, and leaves the declaration unchanged.
- The integration fixture for FINISH closure transition resume path supplies the body update succeeded before a process stopped, exercises FINISH resumes, and asserts observed coverage completes recovery without duplicate instructions, direct issue-close calls, or assignee changes.

**Files:** `src/conductor/src/engine/finish-publication.ts`; `src/conductor/src/engine/finish-publication-production.ts`; `src/conductor/src/engine/engineer/issue-ref.ts`; `src/conductor/test/engine/finish-publication-production.test.ts`
**Dependencies:** Task 36

### Task 39: Keep partial/refused linkage visible and FINISH-owned

**Story:** Story 16; S16.3, S16.4, S16.5
**Type:** negative-path
**Coverage disposition:** planned lower-layer integration proof for S16.3, S16.4, S16.5

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Propagate stage-specific target completeness/refusal through the existing FINISH recovery result. Inject read/write/verify faults and concurrent body replacement; verify the full target set after write. Preserve unrelated content and declarations, disallow successful completion on partial origin-only coverage, and never route a linkage defect to BUILD.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for FINISH publication failure classifier and linkage verification supplies read, guarded write, or verification fails due to network, permission, malformed response, or concurrent body edits, exercises FINISH reports its result, and asserts it identifies incomplete/refused linkage and the affected targets without claiming verified success.
- The integration fixture for FINISH publication failure classifier and linkage verification supplies a linkage failure remains unresolved, exercises lifecycle recovery is selected, and asserts it stays in the existing FINISH recovery path, creates no broad BUILD repair, preserves declarations and unrelated body content, and does not close unrelated issues.
- The integration fixture for FINISH publication failure classifier and linkage verification supplies one body write links only part of the declared set, exercises final verification runs, and asserts the missing targets remain visible and publication is incomplete even if the originating issue was linked successfully.

**Files:** `src/conductor/src/engine/finish-publication.ts`; `src/conductor/src/engine/finish-publication-production.ts`; `src/conductor/src/engine/engineer/issue-ref.ts`; `src/conductor/test/engine/finish-publication.test.ts`; `src/conductor/test/engine/finish-publication-production.test.ts`
**Dependencies:** Task 35, Task 36, Task 38

### Task 40: Connect confirmed action and closure transitions to their owning emitters

**Story:** Story 12.2; S12.2.1
**Type:** happy-path
**Coverage disposition:** planned lower-layer integration proof for S12.2.1

**Steps:**
1. Add the scoped integration fixtures named by the Done-when checks and establish RED with the affected selector.
2. Wire the approved event variants to the owning transition-result boundaries after confirmed persistence/effect observation, using task26 reporting semantics. In-process calls use their current emitter; standalone action commands use task25 EventPersister. Thread the closed IDs/results into existing renderers and timeline. This task implements event integration, not an end-of-feature validation pass.
3. Establish scoped GREEN, await fixture cleanup, and commit this behavior.

**Done when:**
- The integration fixture for production capture/import/resolve/file/recover and FINISH result event adapters supplies capture, resolution, publication, recovery, or closure-linkage work completes, exercises its occurrence is observed, and asserts the existing event/timeline surfaces identify its feature, relevant action/source, and bounded result without exposing entire evidence or intake bodies.
- Each production transition adapter emits only after its confirmed state/effect result and includes feature plus relevant action/source/target IDs with closed bounded result/reason values; no raw intake body, credential or whole snapshot enters the occurrence.

**Files:** `src/conductor/src/engine/post-ship-actions.ts`; `src/conductor/src/engine/post-ship-publication.ts`; `src/conductor/src/engine/post-ship-recovery.ts`; `src/conductor/src/actions-cli.ts`; `src/conductor/src/engine/finish-publication-production.ts`; `src/conductor/src/daemon-cli.ts`; `src/conductor/test/engine/post-ship-events.test.ts`
**Dependencies:** Task 11, Task 12, Task 16, Task 19, Task 23, Task 24, Task 25, Task 26, Task 39

## Task Dependency Graph

Dependencies on each task are authoritative and acyclic; numeric presentation is not execution order.
The ready frontier starts with Tasks 1, 24 and 27. Key chains are storage/identity → classified
capture/local handoff → collection/retention → operator actions/recovery/publication, and target
parser → marker/provenance → guarded projection → common FINISH. Task 40 owns the explicit
transition-to-event integration after its producers exist. Shared file targets constrain parallel
execution even when no semantic dependency exists.

## Integration Points and unique boundary owners

| Production behavior | Owning task | Observable boundary proof |
|---|---|---|
| Build-review classified source capture | 4 | Real coordinator result becomes importable retained source without changing blocking authority |
| PRD/as-built classified source capture | 5 | Serial/group consumption preserves source identity and prior outcomes |
| Local deferral effect | 8 | Coordinator effect durably records source plus handoff without tracker or budget growth |
| Legacy effect recovery | 9 | Eligible deferrals retain marker/link context and settle locally |
| Recurrence/effective/clean-PASS consumers | 10 | Confirmed handoff remains settled while genuine blockers retain authority |
| Executor return → shared-root import | 11 | Terminal collection/attended return uses one importer after release without executor root writes |
| Shipped record → cleanup retention | 12 | Production writers retain sources recoverable after cleanup/interrupted collection |
| CLI registration/authorization | 13 | Invalid/worker calls never mutate or fall into BUILD |
| List/filter/page, context, resolution | 14, 15, 16 respectively | Each command/projection owns only its named observable operation |
| Recovery dispatch and partial-result aggregation | 17, 19 respectively | No reviewer/rebuild, and bounds/errors retain valid independent results |
| Explicit filing and refusal results | 20, 22 respectively | Guarded request boundary and named failed/uncertain operator outcome |
| Event declarations and timeline consumption | 24, 25 respectively | Exhaustive schema handling and standalone ledger timeline visibility |
| Persistence/telemetry split | 26 | Confirmed state survives telemetry failure without replay |
| Marker producer round-trip | 28 | Explicit declarations survive owner/outcome rewrites and ignore inbound lookalikes |
| Initial/automatic closure provenance, explicit reseal | 30, 32 respectively | Rebase retains approved authority; explicit scoped operator revision changes it |
| Spec handoff | 34 | Full declared set is non-closing in the spec PR |
| Guarded PR read/write/base admission | 35 | No unsupported closure claim, foreign mutation or unreadable-body overwrite |
| Common FINISH target linkage | 36 | Both modes and extras-only features verify actual PR coverage before completion |
| Watched-marker precedence | 37 | Old marker cannot delay merge closure or trigger observation machinery |
| FINISH resume and failure routing | 38, 39 respectively | Retry converges by observation; incomplete linkage stays FINISH-owned |
| Transition results → owning event emitters | 40 | Confirmed source/action/closure occurrences reach the existing event spine |

## Coverage Check

Each exact criterion has one primary task and a verbatim completion check. Supporting tasks are
captured by dependencies. All rows are diff-local: they require adapter-observed behavior, not a
future real GitHub merge, another feature's delivery, or production use after this change.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a consumed build-review result has a justified deferral, an explicitly upheld residual of a refutation, accepted risk, or confidence suppression, when its source is captured and collected, then the feature action view contains the outstanding concern with that specific classification and original identity. | task-4 | "The integration fixture for build-review adjudication coordinator capture boundary and action importer supplies a consumed build-review result has a justified deferral, an explicitly upheld residual of a refutation, accepted risk, or confidence suppression, exercises its source is captured and collected, and asserts the feature action view contains the outstanding concern with that specific classification and original identity." | diff-local |
| Story 1 happy: Given requirements audit records a non-blocking finding, when the classified result is captured and collected, then an action preserves its criterion or recorded non-criterion identity and existing case relationship, where present. | task-5 | "The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies requirements audit records a non-blocking finding, exercises the classified result is captured and collected, and asserts an action preserves its criterion or recorded non-criterion identity and existing case relationship, where present." | diff-local |
| Story 1 happy: Given a delivered as-built verdict records an outstanding PLAN_GAP, when its source is captured and collected, then the same action workflow exposes the concern and its as-built origin. | task-5 | "The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies a delivered as-built verdict records an outstanding PLAN_GAP, exercises its source is captured and collected, and asserts the same action workflow exposes the concern and its as-built origin." | diff-local |
| Story 1 negative: Given an unconsumed, stale, malformed, or raw blocking review artifact exists on disk, when capture is considered, then that artifact cannot produce a non-blocking action or change the gate's verdict. | task-4 | "The integration fixture for build-review adjudication coordinator capture boundary and action importer supplies an unconsumed, stale, malformed, or raw blocking review artifact exists on disk, exercises capture is considered, and asserts that artifact cannot produce a non-blocking action or change the gate's verdict." | diff-local |
| Story 1 negative: Given serial and validation-group execution consume the same audit finding, when both observations reach collection, then one action remains and neither path dispatches a new reviewer. | task-5 | "The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies serial and validation-group execution consume the same audit finding, exercises both observations reach collection, and asserts one action remains and neither path dispatches a new reviewer." | diff-local |
| Story 1 negative: Given a typed as-built record describes a completed repair, when it is collected alongside an outstanding gap, then only the outstanding gap is open and the repaired outcome stays available as historical evidence. | task-5 | "The integration fixture for classified PRD/as-built result consumption in Conductor and action importer supplies a typed as-built record describes a completed repair, exercises it is collected alongside an outstanding gap, and asserts only the outstanding gap is open and the repaired outcome stays available as historical evidence." | diff-local |
| Story 2 happy: Given several features have open, acted-on, and dismissed actions, when `actions list` runs with feature and status filters, then it returns only the requested subset; the default view shows open actions and `--status all` includes the resolved history. | task-14 | "The integration fixture for actions list repository query and human/JSON renderers supplies several features have open, acted-on, and dismissed actions, exercises `actions list` runs with feature and status filters, and asserts it returns only the requested subset; the default view shows open actions and `--status all` includes the resolved history." | diff-local |
| Story 2 happy: Given an action's feature has shipped and its worktree has been normally removed, when the operator lists that feature or all features in a new process, then the retained action and its resolution are still discoverable without contacting the tracker. | task-12 | "The integration fixture for shipment source serialization and shipped-record/FINISH publication entry supplies an action's feature has shipped and its worktree has been normally removed, exercises the operator lists that feature or all features in a new process, and asserts the retained action and its resolution are still discoverable without contacting the tracker." | diff-local |
| Story 2 happy: Given more actions exist than one page allows, when results are paged, then every matching action is reachable with a default page of 100 and a maximum of 500 without deleting stored history; human and JSON output represent the same actions and completeness diagnostics. | task-14 | "The integration fixture for actions list repository query and human/JSON renderers supplies more actions exist than one page allows, exercises results are paged, and asserts every matching action is reachable with a default page of 100 and a maximum of 500 without deleting stored history; human and JSON output represent the same actions and completeness diagnostics." | diff-local |
| Story 2 negative: Given an invalid status, malformed feature selector, or invalid pagination input, when listing runs, then it returns a usage diagnostic with no mutation and no BUILD launch. | task-13 | "The integration fixture for CLI actions command parser and pre-build dispatch authorization supplies an invalid status, malformed feature selector, or invalid pagination input, exercises listing runs, and asserts it returns a usage diagnostic with no mutation and no BUILD launch." | diff-local |
| Story 2 negative: Given one feature's retained state is unreadable, when the repository view runs, then it returns valid independent features with a named incomplete-result diagnostic instead of presenting an empty complete list. | task-19 | "The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies one feature's retained state is unreadable, exercises the repository view runs, and asserts it returns valid independent features with a named incomplete-result diagnostic instead of presenting an empty complete list." | diff-local |
| Story 2 negative: Given the tracker is unavailable and the result spans several pages, when the operator reads each page, then local listing completes without a tracker request and page size never exceeds the maximum. | task-14 | "The integration fixture for actions list repository query and human/JSON renderers supplies the tracker is unavailable and the result spans several pages, exercises the operator reads each page, and asserts local listing completes without a tracker request and page size never exceeds the maximum." | diff-local |
| Story 3 happy: Given an action with retained evidence and an earlier risk or scope decision, when it is displayed, then the concern, feature, review source, supporting evidence, original decision and rationale are available without replacing them with a new interpretation. | task-15 | "The integration fixture for action detail projection used by actions list supplies an action with retained evidence and an earlier risk or scope decision, exercises it is displayed, and asserts the concern, feature, review source, supporting evidence, original decision and rationale are available without replacing them with a new interpretation." | diff-local |
| Story 3 happy: Given an existing follow-up issue is linked, when the action is displayed, then its exact reference remains visible independently of whether the issue is open or closed and whether the action is resolved. | task-15 | "The integration fixture for action detail projection used by actions list supplies an existing follow-up issue is linked, exercises the action is displayed, and asserts its exact reference remains visible independently of whether the issue is open or closed and whether the action is resolved." | diff-local |
| Story 3 negative: Given a historical evidence path no longer exists, when the action is displayed, then available retained excerpts remain visible and the missing supporting material is explicitly identified without inventing its contents. | task-15 | "The integration fixture for action detail projection used by actions list supplies a historical evidence path no longer exists, exercises the action is displayed, and asserts available retained excerpts remain visible and the missing supporting material is explicitly identified without inventing its contents." | diff-local |
| Story 3 negative: Given retained review or tracker text contains instructions to dismiss the action or close an unrelated issue, when it is imported or rendered, then the text remains evidence and neither action occurs. | task-15 | "The integration fixture for action detail projection used by actions list supplies retained review or tracker text contains instructions to dismiss the action or close an unrelated issue, exercises it is imported or rendered, and asserts the text remains evidence and neither action occurs." | diff-local |
| Story 4 happy: Given an open action, when `actions resolve` names it as acted-on with a reason or follow-up reference, then a fresh process reads acted-on with the reason, machine-resolved operator, and ordered revision. | task-16 | "The integration fixture for actions resolve command and action transition service supplies an open action, exercises `actions resolve` names it as acted-on with a reason or follow-up reference, and asserts a fresh process reads acted-on with the reason, machine-resolved operator, and ordered revision." | diff-local |
| Story 4 happy: Given an open action, when the operator explicitly dismisses it with a reason, then it leaves the open view and remains inspectable in dismissed/all views without changing any gate risk decision. | task-16 | "The integration fixture for actions resolve command and action transition service supplies an open action, exercises the operator explicitly dismisses it with a reason, and asserts it leaves the open view and remains inspectable in dismissed/all views without changing any gate risk decision." | diff-local |
| Story 4 negative: Given an unknown action, mismatched feature, empty reason, unsupported resolution, or stale conflicting revision, when resolution is attempted, then it reports the specific invalid selection/conflict and leaves confirmed state unchanged. | task-16 | "The integration fixture for actions resolve command and action transition service supplies an unknown action, mismatched feature, empty reason, unsupported resolution, or stale conflicting revision, exercises resolution is attempted, and asserts it reports the specific invalid selection/conflict and leaves confirmed state unchanged." | diff-local |
| Story 4 negative: Given an action is merely listed or an issue is published for it, when its state is read, then no acted-on or dismissed decision has been manufactured. | task-16 | "The integration fixture for actions resolve command and action transition service supplies an action is merely listed or an issue is published for it, exercises its state is read, and asserts no acted-on or dismissed decision has been manufactured." | diff-local |
| Story 4 negative: Given a daemon-worker session attempts an operator-only resolution, when command authorization is checked, then the existing worker restriction refuses it without a new exemption or BUILD fallthrough. | task-13 | "The integration fixture for CLI actions command parser and pre-build dispatch authorization supplies a daemon-worker session attempts an operator-only resolution, exercises command authorization is checked, and asserts the existing worker restriction refuses it without a new exemption or BUILD fallthrough." | diff-local |
| Story 5 happy: Given one captured source appears again through retry, terminal collection, and historical recovery, when each is processed, then exactly one action retains all distinct source links and no duplicate action is created. | task-7 | "The unit fixture for post-ship source importer supplies one captured source appears again through retry, terminal collection, and historical recovery, exercises each is processed, and asserts exactly one action retains all distinct source links and no duplicate action is created." | diff-local |
| Story 5 happy: Given an existing judge-established case relationship binds two source observations, when they are imported, then that relationship is preserved without another semantic adjudication. | task-7 | "The unit fixture for post-ship source importer supplies an existing judge-established case relationship binds two source observations, exercises they are imported, and asserts that relationship is preserved without another semantic adjudication." | diff-local |
| Story 5 negative: Given an action was acted-on or dismissed after its source was first captured, when an older snapshot is replayed, then its resolution, operator, reason, and revision remain unchanged. | task-7 | "The unit fixture for post-ship source importer supplies an action was acted-on or dismissed after its source was first captured, exercises an older snapshot is replayed, and asserts its resolution, operator, reason, and revision remain unchanged." | diff-local |
| Story 5 negative: Given two distinct findings have similar or identical summaries, different authoritative identities, or belong to different features, when imported, then they remain separate; ordinal reuse or prose similarity cannot copy a resolution between them. | task-7 | "The unit fixture for post-ship source importer supplies two distinct findings have similar or identical summaries, different authoritative identities, or belong to different features, exercises imported, and asserts they remain separate; ordinal reuse or prose similarity cannot copy a resolution between them." | diff-local |
| Story 5 negative: Given legacy representations conflict in retained identity fields, when recovery cannot establish exact replay, then it reports the ambiguous sources instead of merging them by text similarity. | task-7 | "The unit fixture for post-ship source importer supplies legacy representations conflict in retained identity fields, exercises recovery cannot establish exact replay, and asserts it reports the ambiguous sources instead of merging them by text similarity." | diff-local |
| Story 6 happy: Given an unlinked action with a complete inherited intake proposal or operator-supplied title and body, when the operator explicitly runs `actions file`, then one sanitized issue is published through the configured guarded intake workflow, its reference is retained, and the action's resolution stays unchanged. | task-20 | "The integration fixture for actions file command using guarded canonical intake service supplies an unlinked action with a complete inherited intake proposal or operator-supplied title and body, exercises the operator explicitly runs `actions file`, and asserts one sanitized issue is published through the configured guarded intake workflow, its reference is retained, and the action's resolution stays unchanged." | diff-local |
| Story 6 happy: Given the action already has an issue reference or a confirmed exact publication-marker match, when filing is requested, then that issue is reused even if closed and no replacement issue is created. | task-21 | "The unit fixture for post-ship publication reservation and exact-marker lookup supplies the action already has an issue reference or a confirmed exact publication-marker match, exercises filing is requested, and asserts that issue is reused even if closed and no replacement issue is created." | diff-local |
| Story 6 negative: Given a source has been captured but no operator has requested publication, when review, collection, recovery, or listing runs, then no intake issue is created. | task-20 | "The integration fixture for actions file command using guarded canonical intake service supplies a source has been captured but no operator has requested publication, exercises review, collection, recovery, or listing runs, and asserts no intake issue is created." | diff-local |
| Story 6 negative: Given retained context lacks the required intake content and no complete operator input is supplied, when filing is requested, then the operator receives an evidence-prefilled proposal and the missing inputs; no impact or desired outcomes are invented and no issue is created. | task-20 | "The integration fixture for actions file command using guarded canonical intake service supplies retained context lacks the required intake content and no complete operator input is supplied, exercises filing is requested, and asserts the operator receives an evidence-prefilled proposal and the missing inputs; no impact or desired outcomes are invented and no issue is created." | diff-local |
| Story 6 negative: Given the target ownership guard refuses the requested write, when filing runs, then refusal remains visible with the action and no raw transport fallback or issue-assignee mutation occurs. | task-22 | "The integration fixture for guarded post-ship publication result reducer supplies the target ownership guard refuses the requested write, exercises filing runs, and asserts refusal remains visible with the action and no raw transport fallback or issue-assignee mutation occurs." | diff-local |
| Story 7 happy: Given a prior publication attempt failed before confirmed creation, when the operator retries successfully, then the same publication identity is used and the issue link is confirmed on the existing action. | task-21 | "The unit fixture for post-ship publication reservation and exact-marker lookup supplies a prior publication attempt failed before confirmed creation, exercises the operator retries successfully, and asserts the same publication identity is used and the issue link is confirmed on the existing action." | diff-local |
| Story 7 happy: Given remote creation succeeded but the process stopped before recording the link, when filing resumes, then exact-marker lookup recovers that issue without another create and preserves any intervening operator resolution. | task-23 | "The unit fixture for per-action publication lease and reserve/effect/confirm protocol supplies remote creation succeeded but the process stopped before recording the link, exercises filing resumes, and asserts exact-marker lookup recovers that issue without another create and preserves any intervening operator resolution." | diff-local |
| Story 7 negative: Given lookup times out, authentication fails, permissions are refused, rate limiting occurs, or a response is unreadable, when publication runs, then the selected action reports the failed or uncertain stage and no failed lookup is treated as permission to create. | task-22 | "The integration fixture for guarded post-ship publication result reducer supplies lookup times out, authentication fails, permissions are refused, rate limiting occurs, or a response is unreadable, exercises publication runs, and asserts the selected action reports the failed or uncertain stage and no failed lookup is treated as permission to create." | diff-local |
| Story 7 negative: Given two callers request publication for the same action concurrently, when lookup/create overlap, then at most one create occurs; a contending caller waits or receives a recoverable contention result without creating independently. | task-23 | "The unit fixture for per-action publication lease and reserve/effect/confirm protocol supplies two callers request publication for the same action concurrently, exercises lookup/create overlap, and asserts at most one create occurs; a contending caller waits or receives a recoverable contention result without creating independently." | diff-local |
| Story 7 negative: Given two distinct action publication identities have identical text, when both are explicitly filed, then each may create its own issue; text similarity does not block legitimate independent publication. | task-21 | "The unit fixture for post-ship publication reservation and exact-marker lookup supplies two distinct action publication identities have identical text, exercises both are explicitly filed, and asserts each may create its own issue; text similarity does not block legitimate independent publication." | diff-local |
| Story 7 negative: Given remote creation may have succeeded but confirmation remains unavailable, when the command returns, then it reports uncertainty rather than success, keeps the action available, and retries with the same lookup identity. | task-22 | "The integration fixture for guarded post-ship publication result reducer supplies remote creation may have succeeded but confirmation remains unavailable, exercises the command returns, and asserts it reports uncertainty rather than success, keeps the action available, and retries with the same lookup identity." | diff-local |
| Story 8 happy: Given a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, when its source is durably handed off locally, then review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge. | task-8 | "The integration fixture for applyBuildReview local post-ship handoff effect supplies a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, exercises its source is durably handed off locally, and asserts review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge." | diff-local |
| Story 8 happy: Given a legacy unfiled or failed remote deferral is non-blocking, when it is resumed, then a local handoff preserves the proposal, original identity/marker aliases, and existing issue reference if any; optional remote failure no longer prevents settlement. | task-9 | "The unit fixture for legacy deferral migration in remediation effect recovery supplies a legacy unfiled or failed remote deferral is non-blocking, exercises it is resumed, and asserts a local handoff preserves the proposal, original identity/marker aliases, and existing issue reference if any; optional remote failure no longer prevents settlement." | diff-local |
| Story 8 happy: Given an exact source recurs after a confirmed local handoff, when effective verdict, recurrence, or clean-PASS reconciliation runs, then it remains settled without another judge session solely for that source, and optional publication state does not reopen it. | task-10 | "The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an exact source recurs after a confirmed local handoff, exercises effective verdict, recurrence, or clean-PASS reconciliation runs, and asserts it remains settled without another judge session solely for that source, and optional publication state does not reopen it." | diff-local |
| Story 8 negative: Given required local review-control evidence is missing or corrupt, when settlement is attempted, then the existing integrity failure remains blocking and no successful local handoff is claimed. | task-8 | "The integration fixture for applyBuildReview local post-ship handoff effect supplies required local review-control evidence is missing or corrupt, exercises settlement is attempted, and asserts the existing integrity failure remains blocking and no successful local handoff is claimed." | diff-local |
| Story 8 negative: Given an unfinished BUILD effect, uncovered infrastructure failure, consistency stop, or unresolved decision-owner escalation exists, when a sibling non-blocking action is captured, then that blocker keeps its authority and cannot be migrated into a non-blocking handoff. | task-10 | "The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an unfinished BUILD effect, uncovered infrastructure failure, consistency stop, or unresolved decision-owner escalation exists, exercises a sibling non-blocking action is captured, and asserts that blocker keeps its authority and cannot be migrated into a non-blocking handoff." | diff-local |
| Story 8 negative: Given repository mirroring or optional intake publication fails after valid local capture, when the feature proceeds, then it reports the action diagnostic without adding a halt, plan task, or remediation charge for that failure. | task-11 | "The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies repository mirroring or optional intake publication fails after valid local capture, exercises the feature proceeds, and asserts it reports the action diagnostic without adding a halt, plan task, or remediation charge for that failure." | diff-local |
| Story 8 negative: Given a security finding is not yet adjudicated, when action capture runs, then the inbox cannot label it non-blocking merely because it is outside the plan; the existing security/adjudication authority decides its route. | task-4 | "The integration fixture for build-review adjudication coordinator capture boundary and action importer supplies a security finding is not yet adjudicated, exercises action capture runs, and asserts the inbox cannot label it non-blocking merely because it is outside the plan; the existing security/adjudication authority decides its route." | diff-local |
| Story 9 happy: Given a shipped record contains sufficient modern source snapshots or supported legacy structured findings, when `actions recover` runs after worktree removal, then eligible concerns appear with their retained provenance and no reviewer, provider, or BUILD invocation occurs. | task-17 | "The integration fixture for actions recover command and post-ship recovery service supplies a shipped record contains sufficient modern source snapshots or supported legacy structured findings, exercises `actions recover` runs after worktree removal, and asserts eligible concerns appear with their retained provenance and no reviewer, provider, or BUILD invocation occurs." | diff-local |
| Story 9 happy: Given retained original audit, as-built, or case evidence supplies an eligible source not yet in the inbox, when recovery selects that feature, then it imports the source; repeated recovery preserves the same action, publication link, and operator resolution. | task-17 | "The integration fixture for actions recover command and post-ship recovery service supplies retained original audit, as-built, or case evidence supplies an eligible source not yet in the inbox, exercises recovery selects that feature, and asserts it imports the source; repeated recovery preserves the same action, publication link, and operator resolution." | diff-local |
| Story 9 negative: Given no sufficient retained evidence exists for an older finding, when recovery runs, then it reports what is unavailable instead of reconstructing a finding or requiring the build to rerun. | task-17 | "The integration fixture for actions recover command and post-ship recovery service supplies no sufficient retained evidence exists for an older finding, exercises recovery runs, and asserts it reports what is unavailable instead of reconstructing a finding or requiring the build to rerun." | diff-local |
| Story 9 negative: Given an active feature is explicitly recovered before terminal collection, when later terminal collection imports its same sources, then no duplicate action or reopened resolution results and the feature is not falsely labeled shipped. | task-11 | "The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies an active feature is explicitly recovered before terminal collection, exercises later terminal collection imports its same sources, and asserts no duplicate action or reopened resolution results and the feature is not falsely labeled shipped." | diff-local |
| Story 9 negative: Given a legacy source lacks a modern ID, when identical retained identity fields and exact content reappear in another supported record, then recovery reuses its legacy identity without calling a model to infer equivalence. | task-18 | "The unit fixture for post-ship legacy evidence decoders supplies a legacy source lacks a modern ID, exercises identical retained identity fields and exact content reappear in another supported record, and asserts recovery reuses its legacy identity without calling a model to infer equivalence." | diff-local |
| Story 10 happy: Given retained evidence explicitly records repaired, wholly refuted/rejected, or dismissed findings alongside an outstanding concern, when capture or recovery runs, then those completed/excluded outcomes remain historical and only the outstanding concern becomes open. | task-6 | "The unit fixture for post-ship source eligibility and action projection supplies retained evidence explicitly records repaired, wholly refuted/rejected, or dismissed findings alongside an outstanding concern, exercises capture or recovery runs, and asserts those completed/excluded outcomes remain historical and only the outstanding concern becomes open." | diff-local |
| Story 10 happy: Given an unresolved concern has prior accepted-risk or scope-acceptance evidence and an existing issue link, when recovered, then the action remains open with both the decision and link visible until the operator explicitly resolves it. | task-6 | "The unit fixture for post-ship source eligibility and action projection supplies an unresolved concern has prior accepted-risk or scope-acceptance evidence and an existing issue link, exercises recovered, and asserts the action remains open with both the decision and link visible until the operator explicitly resolves it." | diff-local |
| Story 10 negative: Given a refuted claim has a separately upheld remainder, when imported, then only the remainder is eligible for an open action; the refuted claim is not reintroduced as true. | task-6 | "The unit fixture for post-ship source eligibility and action projection supplies a refuted claim has a separately upheld remainder, exercises imported, and asserts only the remainder is eligible for an open action; the refuted claim is not reintroduced as true." | diff-local |
| Story 10 negative: Given an issue is closed or a finding is absent from a later report without explicit follow-up completion, when the action is refreshed, then neither observation invents an acted-on/dismissed decision or erases the original risk decision. | task-6 | "The unit fixture for post-ship source eligibility and action projection supplies an issue is closed or a finding is absent from a later report without explicit follow-up completion, exercises the action is refreshed, and asserts neither observation invents an acted-on/dismissed decision or erases the original risk decision." | diff-local |
| Story 10 negative: Given confidence-suppressed evidence is retained, when displayed, then its uncertainty remains visible and capture does not assert that the suppressed claim was proven correct. | task-6 | "The unit fixture for post-ship source eligibility and action projection supplies confidence-suppressed evidence is retained, exercises displayed, and asserts its uncertainty remains visible and capture does not assert that the suppressed claim was proven correct." | diff-local |
| Story 11 happy: Given independent valid and malformed sources, when listing or recovery runs, then valid findings remain usable and each invalid source has a feature/source-specific diagnostic with an incomplete overall result. | task-19 | "The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies independent valid and malformed sources, exercises listing or recovery runs, and asserts valid findings remain usable and each invalid source has a feature/source-specific diagnostic with an incomplete overall result." | diff-local |
| Story 11 happy: Given all selected retained records are readable and eligible processing completes, when recovery finishes with no open actions, then it reports a complete result distinguishable from an incomplete empty result. | task-19 | "The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies all selected retained records are readable and eligible processing completes, exercises recovery finishes with no open actions, and asserts it reports a complete result distinguishable from an incomplete empty result." | diff-local |
| Story 11 negative: Given evidence is missing, unreadable, structurally invalid, conflicting, or ambiguously associated with a feature, when imported, then the affected record is named and no source, resolution, or successful capture is invented for it. | task-18 | "The unit fixture for post-ship legacy evidence decoders supplies evidence is missing, unreadable, structurally invalid, conflicting, or ambiguously associated with a feature, exercises imported, and asserts the affected record is named and no source, resolution, or successful capture is invented for it." | diff-local |
| Story 11 negative: Given source text exceeds 8,000 bytes, a source exceeds 64 evidence references, a case exceeds 512 source links, or repository action state would exceed 16 MiB, when import runs, then it names the exceeded dimension and leaves retained evidence available without truncation or history pruning. | task-19 | "The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies source text exceeds 8,000 bytes, a source exceeds 64 evidence references, a case exceeds 512 source links, or repository action state would exceed 16 MiB, exercises import runs, and asserts it names the exceeded dimension and leaves retained evidence available without truncation or history pruning." | diff-local |
| Story 11 negative: Given a bounded action import fails while valid siblings have been imported, when recovery returns, then those confirmed siblings remain usable and the failed source stays recoverable; existing live gate-control data is not subjected to the new action-envelope limit. | task-19 | "The integration fixture for post-ship recovery bounds and repository listing completeness aggregation supplies a bounded action import fails while valid siblings have been imported, exercises recovery returns, and asserts those confirmed siblings remain usable and the failed source stays recoverable; existing live gate-control data is not subjected to the new action-envelope limit." | diff-local |
| Story 12.1 happy: Given existing version-1 or version-2 review state, when new action-related state is written, then all prior cases, effects, suppressions, PRD relationships, history, and feature identity retain their meanings on a fresh read. | task-1 | "The unit fixture for RemediationCaseStore.read/mutate supplies existing version-1 or version-2 review state, exercises new action-related state is written, and asserts all prior cases, effects, suppressions, PRD relationships, history, and feature identity retain their meanings on a fresh read." | diff-local |
| Story 12.1 happy: Given a feature produces source observations, when attended return or daemon terminal collection receives a done, halted, error, or parked result with valid observations, then repository actions are retained outside the disposable worktree; shipped source evidence supports recovery after an interrupted collection and normal cleanup. | task-11 | "The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies a feature produces source observations, exercises attended return or daemon terminal collection receives a done, halted, error, or parked result with valid observations, and asserts repository actions are retained outside the disposable worktree; shipped source evidence supports recovery after an interrupted collection and normal cleanup." | diff-local |
| Story 12.1 happy: Given concurrent requests resolve different actions or record publication alongside resolution, when both confirm success, then a fresh process sees both results without lost fields; repeating the identical transition does not duplicate it. | task-3 | "The unit fixture for RemediationCaseStore.mutate and post-ship action transition service supplies concurrent requests resolve different actions or record publication alongside resolution, exercises both confirm success, and asserts a fresh process sees both results without lost fields; repeating the identical transition does not duplicate it." | diff-local |
| Story 12.1 negative: Given an unknown schema, malformed store, foreign feature identity, ambiguous repository root, traversal selector, or escaping symlink, when state is accessed, then the operation names the defect and does not normalize it to an empty store or write outside the selected repository/feature. | task-2 | "The unit fixture for repository-action scope factory and RemediationCaseStore validators supplies an unknown schema, malformed store, foreign feature identity, ambiguous repository root, traversal selector, or escaping symlink, exercises state is accessed, and asserts the operation names the defect and does not normalize it to an empty store or write outside the selected repository/feature." | diff-local |
| Story 12.1 negative: Given disk-full, write-denied, interrupted atomic replacement, or lease contention prevents a decision from being confirmed, when the request returns, then it reports failure/contention without claiming success and the last complete confirmed state remains readable. | task-3 | "The unit fixture for RemediationCaseStore.mutate and post-ship action transition service supplies disk-full, write-denied, interrupted atomic replacement, or lease contention prevents a decision from being confirmed, exercises the request returns, and asserts it reports failure/contention without claiming success and the last complete confirmed state remains readable." | diff-local |
| Story 12.1 negative: Given a provider or executor attempts to supply operator resolution/publication authority or mutate shared-root action state, when its output is processed, then that authority/write is refused; valid source observations can still pass through the existing outer collection boundary. | task-11 | "The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies a provider or executor attempts to supply operator resolution/publication authority or mutate shared-root action state, exercises its output is processed, and asserts that authority/write is refused; valid source observations can still pass through the existing outer collection boundary." | diff-local |
| Story 12.1 negative: Given two conflicting resolutions race from the same observed revision, when one commits first, then the stale writer cannot silently replace it and receives a conflict; an old source replay cannot reverse either decision. | task-3 | "The unit fixture for RemediationCaseStore.mutate and post-ship action transition service supplies two conflicting resolutions race from the same observed revision, exercises one commits first, and asserts the stale writer cannot silently replace it and receives a conflict; an old source replay cannot reverse either decision." | diff-local |
| Story 12.1 negative: Given the dispatcher stops before import or repository import fails after the shipped snapshot is committed, when normal cleanup and later explicit recovery occur, then the source remains recoverable without restoring the old worktree and recovery never copies stale operator decisions from shipment evidence. | task-12 | "The integration fixture for shipment source serialization and shipped-record/FINISH publication entry supplies the dispatcher stops before import or repository import fails after the shipped snapshot is committed, exercises normal cleanup and later explicit recovery occur, and asserts the source remains recoverable without restoring the old worktree and recovery never copies stale operator decisions from shipment evidence." | diff-local |
| Story 12.2 happy: Given capture, resolution, publication, recovery, or closure-linkage work completes, when its occurrence is observed, then the existing event/timeline surfaces identify its feature, relevant action/source, and bounded result without exposing entire evidence or intake bodies. | task-40 | "The integration fixture for production capture/import/resolve/file/recover and FINISH result event adapters supplies capture, resolution, publication, recovery, or closure-linkage work completes, exercises its occurrence is observed, and asserts the existing event/timeline surfaces identify its feature, relevant action/source, and bounded result without exposing entire evidence or intake bodies." | diff-local |
| Story 12.2 happy: Given standalone action commands run concurrently with attended or daemon work, when the repository timeline is read, then it includes their same-schema occurrences in timestamp order with the appropriate result rendering. | task-25 | "The integration fixture for readDaemonTimeline and daemon-observe CLI action event rendering supplies standalone action commands run concurrently with attended or daemon work, exercises the repository timeline is read, and asserts it includes their same-schema occurrences in timestamp order with the appropriate result rendering." | diff-local |
| Story 12.2 negative: Given state persistence fails, when the failure is reported, then no success occurrence claims the unpersisted transition. | task-26 | "The unit fixture for post-ship transition reporting through owning emitter/EventPersister supplies state persistence fails, exercises the failure is reported, and asserts no success occurrence claims the unpersisted transition." | diff-local |
| Story 12.2 negative: Given state is confirmed but telemetry persistence fails, when the command returns, then it reports the confirmed state plus telemetry unavailability and does not replay the mutation as though the decision failed. | task-26 | "The unit fixture for post-ship transition reporting through owning emitter/EventPersister supplies state is confirmed but telemetry persistence fails, exercises the command returns, and asserts it reports the confirmed state plus telemetry unavailability and does not replay the mutation as though the decision failed." | diff-local |
| Story 12.2 negative: Given a new occurrence has no registered sink or supported reader/rendering case, when event-contract validation runs, then it fails explicitly instead of allowing an invisible event family. | task-24 | "The unit fixture for ConductorEvent union and EVENT_SINKS exhaustiveness supplies a new occurrence has no registered sink or supported reader/rendering case, exercises event-contract validation runs, and asserts it fails explicitly instead of allowing an invisible event family." | diff-local |
| Story 13.1 happy: Given an intake-backed spec, when its author adds repeatable top-level `Closes-Also: owner/repo#N` declarations, then the originating `Source-Ref`, owner, retained outcomes, and extra targets survive normal marker rewrites and remain associated with that feature. | task-28 | "The integration fixture for writeIntakeMarker and closure declaration reader supplies an intake-backed spec, exercises its author adds repeatable top-level `Closes-Also: owner/repo#N` declarations, and asserts the originating `Source-Ref`, owner, retained outcomes, and extra targets survive normal marker rewrites and remain associated with that feature." | diff-local |
| Story 13.1 happy: Given a spec has no originating issue, when it declares valid additional targets, then the same target set reaches implementation publication without taking an origin-absent skip. | task-36 | "The integration fixture for common FINISH coordinator and production composition supplies a spec has no originating issue, exercises it declares valid additional targets, and asserts the same target set reaches implementation publication without taking an origin-absent skip." | diff-local |
| Story 13.1 negative: Given inbound issue text, a fenced example, or armored outcomes contain `Closes-Also` text, when declarations are parsed, then those embedded lines confer no closure authority. | task-28 | "The integration fixture for writeIntakeMarker and closure declaration reader supplies inbound issue text, a fenced example, or armored outcomes contain `Closes-Also` text, exercises declarations are parsed, and asserts those embedded lines confer no closure authority." | diff-local |
| Story 13.1 negative: Given no extra declarations exist, when an older feature is authored or published, then its originating-issue behavior is preserved without requiring new targets or manufacturing them from related prose. | task-29 | "The integration fixture for spec authoring/land marker producers and shared closure-target resolver supplies no extra declarations exist, exercises an older feature is authored or published, and asserts its originating-issue behavior is preserved without requiring new targets or manufacturing them from related prose." | diff-local |
| Story 13.2 happy: Given a committed approved closure declaration, when BUILD and automatic rebase/rebaseline occur, then publication uses that original approved target set while legitimate marker owner/outcome changes remain possible. | task-30 | "The integration fixture for protected-artifact seal closure descriptor and publication authority resolver supplies a committed approved closure declaration, exercises BUILD and automatic rebase/rebaseline occur, and asserts publication uses that original approved target set while legitimate marker owner/outcome changes remain possible." | diff-local |
| Story 13.2 happy: Given the operator intentionally revises the closure declarations through the existing explicit reseal workflow, when the approved revision is committed and used at publication, then only that newly authorized set replaces the prior projection. | task-32 | "The integration fixture for reseal CLI and scoped protected-artifact-seal writer supplies the operator intentionally revises the closure declarations through the existing explicit reseal workflow, exercises the approved revision is committed and used at publication, and asserts only that newly authorized set replaces the prior projection." | diff-local |
| Story 13.2 negative: Given BUILD adds, removes, or changes a target after the approved baseline, when publication compares active declarations with authorized provenance, then it refuses the changed projection with a DECIDE-owned correction diagnostic; automatic rebaseline cannot silently authorize it. | task-30 | "The integration fixture for protected-artifact seal closure descriptor and publication authority resolver supplies BUILD adds, removes, or changes a target after the approved baseline, exercises publication compares active declarations with authorized provenance, and asserts it refuses the changed projection with a DECIDE-owned correction diagnostic; automatic rebaseline cannot silently authorize it." | diff-local |
| Story 13.2 negative: Given an older seal has no closure descriptor and its original baseline cannot be verified/read, when added-target publication is requested, then it reports the missing provenance and does not derive authority from the current mutable marker. | task-31 | "The unit fixture for legacy seal descriptor derivation and authoritative closure resolver supplies an older seal has no closure descriptor and its original baseline cannot be verified/read, exercises added-target publication is requested, and asserts it reports the missing provenance and does not derive authority from the current mutable marker." | diff-local |
| Story 13.2 negative: Given a work-order manifest or provider-authored PR body names different targets, when authoritative linkage is calculated, then those values cannot replace or expand the approved declaration. | task-31 | "The unit fixture for legacy seal descriptor derivation and authoritative closure resolver supplies a work-order manifest or provider-authored PR body names different targets, exercises authoritative linkage is calculated, and asserts those values cannot replace or expand the approved declaration." | diff-local |
| Story 14 happy: Given fully qualified additional GitHub references with positive issue numbers, when validated, then each resolves to its canonical repository/issue identity and repeated aliases of the same identity produce one closure target. | task-27 | "The unit fixture for additional-closure target parser and canonical set projection supplies fully qualified additional GitHub references with positive issue numbers, exercises validated, and asserts each resolves to its canonical repository/issue identity and repeated aliases of the same identity produce one closure target." | diff-local |
| Story 14 happy: Given the origin is repeated among extras and two distinct repositories use the same issue number, when the set is normalized, then the origin appears once and the cross-repository issues remain distinct. | task-27 | "The unit fixture for additional-closure target parser and canonical set projection supplies the origin is repeated among extras and two distinct repositories use the same issue number, exercises the set is normalized, and asserts the origin appears once and the cross-repository issues remain distinct." | diff-local |
| Story 14 negative: Given an additional reference has a missing owner/repository, zero/negative or malformed number, unsupported Jira form, or arbitrary URL, when validation runs, then the invalid entry is named before any closing instructions are published. | task-27 | "The unit fixture for additional-closure target parser and canonical set projection supplies an additional reference has a missing owner/repository, zero/negative or malformed number, unsupported Jira form, or arbitrary URL, exercises validation runs, and asserts the invalid entry is named before any closing instructions are published." | diff-local |
| Story 14 negative: Given a PR body contains an unqualified `#42` for its own repository while an approved extra targets another repository's issue 42, when existing coverage is checked, then the local reference does not satisfy the cross-repository target. | task-33 | "The unit fixture for shared multi-target issue-reference body projector supplies a PR body contains an unqualified `#42` for its own repository while an approved extra targets another repository's issue 42, exercises existing coverage is checked, and asserts the local reference does not satisfy the cross-repository target." | diff-local |
| Story 15 happy: Given an origin and two distinct approved extras and an implementation PR targeting the repository default branch, when common FINISH publication completes in attended or daemon mode, then the actual PR body contains effective closing references for all three before final completion. | task-36 | "The integration fixture for common FINISH coordinator and production composition supplies an origin and two distinct approved extras and an implementation PR targeting the repository default branch, exercises common FINISH publication completes in attended or daemon mode, and asserts the actual PR body contains effective closing references for all three before final completion." | diff-local |
| Story 15 happy: Given a draft, body refresh, or publication retry already has some equivalent closing references and unrelated content, when the target projection is applied, then only missing linkage is added and unrelated body content/project-owned regions remain intact. | task-33 | "The unit fixture for shared multi-target issue-reference body projector supplies a draft, body refresh, or publication retry already has some equivalent closing references and unrelated content, exercises the target projection is applied, and asserts only missing linkage is added and unrelated body content/project-owned regions remain intact." | diff-local |
| Story 15 happy: Given the same target declarations are handed off in a spec PR, when its body is authored, then they appear as non-closing references and the spec workflow neither closes the issues directly nor adds closing instructions for them. | task-34 | "The integration fixture for engineer handoff/openSpecPr reference composition supplies the same target declarations are handed off in a spec PR, exercises its body is authored, and asserts they appear as non-closing references and the spec workflow neither closes the issues directly nor adds closing instructions for them." | diff-local |
| Story 15 negative: Given the implementation PR targets a non-default branch, when closure coverage is assessed, then it reports unsupported merge-closure coverage instead of claiming GitHub will close the targets. | task-35 | "The integration fixture for guarded batch issue-link publication adapter supplies the implementation PR targets a non-default branch, exercises closure coverage is assessed, and asserts it reports unsupported merge-closure coverage instead of claiming GitHub will close the targets." | diff-local |
| Story 15 negative: Given the PR cannot be identified/authorized or its current body cannot be read as valid data, when linkage is attempted, then the body is not replaced with an empty fallback and no unrelated PR or issue is mutated. | task-35 | "The integration fixture for guarded batch issue-link publication adapter supplies the PR cannot be identified/authorized or its current body cannot be read as valid data, exercises linkage is attempted, and asserts the body is not replaced with an empty fallback and no unrelated PR or issue is mutated." | diff-local |
| Story 15 negative: Given provider prose or a later body refresh removes a required link before FINISH completion, when final coverage is checked, then publication cannot claim completeness until the full approved set is re-observed on the actual PR. | task-36 | "The integration fixture for common FINISH coordinator and production composition supplies provider prose or a later body refresh removes a required link before FINISH completion, exercises final coverage is checked, and asserts publication cannot claim completeness until the full approved set is re-observed on the actual PR." | diff-local |
| Story 15 negative: Given an older watched-observation declaration exists for an origin or declared extra, when this implementation workflow publishes its approved target set, then that declaration cannot downgrade closing references to `Refs`, require a new observation marker or watch enrollment, or delay closure past merge; independently enrolled watches are untouched. | task-37 | "The integration fixture for common implementation closure policy projection supplies an older watched-observation declaration exists for an origin or declared extra, exercises this implementation workflow publishes its approved target set, and asserts that declaration cannot downgrade closing references to `Refs`, require a new observation marker or watch enrollment, or delay closure past merge; independently enrolled watches are untouched." | diff-local |
| Story 16 happy: Given publication has incomplete approved closure coverage, when FINISH retries after the dependency recovers, then it rereads the actual body, adds only missing authorized links, verifies the complete set, and leaves the declaration unchanged. | task-38 | "The integration fixture for FINISH closure transition resume path supplies publication has incomplete approved closure coverage, exercises FINISH retries after the dependency recovers, and asserts it rereads the actual body, adds only missing authorized links, verifies the complete set, and leaves the declaration unchanged." | diff-local |
| Story 16 happy: Given the body update succeeded before a process stopped, when FINISH resumes, then observed coverage completes recovery without duplicate instructions, direct issue-close calls, or assignee changes. | task-38 | "The integration fixture for FINISH closure transition resume path supplies the body update succeeded before a process stopped, exercises FINISH resumes, and asserts observed coverage completes recovery without duplicate instructions, direct issue-close calls, or assignee changes." | diff-local |
| Story 16 negative: Given read, guarded write, or verification fails due to network, permission, malformed response, or concurrent body edits, when FINISH reports its result, then it identifies incomplete/refused linkage and the affected targets without claiming verified success. | task-39 | "The integration fixture for FINISH publication failure classifier and linkage verification supplies read, guarded write, or verification fails due to network, permission, malformed response, or concurrent body edits, exercises FINISH reports its result, and asserts it identifies incomplete/refused linkage and the affected targets without claiming verified success." | diff-local |
| Story 16 negative: Given a linkage failure remains unresolved, when lifecycle recovery is selected, then it stays in the existing FINISH recovery path, creates no broad BUILD repair, preserves declarations and unrelated body content, and does not close unrelated issues. | task-39 | "The integration fixture for FINISH publication failure classifier and linkage verification supplies a linkage failure remains unresolved, exercises lifecycle recovery is selected, and asserts it stays in the existing FINISH recovery path, creates no broad BUILD repair, preserves declarations and unrelated body content, and does not close unrelated issues." | diff-local |
| Story 16 negative: Given one body write links only part of the declared set, when final verification runs, then the missing targets remain visible and publication is incomplete even if the originating issue was linked successfully. | task-39 | "The integration fixture for FINISH publication failure classifier and linkage verification supplies one body write links only part of the declared set, exercises final verification runs, and asserts the missing targets remain visible and publication is incomplete even if the originating issue was linked successfully." | diff-local |

## Architecture Obligation Coverage

All engine-parsed citable decisions in the eight non-deleted changed ADRs are dispositioned.
Task evidence is a verbatim check from a cited owner; dependencies and all cited checks carry the
full behavior. No-change rows preserve unchanged review/presentation authority rather than assign
historical unrelated work to this feature. The observed-close ADR gains a citable D5 for its
approved additive precedence note; its original non-citable numbered section headings remain intact.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-03-halt-pr-rehabilitation-at-finish#D1 | no-change | none | "Reader-facing title/body judgement stays in the existing FINISH prose dispatcher; issue projection preserves that prose and changes only missing engine-owned references." |
| adr-2026-07-03-halt-pr-rehabilitation-at-finish#D2 | task | task-36, task-33, task-35, task-38, task-39 | "The integration fixture for common FINISH coordinator and production composition supplies a spec has no originating issue, exercises it declares valid additional targets, and asserts the same target set reaches implementation publication without taking an origin-absent skip." |
| adr-2026-07-03-halt-pr-rehabilitation-at-finish#D3 | no-change | none | "This decision owns the legacy title-presentation facet; no new title policy is introduced. Independent closure completeness is the amended decision 2 obligation, carried by Tasks 35-39." |
| adr-2026-07-03-halt-pr-rehabilitation-at-finish#D4 | no-change | none | "Existing halt detection uses observed PR state in halt-pr-rehabilitation.ts and common FINISH; this feature adds no halt-origin ledger or classification rule." |
| adr-2026-07-10-observed-close-watch-registry#D5 | task | task-37, task-34, task-36 | "The integration fixture for common implementation closure policy projection supplies an older watched-observation declaration exists for an origin or declared extra, exercises this implementation workflow publishes its approved target set, and asserts that declaration cannot downgrade closing references to `Refs`, require a new observation marker or watch enrollment, or delay closure past merge; independently enrolled watches are untouched." |
| adr-2026-07-11-finish-step-engine-completion-machinery#D1 | task | task-36, task-35, task-38, task-39 | "The integration fixture for common FINISH coordinator and production composition supplies a spec has no originating issue, exercises it declares valid additional targets, and asserts the same target set reaches implementation publication without taking an origin-absent skip." |
| adr-2026-07-11-finish-step-engine-completion-machinery#D2 | no-change | none | "Existing retitle-floor/title prose behavior is outside the changed closure projection. The new FINISH transition preserves reader-facing body and existing presentation ownership." |
| adr-2026-07-11-finish-step-engine-completion-machinery#D3 | no-change | none | "Existing title/draft readiness checks remain in common FINISH. This feature adds verified issue linkage before ready, without changing halt detection or making title-only read errors proof of closure." |
| adr-2026-07-11-finish-step-engine-completion-machinery#D4 | no-change | none | "Recording-only retry is already narrowed by engine-owned FINISH publication; no new agent recording command or retry policy is introduced by action/closure state." |
| adr-2026-07-11-finish-step-engine-completion-machinery#D5 | no-change | none | "This records existing skill ownership of FINISH prose versus engine mechanics; it requires no new functional behavior or ordinary-documentation task in this feature." |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D1 | no-change | none | "Existing plan-done-when.ts and landSpec enforce the Done-when shape. This plan complies without changing land/discovery authority or the task-close evidence contract." |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D2 | no-change | none | "Rubric boundTo grammar and its later registered-rubric/security qualifications are upstream review authority. This feature consumes classified outcomes and introduces no rubric contract or new binding judgement." |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D3 | no-change | none | "Whether a finding is blocking remains with its owning rubric/adjudicator, including the later security qualification. Post-ship import cannot set a verdict or grant operator risk authority." |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D4 | task | task-8, task-7, task-11, task-12 | "The integration fixture for applyBuildReview local post-ship handoff effect supplies a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, exercises its source is durably handed off locally, and asserts review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge." |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D5 | task | task-20, task-21, task-22, task-23 | "The integration fixture for actions file command using guarded canonical intake service supplies an unlinked action with a complete inherited intake proposal or operator-supplied title and body, exercises the operator explicitly runs `actions file`, and asserts one sanitized issue is published through the configured guarded intake workflow, its reference is retained, and the action's resolution stays unchanged." |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria#D6 | task | task-40, task-24, task-25 | "The integration fixture for production capture/import/resolve/file/recover and FINISH result event adapters supplies capture, resolution, publication, recovery, or closure-linkage work completes, exercises its occurrence is observed, and asserts the existing event/timeline surfaces identify its feature, relevant action/source, and bounded result without exposing entire evidence or intake bodies." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | no-change | none | "Independent rubric judgement and the raw aggregate join remain in build-review-aggregate.ts; capture subscribes only after classification and cannot alter that join." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | no-change | none | "Existing operator accepted-risk authority stays in build-review-dispositions.ts; post-ship resolution is a separate collection and cannot broaden or replace dispositions." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | no-change | none | "Existing coordinator owns the single remediate dispatch and bounded prior-case context. No additional judge is introduced; changed effect vocabulary is carried by Task 10." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | task | task-8, task-10 | "The integration fixture for applyBuildReview local post-ship handoff effect supplies a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, exercises its source is durably handed off locally, and asserts review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-1, task-2, task-3, task-7 | "The unit fixture for RemediationCaseStore.read/mutate supplies existing version-1 or version-2 review state, exercises new action-related state is written, and asserts all prior cases, effects, suppressions, PRD relationships, history, and feature identity retain their meanings on a fresh read." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | task | task-8, task-9, task-20, task-21, task-22, task-23 | "The integration fixture for applyBuildReview local post-ship handoff effect supplies a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, exercises its source is durably handed off locally, and asserts review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-10, task-9 | "The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an exact source recurs after a confirmed local handoff, exercises effective verdict, recurrence, or clean-PASS reconciliation runs, and asserts it remains settled without another judge session solely for that source, and optional publication state does not reopen it." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | task | task-10, task-8 | "The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an exact source recurs after a confirmed local handoff, exercises effective verdict, recurrence, or clean-PASS reconciliation runs, and asserts it remains settled without another judge session solely for that source, and optional publication state does not reopen it." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-40, task-24 | "The integration fixture for production capture/import/resolve/file/recover and FINISH result event adapters supplies capture, resolution, publication, recovery, or closure-linkage work completes, exercises its occurrence is observed, and asserts the existing event/timeline surfaces identify its feature, relevant action/source, and bounded result without exposing entire evidence or intake bodies." |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | no-change | none | "The existing adjudication.enabled rollout flag and legacy SHIP/stall artifact parsing remain unchanged. This feature adds no replacement rollout switch or removal task." |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | "The current coordinator distinguishes infrastructure-only from mixed laps; new local handoff cannot reclassify infrastructure or charge a new semantic attempt." |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | "The existing remediate judgement remains the only semantic fan-in and policy-consistency/admission authority. Capture adds no review dispatch or autonomous operator waiver." |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-10, task-8, task-9 | "The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an exact source recurs after a confirmed local handoff, exercises effective verdict, recurrence, or clean-PASS reconciliation runs, and asserts it remains settled without another judge session solely for that source, and optional publication state does not reopen it." |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | "Existing confidence validation/floor/suppression identity remains unchanged; source capture retains suppression uncertainty without claiming correctness or accepted risk." |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-10, task-9 | "The integration fixture for build-review settlement predicates, reducer and Conductor clean-PASS reconciliation supplies an exact source recurs after a confirmed local handoff, exercises effective verdict, recurrence, or clean-PASS reconciliation runs, and asserts it remains settled without another judge session solely for that source, and optional publication state does not reopen it." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | no-change | none | "accepted-widenings operator decisions and autonomous prd_widening relationships retain separate authority. Post-ship action decisions are neither of those records and grant no PRD acceptance." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | task | task-1, task-2, task-3 | "The unit fixture for RemediationCaseStore.read/mutate supplies existing version-1 or version-2 review state, exercises new action-related state is written, and asserts all prior cases, effects, suppressions, PRD relationships, history, and feature identity retain their meanings on a fresh read." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | no-change | none | "prd-widening-capture.ts and prd-widening-offers.ts already capture explicit accept/refuse before reconciliation. Inbox capture reads classified evidence and does not change offer or decision capture." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | "Existing PRD migration preserves legacy decisions through prd-widening-migration.ts. The new v3 case-envelope write preserves those records; it adds no PRD decision-format migration." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | no-change | none | "prd-widening-coordinator.ts remains the only same-case/different/uncertain judgement for current NC findings. Historical inbox replay uses retained identity and does not invoke that judgement." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | no-change | none | "Existing provider native schemas and typed as-built/rubric contracts retain their dispatch and validation ownership. This feature reads validated typed records and adds no provider capability or output schema." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | no-change | none | "Existing PRD input/retry bounds remain in prd-widening-context.ts/coordinator.ts; the new repository-action limits do not constrain live gate control or reset its allowances." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | no-change | none | "prd-widening-classification.ts/coordinator.ts keep freshness and authoritative decision binding; action resolution never alters effective PRD verdicts or stale-result refusal." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | no-change | none | "Existing PRD recovery/occurrences retain their current owners. Added action occurrences are a distinct domain on the same event spine under the new ADR D9, not a replacement PRD recovery path." |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | "The prior feature delivery/architectural-correction record adds no new obligation here. Its shared-case storage amendment is carried by D2; no cross-gate equivalence or NC confidence floor is introduced." |
| adr-2026-09-30-durable-post-ship-action-cases#D1 | task | task-1, task-2, task-3 | "The unit fixture for RemediationCaseStore.read/mutate supplies existing version-1 or version-2 review state, exercises new action-related state is written, and asserts all prior cases, effects, suppressions, PRD relationships, history, and feature identity retain their meanings on a fresh read." |
| adr-2026-09-30-durable-post-ship-action-cases#D2 | task | task-4, task-5, task-6, task-15, task-19 | "The integration fixture for build-review adjudication coordinator capture boundary and action importer supplies a consumed build-review result has a justified deferral, an explicitly upheld residual of a refutation, accepted risk, or confidence suppression, exercises its source is captured and collected, and asserts the feature action view contains the outstanding concern with that specific classification and original identity." |
| adr-2026-09-30-durable-post-ship-action-cases#D3 | task | task-7, task-18 | "The unit fixture for post-ship source importer supplies one captured source appears again through retry, terminal collection, and historical recovery, exercises each is processed, and asserts exactly one action retains all distinct source links and no duplicate action is created." |
| adr-2026-09-30-durable-post-ship-action-cases#D4 | task | task-16, task-3, task-13, task-14, task-15, task-17, task-19, task-20, task-21, task-22, task-23 | "The integration fixture for actions resolve command and action transition service supplies an open action, exercises `actions resolve` names it as acted-on with a reason or follow-up reference, and asserts a fresh process reads acted-on with the reason, machine-resolved operator, and ordered revision." |
| adr-2026-09-30-durable-post-ship-action-cases#D5 | task | task-8, task-9, task-10 | "The integration fixture for applyBuildReview local post-ship handoff effect supplies a valid adjudicated deferral or upheld refutation remainder and otherwise satisfied review, exercises its source is durably handed off locally, and asserts review can PASS with inspectable source/effect evidence, no remote request, no appended plan task, and no remediation charge." |
| adr-2026-09-30-durable-post-ship-action-cases#D6 | task | task-11, task-12 | "The integration fixture for FeatureTerminalEffects collection and attended outer execution return supplies a feature produces source observations, exercises attended return or daemon terminal collection receives a done, halted, error, or parked result with valid observations, and asserts repository actions are retained outside the disposable worktree; shipped source evidence supports recovery after an interrupted collection and normal cleanup." |
| adr-2026-09-30-durable-post-ship-action-cases#D7 | task | task-20, task-21, task-22, task-23 | "The integration fixture for actions file command using guarded canonical intake service supplies an unlinked action with a complete inherited intake proposal or operator-supplied title and body, exercises the operator explicitly runs `actions file`, and asserts one sanitized issue is published through the configured guarded intake workflow, its reference is retained, and the action's resolution stays unchanged." |
| adr-2026-09-30-durable-post-ship-action-cases#D8 | task | task-17, task-18, task-19, task-6, task-7 | "The integration fixture for actions recover command and post-ship recovery service supplies a shipped record contains sufficient modern source snapshots or supported legacy structured findings, exercises `actions recover` runs after worktree removal, and asserts eligible concerns appear with their retained provenance and no reviewer, provider, or BUILD invocation occurs." |
| adr-2026-09-30-durable-post-ship-action-cases#D9 | task | task-40, task-24, task-25, task-26 | "The integration fixture for production capture/import/resolve/file/recover and FINISH result event adapters supplies capture, resolution, publication, recovery, or closure-linkage work completes, exercises its occurrence is observed, and asserts the existing event/timeline surfaces identify its feature, relevant action/source, and bounded result without exposing entire evidence or intake bodies." |
| adr-2026-09-30-durable-post-ship-action-cases#D10 | task | task-30, task-27, task-28, task-29, task-31, task-32, task-34 | "The integration fixture for protected-artifact seal closure descriptor and publication authority resolver supplies a committed approved closure declaration, exercises BUILD and automatic rebase/rebaseline occur, and asserts publication uses that original approved target set while legitimate marker owner/outcome changes remain possible." |
| adr-2026-09-30-durable-post-ship-action-cases#D11 | task | task-36, task-33, task-35, task-37, task-38, task-39 | "The integration fixture for common FINISH coordinator and production composition supplies a spec has no originating issue, exercises it declares valid additional targets, and asserts the same target set reaches implementation publication without taking an origin-absent skip." |
| adr-2026-09-30-durable-post-ship-action-cases#D12 | no-change | none | "All specified predecessor corrections are applied in this DECIDE diff with operator approval; BUILD performs no protected-artifact amendment. The clean conflict report records the resolved precedence and unchanged scope." |

## Verification and claims

- All 97 accepted happy/negative criteria have a primary behavioral owner and exact completion check.
- Dependency traversal is acyclic; each task has 2–5 physical-line Done-when checks and explicit files.
- Production boundary owners are identified above; helper fixtures alone cannot close those tasks.
- No task modifies another feature's sealed DECIDE artifact, adds ordinary documentation work, or
  acts as a terminal catch-all validation task. No tests, implementation or release files are authored here.
- Existing seams and paths were verified against the inspected source. New post-ship modules, action
  CLI and closure-target module are explicit planned additions, not claims of existing implementation.
- Conflict precedence is operator-confirmed. No unconfirmed architecture/product assumption is used.
- Independent coverage judgement: 97 of 97 claims `asserts`, zero refusals, first round.
  A fresh agent received only the exact criteria and cited Done-when checks under the
  coverage-binding policy; this verifies planned assertion coverage, not executed behavior.
- Engine parsers validated 97 criterion rows, 40 task/path sets and 53 citable ADR decisions;
  there are no missing/duplicate rows, ungrounded quotes or architecture-bookkeeping violations.
- `ai-conductor plan-protected-targets` reports: `No protected-target violations found.`
- All six plan-updated Mermaid diagrams passed the browser render check.
- Feature-document relative links and whitespace pass; task dependency traversal is acyclic.
- Plan and updated diagrams approved by the operator on 2026-09-30; coherence review follows.

### Advisory overlap scan

The full task Files union was scanned with source ref `jstoup111/ai-conductor#1810`. The initial
sandbox network attempt was indeterminate; the read-only retry completed with this report:

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/daemon-cli.ts, src/conductor/src/engine/conductor.ts
Note: renames or name-only diffs may not be detected by this scan.
```

These are advisory sibling-ref overlaps. Recheck these contracts at BUILD entry; the scan does
not prove local remote-tracking refs are current.

### Coherence review refinements

After plan approval, coherence review made five already-approved architecture obligations explicit
in Tasks 1, 8, 11, 13 and 30: migration write ordering and scope schema, atomic source/effect
handoff, release-before-import ordering, command/worker authorization, and committed closure seal
fields. Existing Done-when checks and all 97 criteria remain unchanged; these are additional
completion checks, with no new task, product outcome or architectural choice. D2, D4 and D8 now
also cite their existing context, recovery and publication proof owners. The fresh independent check returned `asserts` for all 11 changed criterion bindings; the other
86 passed pairs are unchanged and reused under coherence-check §4a.
