# Complexity: evidence-stamps-sync-to-task-status-rows-so-progre

Tier: S

Rationale: a contained, deterministic fix inside the existing evidence-derivation seam. One new
private reconcile primitive plus two call-site wirings (`applyDerivedCompletion` in
`autoheal.ts`, `writeJudgedStamps` in `task-evidence.ts`). No new models, integrations, auth,
CLI, hook, or schema; no new architecture and no cross-story state contention (single writer of
`task-status.json` rows, single source of truth = `evidenceStamps`), so architecture-review and
conflict-check add nothing. The reader side (`task-progress.ts`, `build-progress-watcher.ts`)
needs no change — honest rows make honest readers automatically. Negative paths (orphan stamp,
no-stamp row) are simple, unit-testable branches. 5 tasks. Not M: no coupled subsystems, no gate
*semantics* change (the gate already trusts `evidenceStamps`; this only makes the row file agree
with it), no decisions to record.
