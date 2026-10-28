# Complexity Assessment: Daemon startup dashboard is unreadable at real repo scale (#1332)

Tier: M

Rationale: No new module, persisted format, or external integration — but the change spans more
than a single localized edit. It restructures `renderDashboard` (group ordering, a new attention
summary line, a compact console mode that collapses inert groups and clips long reasons, and a new
BLOCKED group), widens the inherited-state input so discovery's existing `BlockedSpecItem`s reach
the startup dashboard, and adjusts the startup call site in `daemon-cli.ts` so the persisted
`daemon.log` render keeps full detail while the console render goes compact with an opt-in
expansion. The one-bucket precedence invariant must be preserved across the new group, and a
substantial set of existing acceptance tests and operator runbooks assert on dashboard group
content, so the design needs a lightweight architecture review (render modes, flag surface,
BLOCKED precedence) before stories. Not Large: one subsystem, no schema or cross-boundary change.
