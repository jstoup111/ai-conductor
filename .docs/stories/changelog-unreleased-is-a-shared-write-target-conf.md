**Status:** Accepted

# Technical Stories: Bot-owned release PR

## Story TI-1: Every implementation PR has one release disposition

As a maintainer, I want every implementation PR to declare structured release metadata or an explicit no-note disposition so that merged work is exhaustively classified without editing shared release files.

### Acceptance Criteria

#### Happy Path

- Given an implementation PR with one supported release category, a non-empty reader-facing note, and one semver impact, when its required release-metadata check runs, then the check succeeds and exposes the normalized disposition for later collection.
- Given a non-notable, specification-only, documentation-only, or no-implementation PR with the explicit no-note disposition, when the check runs, then it succeeds without requiring a note or semver impact.

#### Negative Paths

- Given a PR with a missing disposition, multiple dispositions, an unsupported category, an empty note, or a missing/invalid semver impact, when the check runs, then it fails with the exact invalid field and no normalized disposition is emitted.
- Given a no-note PR that also supplies a note, category, or semver impact, when the check runs, then it fails as contradictory rather than silently choosing one branch.
- Given untrusted note text containing shell syntax, workflow expressions, HTML, or Markdown links, when it is parsed, then it remains inert data and cannot alter workflow execution.

### Done When

- [ ] Fixture-driven checks prove every valid and invalid disposition shape.
- [ ] The pull-request template contains one unambiguous structured contract and no instruction to edit `CHANGELOG.md` or `VERSION`.
- [ ] The normalized result is machine-readable by the release candidate collector.

## Story TI-2: Breaking migrations and semver intent survive the new representation

As a release owner, I want breaking-change migration content and semver intent validated before merge so that the single-writer flow preserves the existing consumer safety gates.

### Acceptance Criteria

#### Happy Path

- Given a PR touching a canonical breaking surface, when it supplies a runnable migration block in its structured release metadata, then the release gate succeeds and the eventual release note preserves the block in a form `bin/migrate` can execute.
- Given merged candidates with different semver impacts, when the release set is rendered, then its proposed version uses the highest impact under the repository's MAJOR/MINOR/PATCH rules.
- Given a path-classifier false positive covered by a fresh valid release waiver, when the gate runs, then the waiver behavior remains unchanged.

#### Negative Paths

- Given a breaking-surface PR with no runnable migration block, when its release gate runs, then it fails before merge even if an ordinary release note exists.
- Given malformed migration content or a migration attached to an explicit no-note disposition, when validation runs, then it fails rather than losing executable consumer instructions.
- Given contradictory or unknown semver impacts, when the release set is rendered, then rendering fails without changing the release branch.

### Done When

- [ ] Existing migration-block and waiver fixtures pass against the structured source and rendered changelog.
- [ ] Semver aggregation tests prove `major > minor > patch` and refuse unknown values.
- [ ] Feature branches no longer need to edit `VERSION` to request a non-patch release.

## Story TI-3: A merged implementation PR updates one bot-owned release PR

As the operator, I want a GitHub-managed release PR updated after implementation merges so that the exact pending changelog and version remain reviewable under ordinary PR protections.

### Acceptance Criteria

#### Happy Path

- Given an eligible implementation PR merged to `main`, when the maintainer workflow runs with the repository GitHub App installation token, then it collects merged candidate dispositions since the latest tag and creates or regenerates the designated bot-owned release branch and PR from current `main`.
- Given an existing open release PR, when another implementation PR merges, then the same branch and PR are updated rather than creating a second pending release PR.
- Given the App-authored branch update, when GitHub emits pull-request events, then the repository's ordinary required checks run against the new release head.

#### Negative Paths

- Given a closed but unmerged PR, a merged release PR, or the release workflow's own commit, when the maintainer event filter runs, then it performs no candidate mutation and does not recurse.
- Given missing or invalid App credentials or insufficient repository permissions, when maintenance starts, then it fails visibly without falling back to `GITHUB_TOKEN` or partially mutating the branch.
- Given an existing release PR whose identity, base, or head branch does not match the designated bot-owned contract, when maintenance runs, then it fails closed without modifying the unexpected PR.

### Done When

- [ ] Workflow tests prove create, update, and no-op event paths using faithful GitHub fakes.
- [ ] Exactly one designated release PR can be open for the pending set.
- [ ] App permission requirements and failure diagnostics are mechanically verified.

## Story TI-4: Concurrent and retried maintenance cannot lose candidates

As a maintainer, I want release-PR updates serialized and idempotent so that rapid merges, retries, and stale runs cannot overwrite newer pending work.

### Acceptance Criteria

#### Happy Path

- Given multiple implementation merges close together, when maintenance runs overlap, then one repository-wide concurrency group serializes them and each completed run regenerates from the latest `main` and complete post-tag candidate set.
- Given the same merge event delivered or retried more than once, when maintenance reruns, then it produces the same release branch contents and does not duplicate notes or candidate evidence.

#### Negative Paths

- Given `main` advances after candidate collection but before push, when the workflow performs its final head check, then it rejects or retries the stale result rather than overwriting a release branch based on old evidence.
- Given branch push succeeds but PR creation/update fails, when a later maintenance run starts, then it reconciles the known bot branch and creates or updates the one expected PR without creating a duplicate branch.
- Given rendering, validation, network access, or push fails, when maintenance exits, then no incomplete release commit is presented as ready and the next run can reconstruct state from GitHub and Git alone.

