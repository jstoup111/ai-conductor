# Story: Backward Navigation

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer at a checkpoint or recovery prompt, I want to navigate back to any previously
completed step so that I can revise earlier decisions without losing track of what was done.

## Acceptance Criteria

### Happy Path
- Given the user presses `b` at a checkpoint, when the navigation menu appears, then it
  lists all prior steps with state `done` or `stale`, their labels, and phases
- Given the user selects a step from the navigation menu, when confirmed, then the target
  step is set to `pending` and all downstream steps are marked `stale`
- Given a step is marked `stale`, when the conductor loop reaches it, then it re-runs the
  step (stale steps are not skipped)
- Given steps downstream of the target are stale, when the conductor re-runs from the target,
  then it continues forward through all downstream steps automatically
- Given the user presses `b` in the recovery menu (after a step failure), when they select
  a step, then the failed step is recorded and the loop jumps back to the target

### Negative Paths
- Given the user selects `0` (Cancel) in the navigation menu, when confirmed, then the
  conductor returns to the checkpoint/recovery prompt without any state changes
- Given no prior steps are in `done` or `stale` state (only the first step has run), when
  the user presses `b`, then the conductor shows "No completed steps to navigate back to"
- Given a stale step has a gate check (e.g., build requires plan), when the stale step runs,
  then the gate passes because `step_satisfied()` accepts stale state

### Done When
- [ ] Navigation menu shows numbered list of completed steps with state and phase
- [ ] Selecting a step sets it to pending and marks all downstream as stale
- [ ] Stale steps re-run when the loop reaches them
- [ ] Stale steps satisfy gate prerequisite checks (step_satisfied)
- [ ] Cancel returns to the previous prompt with no state changes
- [ ] Backward navigation is available from both checkpoints and recovery menu
