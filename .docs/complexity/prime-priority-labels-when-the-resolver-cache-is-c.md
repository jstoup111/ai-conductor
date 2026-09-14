# Complexity: Prime priority labels when the resolver cache is cold

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

One production file changes: the resolver closure in `backlog-priority.ts` gains a record of which
refs it has already attempted and reads the ones it has not, reusing the existing reader call,
cache, outage flag, and warn-once logging. No new module, seam, dependency, config key, event,
metric, or persisted state is introduced, and no caller signature changes — `localWorkSource`,
`orderBacklog`, and the dashboard consume the same `PriorityResolution` union they consume today.
Tests extend two existing files. Small-tier architecture, conflict-check, and coherence artifacts
are not required.
