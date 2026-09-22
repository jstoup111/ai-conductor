# Sequence: build_review rubric dispatch through the native output schema

**Last updated:** 2026-09-22
**Scope:** One rubric branch from catalog lookup to settled result, for any member (`testQuality`,
`security`, `custom-v1`). Shows the native-schema request, the structured-result validation with a
field-named rejection, and the two new mechanical-fault causes. Cache-hit and fresh-base exits are
unchanged and elided.

## Diagram

```mermaid
sequenceDiagram
    participant Cat as Effective catalog
    participant Desc as Rubric contract descriptor
    participant Disp as Generic rubric dispatch
    participant Prov as Provider adapter (Claude or Codex)
    participant Grader as Rubric session
    participant Coord as build_review coordinator
    participant Fault as Mechanical-fault lane
    participant Spine as Event spine

    Coord->>Cat: member for rubric «id»
    Cat-->>Coord: descriptor
    Coord->>Desc: projection.build(source)
    Desc-->>Coord: sealed projection with projectionVersion and digest
    Coord->>Disp: dispatch(projection, descriptor)

    Disp->>Prov: nativeSchemaCapability?
    alt provider lacks nativeOutputSchema
        Prov-->>Disp: unsupported
        Disp-->>Coord: pre-dispatch skip, cause native-schema-unsupported
        Coord->>Fault: settle absent, charge no kickback, tick no cap
        Fault->>Spine: build_review_rubric_mechanical_fault with the closed cause
    else provider supports nativeOutputSchema
        Disp->>Desc: output.jsonSchema and renderShape()
        Desc-->>Disp: schema object and prompt shape text
        Disp->>Prov: invoke(prompt = policy bundle + skill invocation + shape + projection, nativeSchema = schema)
        Prov->>Grader: --json-schema or --output-schema plus prompt
        Grader-->>Prov: terminal structured result
        Prov-->>Disp: finalStructuredResult (no scraping of output text)
        Disp-->>Coord: candidate result

        Coord->>Desc: output.parse(finalStructuredResult)
        alt structured result absent or violates the contract
            Desc-->>Coord: rejection naming the field and the form it requires
            Coord->>Fault: settle absent, cause invalid-structured-result
            Fault->>Spine: build_review_rubric_mechanical_fault with the named field
        else structured result validates
            Desc-->>Coord: provider payload (findings and closed companion fields)
            Coord->>Coord: stamp kind, rubric, contractVersion, lapId, snapshotDigest from the projection
            Coord->>Desc: identity.canonicalize(each finding)
            Desc-->>Coord: finding ids (content-anchored, unchanged grammar)
            Coord->>Coord: write branch result, cache under projection + output versions
            Coord->>Spine: build_review_rubric_judged
        end
    end
```

## Legend

- **Effective catalog** — built-in registry members and resolved custom-policy members. Both hand
  back the same descriptor shape; the coordinator never branches on member kind after this lookup.
- **Rubric contract descriptor** — the projection builder, the output JSON Schema, the parser, and
  the identity canonicalizer for one member. `renderShape()` derives the prompt text from the
  schema, so the shape the model is shown and the shape the engine validates cannot diverge.
- **Provider adapter** — the existing `nativeSchema` seam from adr-2026-09-07 D6. Claude passes
  `--json-schema`; Codex writes an engine-owned schema file under the invocation scratch home and
  passes `--output-schema`.
- **Mechanical-fault lane** — the existing lane. `native-schema-unsupported` and
  `invalid-structured-result` are added to the total closed branch-reason mapping
  (adr-2026-08-18-mechanical-rubric-faults D2). Neither is a semantic verdict.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-22 | Initial generation | Spec for #2384 — typed rubric output on the native-schema seam |
