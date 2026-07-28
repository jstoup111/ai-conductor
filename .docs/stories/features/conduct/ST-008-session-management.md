# Story: Session Management

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

> **Current scope:** Updated by `fresh-session-per-step.md` (#325, merged via
> PR #365) and per-step provider routing (#927, approved 2026-07-24).

As a developer, I want every executed step to start with fresh provider-native
context while its own retries may resume that step's session, so reasoning does
not leak across steps and retries can still continue partial work.

## Acceptance Criteria

### Happy Path
- Given a step starts, when its first provider invocation dispatches, then it
  uses a fresh session ID and create semantics rather than resuming a prior
  step's conversation
- Given the same step retries on the same provider, when the retry dispatches,
  then it resumes that step-and-provider session
- Given the next step starts, when it invokes the same provider, then it resets
  to another fresh session rather than resuming the preceding step
- Given a step falls back to another provider, when that provider first
  dispatches for the step, then it creates an isolated provider-native session
- Given a step dispatches a subagent, when the subagent completes, then its context is
  discarded — only a summary returns to the orchestrator session
- Given the conductor is invoked with `--resume`, when it continues, then it uses the stored
  state to resume only an in-progress matching step-and-provider retry; a new
  step still creates fresh context

### Negative Paths
- Given the current step-and-provider session has expired or been invalidated
  ("No conversation found"), when a resume is attempted, then the conductor
  creates a fresh session for that same step/provider without consuming retry
  budget — it does not fail permanently
- Given the API returns a rate limit error, when detected, then the conductor waits for the
  rate limit to clear before retrying (escalating cooldown)
- Given a prior step left session markers, when a later step or different
  provider dispatches, then those markers never cause it to resume the prior
  conversation

### Done When
- [ ] Every step boundary creates fresh provider-native session state
- [ ] Same-step, same-provider retries resume their own session
- [ ] Later steps and other providers never resume that session
- [ ] Subagent context is isolated and discarded after return
- [ ] Expired sessions are transparently recreated
- [ ] Rate limits are detected and handled with escalating cooldown
