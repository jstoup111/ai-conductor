# Implementation Plan: Ownership across harness GitHub operations

**Date:** 2026-09-11
**Stories:** .docs/stories/enforce-ownership-across-all-harness-github-operat.md
**Architecture:** .docs/decisions/adr-2026-09-11-github-operation-ownership.md
**Conflict check:** Clean after operator-approved D8 supersession, 2026-09-11.
**Tier:** L
**Source-Ref:** jstoup111/ai-conductor#2516

## Summary

Extend the canonical GitHub boundary with shared operation authorization and apply it to remote Git writes. All supported harness callers must reach the gate; local Git behavior remains outside this feature. Twenty-four tasks implement the policy, caller integrations, operator-facing guarded command, refusal reporting, and executable invocation audit.

## Technical Approach

Use typed requests with canonical repository/resource targets and explicit read/write operation registration. Keep TrackerClient backend-neutral and its GitHub transport injectable. The private raw transports cannot be imported as a mutable bypass by production callers. Mutation policy composes the existing machine identity resolver, strict committed provenance, current pre-spec assignment, exact operator confirmation, or an internal creation-transaction capability as appropriate.

Read operations remain available for discovery; unknown operations are not reads. Authorization is computed per request and retry. The result discriminates executed, refused, failed, and partial; callers cannot turn refusal into success or a fallback remote write. Remote Git requests resolve the complete destination set before any push or deletion. Existing validation, intent, ready/draft, and force-with-lease constraints still apply.

Add the guarded github-operation command only for the closed operation vocabulary required by existing harness workflows. Explicit approval is an injectable operator confirmation over one canonical request, not an arbitrary approval flag or an expansion of unattended publication authority. Noninteractive callers without that authority receive a refusal. The cooperative ownership guarantee covers supported harness operations; it is not a general OS/network sandbox.

Local pattern basis: tracker-client.ts's canonical injectable GhRunner and factory separate real execution from fake transport tests; pr-labels.ts and finish-publication-production.ts compose behavior through injected adapters. Preserve those testable boundaries and existing failure semantics, adding typed refusal instead of duplicate runner implementations. Reuse PublicationIntent's explicit operator_confirmed versus unattended_policy distinction without treating it as general resource permission. Each integration task below uses the same injected terminal boundary, not real third-party calls.

## Prerequisites and boundaries

The approved story/ADR set and corrected historical writeback assertions are already authored in DECIDE. No task changes another feature's protected artifacts. No task removes a production directory. No task edits VERSION or CHANGELOG. General local Git consolidation is separate intake #2517.

The operation inventory must cover current shipped TypeScript entry points, maintained executable skill publication commands, and launchers/helpers that invoke GitHub or remote Git writes. Static historical prose is not executable scope. An undiscovered in-scope path belongs to its behavior-owning integration task, not a generic last-minute repair task.

Tests use real policy/caller composition with fake GitHub and process boundaries. Real Git semantics, where necessary, use only fixture-owned local repositories and remotes. Prove a fake process boundary is reached before destructive arguments; removing the guard in counterfactual review must not expose operator resources.

## Tasks

### Task 1: Define closed operation requests and results

**Story:** Story 3
**Story:** Story 8
**Type:** infrastructure

**Steps:**
1. Add scoped failing unit and adapter coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Define discriminated read, feature-write, intake-write, create, shared-write, and remote-ref-write requests, canonical target types, and executed/refused/failed/partial results. Refusal reasons include other-owner, unresolved-actor, missing-provenance, conflicting-provenance, invalid-target, unsupported-operation, and explicit-authorization-required. Add an operation registry covering the current invocation inventory; raw requests cannot assert that they are reads.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- The github-operations request decoder accepts registered read/write shapes and rejects unknown operation names, missing context, and malformed payloads as typed refusals before transport invocation.
- The operation result union represents executed, refused, failed, and partial creation outcomes without treating a refusal or partial metadata failure as success.

**Files:** `src/conductor/src/engine/github-operations.ts`, `src/conductor/test/engine/github-ownership/1-define-closed-operation-requests-and-results.test.ts`
**Dependencies:** none

### Task 2: Resolve canonical repository and resource targets

**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Add scoped failing unit and adapter coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Resolve explicit repository/URL/PR/ref identity at the boundary, using existing canonical source-ref parsing and remote repository discovery. Compare canonical repository plus resource identity, never cwd alone. Reject cross-repository target conflicts and ambiguous aliases.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- resolveGithubTarget turns supported URL/ref inputs into repository-bound resource identities and rejects malformed or ambiguous inputs before any mutation, including failed or timed-out discovery reads.
- Authorization target matching compares repository and resource together; identical branch names in different repositories cannot reuse a decision.

**Files:** `src/conductor/src/engine/github-target.ts`, `src/conductor/test/engine/github-ownership/2-resolve-canonical-repository-and-resource-targets.test.ts`
**Dependencies:** Task 1

### Task 3: Read committed feature ownership without first-match ambiguity

**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Add scoped failing unit and adapter coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Reuse committed intake marker discovery, adding a strict mutation reader distinct from dispatch eligibility. Parse all owner lines. Use default-branch evidence for merged specs and committed spec-branch evidence for initial publication. Return missing/conflicting/read-failed distinctly; do not infer ownership from PR author, git author, marker, or shipment alone.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- readMutationProvenance resolves committed default/spec-branch ownership and reports missing, conflicting, duplicate-contradictory, unreadable, or timed-out evidence without granting permission.
- The strict provenance reader never treats a halt marker, branch prefix, shipment record, or first contradictory Owner line as authorization.

**Files:** `src/conductor/src/engine/owner-gate/mutation-provenance.ts`, `src/conductor/test/engine/github-ownership/3-read-committed-feature-ownership-without-first-match-ambiguity.test.ts`
**Dependencies:** Task 2

### Task 4: Compose machine identity with feature authorization

**Story:** Story 1
**Story:** Story 8
**Type:** infrastructure

