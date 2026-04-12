# Story: Step Progression and State Tracking

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer running the conductor, I want it to progress through SDLC steps in order
and track completion state so that I always know where I am and never lose progress.

## Acceptance Criteria

### Happy Path
- Given a new feature with no prior state, when the conductor starts, then it begins at
  the first step (worktree setup) and records `in_progress` in conduct-state.json
- Given a step function returns success, when the conductor advances, then it marks the
  step as `done` in conduct-state.json and moves to the next step
- Given all steps are complete, when the conductor finishes, then it sets `feature_status`
  to `complete` in conduct-state.json and commits final artifacts

### Negative Paths
- Given a step function returns failure, when the conductor handles it, then it records
  the step as `failed` and enters the recovery flow — it does NOT advance to the next step
- Given the conductor crashes mid-step (kill signal, power loss), when it resumes via
  `--resume`, then it lands on the step that was `in_progress` at crash time
- Given conduct-state.json is corrupted (invalid JSON), when the conductor reads it, then
  it reports the error and offers to reset state or quit

### Done When
- [ ] Steps execute in the order defined by the step registry (ALL_STEPS array)
- [ ] Each step's state transitions through: pending -> in_progress -> done (or failed/skipped)
- [ ] conduct-state.json persists across conductor invocations
- [ ] Crash recovery via --resume lands on the correct in_progress step
- [ ] feature_status is set to complete only after all steps succeed
