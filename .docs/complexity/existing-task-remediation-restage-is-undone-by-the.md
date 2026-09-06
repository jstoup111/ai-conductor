# Complexity: Existing-task remediation restage is undone by the Task-trailer completion union

Tier: M

Rationale: A bounded engine change across three known files — the restage path
(`conductor.ts`), the shared resolution fold (`task-progress.ts`), and the engine-state record
(`artifacts.ts`) — plus a trailer read that must start carrying commit identity. The issue
carries the `size: M` label. It is not Small: the fold is consumed by the build completion
predicate, the D1 no-op guard, and the stall circuit breaker, so the change needs an
architecture review of the completion-authority seam and a conflict-check against the #859 and
#647 behaviors it must preserve. It is not Large: no new subsystem, no schema migration, and
the behavior change is confined to ids an existing-task remediation round explicitly reopened.
