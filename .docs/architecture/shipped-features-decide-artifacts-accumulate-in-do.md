# Architecture: operator CLI prunes shipped features' DECIDE artifacts (#2963)

**Stem:** `shipped-features-decide-artifacts-accumulate-in-do`
**Tier:** M — lightweight architecture pass
**Last updated:** 2026-10-21
**Scope:** a new `ai-conductor docs-prune` command, the retention policy, and the pruned-plan lookup
used by record repair and the shipment audit.
**Governing ADR:** `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`
**Builds on:** `.docs/architecture/base-inherited-artifact-deletion-deadlocks-both-se.md` (#1752,
which lets in-flight features survive deletions arriving from main).

## Scope

The operator runs `ai-conductor docs-prune`, which does the following:

1. Reads `origin/main`. For every stem with a `.docs/shipped/«stem».md` record, it selects that stem's
   files in the prunable families of the retention policy.
2. Reads the changed files of every open PR through the guarded tracker read, and defers any
   selected path an open PR modifies.
3. In a temporary detached worktree, commits the deletion of the remaining paths as one docs-only
   commit. It publishes that commit on one deterministic `docs-prune/«date»` branch and PR through the
   existing guarded repair-publication pattern, creating the PR or refreshing the open one.
4. Writes every removed and deferred path, with reasons, into the PR body, and emits one
   `decide_artifacts_pruned` event on the existing spine.

It never pushes `main` and never merges.

Record-only repair and the shipment audit gain one shared lookup. When a stem's plan is absent at
the commit being read, they read the plan from the parent of the commit that deleted it. If no such
commit exists, they refuse with `shipment-plan-pruned`, naming the path.

No change to the finish path, `spec_hash`, shipment evidence or the protected-artifact seal.

## Component view (C4 level 3)

```mermaid
flowchart TB
    OP["operator"]
    subgraph engine["src/conductor/src/engine"]
        CLI["NEW: docs-prune command<br/>docs-prune-cli.ts, cli.ts table"]
        POLICY["NEW: retention policy constant<br/>docs-retention.ts"]
        SELECT["NEW: prune-set resolver<br/>docs-prune.ts, shipped stems on origin/main"]
        DEFER["NEW: whole-stem open-PR deferral<br/>docs-prune.ts"]
        PRFILES["NEW: paginated PR file reader<br/>pull-request-files.ts, shared with audit"]
        PUB["NEW: docs-prune publisher<br/>repair-publication pattern, exact operator approval"]
        CARRIER["NEW: pruned-plan lookup<br/>pruned-plan.ts, parent of deleting commit"]
        REPAIR["record-only repair<br/>CHANGED: uses pruned-plan lookup"]
        AUDIT["shipment audit<br/>CHANGED: uses pruned-plan lookup"]
        TEL["ConductorEventEmitter<br/>NEW: decide_artifacts_pruned"]
    end
    GIT["git<br/>ls-tree, log, show"]
    GH["GitHub<br/>open PRs, docs-prune PR"]

    OP --> CLI
    CLI --> SELECT
    SELECT --> POLICY
    SELECT --> GIT
    CLI --> DEFER
    DEFER --> PRFILES
    PRFILES --> GH
    AUDIT --> PRFILES
    CLI --> PUB
    PUB --> GH
    CLI --> TEL
    REPAIR --> CARRIER
    AUDIT --> CARRIER
    CARRIER --> GIT
```

## Sequence: operator cleanup run

```mermaid
sequenceDiagram
    participant O as operator
    participant C as docs-prune
    participant G as git (origin/main)
    participant GH as GitHub
    participant P as repair publication

    O->>C: ai-conductor docs-prune
    C->>G: fetch, list shipped stems and their prunable files
    C->>GH: read open PRs and every changed-file page
    GH-->>C: paths still in flight
    C->>C: removable = selected minus in-flight
    C->>P: detached worktree, docs-only deletion commit
    P->>O: confirm push, then PR create or edit
    O-->>P: exact-request approval
    P->>GH: push docs-prune/«date», create or refresh own PR
    C-->>O: removed and deferred paths, PR URL
    Note over GH: operator reviews and merges<br/>in-flight features tolerate the deletion via #1752
```

## Legend

- **NEW** marks an added component, and **CHANGED** marks an existing one that gains behavior.
- `«stem»` and `«date»` are placeholders.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-15 | Initial generation | #2963 DECIDE |
