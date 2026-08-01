# Architecture Review: Bot-owned release PR

**Date:** 2026-08-01  
**Tier:** Medium  
**Input reviewed:** approved technical intent and `.docs/architecture/changelog-unreleased-is-a-shared-write-target-conf.md`  
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** Verified. The repository already uses GitHub Actions, `actions/github-script`, a built TypeScript action seam, PR write permissions, Git tags, and a deterministic release workflow. A GitHub App token is the only new credential boundary; no package manager or external release service is required.
- **Prerequisites:** Create a narrowly scoped repository GitHub App installation and configure its App ID/private-key secrets. Repository settings must allow the App to create/update the dedicated branch and PR while preserving branch protections.
- **Integration surface:** The design crosses the PR template/check, release-PR maintenance workflow, changelog renderer, release gate, publisher workflow, and existing changelog finalization/rebase helpers. These are cohesive parts of one repository-local release domain.
- **Data/backfill:** There is no database migration. The legacy `[Unreleased]` block is a one-time semantic backfill input; inclusion/exclusion evidence must be retained in the transition artifact or release PR.
- **Performance:** The bounded set is merged PRs since the latest tag. Pagination must be explicit; the workflow must fail closed rather than silently truncate candidates.
- **Worktree isolation:** Normal feature work no longer writes the shared release files. The bot branch is the sole mutable pending-release workspace and workflow concurrency serializes all updates.

## Architectural Alignment

- **Deterministic-first:** Candidate collection, metadata validation, semver maximum, rendering, completeness, provenance, and publishing are mechanical. AI judgment is restricted to the one-time legacy cleanup proposal, followed by operator approval.
- **Repository-only placement:** CI, release-gate, contributor instructions, and release documentation change locally. `HARNESS.md` consumer behavior remains unchanged.
- **Single source and writer:** Merged PR metadata is authoritative for pending candidate dispositions; the release PR is authoritative for the exact proposed changelog/version diff; released `CHANGELOG.md` sections and Git tags remain published history.
- **State transitions:** `absent/open/update-ready/approved/merged/published` transitions are derived from GitHub branch/PR/tag state. The design must not introduce an untracked local ledger as authority.
- **Security:** A GitHub App token is scoped to the repository and only the contents/pull-request permissions needed for branch and PR maintenance. Untrusted PR-authored metadata is parsed as data and must never be interpolated into shell commands or executable workflow expressions.
- **Installation compatibility:** Tagged consumers update only after publication creates a tag; main-channel consumers continue fetching main. No registry/package publishing path is added.

## Wiring Surface

| Production surface | Design-time production caller |
|---|---|
| Structured release metadata parser/validator | Required pull-request check for implementation PR open/update events |
| Release candidate collector and renderer | Release-PR maintainer action invoked after an implementation PR merges |
| GitHub App authentication seam | Release-PR maintainer workflow before branch/PR mutations |
| Serialized release-PR upsert | Maintainer workflow, guarded by a repository-wide concurrency group and latest-main recheck |
| Release-set completeness/provenance verifier | Release PR checks and the post-merge publisher before tagging |
| Deterministic publisher | Push-to-main workflow only when the merged PR is the designated release PR |
| One-time cleanup proposal | Transition task run once against current `[Unreleased]` and merged PR evidence, then reviewed by the operator |

Candidate paths: `.github/workflows/release-pr.yml`, `.github/workflows/release.yml`, `.github/pull_request_template.md`, `.github/scripts/`, `src/conductor/src/engine/self-host/release-gate.ts`, `src/conductor/src/engine/changelog-pr-finalizer-cli.ts`, `src/conductor/src/engine/rebase.ts`, `CHANGELOG.md`, `VERSION`, and `docs/contributing/releases.md`.

Early overlap scan: no overlap detected and no open blockers; rename/name-only limitations remain advisory.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Concurrent merge events overwrite a newer release branch | Integration | Medium | High | One concurrency group, regenerate from latest `main`, recheck head before push, retry stale updates |
| Bot-authored updates do not trigger required checks | Integration | Medium | High | Use the approved GitHub App installation token rather than `GITHUB_TOKEN`; verify required checks on the release head |
| PR metadata is missing or contradictory | Data | Medium | High | Required pre-merge parser/check with exactly-one disposition and exhaustive candidate audit |
| Candidate query truncates merged PRs | Data | Low | High | Explicit pagination plus fail-closed completeness comparison against the tag range |
| Untrusted note text reaches shell/workflow evaluation | Security | Low | High | Treat notes as inert data; use typed API calls/files, never command interpolation |
| Legacy cleanup drops a reader-relevant change | Knowledge | Medium | Medium | Include/exclude/consolidate reasons and operator approval before the first release PR merges |

## ADRs Created

- `adr-2026-08-01-bot-owned-release-pr` — APPROVED by the operator on 2026-08-01.

## Conditions

None. Downstream stories must cover each risk mitigation and wiring commitment.