**Steps:**
1. Add scoped failing unit and adapter coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Call the existing machine-scoped resolver lazily for attempted mutations. Compare the normalized operator to strict provenance. Keep dispatch policy independent. Produce a target/operation-bound decision for each attempt, not a reusable boolean.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- authorizeGithubMutation uses machine user configuration before authenticated login, permits a matching committed owner, and never takes identity from shared project configuration.
- authorizeGithubMutation refuses other-owner, unresolved actor, missing/conflicting provenance, or evidence failure with distinct reasons and zero mutating transport calls.
- A second authorization attempt resolves current identity/evidence again; an earlier decision cannot authorize a changed actor, operation, repository, target, or retry.

**Files:** `src/conductor/src/engine/owner-gate/mutation-policy.ts`, `src/conductor/test/engine/github-ownership/4-compose-machine-identity-with-feature-authorization.test.ts`
**Dependencies:** Task 3

### Task 5: Bind explicit operator approval to one request

**Story:** Story 4
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Add scoped failing unit and adapter coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Add an injectable explicit-approval callback to the guarded command composition, following PublicationIntent's operator_confirmed distinction without treating publication intent as blanket approval. Present canonical actor/repository/resource/operation and payload digest. Only a positive callback for this exact request produces an internal approval capability; default absent/declined/noninteractive callback refuses. Capability cannot be supplied as a raw request owner string or generic ignore flag.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- The explicit-approval adapter permits one exact pre-spec issue or shared-resource request after positive operator confirmation, binding actor, repository, target, operation, and payload.
- The approval adapter refuses absent/declined authority and mismatched issue, repository, resource, operation, or payload; ordinary feature publication intent is not shared administration authority.

**Files:** `src/conductor/src/engine/github-operation-approval.ts`, `src/conductor/test/engine/github-ownership/5-bind-explicit-operator-approval-to-one-request.test.ts`
**Dependencies:** Task 4

### Task 6: Install guarded execution at the canonical GitHub boundary

**Story:** Story 3
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Separate private process execution from public guarded operations while retaining canonical injectable transport shape. Recognized read operations go directly to the read transport; all mutation variants go through policy. Never forward arbitrary gh argv as a mutable escape hatch. Fake the terminal process boundary before destructive test inputs; prove isolation with the production authorization guard removed.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- The production GitHub composition executes registered discovery/ownership reads for foreign resources but routes every registered mutation through authorizeGithubMutation before the private transport.
- Unknown operations and missing authorization context are refused by guarded execution rather than defaulting to read access or a raw argv fallback.
- A transport-spy fixture confirms the production composition reaches a fake process boundary, and remains isolated from real gh/network execution even when the authorization guard is absent.

**Files:** `src/conductor/src/engine/tracker-client.ts`, `src/conductor/src/engine/github-operations.ts`, `src/conductor/test/engine/github-ownership/6-install-guarded-execution-at-the-canonical-github-boundary.test.ts`
**Dependencies:** Task 1, Task 4, Task 5

### Task 7: Migrate issue operations through guarded requests

**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Adapt TrackerClient issue comments, create, edit/body, close, labels, dependencies, and reads to structured operations. Preserve backend-neutral public operation semantics and canonical GitHub implementation. Combine needed ownership fields with existing issue-state reads where possible. Reads do not gain write authority.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- GitHubTrackerClient issues structured requests for its complete existing issue mutation inventory; fake-boundary integration proves authorized effects and zero foreign-target effects for comments, edits, close, labels, and dependency writes.
- TrackerClient read methods still return foreign-resource data without creating an authorization capability or an extra mutation.

**Files:** `src/conductor/src/engine/tracker-client.ts`, `src/conductor/test/engine/github-ownership/7-migrate-issue-operations-through-guarded-requests.test.ts`
**Dependencies:** Task 6

### Task 8: Migrate PR primitives and separate label definitions

**Story:** Story 3
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Wire PR create/edit/comment/ready/label helpers to guarded operations, retaining marker-edit idempotency and no duplicate-create fallback. Separate add/remove label on a resource from ensureLabel definition creation/update. Existing definitions require no mutation. Preserve existing operation failures and add typed refusal outcomes for callers.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- PR primitives execute authorized title/body/comment/state/label operations and return refusal without transport writes for foreign resources; marker edit failure never triggers duplicate comment creation.
- Applying an existing label through pr-labels changes only the authorized issue/PR association; it performs no label-definition color or description write.
- ensureLabel routes missing/create/update definitions as shared-resource requests and returns explicit-authorization-required without force-creating or force-updating them when permission is absent.

**Files:** `src/conductor/src/engine/pr-labels.ts`, `src/conductor/test/engine/github-ownership/8-migrate-pr-primitives-and-separate-label-definitions.test.ts`
**Dependencies:** Task 6

### Task 9: Gate halt reconciliation healing and cleanup

**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Integrate ownership before both ensureHaltPresentation and cleanupHaltPresentation/upsertComment. Preserve shipment selection, caching of presentation outcomes, and per-item continuation, but never cache authorization. Add the two-operator reproduction directly through reconcileHaltPrs.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- reconcileHaltPrs restores label/draft presentation for an authorized halted PR and clears stale halt presentation plus updates its comment for an authorized shipped PR.
- The reconciliation fixture records no label, body, comment, or draft mutation for foreign PRs in either healing or shipped-cleanup paths, including unknown ownership with only marker/branch/shipment hints.
- One refused PR in a mixed sweep does not prevent a later authorized PR from being reconciled, and refusal is never cached as healed or cleared.

**Files:** `src/conductor/src/engine/halt-pr-reconciliation.ts`, `src/conductor/test/engine/github-ownership/9-gate-halt-reconciliation-healing-and-cleanup.test.ts`
**Dependencies:** Task 8

### Task 10: Preserve local gated visibility without foreign announcements

**Story:** Story 3
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Apply D8 at announceGatedPr/announceGatedIssue, preserving local-before-remote ordering and no-target skip verbosity. Use independent issue authorization. Return denied outcomes without adding owner-gated labels or comments to foreign resources; preserve authorized marker semantics.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Gate-writeback integration records GATED local visibility before any authorized remote action and records zero label/comment mutations for other-owner PRs and independently unauthorized source issues.
- Authorized gate announcements retain marker upserts and per-surface best-effort behavior; denied announcements produce no escalation write and do not change existing no-target skip verbosity.

