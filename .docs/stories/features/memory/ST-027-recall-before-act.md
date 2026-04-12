# Story: Memory Recall-Before-Act Protocol

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** memory/SKILL.md

As a developer, I want the memory skill to recall prior decisions and context at the start
of every session so that the harness doesn't repeat past mistakes or contradict prior choices.

## Acceptance Criteria

### Happy Path
- Given `.memory/index.md` exists with categorized entries, when memory recall runs, then
  relevant memories are loaded into the session context
- Given a significant decision is made during work, when the session progresses, then the
  decision is persisted to `.memory/decisions/` with rationale
- Given memories exist from prior sessions, when a new session starts, then stale memories
  are detected (by checking if referenced files/functions still exist) and flagged

### Negative Paths
- Given no `.memory/` directory exists (fresh project), when memory recall runs, then it
  completes silently — no error, no blocking
- Given a memory references a file that no longer exists, when staleness is checked, then
  the memory is flagged as potentially stale — it is not auto-deleted
- Given conflicting memories exist (two memories with contradictory guidance), when detected,
  then the conflict is surfaced to the user for resolution

### Done When
- [ ] Memories recalled at session start from .memory/
- [ ] Decisions persisted with rationale during work
- [ ] Stale memories detected by verifying referenced artifacts
- [ ] Missing .memory/ handled gracefully (no error)
- [ ] Conflicting memories surfaced for resolution
