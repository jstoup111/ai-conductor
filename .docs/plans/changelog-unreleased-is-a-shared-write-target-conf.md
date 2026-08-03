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

**Sequencing amendment (operator-approved).** The original task specified the gate's
*input shape* but never sequenced where the metadata comes from in production, leaving
`runSelfHostFinishGates` calling `guardrails.releaseGate` with no metadata. The omission is
an ordering problem, not a missing call:

- `src/conductor/src/engine/conductor.ts:4143` runs the self-host release gates **before**
  `finish`, deliberately, so the daemon never opens a PR behind a failing gate.
- The release disposition lives in the implementation PR body.
- At gate time that body is still the SHIP-start placeholder — `ship-draft-pr.ts:143-160`
  writes `SHIP_DRAFT_PR_NOTE`, and `/finish` authors the real body afterward.

**Resolution: finalize the metadata onto the existing draft PR before the pre-finish gate.**
The pre-finish safety boundary does not move. The draft PR identity opened at SHIP start is
retained through SHIP entry; its body is finalized with the structured release disposition
ahead of the gate; the gate reads and parses that body through the conductor's injected
GitHub boundary. `/finish` continues to author the reader-facing title/body and mark the PR
ready — finalizing metadata must not pre-empt that.

**Disposition authority (operator decision, resolves `stall:disposition-authority`).** The
authoritative pre-gate writer is a new **repository-local custom step, `release-disposition`**,
declared in this repo's `.ai-conductor/config.yml` and anchored `after: maintain-documentation`
— immediately before `finish`. It judges the feature's own diff and authors the structured
disposition (`Release-Disposition` / `Release-Category` / `Release-Semver` / `Release-Note`, plus
any runnable migration block) **directly onto the retained SHIP draft PR body**, then the gate
reads that body. `/finish` continues to author the reader-facing title/body afterward and must
not clobber the metadata block.

Why a custom step rather than engine code:

- **Self-host-only by construction.** The step exists only in this repository's config, which
  consumers do not have — no `isSelfBuild()` branch is added to the engine. This is the same
  mechanism and precedent as the existing `maintain-documentation` custom step.
- **Ordering is expressible and verified.** `after` accepts a built-in or an earlier custom step
  (`src/conductor/src/engine/steps.ts:532-533`), and the step registry that the pre-finish gate
  iterates is built by `buildStepRegistry` (`src/conductor/src/engine/conductor.ts:2557`), so a
  step anchored before `finish` runs before the gate at `conductor.ts:4143` — daemon path included.
- **No new authority ledger.** The step writes to the PR body, so merged PR metadata remains the
  single authority per the ADR; `completion_artifact` is evidence only, never the source of truth.
- **Gate-loop membership is inherited.** A custom step inserted among the loop steps joins the
  gate loop automatically, so a downstream kickback can re-open it.

The step's skill lives in the repository-local catalog (`.agents/skills/release-disposition/SKILL.md`)
per `scope-check`, not the shipped `skills/` catalog.

**Fail-closed requirement, scoped to the active flow (operator decision).** The gate now
depends on a GitHub read, which can fail offline (observed: the daemon logging
`fetch origin main failed (offline?)`). The fail-closed rule applies **only when the
release-disposition flow is active** — i.e. `releaseDispositionFlowActive()`: a self-build
whose config declares the `release-disposition` step. Metadata resolution MUST be guarded by
that predicate; an unguarded resolver breaks every self-host finish that has no draft PR.

When the flow is active:

- Unreachable GitHub, an unresolvable PR identity, an absent disposition, and a malformed
  disposition MUST each produce a HALT verdict — never a pass, never a silent skip of the
  migration check.
- An explicit `Release-Disposition: no-note` MUST **pass**. It is a valid, deliberate
  disposition, and this repository's release rule already exempts documentation-only,
  specification-only, and internal non-notable changes from a changelog entry. A docs-only
  self-build therefore receives `no-note` from the `release-disposition` step and clears the
  gate without an entry.

When the flow is **not** active, `runSelfHostFinishGates` behaves exactly as it did before
this feature: no metadata is resolved and no metadata-derived HALT is possible.

