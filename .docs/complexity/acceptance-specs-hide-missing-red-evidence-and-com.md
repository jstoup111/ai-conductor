# Complexity: Acceptance specs hide missing RED evidence and completion waits (#1246)

Tier: M

## Rationale

Medium. The feature spans four coupled surfaces but introduces no new subsystem, no external
integration, no persistence store, and no auth or multi-actor state machine.

**Signals pushing above Small:**

- **Multiple engine surfaces.** The `ConductorEvent` union (`src/conductor/src/types/events.ts`),
  the acceptance RED runner (`src/conductor/src/engine/acceptance-red-runner.ts`), the completion
  gate's validator (`src/conductor/src/engine/artifacts.ts`), and the status renderer
  (`src/conductor/src/engine/daemon-dashboard.ts`) all change together.
- **A validated artifact schema changes.** `validateAcceptanceRedEvidence` gains required fields,
  so existing markers written by the current runner need a defined compatibility outcome. Getting
  this wrong hard-fails live builds at a gate.
- **A lifecycle with four states** (required / pending / satisfied / rejected) plus a distinct
  remediation-exception path — enough state to warrant a diagram and a conflict check against the
  existing self-heal ordering.
- **Interacts with an approved ADR.** `adr-2026-07-21-engine-owned-acceptance-red-execution` fixes
  where and when the marker is written; this feature must extend that contract without
  contradicting it.

**Signals holding it below Large:**

- No new process, service, or storage layer; all writes stay on the existing spine plus the
  existing gate artifact.
- Subagent child-count and cached/uncached token plumbing — the parts that would have required
  provider-stream parsing — are explicitly out of scope, deferred to #1441.
- The RED gate's pass/fail semantics are unchanged; the work adds evidence detail and visibility
  around a decision the engine already makes correctly.

## Consequences for the BUILD phase

Tier M requires the full non-Small artifact set: architecture diagram, lightweight architecture
review with ADR, conflict-check, and the coherence-check traceability mapping. No PRD — the track
is technical (`.docs/track/acceptance-specs-hide-missing-red-evidence-and-com.md`).