### Done When

- [ ] Concurrency, duplicate-event, stale-head, and partial-failure tests prove no candidate loss or duplicate release PR.
- [ ] Regeneration is content-idempotent for an unchanged tag-to-main range.
- [ ] No untracked local ledger is required for recovery.

## Story TI-5: The release PR proves candidate completeness and final output

As the operator, I want the release PR to show both the reader-facing result and an exhaustive candidate audit so that I can approve omissions and the computed version knowingly.

### Acceptance Criteria

#### Happy Path

- Given all merged PRs since the latest release tag, when the release PR is rendered, then every PR appears exactly once as included, explicitly no-note, or transition-excluded with a reason, while only included entries appear in the reader-facing changelog section.
- Given more candidates than one GitHub API page, when collection runs, then it follows pagination to exhaustion and proves the audit count against the authoritative tag-to-main merge range.
- Given the pending dispositions, when rendering completes, then `CHANGELOG.md` contains the proposed version section in the existing reader-facing shape and `VERSION` contains the approved next-version value dictated by the release convention.

#### Negative Paths

- Given a merged PR with no valid disposition, duplicate classification, an unreachable page, or an unexplained gap between Git and GitHub evidence, when completeness validation runs, then the release PR is not marked ready and no partial candidate set is silently rendered.
- Given two candidates that happen to have identical note text, when rendering runs, then both remain separately auditable rather than being deduplicated by text and losing provenance.
- Given the release branch contains a manual or foreign edit outside the generated release surfaces, when regeneration runs, then it fails visibly rather than overwriting unowned content.

### Done When

- [ ] The release PR presents the final changelog/version diff and a one-to-one candidate disposition audit.
- [ ] Pagination and Git/GitHub completeness fixtures cover empty, single-page, and multi-page ranges.
- [ ] A required release-head check blocks approval on any unexplained candidate.

## Story TI-6: Only an approved release PR publishes a tag

As the operator, I want release publication tied to the approved release PR so that ordinary main pushes cannot accidentally tag incomplete work.

### Acceptance Criteria

#### Happy Path

- Given the designated release PR passes required checks and is merged by the operator, when the publisher runs, then it verifies provenance and candidate completeness, commits any deterministic post-release state required by the version convention, creates the computed annotated tag, and publishes a GitHub Release from the approved changelog section.
- Given publication succeeds, when tagged-channel and main-channel installations update, then tagged installations resolve the new tag and main installations continue resolving `main` without any package registry.
- Given a tagged-channel installation whose checkout/recorded installed tag is older than the newest published tag while repository `VERSION` is already forward-looking, when update detection runs, then it compares the installed release identity to tags and reports the available update instead of treating `VERSION` as the installed version.
- Given there are no eligible release notes, when maintenance evaluates the pending set, then it does not open an empty release PR or publish an empty release.

#### Negative Paths

- Given an ordinary implementation merge, a foreign PR, a direct push, or a release PR with failed/stale checks, when the publisher event filter runs, then no tag, release, changelog rewrite, or version mutation occurs.
- Given the target tag already exists, provenance is invalid, the approved changelog section is missing, or candidate evidence is incomplete, when publishing starts, then it fails before mutating Git or GitHub release state.
- Given tag creation succeeds but GitHub Release creation fails, when recovery runs, then it detects the existing tag and can finish the same release without creating a different version or duplicate tag.
- Given a tagged installation's installed release identity cannot be determined, when update detection runs, then it reports an unverifiable installed version and does not silently claim the installation is current.

### Done When

- [ ] Publisher tests prove positive provenance and every non-release main-push rejection.
- [ ] Tag/release retry tests prove idempotent recovery across partial external failure.
- [ ] Existing tagged/main installer tests pass without package-manager configuration.
- [ ] Regression tests cover #1005's older installed tag plus ahead-of-latest repository `VERSION` and prove the update is detected.

## Story TI-7: The legacy pending set is cleaned once before steady state

As the operator, I want automation to propose a consolidated first release set so that historical implementation repairs do not become reader-facing release noise.

### Acceptance Criteria

#### Happy Path

- Given the current `[Unreleased]` entries and merged PR evidence since the latest tag, when the one-time cleanup runs, then it proposes final reader-facing entries plus an audit mapping every legacy entry and relevant PR to included, consolidated, or excluded with a reason.
- Given several PRs implement and then repair one not-yet-released capability, when cleanup analyzes them, then it proposes one entry describing the final delivered behavior and marks the intermediate repairs as consolidated rather than separate release notes.
- Given the proposal, when the operator approves it, then the approved result seeds the first bot-owned release PR and recurring maintenance does not rerun semantic AI curation.

#### Negative Paths

- Given cleanup cannot confidently relate an entry to merged evidence or determine whether it is reader-relevant, when it produces the proposal, then it marks the item unresolved for operator decision rather than excluding it silently.
- Given the operator rejects or edits the proposal, when transition state is prepared, then only the operator-approved list seeds the first release PR.
- Given cleanup is invoked after the transition has been recorded complete, when it runs, then it refuses to overwrite the established steady-state release set.

### Done When

- [ ] The transition proposal accounts for every legacy `[Unreleased]` entry and relevant merged PR.
- [ ] Operator approval is captured before the first release PR can publish the cleaned set.
- [ ] The recurring maintainer contains no semantic AI/provider dependency.
