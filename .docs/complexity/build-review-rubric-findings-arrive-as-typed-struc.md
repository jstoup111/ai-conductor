# Complexity: build-review-rubric-findings-arrive-as-typed-struc

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One: the rubric contract descriptor (projection version + builder, output version + JSON Schema + parser, identity canonicalizer) that every catalog member fills in |
| External integrations | Both provider adapters' native structured-output options (`--json-schema`, `--output-schema`) via the existing `nativeSchema` seam; no new adapter |
| Auth / permission surface | None |
| State machines | Mechanical-fault lane gains closed causes for unsupported-capability and invalid-structured-result; cache identity changes when the projection or output version advances |
| Story count | ~8 (shared descriptor, native-schema dispatch, field-named rejection, custom-v1 on the seam, skill prose purge, audit rule, drift-guard relocation, identity preserved) |
| Files touched | ~15 engine modules (`step-runners`, `build-review-coordinator`, `-domain`, `-registry`, `-projections`, `-policy-contract`, `-finding-identity`, `provider-execution`), 2 SKILL.md, 2 shell audits, 3 TS contract tests, 5+ ADR amendments, `docs/explanation/gates.md`, `docs/reference/skills.md` |
| New runtime code | Descriptor type + catalog wiring, JSON Schema objects for `judged` v3 and `custom-v1` payloads, generic dispatch replacing two scrape-and-parse paths, rejection diagnosis over the structured result |

## Rationale

Two independently evolved dispatch paths (built-in and custom policy) collapse onto one seam that
custom rubrics from other projects will depend on, and the seam is what the mechanical-fault lane,
cache key, and disposition identity all hang off. Getting the descriptor boundary wrong is
expensive to reverse and touches five approved ADRs. That warrants the full architecture review
and a conflict-check, not the lightweight pass. → **Large.**
