# Implementation Plan: Bot-owned release PR

**Date:** 2026-08-01  
**Design:** `.docs/decisions/adr-2026-08-01-bot-owned-release-pr.md`  
**Architecture:** `.docs/architecture/changelog-unreleased-is-a-shared-write-target-conf.md`  
**Stories:** `.docs/stories/changelog-unreleased-is-a-shared-write-target-conf.md`  
**Conflict check:** Clean as of 2026-08-01, including open GitHub issues

## Summary

This 20-task plan replaces feature-authored changelog/version edits with typed PR metadata, a GitHub App-authored release PR, and a provenance-gated publisher. It also performs the one-time audited backlog cleanup and fixes tagged installed-version detection (#1005), while preserving migration/waiver safety and leaving broader GitHub identity, rebase verification, FINISH transaction, and post-release migration-jump work in their existing issues.

## Technical Approach

- Add pure typed modules for PR release metadata, candidate collection/completeness, semver aggregation, changelog rendering, release-branch ownership, and publication state. All GitHub/network operations enter through injected adapters; ordinary tests use faithful fakes.
- Expose narrowly scoped action entry points from `src/conductor/src/index.ts`. GitHub workflows use a repository GitHub App installation token and serialize release-PR maintenance in one concurrency group.
- Treat merged PR metadata since the latest tag as the pending candidate source, the generated release PR as the exact proposed release, and the merged version section/tag as published history. No local ledger becomes authority.
- Change self-host release gating from feature-owned `[Unreleased]` content to structured PR metadata while keeping canonical breaking-surface classification, runnable migrations, and fresh waivers fail-closed.
- Retire only changelog-specific token finalization and rebase-union machinery. Generic finish recovery and rebase verification remain outside this feature.
- For the one-time transition, create an automated include/consolidate/exclude audit and cleaned backlog as reviewable implementation/release-PR inputs. Recurring Actions code contains no AI/provider dependency.
- Fix tagged update identity to use the installed/checked-out tag rather than forward-looking repository `VERSION`; keep the existing Git-based tagged and main channels.

## Prerequisites

- Provision a repository GitHub App with the minimum contents and pull-request permissions required to maintain the dedicated release branch and PR; configure its App ID/private-key secrets before live activation.
- Confirm the designated release branch name and App bot login in repository workflow configuration.
- Keep #219 open for the real consumer jump exercise after the first new tag exists.

## Tasks

### Task 1: Parse one valid release disposition

**Story:** TI-1 — valid note and explicit no-note happy paths  
**Type:** happy-path

**Steps:**
1. Write failing unit tests for a categorized reader note with semver impact and for the explicit no-note form.
2. Verify RED in the focused test file.
3. Implement typed `ReleaseDisposition` parsing and normalization from PR-body text.
4. Verify GREEN.
5. Commit `feat(release): parse structured PR release dispositions`.

**Files:**
- `src/conductor/src/engine/release-metadata.ts` — typed parser and normalized result
- `src/conductor/test/engine/release-metadata.test.ts` — focused valid-shape tests

**Wired-into:** `src/conductor/src/engine/release-metadata-check-action.ts#runReleaseMetadataCheckAction`, `src/conductor/src/engine/release-candidates.ts#collectReleaseCandidates`  
**Dependencies:** none

### Task 2: Reject malformed, contradictory, and executable metadata

**Story:** TI-1 — all metadata negative paths  
**Type:** negative-path

**Steps:**
1. Add failing table tests for missing/multiple dispositions, invalid category/semver, empty note, contradictory no-note fields, workflow expressions, and shell-like text.
2. Verify RED.
3. Make parsing exhaustive and keep note content inert without evaluation/interpolation.
4. Verify GREEN.
5. Commit `fix(release): fail closed on invalid PR release metadata`.

**Files:**
- `src/conductor/src/engine/release-metadata.ts` — exhaustive validation
- `src/conductor/test/engine/release-metadata.test.ts` — invalid/untrusted input matrix

**Wired-into:** same as Task 1  
**Dependencies:** Task 1

### Task 3: Wire the required PR metadata check and template contract

**Story:** TI-1 — required check and machine-readable normalized output  
**Type:** infrastructure

**Steps:**
1. Write failing action-adapter and workflow-structure tests for PR open/update validation.
2. Verify RED without contacting GitHub.
3. Add the injected GitHub action entry point, export it, update the machine-consumed PR template, and wire the check workflow.
4. Verify GREEN with a faithful event/client fake and structural workflow test.
5. Commit `feat(release): gate PRs on release metadata`.

**Files:**
- `src/conductor/src/engine/release-metadata-check-action.ts` — action adapter
- `src/conductor/test/engine/release-metadata-check-action.test.ts` — fake-GitHub action tests
- `src/conductor/src/index.ts` — production export
- `.github/workflows/release-metadata.yml` — required check wiring
- `.github/pull_request_template.md` — structured machine-consumed fields
- `test/test_release_pr_workflow.sh` — structural workflow/template checks

**Wired-into:** `.github/workflows/release-metadata.yml#actions/github-script`  
**Dependencies:** Tasks 1, 2

### Task 4: Validate structured breaking migrations before merge

**Story:** TI-2 — runnable migration happy path and missing/malformed migration negatives  
**Type:** happy-path

**Steps:**
1. Write failing release-gate tests that supply structured metadata rather than feature-owned changelog content.
2. Verify RED.
3. Refactor the gate input to validate the parsed runnable migration block for classified breaking surfaces.
4. Verify GREEN, including exact `bin/migrate`-compatible fence preservation.
5. Commit `feat(release): validate migrations from PR metadata`.

**Files:**
- `src/conductor/src/engine/self-host/release-gate.ts` — structured migration input
- `src/conductor/test/engine/self-host/release-gate.test.ts` — breaking/malformed cases
- `src/conductor/src/engine/release-metadata.ts` — migration field representation

**Wired-into:** `src/conductor/src/engine/conductor.ts#runReleaseArtifactGate`  
**Dependencies:** Task 2

### Task 5: Preserve fresh waiver behavior under the new gate

**Story:** TI-2 — waiver happy and negative paths  
**Type:** negative-path

**Steps:**
1. Add failing regression tests for valid fresh waiver, stale waiver, malformed waiver, partial coverage, and uncertain diff.
2. Verify RED against the refactored input boundary.
3. Adapt composition without changing canonical names, freshness, coverage, or uncertainty behavior.
4. Verify GREEN with no third-party calls.
5. Commit `test(release): preserve migration waiver guarantees`.

**Files:**
- `src/conductor/src/engine/self-host/release-gate.ts` — composed gate compatibility
- `src/conductor/test/engine/self-host/release-gate.test.ts` — waiver regression matrix

**Wired-into:** same as Task 4  
**Dependencies:** Task 4

### Task 6: Aggregate semver impact and render release output

**Story:** TI-2 and TI-5 — highest semver impact, existing changelog shape, invalid impact rejection  
**Type:** happy-path

**Steps:**
1. Write failing pure tests for patch/minor/major maximum, category grouping, PR attribution, migration ordering, and rendered `CHANGELOG.md`/`VERSION` values.
2. Verify RED.
3. Implement typed semver aggregation and deterministic renderer.
4. Verify GREEN and stable byte-for-byte rerendering.
5. Commit `feat(release): render deterministic release candidates`.

**Files:**
- `src/conductor/src/engine/release-renderer.ts` — semver and changelog renderer
- `src/conductor/test/engine/release-renderer.test.ts` — pure rendering tests

**Wired-into:** `src/conductor/src/engine/release-pr-action.ts#runReleasePrAction`  
**Dependencies:** Tasks 1, 4

### Task 7: Collect paginated merged PR candidates since the latest tag

**Story:** TI-3 and TI-5 — complete candidate collection and multi-page happy path  
**Type:** happy-path

**Steps:**
1. Write failing adapter tests for latest-tag boundary, merged-only selection, stable ordering, and two GitHub pages.
2. Verify RED.
3. Implement candidate collection through injected Git and GitHub query interfaces.
4. Verify GREEN with local data/fakes only.
5. Commit `feat(release): collect post-tag merged PR candidates`.

**Files:**
- `src/conductor/src/engine/release-candidates.ts` — collection/completeness domain logic
- `src/conductor/test/engine/release-candidates.test.ts` — paginated fake fixtures

**Wired-into:** `src/conductor/src/engine/release-pr-action.ts#runReleasePrAction`  
**Dependencies:** Tasks 1, 2

### Task 8: Fail closed on candidate gaps and ambiguous evidence

**Story:** TI-5 — missing disposition, duplicate classification, API failure, Git/GitHub mismatch, identical-note provenance  
**Type:** negative-path

**Steps:**
1. Add failing tests for unreachable pages, truncated totals, unexplained Git merges, duplicates, and identical note text from distinct PRs.
2. Verify RED.
3. Add exhaustive one-to-one disposition auditing and explicit incomplete verdicts.
4. Verify GREEN.
5. Commit `fix(release): reject incomplete candidate sets`.

**Files:**
- `src/conductor/src/engine/release-candidates.ts` — completeness verdicts
- `src/conductor/test/engine/release-candidates.test.ts` — gap/ambiguity fixtures

**Wired-into:** same as Task 7  
**Dependencies:** Task 7

### Task 9: Create or update the owned release branch and PR

**Story:** TI-3 — one App-authored release branch/PR happy paths  
**Type:** happy-path

**Steps:**
1. Write failing action tests for create and update using injected GitHub/Git runners.
2. Verify RED.
3. Implement owned-branch identity, generated-surface diffing, commit creation, and one-PR upsert.
4. Verify GREEN and assert no personal `gh` or ambient token use.
5. Commit `feat(release): upsert the bot-owned release PR`.

**Files:**
- `src/conductor/src/engine/release-pr-action.ts` — maintenance orchestration
- `src/conductor/test/engine/release-pr-action.test.ts` — fake GitHub/Git happy paths
- `src/conductor/src/index.ts` — action export

**Wired-into:** `.github/workflows/release-pr.yml#actions/github-script`  
**Dependencies:** Tasks 6, 8

### Task 10: Protect release-branch ownership and partial failures

**Story:** TI-3 and TI-4 — credential, foreign PR, branch-push/PR-update, and retry negative paths  
**Type:** negative-path

**Steps:**
1. Add failing action tests for missing App identity, wrong owner/base/head, foreign edits, push-only partial success, and duplicate retry.
2. Verify RED.
3. Add fail-closed ownership checks and reconciliation from GitHub/Git state.
4. Verify GREEN with no local authority ledger.
5. Commit `fix(release): guard release PR ownership and recovery`.

**Files:**
- `src/conductor/src/engine/release-pr-action.ts` — ownership/recovery paths
- `src/conductor/test/engine/release-pr-action.test.ts` — negative and retry cases

**Wired-into:** same as Task 9  
**Dependencies:** Task 9

### Task 11: Reject stale release renders before push

**Story:** TI-4 — latest-main recheck and idempotency  
**Type:** negative-path

**Steps:**
1. Write failing tests for main advancing between collection and push and for duplicate unchanged events.
2. Verify RED.
3. Add expected-head comparison, bounded stale retry, and content no-op detection.
4. Verify GREEN.
5. Commit `fix(release): prevent stale release branch updates`.

**Files:**
- `src/conductor/src/engine/release-pr-action.ts` — head guard/idempotency
- `src/conductor/test/engine/release-pr-action.test.ts` — stale/no-op cases

**Wired-into:** same as Task 9  
**Dependencies:** Task 10

### Task 12: Wire App authentication and serialized merge maintenance

**Story:** TI-3 and TI-4 — App credential, merged-event filter, concurrency, and no-recursion behavior  
**Type:** infrastructure

**Steps:**
1. Extend failing structural workflow tests for App-token creation, minimum permissions, closed-and-merged filtering, one concurrency group, and release-PR recursion exclusion.
2. Verify RED.
3. Add the maintainer workflow using the reusable App credential seam and exported action.
4. Verify GREEN without contacting GitHub.
5. Commit `ci(release): maintain one serialized release PR`.

**Files:**
- `.github/workflows/release-pr.yml` — merge trigger, App token, concurrency, action call
- `test/test_release_pr_workflow.sh` — workflow contract assertions
- `src/conductor/src/engine/github-app-auth.ts` — reusable credential configuration contract
- `src/conductor/test/engine/github-app-auth.test.ts` — scoped configuration tests

**Wired-into:** `.github/workflows/release-pr.yml#release-pr-maintenance`  
**Dependencies:** Tasks 9, 10, 11

### Task 13: Present the exhaustive audit on the release PR

**Story:** TI-5 — included/no-note/excluded audit and readiness check  
**Type:** happy-path

**Steps:**
1. Write failing renderer/action tests for one audit row per candidate, included-only changelog output, and a required readiness status on the exact head.
2. Verify RED.
3. Render the audit into the owned PR body/check output and bind readiness to the candidate hash/head.
4. Verify GREEN.
5. Commit `feat(release): expose release candidate audit`.

**Files:**
- `src/conductor/src/engine/release-renderer.ts` — audit rendering
- `src/conductor/src/engine/release-pr-action.ts` — PR body/readiness publication
- `src/conductor/test/engine/release-renderer.test.ts` — audit formatting
- `src/conductor/test/engine/release-pr-action.test.ts` — head-bound readiness

**Wired-into:** same as Task 9  
**Dependencies:** Tasks 8, 11

### Task 14: Publish only a proven release-PR merge

**Story:** TI-6 — approved provenance happy path and ordinary-main-push rejection  
**Type:** happy-path

**Steps:**
1. Write failing publisher tests for designated merged PR provenance, complete audit, approved version section, and rejection of implementation/foreign/direct pushes.
2. Verify RED.
3. Implement the publisher action state calculation and mutation authorization.
4. Verify GREEN with injected GitHub/Git release adapters.
5. Commit `feat(release): authorize publication by release PR provenance`.

**Files:**
- `src/conductor/src/engine/release-publisher-action.ts` — provenance and publish orchestration
- `src/conductor/test/engine/release-publisher-action.test.ts` — positive/negative event fixtures
- `src/conductor/src/index.ts` — publisher export

**Wired-into:** `.github/workflows/release.yml#actions/github-script`  
**Dependencies:** Tasks 6, 13

### Task 15: Make tag and GitHub Release publication retry-safe

**Story:** TI-6 — existing tag, invalid artifact, and partial tag/release failure paths  
**Type:** negative-path

**Steps:**
1. Add failing tests for existing correct tag, conflicting tag, tag-created/release-missing recovery, invalid provenance, and incomplete candidate evidence.
2. Verify RED.
3. Add idempotent transition classification and fail-before-mutation ordering.
4. Verify GREEN.
5. Commit `fix(release): recover publication without duplicate tags`.

**Files:**
- `src/conductor/src/engine/release-publisher-action.ts` — transition/recovery logic
- `src/conductor/test/engine/release-publisher-action.test.ts` — partial failure matrix

**Wired-into:** same as Task 14  
**Dependencies:** Task 14

### Task 16: Replace the direct-push release workflow

**Story:** TI-6 — deterministic release workflow, empty-set no-op, tagged/main compatibility  
**Type:** infrastructure

**Steps:**
1. Update failing workflow tests to require App-authored release-PR provenance and forbid the legacy direct `main` changelog/version push sequence.
2. Verify RED.
3. Rewire `.github/workflows/release.yml` to call the publisher only for a proven release-PR merge and preserve empty-set no-release behavior.
4. Verify GREEN.
5. Commit `ci(release): publish only approved release PRs`.

**Files:**
- `.github/workflows/release.yml` — deterministic publisher wiring
- `.github/scripts/release-unreleased-state.sh` — remove/replace legacy content trigger as required
- `test/test_release_unreleased_state.sh` — new provenance/no-release workflow contract
- `test/test_release_pr_workflow.sh` — cross-workflow identity checks

**Wired-into:** `.github/workflows/release.yml#release`  
**Dependencies:** Tasks 12, 15

### Task 17: Detect tagged updates from installed release identity

**Story:** TI-6 — #1005 older-installed-tag regression and unverifiable identity negative path  
**Type:** happy-path

**Steps:**
1. Add failing shell fixtures where installed tag is older than latest while repository `VERSION` is ahead, plus unknown identity and main-channel cases.
2. Verify RED in the focused update tests.
3. Change installed-version detection to checked-out/recorded tag authority and keep channel state consistent.
4. Verify GREEN in `bin/update` and any shared `bin/conduct` compatibility helper.
5. Commit `fix(update): compare tagged installs by installed release`.

**Files:**
- `bin/update` — installed tag/version detection
- `bin/conduct` — shared legacy helper compatibility if still duplicated
- `test/test_bin_update.sh` — #1005 regression fixtures

**Wired-into:** `bin/update#check_harness_update`, `bin/conduct#check_harness_update`  
**Dependencies:** Task 16

### Task 18: Retire feature changelog finalization from FINISH

**Story:** TI-1, TI-3, and issue boundary for #1172 — feature branches never author/finalize release entries  
**Type:** refactor

**Steps:**
1. Write failing regression tests proving FINISH no longer blocks on or invokes `{{IMPLEMENTATION_PR}}` finalization while unrelated finish/shipped-record behavior remains.
2. Verify RED against the legacy path.
3. Remove the finalizer dispatch/call and changelog token completion predicate; delete dead finalizer code/tests only after reachability proves no caller remains.
4. Verify GREEN in focused finish/artifact/index tests.
5. Commit `refactor(finish): retire feature changelog finalization`.

**Files:**
- `src/conductor/src/engine/changelog-pr-finalizer-cli.ts` — remove obsolete primitive
- `src/conductor/test/engine/changelog-pr-finalizer-cli.test.ts` — remove obsolete contract
- `src/conductor/src/engine/artifacts.ts` — remove token completion guard
- `src/conductor/test/engine/artifacts.test.ts` — new no-token regression
- `src/conductor/src/engine/conductor.ts` — remove finish finalizer wiring
- `src/conductor/src/index.ts` — remove command dispatch/export

**Wired-into:** none (removes an obsolete production surface; broader FINISH remains tracked by #1172)  
**Dependencies:** Tasks 3, 12

### Task 19: Remove changelog-specific rebase union behavior

**Story:** TI-4 and issue boundary for #1152 — no shared changelog conflict target, generic rebase safety preserved  
**Type:** refactor

**Steps:**
1. Add failing regression tests proving ordinary rebase conflict/HALT behavior remains after changelog-special-case removal.
2. Verify RED or characterize the legacy-special-case assertion being replaced.
3. Remove only `[Unreleased]` addition capture/union/autoresolution helpers and their special branches; retain generic resolver and verification seams.
4. Verify GREEN in focused rebase tests.
5. Commit `refactor(rebase): remove changelog union special case`.

**Files:**
- `src/conductor/src/engine/rebase.ts` — remove changelog-specific conflict machinery
- `src/conductor/test/engine/rebase.test.ts` — generic conflict/replay regression coverage

**Wired-into:** none (removes obsolete special handling; generic `src/conductor/src/engine/conductor.ts#runRebase` remains)  
**Dependencies:** Tasks 3, 18

### Task 20: Produce the one-time audited release backlog transition

**Story:** TI-7 — include/consolidate/exclude proposal, operator approval input, uncertainty, and rerun refusal  
**Type:** infrastructure

**Steps:**
1. Create a failing transition check that requires every legacy `[Unreleased]` entry and relevant post-tag PR to have an included, consolidated, excluded, or unresolved audit disposition.
2. Verify RED against the current uncurated backlog.
3. Use the build session's semantic judgment once to generate the audit and cleaned proposed backlog; encode unresolved items explicitly and add a consumed-once transition guard for the release-PR maintainer.
4. Verify GREEN for exhaustive accounting, migration ordering, and refusal to rerun after transition completion; leave the exact proposal visible for operator PR approval.
5. Commit `chore(release): propose audited backlog transition`.

**Files:**
- `CHANGELOG.md` — one-time cleaned pending set (transition exception to steady-state ownership)
- `.github/release-transition-audit.md` — one-time exhaustive include/consolidate/exclude/unresolved evidence consumed by the first release PR
- `src/conductor/src/engine/release-pr-action.ts` — transition guard/seed handling
- `src/conductor/test/engine/release-pr-action.test.ts` — seed and rerun-refusal cases
- `test/test_release_unreleased_state.sh` — migration ordering/legacy accounting checks

**Wired-into:** `src/conductor/src/engine/release-pr-action.ts#runReleasePrAction`  
**Dependencies:** Tasks 6, 8, 12, 13, 16

## Task Dependency Graph

```text
1 -> 2 -> 3
2 -> 4 -> 5
1,4 -> 6
1,2 -> 7 -> 8
6,8 -> 9 -> 10 -> 11 -> 12
8,11 -> 13
6,13 -> 14 -> 15
12,15 -> 16 -> 17
3,12 -> 18 -> 19
6,8,12,13,16 -> 20
```

## Integration Points

- After Task 5: implementation PR metadata can satisfy or fail the existing breaking-migration/waiver gate without feature changelog edits.
- After Task 8: a complete, ordered, auditable post-tag release set can be derived with no GitHub side effects.
- After Task 13: merged implementation events can maintain one checked, reviewable release PR through faked adapters.
- After Task 16: a proven release-PR merge is the only publication authority; ordinary main merges are no-release events.
- After Task 17: the published tag is discoverable by default tagged installations even when repository `VERSION` is forward-looking.
- After Task 20: the first release PR can present the operator-approved backlog transition and then enter deterministic steady state.

## Advisory Overlap Scan

The required scan reported broad overlap across many existing `spec/*` branches because this feature intentionally changes high-traffic shared surfaces including `src/conductor/src/index.ts`, `conductor.ts`, `artifacts.ts`, `rebase.ts`, the release gate/workflow, `bin/update`, `bin/conduct`, and the legacy `CHANGELOG.md`. The scan is advisory and name-only/rename-limited; execution should sequence removals late (Tasks 18–20), regenerate from current main at task time, and rely on finish-time integration rather than assuming these files remain static.

## Acceptance-Criteria Coverage

| Story | Criteria | Tasks |
|---|---|---|
| TI-1 | valid note/no-note, malformed/contradictory/untrusted input, template and normalized output | 1, 2, 3, 18 |
| TI-2 | runnable migration, semver maximum, waiver, malformed/missing/contradictory failure | 4, 5, 6 |
| TI-3 | App-authored create/update, ordinary checks, event exclusions, credential and foreign-PR failure | 9, 10, 12 |
| TI-4 | concurrency, duplicate idempotency, stale main, partial failure and reconstruction | 10, 11, 12, 19 |
| TI-5 | exhaustive audit, pagination, rendered changelog/version, gaps, identical notes, foreign edits | 6, 7, 8, 10, 13 |
| TI-6 | proven publication, no-release path, tag/main installs, provenance rejection, partial recovery, #1005 | 14, 15, 16, 17 |
| TI-7 | one-time proposal, consolidation, unresolved escalation, approval input, rerun refusal | 20 |

## Verification

- [x] Every happy and negative acceptance criterion maps to at least one behavior-owning task.
- [x] GitHub, Git, clock, and process boundaries are injected or exercised through bounded local fixtures; ordinary tests make no real third-party calls.
- [x] Every task has explicit dependencies and a design-derived `Wired-into:` contract.
- [x] The graph is acyclic and contains no terminal catch-all validation task.
- [x] Task count is 20, within the normal 1–20 range.
- [x] Open-issue boundaries are explicit: absorbed work is implemented here and broader residual outcomes remain separately tracked.
