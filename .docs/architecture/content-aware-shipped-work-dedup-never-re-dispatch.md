# Architecture: content-aware shipped-work dedup

**Last updated:** 2026-07-03
**Scope:** the three engine seams changed by this feature — finish-time shipped-record
authoring, discovery-time content-hash dedup, and rekick-time processed check — plus the
demotion of the local ledger to a cache.

## Components

```mermaid
graph TD
    subgraph BaseBranch["base branch tree (authoritative, travels with clones)"]
        PLANS["docs plans «stem».md"]
        STORIES["docs stories «stem».md"]
        SHIPPED["docs shipped «stem».md - spec hash + impl PR URL"]
    end

    subgraph Daemon["daemon engine (this checkout)"]
        DISCOVER["discoverBacklog"]
        HASH["specHash - canonical hash of plan + stories content"]
        REKICK["rekickSweep"]
        FINISH["finish flow"]
        LEDGER["local .daemon processed «slug» - cache only"]
    end

    DISCOVER -->|reads candidates| PLANS
    DISCOVER -->|reads| STORIES
    DISCOVER -->|computes| HASH
    DISCOVER -->|"skip when hash matches any shipped record"| SHIPPED
    DISCOVER -->|"fast-path skip (cache hit)"| LEDGER
    FINISH -->|"commits shipped record onto impl PR branch"| SHIPPED
    FINISH -->|writes cache entry| LEDGER
    REKICK -->|"NEW: consult isProcessed before re-kick"| LEDGER
    REKICK -->|"NEW: consult shipped record"| SHIPPED
```

## Sequence: ship → never re-dispatch

```mermaid
sequenceDiagram
    participant D as daemon
    participant W as impl worktree
    participant GH as origin main
    participant L as local ledger

    D->>W: finish step passes gates
    D->>W: write docs shipped «stem».md (spec hash, PR URL)
    D->>W: commit marker on impl branch, push
    D->>GH: PR merges (human)
    Note over GH: base branch now carries plan + shipped record
    D->>L: write processed «slug» (cache)
    D->>GH: next poll - discoverBacklog
    D->>D: candidate «any stem» found
    D->>L: cache hit? yes - skip
    D->>GH: cache miss (fresh clone or renamed stem)
    D->>D: hash(plan+stories) equals shipped record hash - skip
    Note over D: replay impossible regardless of slug or local state
```

## Legend

- **shipped record** — `.docs/shipped/«stem».md`, committed onto the implementation PR
  branch by the finish flow, so the human merge that lands the code also lands the
  "this spec shipped" fact.
- **specHash** — canonical content hash over the spec's plan + stories files as read
  from the base branch tree; slug-independent, so a renamed stem still matches.
- **cache only** — `.daemon/processed/«slug»` keeps its fast-path role but is never
  the last line of defense; absence of a cache entry falls through to the shipped
  record check instead of dispatching.
- **NEW** edges — behavior added by this feature; all other edges exist today.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | Spec authoring for #204/#205 (engineer DECIDE) |
| 2026-07-03 | Plan-update pass: confirmed diagrams match the implementation plan (shipped-record module, dedup-before-owner-gate, rekick guard) | /plan step 8b |
