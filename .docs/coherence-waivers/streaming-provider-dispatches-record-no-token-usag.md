# Coherence waiver: streaming-provider-dispatches-record-no-token-usag

Waives: outcome-3, criterion:disposition-negative:30

Rationale: Both gaps are deliberate and neither is an evidentiary defect — each is a coverage
boundary the operator or an APPROVED ADR chose knowingly, recorded here rather than papered over.

`outcome-3` asks that token totals and cost totals in the same reported line derive from the same
set of dispatches, or that the line say they do not. The operator scoped this feature to closing the
usage-capture gap and directed the totals-line rework be filed separately; it is
jstoup111/ai-conductor#1863 (size S, depends on this issue). The scope boundary is recorded in
`.docs/track/streaming-provider-dispatches-record-no-token-usag.md`. Story 8 does deliver the
bullet's substantive half — after this feature both totals derive from one three-valued
classification over the same dispatches, and #1858's committed rate card already removed the
provider-population split that made them diverge. What remains undelivered is presentational: when a
dispatch genuinely cannot be measured, the money figure still reads as a total with nothing on the
line saying otherwise. That residue is #1863's whole subject, so crediting this row as covered would
claim work this diff does not contain.

`criterion:disposition-negative:30` is the `outside-diff` disposition on Story 5's criterion "Given
the installed codex CLI, when a real non-REPL dispatch runs against it in a smoke context, then its
emitted envelope is parseable by the existing codex parser." The disposition is honest rather than
avoidable: the criterion's truth depends on the version of the codex CLI installed on the machine,
which no commit in this diff controls. Rewording it into a diff-local form would only hide that
dependency behind a fake. `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` records
it as an explicit assumption at 90% confidence, verified at `codex-cli 0.145.0` by
`adr-2026-07-27-cost-unmetered-is-a-first-class-state` and not re-probed at authoring time. Task 9.1
exists precisely to observe it, and its own completion criteria require that an envelope which does
not parse be recorded as a blocking finding rather than passed over. The external dependency is
therefore surfaced and acted on, not assumed away.
