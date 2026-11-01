# Architecture: Routed-repair citation resolution

**Issue:** #3550 · **Stem:** `routed-repair-hosts-a-finding-on-a-stack-child-tha` · **Tier:** M (lightweight diagram)
**Last updated:** 2026-10-31
**Scope:** The stacked routed-repair placement path in `src/conductor/src/engine/routing/`: citation
extraction, D4 cannot-host selection and D5 prerequisite-claim verification
(`adr-2026-10-12-routed-whole-feature-repair` decisions 4 and 5). Residue judgement, rem-block
allocation, the route-record schema, the admission fence and markers, routed exit and restack are
unchanged.

## One-line

Every cited path is resolved once against the leaf tree into repository file paths before it can
count as evidence, and a directory or ambiguous citation never counts. The citations include the
text each item's rem blocks will carry. D4 host selection and D5 claim verification read the same
resolved files. Because the leaf holds every resolved input, D4 always finds a host that holds every
file a repair block cites, so the change adds no halt.

## Components

```mermaid
flowchart TD
  subgraph CONDUCTOR["conductor.ts — routed audit round"]
    CITE["citedPathsFor<br/>owner task files · Done-when · finding evidence · work order"]
  end

  subgraph ROUTING["engine/routing"]
    BLOCK["Block-text citations (round-router.ts, new)<br/>task titles · rationale · criterion · governing clause"]
    EXTRACT["citedRepositoryPaths (cited-repository-paths.ts)<br/>token cleanup strips wrapping punctuation (changed)"]
    RESOLVE["resolveCitedPaths (cannot-host.ts, new)<br/>one leaf listing · exact file · unique suffix match<br/>directory → dropped · ambiguous → dropped · no match → output"]
    SELECT["selectHost (cannot-host.ts)<br/>D4: owner, else earliest child above holding every input, else leaf"]
    ALLOC["allocateFrozenBlocks (remediation-append.ts)<br/>unchanged"]
    FENCE["checkRoundAdmissionFence → createRouteRecord → admitRound<br/>unchanged · prerequisitePaths = resolved files only"]
    CLAIM["verifyPrerequisiteClaim (prerequisite-claim.ts)<br/>D5: claimed + stored inputs through the same resolver<br/>legacy directory entries ignored (changed)"]
  end

  GIT[("Git trees<br/>leaf tip · refs/conductor/«slug»/closed/c«n»")]

  CITE --> EXTRACT
  BLOCK --> EXTRACT
  EXTRACT --> RESOLVE --> SELECT --> ALLOC --> FENCE
  RESOLVE -->|"ls-tree -r --name-only"| GIT
  SELECT -->|"closure tree reads"| GIT
  FENCE -.->|"routed BUILD returns blocked-by-prerequisite"| CLAIM
  CLAIM --> RESOLVE
```

## Placement sequence (the #3550 incident, corrected)

```mermaid
sequenceDiagram
  participant R as round-router
  participant V as resolveCitedPaths
  participant H as selectHost (D4)
  participant G as git trees
  R->>V: (register-artifact-cli.ts, restack/restack-sync.ts, src/conductor/src/engine/
  V->>G: ls-tree -r --name-only leaf tip
  V-->>R: inputs: src/conductor/src/engine/register-artifact-cli.ts, src/conductor/src/engine/restack/restack-sync.ts · directory dropped
  R->>H: owner 1, inputs
  H->>G: closed/c1 lacks register-artifact-cli.ts · closed/c2 lacks it
  H->>G: leaf tip has every input
  H-->>R: host 3, reason prerequisite-paths
```

## Legend

- **Changed / new** label a component this spec edits. Every other component keeps its behaviour.
- **Input** — a resolved repository file present at the leaf tip (D4 prerequisite input).
- **Output** — a citation with no leaf match, which the repair creates. Never prerequisite evidence,
  as D4 already states.
- **Dropped** — a citation that names a directory or matches several leaf files. It is neither an
  input nor an output and never satisfies or fails a host check.
- `«slug»`, `«n»` — placeholders for the feature slug and child position.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-31 | Initial generation | #3550: routed repair hosted a finding on a child lacking its target file |
