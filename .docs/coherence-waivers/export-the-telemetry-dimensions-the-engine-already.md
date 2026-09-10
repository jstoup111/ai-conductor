# Coherence waiver: export-the-telemetry-dimensions-the-engine-already

Waives: outcome-1, outcome-2, outcome-6, outcome-9

Rationale: All four gaps are deliberate scope boundaries recorded in `.docs/track/export-the-telemetry-dimensions-the-engine-already.md`, not evidentiary defects.

`outcome-1` (attribute telemetry to its feature) and `outcome-6` (metered vs unmetered dispatches distinguishable) were delivered on main before this spec was authored — #1938 made `feature` a data-point label on every per-feature instrument and #1972 added the `metering` attribute to `conductor.step.dispatches`. The operator confirmed on 2026-09-09 that this spec covers only the gaps still open on main; re-specifying shipped work would claim a diff this feature does not contain.

`outcome-2` (attribute telemetry to the responsible GitHub user) was excluded by the operator on 2026-09-09 over privacy of exporting "who"; it will be scoped in its own intake and adr-014 D10 records that operator identity leaves the process on neither signal.

`outcome-9` (the dimension set is extensible without touching a hardcoded list in more than one place) was consciously dropped when the operator chose approach A (direct plumbing) over the declared dimension-table approach on 2026-09-09; the table approach is filed as a separate low-priority intake. This spec still reduces the touch count to one shared `dispatchDimensionsFrom` builder for the metric side, but does not claim the outcome.
