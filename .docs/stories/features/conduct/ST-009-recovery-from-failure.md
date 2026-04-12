# Story: Recovery from Step Failure

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer, I want the conductor to offer structured recovery options when a step fails
so that I can fix issues without losing progress or restarting from scratch.

## Acceptance Criteria

### Happy Path
- Given a step fails, when the recovery menu appears, then it offers: r=retry, i=interactive
  Claude session, b=go back, s=skip, q=quit
- Given the user chooses `r` (retry), when the step re-runs, then the retry count is not
  incremented (free retry)
- Given the user chooses `i` (interactive), when a Claude session opens for recovery, then
  it is scoped to the failed step only with a system prompt restricting it to that step —
  it must not proceed to subsequent steps
- Given the user chooses `s` (skip), when applied, then the step is marked `skipped` and the
  conductor advances
- Given the user chooses `q` (quit), when applied, then the step is marked `failed` and
  resume instructions are displayed

### Negative Paths
- Given a step fails 3 times consecutively, when the retry limit is reached, then the
  conductor stops retrying and offers skip (for non-gating) or quit
- Given the user tries to skip a gating step, when `s` is selected, then the conductor
  blocks the skip with an explanation of why the step is required
- Given a rate limit is the cause of failure (detected in log output), when recovery triggers,
  then the conductor waits for the rate limit to clear before offering the recovery menu
- Given the interactive session completes but the step still fails the check, when the
  conductor retries, then it re-enters the recovery flow (not an infinite loop — bounded
  by the 3-retry limit)

### Done When
- [ ] Recovery menu offers r/i/b/s/q options
- [ ] Retry does not increment the retry counter
- [ ] Interactive session is scoped to the failed step only
- [ ] Skip is blocked for gating steps
- [ ] Quit preserves state for --resume
- [ ] Rate limits trigger wait, not recovery menu
- [ ] 3-retry limit prevents infinite loops
