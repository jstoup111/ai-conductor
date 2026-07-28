# Story: Session Management

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

> **Current scope:** Updated by `fresh-session-per-step.md` (#325, merged via
> PR #365), per-step provider routing (#927, approved 2026-07-24), and
> `claude-within-step-retries-resume-the-prior-attemp.md` (#1071).

As a developer, I want every provider attempt to start with fresh provider-native
context, so reasoning does not leak across steps or retries while committed artifacts
and the full retry prompt still carry partial work forward.

## Acceptance Criteria

### Happy Path
- Given a step starts, when its first provider invocation dispatches, then it
  uses a fresh session ID and create semantics rather than resuming a prior
  step's conversation
- Given the same step retries on the same provider, when the retry dispatches,
  then it uses a new session ID with `resume: false` and receives the full step
  prompt prefixed with the retry reason
- Given the next step starts, when it invokes the same provider, then it resets
  to another fresh session rather than resuming the preceding step
- Given a step falls back to another provider, when that provider first
  dispatches for the step, then it creates an isolated provider-native session
- Given a step dispatches a subagent, when the subagent completes, then its context is
  discarded — only a summary returns to the orchestrator session
- Given the conductor is invoked with `--resume`, when it continues, then it resumes
  workflow state only; every provider invocation still creates fresh context

### Negative Paths
- Given a provider reports an expired or invalid session despite a fresh dispatch,
  when the conductor recovers, then it creates another fresh session without
  consuming retry budget — it does not attempt to resume the invalid session
- Given the API returns a rate limit error, when detected, then the conductor waits for the
  rate limit to clear before retrying (escalating cooldown)
- Given a prior step left session markers, when a later step or different
  provider dispatches, then those markers never cause it to resume the prior
  conversation

### Done When
- [ ] Every step boundary creates fresh provider-native session state
- [ ] Same-step, same-provider retries use new session IDs with resume disabled
- [ ] No later step, retry, or other provider resumes a provider session
- [ ] Subagent context is isolated and discarded after return
- [ ] Expired sessions are transparently recreated
- [ ] Rate limits are detected and handled with escalating cooldown
