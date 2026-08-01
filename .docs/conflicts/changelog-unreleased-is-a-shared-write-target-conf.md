# Conflict Check: Bot-owned release PR

**Date:** 2026-08-01  
**New stories:** `.docs/stories/changelog-unreleased-is-a-shared-write-target-conf.md`  
**Corpus scanned:** 277 repository story files, 45 specs, 148 prior conflict reports, APPROVED ADRs, relevant implementation paths, and all open GitHub issues filtered and then reviewed for release/changelog/version/finalizer/App overlap  
**Result:** PASSED after operator-approved targeted supersession and issue reconciliation; zero blocking or degrading conflicts remain

## Resolved Blocking Conflicts

### Feature-authored changelog entries versus a single release-PR writer

**Type:** contradiction / resource contention  
**Confidence:** 100% (verified accepted story text and approved ADRs)

`maintain-documentation` required notable implementation branches to append to `[Unreleased]`, while TI-1 prohibits implementation branches from editing `CHANGELOG.md`. The operator selected the single-writer contract. `adr-2026-08-01-bot-owned-release-pr` supersedes `adr-2026-07-25-notable-change-release-trigger`, and the legacy story now carries a targeted supersession note. Notability survives in structured PR metadata.

### Finish-time token replacement versus release-PR attribution

**Type:** contradiction / sequencing  
**Confidence:** 100% (verified finalizer ADR, story, and implementation)

The legacy flow inserted `{{IMPLEMENTATION_PR}}` in a feature changelog entry and resolved it during FINISH. The new flow attributes merged PR metadata while rendering the release PR, so retaining the feature token would reintroduce the shared write and publication-only FINISH failure. The operator approved superseding `adr-2026-07-25-changelog-pr-link-finalization` and retiring only the changelog-specific finalizer path.

### Release on any notable main push versus publish only an approved release PR

**Type:** contradiction / state conflict  
**Confidence:** 100% (verified current workflow and accepted stories)

The existing workflow publishes whenever `[Unreleased]` has content. TI-6 permits publication only from the designated, checked, operator-merged release PR. The approved resolution replaces content-on-main as authority with release-PR provenance and completeness evidence.

### Forward-looking VERSION versus tagged installed-version detection (#1005)

**Type:** behavioral overlap / state conflict  
**Confidence:** 99% (verified issue evidence and current update contract)

A release PR that advances `VERSION` would preserve #1005's false “up to date” behavior if tagged installations continued treating repository `VERSION` as their installed identity. The operator approved absorbing #1005. TI-6 and the ADR now require checked-out/recorded tag identity plus regression coverage.

## Open GitHub Issue Reconciliation

- **#217 — absorbed:** TI-7 owns the one-time audited consolidation/cull and VERSION/tag reconciliation.
- **#218 — absorbed:** the GitHub App-authored release PR avoids the prohibited direct workflow push to protected `main`; publication follows the operator merge.
- **#282 — absorbed:** TI-2 moves migration-shape validation to structured PR metadata before merge.
- **#1005 — absorbed:** TI-6 fixes tagged installed-version identity.
- **#158 — compatible overlap:** use a reusable GitHub App authentication seam, but do not claim its broader daemon comments/labels/issues scope.
- **#1152 — compatible and still open:** removing feature changelog writes eliminates its dominant conflict trigger; generic replay verification remains separate.
- **#1172 — compatible and still open:** retiring token finalization removes one deterministic FINISH gap; the broader FINISH transaction/preflight outcome remains separate.
- **#219 — compatible post-release dependency:** preserve ordered runnable migrations and leave the real 0.99.17-to-new-tag consumer exercise for after publication.
- **#226/#228 — sequencing overlap only:** the generated release version derives from the approved candidate set and highest semver impact; the release PR must not assume a fixed v1 cutover version before those programs settle.
- **#1227 — compatible and still open:** removing finalizer work narrows one observed scope-creep trigger; general task/commit scope enforcement remains separate.

## Clean Pair Findings

- **Migration waivers:** unchanged; fresh waiver coverage remains an alternate to a runnable migration for classifier false positives. Confidence 100%.
- **Tagged/main channels:** compatible after the #1005 installed-identity amendment; no package manager is introduced. Confidence 99%.
- **Rebase correctness:** changelog-specific resolver code becomes obsolete, but generic rebase verification and conflict recovery remain binding. Confidence 98%.
- **Shipped records:** release candidate collection uses merged PR evidence and tags; `.docs/shipped` remains daemon shipment/dedup authority and is not repurposed as release-note storage. Confidence 100%.

## Re-check Verdict

All five conflict types were re-evaluated after the approved resolutions. Zero blocking or degrading conflicts remain. Proceed to plan.

