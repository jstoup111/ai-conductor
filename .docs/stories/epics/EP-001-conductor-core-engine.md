# Epic: Conductor Core Engine

**Status:** ACCEPTED

## Description

As a developer using the harness, I want a conductor that drives my feature through a
well-defined SDLC flow so that I follow a disciplined process without needing to remember
the sequence or gate requirements myself.

The conductor is the orchestrator — it tracks state, enforces gates, manages sessions,
and directs the user to the correct next skill. It does NOT run skills internally.

## Child Stories

### Conduct
- ST-001 Step progression and state tracking
- ST-002 Status dashboard display
- ST-003 Checkpoint validation (user review after build/manual-test)
- ST-004 Backward navigation from checkpoints and recovery
- ST-005 Tier-based step skipping (S/M/L complexity)
- ST-006 Gate enforcement between steps
- ST-007 Worktree isolation per feature
- ST-008 Session management (resume, single session per feature)
- ST-009 Recovery from step failure (retry, interactive fix, skip, go back, quit)
- ST-010 Feature completion and cleanup
- ST-011 Complexity assessment after brainstorm

## Acceptance Criteria (Epic Level)

### Happy Path
- Given a new feature description, when the conductor starts, then it creates a worktree,
  begins at step 1, and guides the user through each step in sequence
- Given a partially completed feature, when the conductor resumes, then it picks up at the
  first incomplete step without re-running completed steps

### Negative Paths
- Given a step that fails after 3 retries, when recovery is exhausted, then the conductor
  offers skip (non-gating) or quit, preserving state for later resume
- Given a user attempts to skip a gating step, when they request the skip, then the conductor
  blocks with an explanation of why the step is required