**Files:** `src/conductor/src/engine/gate-writeback.ts`, `src/conductor/test/engine/github-ownership/10-preserve-local-gated-visibility-without-foreign-announcements.test.ts`
**Dependencies:** Task 8

### Task 11: Carry refusal through halt rehabilitation

**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Propagate typed refusals through presentation repair, title/body rewrites, clear-at-resume, and ready transitions. Preserve existing preserveDraft and finish-only ready boundaries. Do not treat denied work as confirmed or use recovery calls to bypass policy.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Halt rehabilitation and resume integration execute authorized title/body/marker/label changes while preserving the existing resume draft state and finish-only ready transition.
- Foreign-target or missing-permission results remain refusals through rehabilitation catch/retry paths, with no successful-clear result and no unauthorized escalation comment.

**Files:** `src/conductor/src/engine/halt-pr-rehabilitation.ts`, `src/conductor/test/engine/github-ownership/11-carry-refusal-through-halt-rehabilitation.test.ts`
**Dependencies:** Task 8

### Task 12: Authorize halt issue stamping and closure

**Story:** Story 3
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Route stamp/comment/close through guarded issue operations after local closure eligibility. Preserve recurrence and keep-open checks, steady-state zero remote calls, and per-entry failures. Include assignment/provenance fields in the existing issue read for actual mutations.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Halt-issue sweep integration performs authorized stamping/comment/closure only after existing closure eligibility and independent issue authorization; foreign or unresolved issues remain unchanged.
- Steady-state halt sweeps make zero GitHub calls, while refused eligible entries neither record closed success nor trigger an alternate comment/write.

**Files:** `src/conductor/src/engine/halt-issues/closer.ts`, `src/conductor/src/engine/halt-issues/sweep.ts`, `src/conductor/test/engine/github-ownership/12-authorize-halt-issue-stamping-and-closure.test.ts`
**Dependencies:** Task 7

### Task 13: Gate intake writeback by independent assignment evidence

**Story:** Story 4
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Resolve current assignment for pre-spec issues, allowing only exclusive normalized operator assignment or exact explicit authorization. Preserve existing assignees and source-ref routing. Revalidate each retry. Cover route/handled/comment/close paths, including cleanup and forget; a linked owned feature supplies no unrelated-issue authority.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Intake writeback permits exclusive operator assignment or exact explicit issue authorization and preserves the issue's assignees on success and refusal.
- Absent, foreign, or multiple distinct assignees are refused without explicit approval; mismatched approval and independently unauthorized linked issues produce zero issue writes.
- A retry reads current assignment/evidence and refuses after reassignment or lookup failure instead of reusing an earlier permission.

**Files:** `src/conductor/src/engine/engineer/intake/writeback.ts`, `src/conductor/src/engine/engineer/intake/github-issues.ts`, `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/engine/github-ownership/13-gate-intake-writeback-by-independent-assignment-evidence.test.ts`
**Dependencies:** Task 7, Task 5

### Task 14: Implement transaction-scoped creation authority

**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Add scoped failing unit and adapter coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Create an internal creation context only for resolved operator plus explicit intake action or authorized feature intent and destination. Bind the returned canonical new issue to same-transaction metadata operations. Reject malformed/unrelated creation responses. End context after the transaction; no persisted universal permission.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Creation authorization admits an identified operator's explicit intake or authorized feature creation only in the bound repository and refuses unresolved identity or unauthorized destinations before creation.
- The creation context binds immediate metadata writes to the canonical returned issue; ambiguous responses report partial creation and cannot authorize guessed targets.
- Creation context cannot authorize a different target or a later run; fresh ownership or explicit authorization is then required.

**Files:** `src/conductor/src/engine/github-creation-context.ts`, `src/conductor/test/engine/github-ownership/14-implement-transaction-scoped-creation-authority.test.ts`
**Dependencies:** Task 6

### Task 15: Wire intake filing and metadata follow-ups

**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Use creation context around fileIntakeIssue and the CLI composition. Label associations and dependency metadata use returned new-resource identity; reading a dependency creates no authority over it. Preserve scrub, size/priority handling, and precise partial-success output.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- fileIntakeIssue integration creates an authorized issue and applies immediate size/priority labels and dependency metadata only to that returned issue; a foreign dependency receives no independent mutation.
- The filing result reports the created URL plus failed/refused metadata accurately after partial failure, and performs no guessed follow-up after an ambiguous creation response.

**Files:** `src/conductor/src/engine/engineer/intake/file-issue.ts`, `src/conductor/src/intake-file-cli.ts`, `src/conductor/test/engine/github-ownership/15-wire-intake-filing-and-metadata-follow-ups.test.ts`
**Dependencies:** Task 7, Task 14

### Task 16: Authorize initial composer/spec publication

**Story:** Story 5
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Before push and PR creation, resolve committed spec-branch ownership rather than requiring the not-yet-merged marker on default. Keep guarded push and PR identity binding. Maintain non-closing source refs and keep-on-failure outcomes; no ledger delivery stamp if publication is refused.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Composer handoff integration publishes an owned unmerged spec branch and creates its PR using committed spec-branch provenance; unresolved identity or unauthorized destination causes zero push and zero PR creation.
- Handoff refusal preserves local work and reports failure without a delivered ledger record, successful-push claim, or raw publication fallback.

**Files:** `src/conductor/src/engine/engineer/handoff.ts`, `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/engine/github-ownership/16-authorize-initial-composer-spec-publication.test.ts`
**Dependencies:** Task 8, Task 19

### Task 17: Route shared-resource administration through explicit approval

