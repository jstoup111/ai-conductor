# ADR: Use a bot-owned release PR as the sole pending-release writer

**Date:** 2026-08-01  
**Status:** APPROVED  
**Deciders:** James Stoup and the ai-conductor architecture review
**Supersedes:** `adr-2026-07-25-notable-change-release-trigger`, `adr-2026-07-25-changelog-pr-link-finalization`

## Context

Every concurrent feature currently edits the same `CHANGELOG.md` `[Unreleased]` block. Rebases therefore require semantic conflict resolution and can copy, duplicate, or misclassify another feature's entry. `VERSION` is another potential shared write target when a feature requests a non-patch release.

The solution is deliberately repository-local. It depends on ai-conductor's GitHub repository, custom release gate, `VERSION`, tagged/main update channels, and release workflow; it does not change the release convention installed into consumer repositories.

This decision absorbs the intended outcomes of GitHub issues #217, #218, #282, and #1005. It coordinates with #158 through a reusable GitHub App authentication seam without absorbing that issue's broader daemon/issue-mutation scope. It removes changelog-specific triggers from #1152 and #1172 without superseding their broader rebase-verification and FINISH-transaction outcomes. The post-release multi-version migration exercise in #219 remains separate.

The recurring path must be deterministic. Semantic consolidation of the already-accumulated `[Unreleased]` backlog is a one-time transition task whose proposal requires operator approval.

## Options Considered

### Option A: Bot-owned release PR maintained after implementation merges

- **Pros:** gives `CHANGELOG.md` and `VERSION` one writer; produces an ordinary reviewable diff; uses existing branch protection and checks; keeps release publication deterministic; preserves tagged and main update channels.
- **Cons:** requires a repository GitHub App credential, serialized workflow updates, structured PR metadata, and explicit transition handling for the existing backlog.

### Option B: GitHub draft release as the pending source

- **Pros:** avoids a pending Git branch and minimizes interim repository changes.
- **Cons:** makes mutable GitHub draft state authoritative until publication and delays review of the exact changelog diff.

### Option C: Per-feature files or Git metadata

- **Pros:** avoids a shared feature write target.
- **Cons:** leaves permanent release-record duplication, add/delete churn, or fragile dependence on squash/commit metadata.

## Decision

Adopt Option A.

After an implementation PR merges, a serialized GitHub Actions workflow collects authoritative structured release metadata from merged PRs since the latest release tag and creates or regenerates one bot-owned release branch and PR. Implementation branches do not edit `CHANGELOG.md` or `VERSION` in the steady state.

Each implementation PR declares:

- one release-note category and reader-facing note, or an explicit no-note disposition; and
- a semver impact of patch, minor, or major when a release note is present.

A required deterministic PR check rejects missing, contradictory, or malformed dispositions before merge. The release PR renderer includes every merged PR in an auditable disposition set, renders only eligible notes, chooses the highest declared semver impact, and regenerates idempotently from the latest `main` plus merged-PR evidence since the latest tag.

The workflow authenticates with a narrowly scoped GitHub App installation token rather than the repository `GITHUB_TOKEN`. This allows ordinary pull-request workflow events and required checks to run on bot-authored updates. The App receives only the repository contents and pull-request permissions required to maintain the dedicated branch and PR.

The operator approves the consolidated notes and computed version by merging the release PR. A separate deterministic publisher verifies that the merge came from the designated release PR and that its candidate/disposition evidence is complete, then creates the tag and GitHub Release. Tagged-channel installations receive the change at that tag; main-channel installations continue to consume `main`. No package manager is introduced.

Tagged-channel update detection derives the installed release identity from the checked-out/recorded tag, never from the repository's forward-looking `VERSION` value. This closes the always-ahead comparison failure tracked in #1005 while leaving main-channel identity explicit.

As a one-time transition, automation analyzes the current `[Unreleased]` entries plus merged PR evidence since the latest tag, removes intermediate repairs to unreleased work, consolidates related changes into final reader-facing outcomes, and records inclusion/exclusion reasons. The operator approves this proposal. Recurring GitHub Actions maintenance performs no semantic AI curation.

## Consequences

### Positive

- Concurrent implementation branches no longer conflict on pending changelog or version edits.
- The exact release is reviewable under ordinary PR protections before publication.
- Candidate completeness, exclusions, and semver selection can be checked mechanically.
- Recovery uses an ordinary dedicated Git branch and PR.
- The existing Git-based installation and update channels remain intact.

### Negative

- The repository must provision and rotate a GitHub App private key and installation identifier.
- PR authors or automation must supply structured release metadata accurately.
- The maintainer workflow must safely regenerate a dedicated branch while serializing concurrent merges.
- The transition needs an explicit one-time exception because the legacy `[Unreleased]` backlog predates structured PR metadata.

### Follow-up Actions

- [ ] Define the structured PR metadata and deterministic validation contract.
- [ ] Implement the serialized release-PR maintainer with GitHub App authentication.
- [ ] Define branch identity, idempotent regeneration, stale-run protection, and recovery behavior.
- [ ] Separate release-PR maintenance from deterministic publication.
- [ ] Replace feature-time changelog and VERSION gates with metadata/completeness gates.
- [ ] Remove obsolete inherited-token and changelog-rebase machinery after compatibility checks.
- [ ] Produce and approve the one-time culled/consolidated backlog.
- [ ] Update repository-local release, contribution, CI, and recovery documentation.
