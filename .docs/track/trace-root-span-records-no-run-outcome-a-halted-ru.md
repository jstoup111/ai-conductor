# Track: trace-root-span-records-no-run-outcome-a-halted-ru

Track: technical

Scope boundary: Balanced — deliver the four desired outcomes of #1978 via the bus-derived
approach (Approach A), and audit the other terminal-ish bus events (e.g.
rebase_conflict_halt, credentials_park, operator_park_boundary, auto_park) mapping each to
an outcome value or an explicit out-of-scope disposition. No plugin-contract change; span
OK/ERROR status semantics unchanged.

Observability-internal change to the OTel visualizer; no product-facing behavior, so no PRD —
acceptance criteria live in stories.
