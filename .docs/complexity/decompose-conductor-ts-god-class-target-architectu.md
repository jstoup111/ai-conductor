# Complexity: Decompose conductor.ts — target architecture, roadmap, and module-level evacuation (#1481)

Tier: M

## Rationale

- Code change is mechanical and behavior-neutral: ~2,950 lines of module-level declarations
  (outside `class Conductor`, lines 513–2253 and 16437–17209) move from
  `src/conductor/src/engine/conductor.ts` into ~13 topical engine modules. No logic changes.
- Few production call sites: ~12 `src/` importers migrate to the new modules; `conductor.ts`
  keeps `export … from` re-exports for moved names so the ~197 importing test files are untouched
  (operator-confirmed shim; a later roadmap slice removes it).
- No module-level item references `Conductor`, so no move creates a value import cycle; the move
  removes the existing `step-runners.ts` → `conductor.ts` value back-edge.
- Known hazards that justify Medium over Small: an `appendRemediationTasks` name clash with
  `remediation-append.ts`, two whole-module `vi.mock('…/conductor.js')` tests, one load-time
  `Set` construction (`AGENT_DISPATCHING_ENGINE_NATIVE_STEPS`), and high parallel-lane churn on
  `conductor.ts` (78 of the last 491 commits).
- The spec also carries a direction-setting ADR (target architecture + ordered roadmap) that needs
  an architecture-review approval point; lightweight review suffices because each roadmap slice
  is specced and reviewed on its own.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check, and
coherence-check run; no PRD (technical track).
