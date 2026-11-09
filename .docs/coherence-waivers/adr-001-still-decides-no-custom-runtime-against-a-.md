Waives: outcome-2, adr-2026-09-28-skills-may-bundle-executable-helpers

Rationale: Both gaps follow from an operator decision made in this DECIDE pass on 2026-11-07 and
recorded as decision 1 of `adr-2026-11-07-decision-corpus-query-and-known-record-shapes`.

- **outcome-2** (the original decision's historical reasoning stays readable rather than deleted):
  the operator chose to delete `001-harness-architecture.md` rather than supersede it, and to
  author a replacement record only if one were actually needed. None was: the choices from 001
  that still hold are documented in `ARCHITECTURE.md`. The reasoning stays recoverable from git
  history, and each of the four records that cite 001 now carries a dated amendment note saying
  so. No story delivers the outcome as the intake worded it, by the operator's choice.
- **adr-2026-09-28-skills-may-bundle-executable-helpers**: at the operator's request, this spec
  adds only an additive amendment note beside that ADR's citation of record 001. The note changes
  none of the ADR's decisions, and no story implements or is constrained by it. The plan's
  Architecture Obligation Coverage marks all seven decisions `existing`, with verified evidence.
