# Components: path-triggered custom build_review rubrics and the dependency-hygiene policy

**Last updated:** 2026-11-07
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#2045. A `build_review.custom_rubrics`
declaration gains an optional `paths` glob list. Before any custom-lap machinery runs, the build_review
step runner matches each path-triggered custom catalog entry against the whole-feature changed-file set
(merge-base to head). An entry with no matching path is withheld from the lap: the engine emits the
existing `build_review_rubric_skipped` event with reason `paths-unmatched`, and the entry does not
appear in the lap gate members, the custom dispatch plan, or `currentCustomRubrics`. A shipped
`skills/build-review-dependency-hygiene` review-policy skill judges necessity, version pinning, and
license compatibility for dependency manifest and lockfile changes. This repository's
`.ai-conductor/config.yml` declares it with a manifest/lockfile `paths` set. Its findings use the
existing custom finding contract and pass through the existing adjudicator. No new module, event type,
artifact, or built-in rubric is added.

## Diagram

```mermaid
graph TD
  subgraph Config["Operator configuration (changed)"]
    YML[".ai-conductor/config.yml<br/>custom_rubrics.dependencyHygiene<br/>skill + question + paths"]
    CFG["config.ts<br/>validate paths: optional non-empty<br/>array of non-empty glob strings"]
    RES["resolved-config.ts<br/>ResolvedBuildReviewCustomCatalogEntry<br/>+ paths (absent = always applies)"]
  end

  subgraph Runner["build_review input assembly and step runner (changed)"]
    CHANGED["snapshot changed paths<br/>whole-feature diff vs merge-base"]
    MATCH{"participation resolver<br/>(before source materialization):<br/>entry declares paths<br/>and no changed path matches?"}
    SKIP["emit build_review_rubric_skipped<br/>reason paths-unmatched<br/>entry withheld from lap"]
    ACTIVE["participating catalog<br/>materialization members, customEntries,<br/>lap gate, dispatch plan, currentCustomRubrics"]
    BUILTIN["built-in-only lap boundary<br/>unchanged when no custom entry is active"]
  end

  subgraph Review["Existing custom review path (unchanged)"]
    DISPATCH["custom reviewer dispatch<br/>read-only provider mode"]
    POLICY["skills/build-review-dependency-hygiene<br/>necessity, pinning, license<br/>(new shipped review policy)"]
    AGG["build-review-aggregate.ts<br/>custom member results"]
    ADJ["adjudication coordinator<br/>shared decision and repair path"]
  end

  SPINE["ConductorEventEmitter<br/>.pipeline/events.jsonl"]

  YML --> CFG --> RES --> MATCH
  CHANGED --> MATCH
  MATCH -- yes --> SKIP --> SPINE
  MATCH -- no --> ACTIVE
  SKIP -. no active custom entry .-> BUILTIN
  ACTIVE --> DISPATCH
  POLICY --> DISPATCH
  DISPATCH --> AGG --> ADJ
```

```mermaid
sequenceDiagram
  participant SR as build_review step runner
  participant RC as resolved config catalog
  participant EV as event spine
  participant GATE as custom lap gate
  participant DH as dependencyHygiene reviewer
  participant ADJ as adjudicator

  SR->>RC: read custom catalog entries
  SR->>SR: assemble inputs, compute snapshot diff (merge-base to head)
  SR->>SR: resolve lap participation before source materialization
  alt no changed path matches entry paths
    SR->>EV: build_review_rubric_skipped (paths-unmatched)
    Note over SR: entry withheld, no frozen view, no lap gate member, no provider call
  else a manifest or lockfile changed
    SR->>GATE: begin lap with dependencyHygiene member
    GATE->>DH: dispatch with frozen input and policy skill
    DH-->>GATE: custom findings (necessity, pinning, license)
    GATE-->>SR: custom member result
    SR->>ADJ: unresolved findings join shared adjudication
  end
```

## Legend

- **Changed** boxes are edited by this feature; **unchanged** boxes are existing seams it relies on.
- `paths` is matched against the whole-feature changed-file set, not a per-lap delta, so a later lap
  keeps reviewing a dependency change that is still present and stops only when the feature diff no
  longer touches a matching path.
- An entry without `paths` behaves exactly as today. A withheld entry produces no artifact; the
  skip event is its only record, so no parallel channel is added.
- The policy skill is provider-neutral and runs under the existing Claude restricted and Codex
  read-only review modes. License is judged only from on-disk evidence and reported at a
  non-blocking severity when it cannot be determined.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-07 | Initial generation | Composer DECIDE for #2045 |
