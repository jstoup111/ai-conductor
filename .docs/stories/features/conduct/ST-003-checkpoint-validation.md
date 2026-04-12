# Story: Checkpoint Validation

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer using the conductor, I want the flow to pause at key milestones (after build,
after manual-test) so that I can review what was produced and decide whether to continue,
go back, or stop.

## Acceptance Criteria

### Happy Path
- Given the build step completes successfully, when the conductor reaches the checkpoint,
  then it pauses with a harness-level prompt (c=continue, b=go back, q=quit) — no Claude
  session is involved
- Given the manual-test step completes, when the conductor reaches the checkpoint, then it
  pauses with the same c/b/q prompt
- Given the user presses `c` at a checkpoint, when the input is received, then the conductor
  advances to the next step

### Negative Paths
- Given the conductor is running in auto mode (non-interactive), when a checkpoint step
  completes, then the checkpoint is silently skipped and the flow continues
- Given the terminal is not attached (no TTY), when a checkpoint would fire, then it is
  skipped to avoid blocking headless execution
- Given the user enters invalid input at the checkpoint prompt, when received, then the
  prompt re-displays without advancing or crashing

### Done When
- [ ] Checkpoints fire after `build` and `manual_test` steps in interactive mode
- [ ] Checkpoints are skipped in auto mode and non-TTY environments
- [ ] Status dashboard is displayed before the checkpoint prompt
- [ ] Pressing `q` saves state and exits cleanly with resume instructions
