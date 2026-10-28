# Complexity: closeout timing events record wrong units (#2049)

Tier: S

## Rationale

- Models/tables: none. The change adds one variant (a closeout-started occurrence) to the existing `ConductorEvent` union and changes how the existing `pipeline_closeout` variant is stamped; no persisted store or schema migration. (Small)
- External integrations: none. (Small)
- Auth/authz: none. (Small)
- State machines: one trivial open/closed pairing of a start occurrence with its completion. (borders Medium; counted Medium)
- Estimated stories: 4 — engine-stamped recording, refusal of caller-supplied or unpaired timing, shared reader trust check, pipeline-skill/documentation contract. (Small)

Four of five signals are Small, so the tier is Small. The fix stays inside the approved design of
`adr-2026-08-08-pipeline-owned-closeout-timestamps` (closeout events are `ConductorEvent`s written to
the pipeline-owned sibling ledger by a pipeline-side command; readers tolerate absence). It changes
only who supplies the two timestamps and how readers judge them, so no new ADR is needed. Per tier
rules architecture-diagram, architecture-review, conflict-check, and coherence-check are skipped.