**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Register only existing supported shared administration operations and label-definition variants. Resolve exact target before approval. Do not add new workflow/release administration capabilities merely to populate the registry; unknown variants refuse. No daemon request inherits admin authority from feature permission.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- The shared-operation entry point executes an existing supported administration operation only with exact scoped operator approval, and refuses mismatched resource/operation authority.
- A daemon's feature ownership never authorizes label-definition creation/update or registered repository/workflow administration; a missing label returns explicit-authorization-required without force write.
- Transport failure remains failed or partial in the shared-operation result and cannot be reported as successful administration.

**Files:** `src/conductor/src/engine/github-shared-operations.ts`, `src/conductor/src/engine/tracker-client.ts`, `src/conductor/test/engine/github-ownership/17-route-shared-resource-administration-through-explicit-approval.test.ts`
**Dependencies:** Task 5, Task 8

### Task 18: Resolve remote Git destination sets

**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Add scoped failing unit and adapter coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Normalize explicit push/delete requests into canonical repository and destination refs using Git remote configuration. Recognize explicit single/multi refspecs, reject wildcard/mirror/all/tags and ambiguous implicit destinations. Preserve local Git runner behavior; generic local calls do not enter mutation policy.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- resolveRemoteGitTargets resolves every explicit destination ref and canonical remote repository before authorization, and rejects ambiguous implicit, wildcard, broad/all/tags, or mirror requests before execution.
- Local status, diff, commit, and worktree calls remain on existing runners with no added ownership reads, events, or remote writes from this adapter.

**Files:** `src/conductor/src/engine/remote-git-targets.ts`, `src/conductor/test/engine/github-ownership/18-resolve-remote-git-destination-sets.test.ts`
**Dependencies:** Task 2

### Task 19: Guard push and named remote deletion

**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Preauthorize the whole resolved target set before invoking Git. Preserve caller force restrictions; use existing force-with-lease behavior only where already allowed. Never convert lease rejection to plain force. Deletion remains named and separately authorized under existing deletion policy.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- executeRemoteGit authorizes every resolved destination before a single push/delete invocation; one unauthorized ref refuses the entire request with zero writes, regardless of the local worktree owner.
- Owned explicit pushes update only requested refs and authorized named deletion removes only its named ref, as proven with fixture-owned local Git repositories.
- A force-with-lease rejection returns failure with no unleased force fallback or retry through an unguarded runner.

**Files:** `src/conductor/src/engine/remote-git-operations.ts`, `src/conductor/test/engine/github-ownership/19-guard-push-and-named-remote-deletion.test.ts`
**Dependencies:** Task 4, Task 18

### Task 20: Migrate halt and repair push entry points

**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Replace each direct push entry with the guarded remote operation using explicit destination resolution. Preserve local commit/record creation. Parameterized caller fixtures prove exact entry-point behavior for halt recording, build escalation, repair publication, conductor push, and shipment evidence.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Each halt-record, build-failure escalation, autoresolve repair, conductor push, and shipment-evidence entry point reaches executeRemoteGit with explicit targets and can perform its authorized publication.
- Those five entry points retain refusal/failure without recording pushed success or invoking raw push, unauthorized escalation comments, or unleased fallback.

**Files:** `src/conductor/src/engine/halt-record.ts`, `src/conductor/src/engine/build-failure-escalation.ts`, `src/conductor/src/engine/autoresolve.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/shipment-evidence-cli.ts`, `src/conductor/test/engine/github-ownership/20-migrate-halt-and-repair-push-entry-points.test.ts`
**Dependencies:** Task 19

### Task 21: Wire finish publication without false progress

**Story:** Story 3
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Use guarded remote writes and GitHub operations in finish composition and ship draft creation. Preserve validation/current-head/intent fences and observe-after-effect semantics. Map refusal to actionable non-success disposition; no progress dimension advances solely because a helper returned.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- Finish/ship-draft production integration publishes and repairs authorized resources through guarded transports while retaining existing validation, intent, current-head, and post-write observation fences.
- Ownership refusal leaves publication incomplete with an actionable disposition; it records neither pushed/healed/ready success nor progress and performs no alternative escalation write.

**Files:** `src/conductor/src/engine/ship-draft-pr.ts`, `src/conductor/src/engine/finish-publication-production.ts`, `src/conductor/src/engine/finish-publication.ts`, `src/conductor/test/engine/github-ownership/21-wire-finish-publication-without-false-progress.test.ts`
**Dependencies:** Task 11, Task 19

### Task 22: Expose guarded CLI operations to supported hosts

**Story:** Story 8
**Story:** Story 4
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Add ai-conductor github-operation --request-file for the closed operation request schema, with result JSON and refused/error exit status. Wire an injectable per-request confirmation callback using existing operator-confirmed intent pattern; default noninteractive execution without supplied trusted confirmation cannot grant explicit permission. Migrate executable PR/composer publication instructions to this command and engine primitives. Never accept raw gh/git argv as a mutable escape.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- The index.ts guarded command dispatch decodes a request file, invokes the same engine policy, and returns executed/refused/failed/partial results with canonical target and a non-success exit for refusal.
- Both supported host publication workflows invoke guarded CLI/engine operations instead of raw GitHub or remote Git writes; explicit request confirmation binds only that operation and no host-specific hook supplies authority.

**Files:** `src/conductor/src/engine/github-operations-cli.ts`, `src/conductor/src/index.ts`, `skills/pr/SKILL.md`, `skills/composer/SKILL.md`, `src/conductor/test/engine/github-ownership/22-expose-guarded-cli-operations-to-supported-hosts.test.ts`
**Dependencies:** Task 6, Task 17, Task 19

### Task 23: Emit and render canonical ownership refusals

