# Story: Session Management

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer, I want the conductor to maintain a single Claude session per feature so that
context accumulates across steps without redundant cold starts.

## Acceptance Criteria

### Happy Path
- Given a new feature starts, when the first Claude invocation succeeds, then a session ID
  is stored in `.pipeline/conduct-session-id` and a marker file is created
- Given a session exists, when subsequent steps invoke Claude, then they resume the existing
  session (--resume flag) instead of creating a new one
- Given a step dispatches a subagent, when the subagent completes, then its context is
  discarded — only a summary returns to the orchestrator session
- Given the conductor is invoked with `--resume`, when it continues, then it uses the stored
  session ID to resume the Claude session

### Negative Paths
- Given the Claude session has expired or been invalidated ("No conversation found"), when
  a resume is attempted, then the conductor creates a fresh session and updates the session
  ID — it does not fail permanently
- Given the API returns a rate limit error, when detected, then the conductor waits for the
  rate limit to clear before retrying (escalating cooldown)
- Given the session log grows very large, when the conductor operates, then subagent isolation
  prevents the orchestrator context from growing beyond a bounded size

### Done When
- [ ] One session per feature — session ID stored in .pipeline/conduct-session-id
- [ ] Subsequent Claude calls resume the session, not create new ones
- [ ] Subagent context is isolated and discarded after return
- [ ] Expired sessions are transparently recreated
- [ ] Rate limits are detected and handled with escalating cooldown