**Steps:**
1. Write failing release-gate tests that supply structured metadata rather than feature-owned changelog content.
2. Verify RED.
3. Refactor the gate input to validate the parsed runnable migration block for classified breaking surfaces.
4. Add the `release-disposition` repository-local custom step: its SKILL.md, its `.ai-conductor/config.yml` declaration (`after: maintain-documentation`, `enforcement: gating`, `completion_artifact`, `llm_provider: claude`), and a registry test proving it is inserted before `finish`.
5. Finalize the structured disposition onto the retained draft implementation PR before the pre-finish gate, then resolve, parse, and pass it into `guardrails.releaseGate` from `runSelfHostFinishGates` through the injected GitHub boundary.
6. Verify GREEN, including exact `bin/migrate`-compatible fence preservation, and prove through the production caller that: a classified breaking surface with runnable PR-metadata migration passes; unreachable, missing, and malformed metadata each HALT; an explicit `no-note` disposition passes; and a self-build with the flow inactive reaches the gates unchanged (regression coverage for `harness-daemon-profile.test.ts` and `codex-self-host-isolation.acceptance.test.ts`).
7. Commit `feat(release): validate migrations from PR metadata`.

**Files:**
- `src/conductor/src/engine/self-host/release-gate.ts` — structured migration input
- `src/conductor/test/engine/self-host/release-gate.test.ts` — breaking/malformed cases
- `src/conductor/src/engine/release-metadata.ts` — migration field representation
- `src/conductor/src/engine/conductor.ts` — resolve/parse the implementation PR disposition and supply `releaseMetadata` to `guardrails.releaseGate`; fail closed when it cannot be resolved
- `src/conductor/src/engine/ship-draft-pr.ts` — retain draft PR identity and finalize release metadata onto its body before the pre-finish gate
- `src/conductor/test/engine/self-host/wiring.test.ts` — production-path coverage: metadata reaches `releaseGate`; unreachable/missing/malformed each HALT
- `.agents/skills/release-disposition/SKILL.md` — repository-local skill: judge the diff, author the structured disposition onto the draft PR body
- `.ai-conductor/config.yml` — `release-disposition` custom-step declaration (`after: maintain-documentation`, gating, completion artifact)
- `src/conductor/test/engine/steps.test.ts` — registry coverage proving `release-disposition` inserts before `finish` and joins the gate loop
- `docs/reference/steps.md` — document the new step (required by the repo's documentation-upkeep rule)

**Wired-into:** `src/conductor/src/engine/conductor.ts#runSelfHostFinishGates`
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

**Authentication-contract amendment (operator decision, resolves the as-built
`adr-2026-08-01-bot-owned-release-pr` HALT).** The as-built review found
`releasePrGithubAppAuth` (`src/conductor/src/engine/github-app-auth.ts:6`) unreachable:
exported at `src/conductor/src/index.ts:9`, referenced only by its own unit test, while both
workflows hardcode the same secret names and permissions in YAML. **Resolution: delete the
constant, its unit test, and its index export.** The YAML is the sole source of truth for App
authentication.

Rationale:

- **A TS constant can never be authoritative here.** GitHub Actions resolves
  `${{ secrets.* }}` during YAML evaluation; a workflow's secret reference cannot be
  parameterized from TypeScript. The constant could only ever mirror the YAML, never drive it.
- **The drift guard already exists, closer to the truth.** `test/test_release_pr_workflow.sh:30-34`
  already asserts `app-id: ${{ secrets.RELEASE_PR_APP_ID }}`,
  `private-key: ${{ secrets.RELEASE_PR_APP_PRIVATE_KEY }}`, and the
  `permission-contents/pull-requests/checks: write` stanzas directly against the workflow.
  A second test comparing YAML to a constant nothing else reads would be a tautological guard.
- **No security difference.** The module holds secret *names*, never values; values live in
  GitHub Actions secrets under every alternative.

Deleting is therefore a scope correction, not a capability loss: the shipped behavior the
module claimed to provide is already provided, and already tested, at the workflow boundary.

**Steps:**
1. Extend failing structural workflow tests for App-token creation, minimum permissions, closed-and-merged filtering, one concurrency group, and release-PR recursion exclusion.
2. Verify RED.
3. Add the maintainer workflow using the App credential stanzas declared directly in YAML.
4. Delete `src/conductor/src/engine/github-app-auth.ts`, its unit test, and its `src/conductor/src/index.ts` export; confirm no remaining reference in `src/`, `.github/`, `bin/`, `skills/`, or `.agents/`.
5. Verify GREEN without contacting GitHub, with `test/test_release_pr_workflow.sh:30-34` retained as the authentication-contract guard.
6. Commit `ci(release): maintain one serialized release PR`.

**Files:**
- `.github/workflows/release-pr.yml` — merge trigger, App token, concurrency, action call
- `test/test_release_pr_workflow.sh` — workflow contract assertions, including the App auth guard
- ~~`src/conductor/src/engine/github-app-auth.ts`~~ — deleted; YAML is the sole source of truth
- ~~`src/conductor/test/engine/github-app-auth.test.ts`~~ — deleted with the module
- `src/conductor/src/index.ts` — drop the `releasePrGithubAppAuth` export

**Wired-into:** `.github/workflows/release-pr.yml#release-pr-maintenance` (workflow-declared auth; no engine module)  
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

### Task 20: Deliver the release backlog transition mechanism and its unresolved audit

**Story:** TI-7 — include/consolidate/exclude proposal, operator approval input, uncertainty, and rerun refusal  
**Type:** infrastructure

**Scope amendment (operator-approved, supersedes the original Task 20).** The original
task directed the build session to exercise semantic judgment once and emit a *cleaned
pending set* into `CHANGELOG.md`. That curation is explicitly **out of scope for this
feature** and is deferred to issue #217 ("Condense and correct CHANGELOG [Unreleased]
before re-enabling releases"), for two reasons:

1. **No authoritative mapping.** The checkout has no offline mapping from legacy changelog
   prose or commit-message `#NNN` references to merged GitHub PR metadata. Any disposition
   the build session invented would convert uncertainty into a silent exclusion — the exact
   failure the transition guard exists to prevent.
2. **Ordering.** #217 requires the curation to land alone, immediately before the
   release-workflow fix (#218), with nothing else in flight. Performing it inside a feature
   build violates that constraint.

This feature therefore delivers the transition **mechanism** plus an exhaustive,
deliberately-unresolved audit; #217 resolves the dispositions and rewrites `[Unreleased]`.
The guard fails closed in the interim: the first bot-owned release PR refuses to seed while
the audit status is not `approved` or any item remains unresolved.

**Steps:**
1. Create a failing transition check that requires every legacy `[Unreleased]` entry and relevant post-tag PR to have an included, consolidated, excluded, or unresolved audit disposition.
2. Verify RED against the current uncurated backlog.
3. Generate the exhaustive audit inventory with content hashes, recording every item as `unresolved` and naming #217 as the resolver; add a consumed-once transition guard for the release-PR maintainer.
4. Verify GREEN for exhaustive accounting, migration ordering, refusal to seed while unapproved or unresolved, and refusal to rerun after transition completion.
5. Commit `chore(release): propose audited backlog transition`.

**Files:**
- `CHANGELOG.md` — legacy `[Unreleased]` left intact behind a pointer comment to the audit; curation deferred to #217 (no cleaned pending set in this feature)
- `.github/release-transition-audit.md` — one-time exhaustive include/consolidate/exclude/unresolved evidence consumed by the first release PR
- `src/conductor/src/engine/release-pr-action.ts` — transition guard/seed handling
- `src/conductor/test/engine/release-pr-action.test.ts` — seed and rerun-refusal cases
- `test/test_release_unreleased_state.sh` — migration ordering/legacy accounting checks

**Wired-into:** `src/conductor/src/engine/release-pr-action.ts#runReleasePrAction`  
**Dependencies:** Tasks 6, 8, 12, 13, 16

### Task 21: Realign contributor instructions with the shipped release flow

**Story:** TI-5 — contributors and agents follow the shipped release path, not the retired one  
**Type:** infrastructure

Added by operator decision from the as-built architecture review (non-blocking findings 2
and 4). `docs/contributing/releases.md` was updated during the build; `CLAUDE.md` was not.
Its "Release & Update Gates" section still directs contributors to add entries under
`[Unreleased]` and to put migration blocks in `CHANGELOG.md`, and still describes the retired
CI rewrite ("reads `VERSION`, tags, rewrites the `[Unreleased]` block"). Left stale, agents
keep writing to the shared target this feature exists to eliminate — the instruction file
would actively defeat the feature.

**Steps:**
1. Rewrite `CLAUDE.md`'s "Release & Update Gates" section to the shipped flow: release intent is declared in implementation-PR metadata; migration blocks travel in that metadata; the bot-owned release PR is the only writer of `CHANGELOG.md`/`VERSION`.
2. Preserve the rules that survive unchanged — the migration-block requirement for breaking changes, the waiver mechanism and its canonical surface names, and the semver tiers.
3. Correct the architecture document header from "Proposed repository-local flow" to as-built wording.
4. Verify no remaining instruction anywhere in `CLAUDE.md` or `AGENTS.md` tells an author to hand-edit `CHANGELOG.md`'s `[Unreleased]`, and that root agent-instruction parity still passes.
5. Commit `docs(release): realign contributor instructions with the shipped flow`.

**Files:**
- `CLAUDE.md` — "Release & Update Gates" rewritten to the PR-metadata flow
- `AGENTS.md` — kept in parity (integrity check 15)
- `.docs/architecture/changelog-unreleased-is-a-shared-write-target-conf.md` — as-built header wording

**Wired-into:** none (contributor and agent instructions; no runtime surface)  
**Dependencies:** Tasks 17, 18, 20

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
17,18,20 -> 21
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