**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Add a ConductorEvent variant for mutation refusal, carrying operator, canonical target, operation, and typed reason/remedy without secrets or full request bodies. Inject existing emitter at composition; persist/render through current infrastructure. Standalone result renderer uses same reason data. Event failures do not change denied execution.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- A refused daemon operation emits a canonical ConductorEvent whose persisted/rendered form identifies target, operation, reason, and remedy; the standalone result renders the same reason without inventing a success.
- If event persistence or rendering fails after denial, guarded execution still returns refusal and invokes no remote write or reporting fallback mutation.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-persister.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/src/engine/github-operations.ts`, `src/conductor/test/engine/github-ownership/23-emit-and-render-canonical-ownership-refusals.test.ts`
**Dependencies:** Task 6

### Task 24: Enforce the production invocation boundary mechanically

**Story:** Story 8
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add scoped failing entry-point integration coverage for the Done-when cases below, using the lowest sufficient fake boundary. Reuse the canonical injectable runner pattern; verify the production process seam is replaced before destructive inputs.
2. Establish RED through the affected-test runner; Add a TypeScript AST-based audit of shipped runtime invocation sites: process imports/aliases, canonical runner factories, raw transport imports, and known GitHub HTTP clients. Only approved adapters may execute remote writes; unresolvable executable command construction at these sites fails review. Check executable shell blocks in maintained publication skills/launchers against the guarded CLI contract; exclude historical .docs prose and ordinary examples. Inventory every current production operation and migrate any omitted in-scope site as part of its owning integration task before this gate passes. Fixtures use fake process/network boundaries, including guard-absent counterfactuals.
3. Establish GREEN for the affected coverage and commit this behavior change. Do not run a full conductor lifecycle to prove a single operation.

**Done when:**
- The production invocation audit enumerates shipped runtime GitHub/remote-Git execution sites and fails for direct process aliases, unapproved raw transport imports, mutable command forwarding, and unclassified executable remote invocation sites outside guarded adapters.
- Audit fixtures pass for approved adapters, preserved local Git calls, and historical documentation mentions, and fail with file/site diagnostics for introduced GitHub or remote Git bypasses.
- The integrity suite invokes the audit; the accepted operation inventory and caller proofs include every supported mutation family, so adding a new unclassified production operation cannot silently pass.

**Files:** `src/conductor/src/engine/github-invocation-audit.ts`, `test/check_github_invocation_boundary.sh`, `test/test_harness_integrity.sh`, `src/conductor/test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts`
**Dependencies:** Task 7, Task 8, Task 9, Task 10, Task 11, Task 12, Task 13, Task 15, Task 16, Task 17, Task 20, Task 21, Task 22

## Integration Points

Tasks 6-8 own the canonical GitHub operation and primitive boundaries; Tasks 9-13 own reconciliation, gate announcements, rehabilitation, halt closure, and intake writeback. Task 15 owns intake creation/follow-ups; Task 16 owns initial spec handoff; Task 17 owns shared administration. Task 19 owns remote Git mutation semantics, Task 20 its halt/repair callers, and Task 21 finish publication. Task 22 owns CLI/host dispatch, Task 23 refusal event delivery, and Task 24 the production audit entry point. Internal helpers are covered by these callers rather than separate redundant full-flow suites.

## Coverage Check

Each row maps an exact accepted criterion to its behavior-owning tasks and a required completion check. Multiple cited tasks jointly deliver cross-entry-point criteria; the quoted fragment is from one of those tasks, with the remaining cited Done-when checks supplying the other boundaries. Test dispositions are the scoped unit/adapter/integration proof in those tasks; no ordinary test calls a live service. Diff-local here describes the delivered implementation evaluated against controlled fixture evidence, not an assertion about future live GitHub state.


| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a machine-configured operator and a matching committed feature owner, when a mutation targets that feature in its canonical repository, then it proceeds using the configured identity even if the ambient GitHub login differs. | 4 | authorizeGithubMutation uses machine user configuration before authenticated login, permits a matching committed owner, and never takes identity from shared project configuration. | diff-local |
| Story 1 happy: Given no configured operator and an available authenticated login matching the committed owner, when that operator requests a feature mutation, then it proceeds. | 4 | authorizeGithubMutation uses machine user configuration before authenticated login, permits a matching committed owner, and never takes identity from shared project configuration. | diff-local |
| Story 1 negative: Given another owner, unresolved identity, missing ownership, or conflicting owner records, when a feature mutation is requested, then it is refused with the distinct reason and no remote write. | 3, 4 | readMutationProvenance resolves committed default/spec-branch ownership and reports missing, conflicting, duplicate-contradictory, unreadable, or timed-out evidence without granting permission. | diff-local |
| Story 1 negative: Given shared project configuration claims another operator identity, when authorization runs, then that value never supplies permission. | 4 | authorizeGithubMutation uses machine user configuration before authenticated login, permits a matching committed owner, and never takes identity from shared project configuration. | diff-local |
| Story 1 negative: Given a malformed or ambiguous repository/target, or an ownership lookup that fails or times out, when authorization runs, then no mutation occurs. | 2, 3, 4 | resolveGithubTarget turns supported URL/ref inputs into repository-bound resource identities and rejects malformed or ambiguous inputs before any mutation, including failed or timed-out discovery reads. | diff-local |
| Story 1 negative: Given identical branch names in two repositories with different owners, when authorization was obtained for one, then it cannot authorize a write to the other. | 2, 4 | Authorization target matching compares repository and resource together; identical branch names in different repositories cannot reuse a decision. | diff-local |
| Story 1 negative: Given relevant committed records contain contradictory duplicate owner lines, when authorization runs, then no first-match interpretation permits the write. | 3 | readMutationProvenance resolves committed default/spec-branch ownership and reports missing, conflicting, duplicate-contradictory, unreadable, or timed-out evidence without granting permission. | diff-local |
| Story 2 happy: Given an owned halted PR missing the required label or draft state, when reconciliation runs, then its halt presentation is restored. | 9 | reconcileHaltPrs restores label/draft presentation for an authorized halted PR and clears stale halt presentation plus updates its comment for an authorized shipped PR. | diff-local |
| Story 2 happy: Given an owned PR with committed shipment evidence, when reconciliation runs, then its stale halt presentation is cleared and its halt comment updated as intended. | 9 | reconcileHaltPrs restores label/draft presentation for an authorized halted PR and clears stale halt presentation plus updates its comment for an authorized shipped PR. | diff-local |
| Story 2 negative: Given another operator's marked PR missing a label or draft state, when reconciliation runs, then its labels, body, comments, and draft state remain unchanged. | 9 | The reconciliation fixture records no label, body, comment, or draft mutation for foreign PRs in either healing or shipped-cleanup paths, including unknown ownership with only marker/branch/shipment hints. | diff-local |
| Story 2 negative: Given another operator's marked PR with shipment evidence, when cleanup runs, then no label, comment, body, or draft mutation occurs. | 9 | The reconciliation fixture records no label, body, comment, or draft mutation for foreign PRs in either healing or shipped-cleanup paths, including unknown ownership with only marker/branch/shipment hints. | diff-local |
| Story 2 negative: Given an unauthorized PR alongside an authorized PR in the same sweep, when reconciliation runs, then the former is refused and the latter is still processed. | 9 | One refused PR in a mixed sweep does not prevent a later authorized PR from being reconciled, and refusal is never cached as healed or cleared. | diff-local |
| Story 2 negative: Given a PR whose owner cannot be resolved from authoritative evidence, when reconciliation runs, then a body marker, branch naming convention, or shipment record alone never grants permission. | 3, 9 | The strict provenance reader never treats a halt marker, branch prefix, shipment record, or first contradictory Owner line as authorization. | diff-local |
| Story 3 happy: Given an authorized existing resource and a supported mutation, when the harness updates its presentation or lifecycle state, then the intended change succeeds through the guarded operation. | 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 21, 22, 24 | The production GitHub composition executes registered discovery/ownership reads for foreign resources but routes every registered mutation through authorizeGithubMutation before the private transport. | diff-local |
| Story 3 happy: Given ordinary repository discovery or ownership reads, when the operator does not own the returned resources, then the read succeeds without granting mutation permission. | 6, 7 | The production GitHub composition executes registered discovery/ownership reads for foreign resources but routes every registered mutation through authorizeGithubMutation before the private transport. | diff-local |
| Story 3 negative: Given a supported mutation against a foreign-owned resource, when requested through any migrated entry point, then it is refused, including labels, comments, body/title edits, state changes, and applicable remote API mutations. | 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 21, 22, 24 | The production GitHub composition executes registered discovery/ownership reads for foreign resources but routes every registered mutation through authorizeGithubMutation before the private transport. | diff-local |
| Story 3 negative: Given an unknown operation or missing required context, when submitted to the GitHub interface, then it is refused rather than assumed to be a read. | 1, 6 | The github-operations request decoder accepts registered read/write shapes and rejects unknown operation names, missing context, and malformed payloads as typed refusals before transport invocation. | diff-local |
| Story 3 negative: Given a linked issue owned by another operator, when an owned feature attempts issue writeback, then the issue is not mutated merely because it is referenced by that feature. | 13 | Absent, foreign, or multiple distinct assignees are refused without explicit approval; mismatched approval and independently unauthorized linked issues produce zero issue writes. | diff-local |
| Story 3 negative: Given a refusal caught by a best-effort handler, when the workflow continues, then it neither reports a successful mutation nor sends an escalation comment to that unauthorized resource. | 11, 12, 21 | Foreign-target or missing-permission results remain refusals through rehabilitation catch/retry paths, with no successful-clear result and no unauthorized escalation comment. | diff-local |
| Story 4 happy: Given a pre-spec issue assigned exclusively to the resolved operator, when the harness performs an intake update, then it succeeds without changing assignees. | 13 | Intake writeback permits exclusive operator assignment or exact explicit issue authorization and preserves the issue's assignees on success and refusal. | diff-local |
| Story 4 happy: Given a pre-spec issue otherwise lacking permission and explicit authorization for its exact repository, issue, and operation, when that operation is requested, then it succeeds within that authorization. | 5, 13 | The explicit-approval adapter permits one exact pre-spec issue or shared-resource request after positive operator confirmation, binding actor, repository, target, operation, and payload. | diff-local |
| Story 4 negative: Given no assignee, another assignee, or multiple distinct assignees, when no explicit authorization exists, then the intake mutation is refused and assignees remain unchanged. | 13 | Absent, foreign, or multiple distinct assignees are refused without explicit approval; mismatched approval and independently unauthorized linked issues produce zero issue writes. | diff-local |
| Story 4 negative: Given explicit authorization for a different issue, repository, or operation, when it is presented for the target issue, then mutation is refused. | 5, 13 | The approval adapter refuses absent/declined authority and mismatched issue, repository, resource, operation, or payload; ordinary feature publication intent is not shared administration authority. | diff-local |
| Story 4 negative: Given assignment evidence changes or becomes unavailable before a retry, when the retry authorizes again, then stale permission does not permit mutation. | 13 | A retry reads current assignment/evidence and refuses after reassignment or lookup failure instead of reusing an earlier permission. | diff-local |
| Story 4 negative: Given an owned feature references an intake issue whose independent authorization fails, when writeback runs, then the issue remains unchanged. | 13 | Absent, foreign, or multiple distinct assignees are refused without explicit approval; mismatched approval and independently unauthorized linked issues produce zero issue writes. | diff-local |
| Story 5 happy: Given an identified operator making an explicit intake request or acting in an authorized feature workflow, when a new issue is created in the authorized repository, then its immediate labels and dependency metadata can be written to the returned issue. | 14, 15 | Creation authorization admits an identified operator's explicit intake or authorized feature creation only in the bound repository and refuses unresolved identity or unauthorized destinations before creation. | diff-local |
| Story 5 happy: Given a not-yet-merged spec with matching committed spec-branch ownership, when its feature branch and PR are first published, then publication succeeds without requiring a default-branch marker that cannot yet exist. | 3, 16 | readMutationProvenance resolves committed default/spec-branch ownership and reports missing, conflicting, duplicate-contradictory, unreadable, or timed-out evidence without granting permission. | diff-local |
| Story 5 negative: Given unresolved identity or an unauthorized destination, when creation/publication is requested, then no remote resource is created or pushed. | 14, 16 | Creation authorization admits an identified operator's explicit intake or authorized feature creation only in the bound repository and refuses unresolved identity or unauthorized destinations before creation. | diff-local |
| Story 5 negative: Given a creation response cannot identify the newly created issue unambiguously, when follow-up metadata is attempted, then no other issue is guessed or modified and partial completion is reported. | 14, 15 | The creation context binds immediate metadata writes to the canonical returned issue; ambiguous responses report partial creation and cannot authorize guessed targets. | diff-local |
| Story 5 negative: Given an earlier creation context is reused in a later run or for a different target, when a mutation is requested, then current ownership or explicit authorization is required. | 14 | Creation context cannot authorize a different target or a later run; fresh ownership or explicit authorization is then required. | diff-local |
| Story 5 negative: Given dependency metadata on the new issue refers to another operator's issue, when the dependency is linked, then the referenced issue receives no independent mutation. | 15 | fileIntakeIssue integration creates an authorized issue and applies immediate size/priority labels and dependency metadata only to that returned issue; a foreign dependency receives no independent mutation. | diff-local |
| Story 5 negative: Given creation succeeds but a metadata write fails, when the result is reported, then it distinguishes the created resource from failed metadata and does not claim complete success. | 15 | The filing result reports the created URL plus failed/refused metadata accurately after partial failure, and performs no guessed follow-up after an ambiguous creation response. | diff-local |
| Story 6 happy: Given explicit authorization for an exact shared repository resource and operation, when the supported administration operation runs, then the requested change succeeds. | 5, 17 | The explicit-approval adapter permits one exact pre-spec issue or shared-resource request after positive operator confirmation, binding actor, repository, target, operation, and payload. | diff-local |
| Story 6 happy: Given an existing shared label and an owned issue or PR, when the label is applied, then it is applied without changing the label's shared definition. | 8 | Applying an existing label through pr-labels changes only the authorized issue/PR association; it performs no label-definition color or description write. | diff-local |
| Story 6 negative: Given an owned feature but no shared-resource authorization, when a daemon tries to create or modify a label definition or perform supported repository/workflow administration, then that shared mutation is refused. | 17 | A daemon's feature ownership never authorizes label-definition creation/update or registered repository/workflow administration; a missing label returns explicit-authorization-required without force write. | diff-local |
| Story 6 negative: Given a missing shared label, when automatic label creation lacks explicit authorization, then it is reported as requiring authorization rather than silently created or force-updated. | 8, 17 | ensureLabel routes missing/create/update definitions as shared-resource requests and returns explicit-authorization-required without force-creating or force-updating them when permission is absent. | diff-local |
| Story 6 negative: Given permission for a different shared resource or operation, when it is reused, then the requested mutation is refused. | 5, 17 | The approval adapter refuses absent/declined authority and mismatched issue, repository, resource, operation, or payload; ordinary feature publication intent is not shared administration authority. | diff-local |
| Story 6 negative: Given an authorized administration request encounters transport failure, when the harness reports its result, then it does not report the shared mutation as successful. | 17 | Transport failure remains failed or partial in the shared-operation result and cannot be reported as successful administration. | diff-local |
| Story 7 happy: Given matching ownership for every explicit destination ref, when an otherwise permitted push runs, then it updates only those refs. | 18, 19 | resolveRemoteGitTargets resolves every explicit destination ref and canonical remote repository before authorization, and rejects ambiguous implicit, wildcard, broad/all/tags, or mirror requests before execution. | diff-local |
| Story 7 happy: Given matching ownership and existing deletion permission, when a named remote branch deletion runs, then only that named ref is deleted. | 19 | Owned explicit pushes update only requested refs and authorized named deletion removes only its named ref, as proven with fixture-owned local Git repositories. | diff-local |
| Story 7 happy: Given ordinary local status, diff, commit, or worktree operations, when executed, then this remote ownership gate does not change their existing behavior. | 18 | Local status, diff, commit, and worktree calls remain on existing runners with no added ownership reads, events, or remote writes from this adapter. | diff-local |
| Story 7 negative: Given any unauthorized ref in a multi-target request, when publication is attempted, then no remote write is invoked for any target. | 19 | executeRemoteGit authorizes every resolved destination before a single push/delete invocation; one unauthorized ref refuses the entire request with zero writes, regardless of the local worktree owner. | diff-local |
| Story 7 negative: Given an ambiguous implicit destination or broad/mirror push request, when publication is attempted, then it is refused before remote execution. | 18 | resolveRemoteGitTargets resolves every explicit destination ref and canonical remote repository before authorization, and rejects ambiguous implicit, wildcard, broad/all/tags, or mirror requests before execution. | diff-local |
| Story 7 negative: Given a force-with-lease push whose lease is rejected, when publication fails, then no unleased force fallback is attempted. | 19 | A force-with-lease rejection returns failure with no unleased force fallback or retry through an unguarded runner. | diff-local |
| Story 7 negative: Given a foreign remote branch targeted for deletion or update, when the request originates in an owned worktree, then worktree ownership does not authorize that foreign ref. | 19 | executeRemoteGit authorizes every resolved destination before a single push/delete invocation; one unauthorized ref refuses the entire request with zero writes, regardless of the local worktree owner. | diff-local |
| Story 7 negative: Given a refusal in halt-record, escalation, composer, or repair publication, when its caller reports progress, then it does not record the push as successful or retry outside authorization. | 16, 20, 21 | Handoff refusal preserves local work and reports failure without a delivered ledger record, successful-push claim, or raw publication fallback. | diff-local |
| Story 8 happy: Given an ownership refusal, when a daemon or standalone command reports it, then the result names the target and actionable reason; daemon evidence is available through the existing event spine. | 23, 22 | A refused daemon operation emits a canonical ConductorEvent whose persisted/rendered form identifies target, operation, reason, and remedy; the standalone result renders the same reason without inventing a success. | diff-local |
| Story 8 happy: Given supported engine and skill-directed publication operations on either supported host, when invoked, then they use the same authorization behavior. | 22 | Both supported host publication workflows invoke guarded CLI/engine operations instead of raw GitHub or remote Git writes; explicit request confirmation binds only that operation and no host-specific hook supplies authority. | diff-local |
| Story 8 happy: Given production calls confined to approved boundaries, when the invocation audit runs, then it passes. | 24 | Audit fixtures pass for approved adapters, preserved local Git calls, and historical documentation mentions, and fail with file/site diagnostics for introduced GitHub or remote Git bypasses. | diff-local |
| Story 8 negative: Given a new direct GitHub call or remote Git write outside those boundaries, when validation runs, then it fails identifying that bypass. | 24 | The production invocation audit enumerates shipped runtime GitHub/remote-Git execution sites and fails for direct process aliases, unapproved raw transport imports, mutable command forwarding, and unclassified executable remote invocation sites outside guarded adapters. | diff-local |
| Story 8 negative: Given a historical documentation mention or a permitted local Git call, when the audit runs, then that non-bypass does not fail validation. | 24 | Audit fixtures pass for approved adapters, preserved local Git calls, and historical documentation mentions, and fail with file/site diagnostics for introduced GitHub or remote Git bypasses. | diff-local |
| Story 8 negative: Given authorization changes between attempts, when retry runs, then it cannot reuse the previous decision as blanket permission. | 4, 13 | A second authorization attempt resolves current identity/evidence again; an earlier decision cannot authorize a changed actor, operation, repository, target, or retry. | diff-local |
| Story 8 negative: Given an event/reporting failure after a refused operation, when the result is handled, then no remote write is performed as a fallback and the caller still receives a refusal. | 23 | If event persistence or rendering fails after denial, guarded execution still returns refusal and invokes no remote write or reporting fallback mutation. | diff-local |
| Story 8 negative: Given tests exercise a denied operation with the production guard absent, when the test runs, then a fixture-owned fake process boundary still prevents any real third-party call. | 6 | A transport-spy fixture confirms the production composition reaches a fake process boundary, and remains isolated from real gh/network execution even when the authorization guard is absent. | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-11-github-operation-ownership#D1 | task | task-1, task-2, task-6 | The production GitHub composition executes registered discovery/ownership reads for foreign resources but routes every registered mutation through authorizeGithubMutation before the private transport. |
| adr-2026-09-11-github-operation-ownership#D2 | task | task-3, task-4, task-9, task-16 | authorizeGithubMutation refuses other-owner, unresolved actor, missing/conflicting provenance, or evidence failure with distinct reasons and zero mutating transport calls. |
| adr-2026-09-11-github-operation-ownership#D3 | task | task-5, task-13, task-14, task-15, task-16 | Intake writeback permits exclusive operator assignment or exact explicit issue authorization and preserves the issue's assignees on success and refusal. |
| adr-2026-09-11-github-operation-ownership#D4 | task | task-5, task-8, task-17 | A daemon's feature ownership never authorizes label-definition creation/update or registered repository/workflow administration; a missing label returns explicit-authorization-required without force write. |
| adr-2026-09-11-github-operation-ownership#D5 | task | task-18, task-19, task-20, task-21 | executeRemoteGit authorizes every resolved destination before a single push/delete invocation; one unauthorized ref refuses the entire request with zero writes, regardless of the local worktree owner. |
| adr-2026-09-11-github-operation-ownership#D6 | task | task-9, task-11, task-12, task-20, task-21, task-23 | If event persistence or rendering fails after denial, guarded execution still returns refusal and invokes no remote write or reporting fallback mutation. |
| adr-2026-09-11-github-operation-ownership#D7 | task | task-6, task-22, task-24 | The integrity suite invokes the audit; the accepted operation inventory and caller proofs include every supported mutation family, so adding a new unclassified production operation cannot silently pass. |
| adr-2026-09-11-github-operation-ownership#D8 | task | task-10 | Gate-writeback integration records GATED local visibility before any authorized remote action and records zero label/comment mutations for other-owner PRs and independently unauthorized source issues. |

| adr-2026-07-03-gated-writeback-announcements#D1 | no-change | — | Superseded historical policy is retained for provenance, not implemented anew. Replacement obligations are mapped under adr-2026-09-11-github-operation-ownership#D8 and task-10. |

The historical decision is numbered only to make the approved supersession citable. Historical protected-artifact corrections are already in the spec diff and are not BUILD tasks.

## Task Dependency Graph

Dependencies on every task are authoritative. The principal ordering is:

- Requests and targets: 1 → 2 → 3 → 4 → 5 → 6.
- GitHub integrations: 6 → 7/8; 8 → 9/10/11; 7 → 12/13; 6 → 14 → 15.
- Remote Git: 2 → 18; 4 + 18 → 19; 19 → 20; 8 + 19 → 16; 11 + 19 → 21.
- Shared operations and CLI: 5 + 8 → 17; 6 + 17 + 19 → 22.
- Refusal event integration: 6 → 23.
- Production audit delivery: 7-13, 15-17, 20-22 → 24.

Task 24 delivers a named new production validation gate and its fixtures. It is not a terminal catch-all feature verification task. Completed-feature validation remains with test_suite and SHIP.

## Verify-claims ledger

Verified source basis: the canonical tracker-client/GhRunner factory; pr-labels helpers; the machine identity and committed provenance modules; existing direct push sites in halt-record, escalation, autoresolve, conductor, handoff and shipment evidence; finish publication's typed operator_confirmed authority and non-success disposition patterns; existing intake-file prompt injection. New modules and command names above are planned implementation choices, not claims that those APIs already exist.

Every expected permission behavior is operator-approved in D1-D8. No inferred administrator exemption or alternate owner source is introduced. The plan deliberately retains strict existing push, publication, draft, test-isolation, and local Git constraints. All external interactions in proof are faked or fixture-owned.

Verdict: CLEAR

## Review status

Operator approved the plan and amended architecture diagram on 2026-09-11. No implementation is authorized in this composer session. Coherence-check records criterion achievability and ADR obligations before land and handoff.

## Advisory overlap result

Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts

Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/engine/conductor.ts

Note: renames or name-only diffs may not be detected by this scan. This is advisory, not a prerequisite.
