# Components: Decision-corpus query and conformance (#1480)

**Last updated:** 2026-11-07
**Scope:** The new read-only decision-corpus classifier and its two consumers: the
`ai-conductor decisions` CLI subcommand and the land gate's added-file conformance rule. Also shows
the one-time corpus change carried by the spec PR (deleting `001-harness-architecture.md` and
repairing its four citing records), which builds cannot make because `.docs/decisions` is a
protected-artifact directory.

## Diagram

```mermaid
graph TD
    subgraph Callers["Consumers"]
        CLI["ai-conductor decisions subcommand<br/>NEW · cli.ts registration<br/>read-only, exit 0 on empty corpus"]
        LAND["land ADR gates<br/>engineer/land-spec.ts<br/>EXTENDED: added-file conformance"]
    end

    subgraph Classifier["Decision-corpus classifier (NEW engine module)"]
        ENUM["Corpus enumeration<br/>locations from kind table"]
        KIND["Kind rule<br/>1. filename prefix<br/>2. content: Status → decision,<br/>Verdict → review<br/>3. else unclassified"]
        DISP["Disposition rule<br/>approved · superseded · other · undeclared"]
        ROW["Index row<br/>kind, disposition, date, title,<br/>one-line decision"]
    end

    subgraph Existing["Existing engine seams (unchanged)"]
        KT["MANIFEST_KIND_LOCATIONS<br/>feature-manifest.ts"]
        AAS["adrApprovalStatus<br/>artifacts.ts"]
        SEAL["PROTECTED_ARTIFACT_DIRECTORIES<br/>protected-artifact-seal.ts"]
    end

    CORPUS[(".docs/decisions/<br/>~770 records, legacy names kept")]
    SPEC["Spec PR change set<br/>delete 001 · repair 4 citations<br/>new ADR for the rule"]

    CLI --> ENUM
    LAND -->|"files the change set adds"| KIND
    ENUM --> KT
    ENUM --> CORPUS
    ENUM --> KIND
    KIND --> DISP
    DISP --> AAS
    DISP --> ROW
    SPEC -->|"lands via composer land only"| CORPUS
    SEAL -.->|"blocks build-time edits"| CORPUS
```

## Sequence: `ai-conductor decisions`

```mermaid
sequenceDiagram
    participant Op as Reader (operator or agent)
    participant CLI as ai-conductor decisions
    participant C as Classifier
    participant KT as MANIFEST_KIND_LOCATIONS
    participant FS as Decision corpus
    Op->>CLI: ai-conductor decisions [--kind «k»] [--status «s»] [«term»]
    CLI->>C: classify corpus at «repo root»
    C->>KT: resolve decision directory
    C->>FS: list markdown records
    alt no corpus directory
        C-->>CLI: empty index
    else records present
        loop each record
            C->>C: kind by prefix, else by content, else unclassified
            C->>C: disposition via adrApprovalStatus or Verdict line
        end
        C-->>CLI: index rows
    end
    CLI-->>Op: filtered rows, exit 0
```

## Legend

- **NEW / EXTENDED** mark the components this spec adds or changes; everything in *Existing
  engine seams* is reused unchanged.
- **Kind rule** is portable: it carries no repository-specific stem table, so consumer repositories
  with their own legacy ADRs classify without configuration.
- **Kind table**: corpus locations are read from `MANIFEST_KIND_LOCATIONS`, so a later layout move
  (#3419) or ADR relocation (#782) changes one table, not this module.
- The land conformance rule applies only to files the change set adds; existing records in every
  repository are grandfathered.
- Dashed edge: a constraint, not a call.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-07 | Initial generation | #1480 DECIDE (Medium tier) |
