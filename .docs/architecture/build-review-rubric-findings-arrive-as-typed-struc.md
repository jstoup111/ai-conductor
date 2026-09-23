# Components: one rubric contract descriptor for every build_review catalog member

**Last updated:** 2026-09-22
**Scope:** The engine-owned rubric contract descriptor that `testQuality`, `security`, and the
custom-policy `custom-v1` member each fill in, and the single generic dispatch path that consumes
it. Judgement semantics, finding identity, dispositions, and the mechanical-fault lane are unchanged
in meaning; what changes is that one seam produces the projection, the native output schema, the
validated structured result, and the stamped envelope for every member.

## Diagram

```mermaid
graph TD
    subgraph Catalog["Effective rubric catalog (registry + policy resolver)"]
        TQ["testQuality descriptor<br/>projection v3 · output judged v3"]
        SEC["security descriptor<br/>projection v3 · output judged v3"]
        CUS["custom-v1 descriptor<br/>projection frozen-input · output custom-findings v1"]
    end

    subgraph Descriptor["Rubric contract descriptor (one shape, engine-owned)"]
        PROJ["projection: version + build(source) → sealed projection"]
        OUT["output: version + jsonSchema + parse(structuredResult) → findings"]
        IDENT["identity: canonicalize(finding) → finding id"]
        SHAPE["renderShape(): prompt text derived from jsonSchema"]
    end

    subgraph Dispatch["Shared seam: dispatchRubricContract (step-runners → provider-execution)"]
        RENDER["render projection + policy bundle + skill invocation"]
        REQ["invoke with nativeSchema = descriptor.output.jsonSchema"]
        CAP{"provider declares<br/>nativeOutputSchema?"}
        SR["finalStructuredResult"]
    end

    subgraph Coordinator["build_review coordinator"]
        VAL["validate structured result against descriptor.output<br/>field-named rejection (adr-2026-08-19 D6)"]
        STAMP["stamp envelope: kind · rubric · contractVersion · lapId · snapshotDigest"]
        FAULT["mechanical-fault lane<br/>closed causes: native-schema-unsupported · invalid-structured-result"]
        CACHE["content-addressed cache<br/>key includes projection + output versions"]
        AGG["aggregate · effective verdict · dispositions · adjudication case"]
    end

    subgraph Skills["skills/build-review-*/SKILL.md"]
        JUDGE["judgement guidance only<br/>(no result-contract block)"]
    end

    subgraph Audits["Repository audits"]
        PCA["provider-contract audit:<br/>forbid output-format prose in build-review-* skills"]
        DRIFT["vocabulary drift guard:<br/>descriptor enum ⇄ SKILL.md closed vocabulary"]
    end

    TQ --> Descriptor
    SEC --> Descriptor
    CUS --> Descriptor
    TQ -. built-in route: coordinator .-> RENDER
    SEC -. built-in route: coordinator .-> RENDER
    CUS -. custom route: dispatchInstalledBuildReviewPolicy .-> RENDER
    PROJ --> RENDER
    SHAPE --> RENDER
    OUT --> REQ
    RENDER --> REQ
    REQ --> CAP
    CAP -- no --> FAULT
    CAP -- yes --> SR
    SR --> VAL
    VAL -- rejected --> FAULT
    VAL -- accepted --> STAMP
    STAMP --> IDENT
    IDENT --> CACHE
    CACHE --> AGG
    JUDGE -. invoked as the review role .-> RENDER
    PCA -. audits .-> JUDGE
    DRIFT -. binds .-> OUT
    DRIFT -. binds .-> JUDGE
```

## Legend

- **Effective rubric catalog** — the closed registry (`BUILD_REVIEW_RUBRIC_REGISTRY`) plus custom
  members admitted by the portable policy resolver (adr-2026-09-10). Each member supplies exactly
  one descriptor; nothing else about the member is consulted at dispatch.
- **Rubric contract descriptor** — the new engine-owned type. `projection` replaces the per-rubric
  branches inside `deriveBuildReviewRubricProjections`; `output.jsonSchema` is the JSON Schema
  handed to the provider natively and the single source from which both the prompt shape and the
  rejection diagnosis are rendered; `identity` wraps the existing `custom-v1` and built-in
  canonicalizers unchanged.
- **Shared seam `dispatchRubricContract`** — replaces the two scrape-and-parse paths (built-in
  `dispatchBuildReviewRubric` and the custom-policy dispatch). Built-in members reach it through the
  built-in-keyed coordinator; `custom-v1` reaches it through `dispatchInstalledBuildReviewPolicy`
  (ADR D1.3). Both routes share one render, one native-schema request, and one parser. `extractJudgedResultCandidate` and
  the bounded repair turn are retired; the provider's terminal structured result is the only input
  to validation.
- **Mechanical-fault lane** — existing lane (adr-2026-08-18-mechanical-rubric-faults) with two
  additional closed causes. Both settle `absent`, charge no kickback, and tick no cap.
- **Dotted edges** — audits and the skill invocation are not on the data path. The audits bind the
  descriptor's closed vocabulary to the skill text in both directions and fail the harness
  integrity suite when a build-review skill regains result-format prose.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-22 | Initial generation | Spec for #2384 — typed, structurally keyed rubric output on one descriptor seam |
| 2026-09-23 | Name `dispatchRubricContract` as the shared seam; show built-in and custom routes | ADR D1.3 clarification after as-built AB-1 |
