Waives: outcome-6, outcome-8

Rationale: Both gaps are consequences of deliberate, operator-approved descoping recorded in
`.docs/architecture/codex-lacks-preventive-hook-parity-protected-artif.md` and the architecture
review's Conditions section, not of incomplete planning. Neither is silently dropped: each is
recorded as a `gap` row in `.docs/coherence/codex-lacks-preventive-hook-parity-protected-artif.md`
and routed to a named owner.

`outcome-6` — "Every harness-supplied host lifecycle control has a documented classification." This
deliverable is human-facing documentation. The `/plan` skill's documentation boundary explicitly
forbids creating plan tasks for writing or updating documentation, so it cannot have a task
counterpart in this plan by construction. Its owner is this repository's `maintain-documentation`
custom step, and its source content is already authored — the complete classification table for all
thirteen controls, including the three found to be inactive, is in the architecture document under
"Control classification". Writing a plan task for it would violate the plan skill's own boundary in
order to satisfy a traceability row.

`outcome-8` — "Provider-specific lifecycle behavior covered by executable tests for healthy, missing,
disabled, malformed, and bypassed-control paths." The five required paths ARE covered for the control
this spec actually ships: task-8 (healthy), task-16 (missing/disabled), task-11 and task-14
(malformed/unclassifiable), task-12 (bypassed). What is absent is *provider-specific* lifecycle
behavior to test, because this design deliberately makes the load-bearing control provider-neutral
rather than per-provider. That choice is required by the APPROVED
`adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation:87` ("Provider-local
hooks remain early feedback only") and is the reason no superseding ADR was needed. The
provider-specific early-feedback layer was descoped to #1353 and carries its own executable-coverage
outcome there.

Neither waiver conceals a coverage failure in the shipped behavior: outcome-1 through outcome-5,
outcome-7, and outcome-9 are all `covered` with confirmed story and task counterparts, and every
story and every task in this plan maps cleanly in both directions.
