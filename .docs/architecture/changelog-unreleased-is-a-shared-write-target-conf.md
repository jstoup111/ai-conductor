# Release-PR Architecture: ai-conductor

**Last updated:** 2026-08-01  
**Scope:** As-built repository-local flow for maintaining and publishing release notes without feature-branch writes to `CHANGELOG.md`.

## System Context

```mermaid
graph LR
    OP[Operator] -->|merges implementation PR| GH[GitHub repository]
    GH -->|pull_request closed event| MAINT[Release PR maintainer workflow]
    MAINT -->|creates or updates| RPR[Bot-owned release PR]
    OP -->|reviews and merges| RPR
    RPR -->|merge to main| PUB[Deterministic release workflow]
    PUB -->|commit, tag, release| GH
    INST[Tagged-channel installations] -->|fetch approved tag| GH
    MAIN[Main-channel installations] -->|fetch main| GH
```

## Components and Ownership

```mermaid
graph TD
    subgraph FeaturePR[Implementation PR]
        META[Structured release-note metadata]
        DISP[Explicit note or no-note disposition]
    end

    subgraph Maintainer[Release PR maintainer workflow]
        EVENT[Validate merged-PR event]
        COLLECT[Collect merged PR metadata since latest tag]
        RENDER[Deterministically render pending release section]
        UPSERT[Create or update one bot-owned branch and PR]
    end

    subgraph ReleasePR[Bot-owned release PR]
        CHANGELOG[CHANGELOG.md]
        VERSION[VERSION]
        AUDIT[Candidate completeness and disposition evidence]
    end

    subgraph Publisher[Release workflow after release-PR merge]
        VERIFY[Verify approved release artifacts]
        TAG[Create version tag]
        PUBLISH[Publish GitHub Release]
    end

    META --> EVENT
    DISP --> EVENT
    EVENT --> COLLECT --> RENDER --> UPSERT
    UPSERT --> CHANGELOG
    UPSERT --> VERSION
    UPSERT --> AUDIT
    CHANGELOG --> VERIFY
    VERSION --> VERIFY
    AUDIT --> VERIFY
    VERIFY --> TAG --> PUBLISH
```

## Merge-to-Release Sequence

```mermaid
sequenceDiagram
    actor Operator
    participant Feature as Implementation PR
    participant Main as main
    participant Maintain as Release PR maintainer
    participant ReleasePR as Bot-owned release PR
    participant Publish as Release publisher

    Operator->>Feature: Approve and merge
    Feature->>Main: Land code and structured note disposition
    Main->>Maintain: Trigger serialized maintenance run
    Maintain->>Maintain: Collect and validate merged PRs since latest tag
    Maintain->>ReleasePR: Create or regenerate pending changelog and version diff
    ReleasePR-->>Operator: Present reviewable release set
    Operator->>Main: Merge approved release PR
    Main->>Publish: Trigger deterministic release
    Publish->>Publish: Verify release-PR provenance and artifacts
    Publish->>Main: Commit release result and create tag
    Publish-->>Operator: Publish GitHub Release
```

## One-Time Transition

```mermaid
graph LR
    OLD[Current Unreleased entries] --> CLEAN[Automated semantic cleanup]
    MERGED[Merged PR evidence since latest tag] --> CLEAN
    CLEAN --> PROPOSAL[Included, consolidated, and excluded proposal with reasons]
    PROPOSAL --> APPROVAL[Operator approval]
    APPROVAL --> FIRST[Initial bot-owned release PR state]
    FIRST --> NORMAL[Future deterministic maintenance]
```

## Invariants

- Implementation branches never write `CHANGELOG.md` or `VERSION`.
- Exactly one bot-owned release PR is open for the pending release set.
- Maintenance runs are serialized and regenerate from authoritative merged-PR metadata, so retries are idempotent.
- A merged implementation PR has either a valid release note/category or an explicit no-note disposition.
- Only an operator-approved release PR can reach tagging and publication.
- The one-time semantic cleanup does not become a recurring GitHub Actions dependency.

## Legend

Solid arrows are deterministic repository or GitHub workflow transitions. The one-time cleanup is a migration activity with operator approval; normal maintenance is deterministic.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-01 | Initial proposed release-PR architecture | Replace the shared feature-branch changelog write target |
| 2026-08-01 | Plan alignment update | Named typed metadata, candidate, renderer, App-action, publisher, transition, and tagged-update seams |
