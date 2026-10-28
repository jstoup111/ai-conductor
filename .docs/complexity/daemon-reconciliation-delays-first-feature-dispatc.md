# Complexity: Daemon reconciliation delays first feature dispatch

Tier: M

Rationale: The change stays inside one subsystem, daemon scheduling (`engine/daemon.ts` startup
and loop, `engine/daemon-maintenance.ts` policy, `engine/park-reconciliation.ts`, the
mergeable-sweep CI-fix and autoresolve dispatch, and the startup dashboard wiring in
`daemon-cli.ts`), plus new duration variants on the existing `ConductorEvent` union. It changes
concurrency semantics: maintenance now overlaps live workers, and provider repair sessions move
from inline to pool work. Those changes need an architecture pass and a conflict check, but they
add no new subsystem, external dependency, or cross-repository contract, so the tier is not Large.
Operator-confirmed Medium on 2026-10-14.
