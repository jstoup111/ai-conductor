# Complexity: Build-stall auto-remediation must also fire for no_task_progress stalls (#569)

Tier: S

## Rationale
- **Models/integrations:** none new. Reuses the existing `planRemediation` / `/remediate`
  dispatch and the existing task-status/task-evidence context already read in the build loop.
- **Auth/state machines:** none new. No new persisted state; the change relaxes/duplicates an
  existing dispatch predicate in an existing gate path and adds one step-scoped reason variable.
- **Surface:** single production file (`src/conductor/src/engine/conductor.ts`) — inside the
  `if (stalled)` build-stall block (`:3622-3855`): populate `effectiveQuestion` for the
  `no_task_progress` branch by synthesizing a prompt from `completion.reason` (pending-task rows),
  the stall counts, and `taskEvidence.noEvidenceReasons`; run the SAME dispatch for both stall
  kinds; give `no_task_progress` a distinct budget-exhaustion / non-route fall-through (it must
  NOT terminal-HALT — the durable no-evidence counter keeps owning that). Secondary: the terminal
  reason string at `:4568-4573` gains a `no_task_progress`-specific message instead of the generic
  "retries exhausted".
- **Story count:** ~4 (dispatch-on-no_task_progress happy path; halt_marker path unchanged pin;
  budget-exhausted/non-route falls through to retry+auto-park rather than HALT; distinct terminal
  reason string).
- **Risk note:** the edit is on the engine's critical build-gate retry loop, so blast radius is
  real even though structural complexity is low. Mitigated by (a) unit tests pinning each
  acceptance signal, (b) leaving the `halt_marker` dispatch/HALT semantics byte-for-byte
  unchanged, and (c) leaving the durable no-evidence counter + `checkAndAutoPark` accounting
  (`:3539-3620`) and the interactive-mode REPL handoff untouched.

## Tier-driven step skipping (Small)
Skips: architecture-diagram, architecture-review, conflict-check.
Runs: stories, plan.
