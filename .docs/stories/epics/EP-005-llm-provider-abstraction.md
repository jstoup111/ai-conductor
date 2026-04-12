# Epic: LLM Provider Abstraction

**Status:** ACCEPTED

## Description

As the harness maintainer, I want the execution layer to abstract LLM CLI invocation behind
a simple interface so that the harness can theoretically work with providers other than Claude
without rewriting the conductor.

## Child Stories

- ST-080 LLM provider interface (invoke, resume, session management)
- ST-081 Claude CLI provider (default implementation)

## Acceptance Criteria (Epic Level)

### Happy Path
- Given the Claude CLI provider is configured (default), when the conductor invokes a skill,
  then it calls the Claude CLI with the appropriate flags (session resume, system prompt, etc.)

### Negative Paths
- Given the configured LLM provider binary is not found on PATH, when the conductor starts,
  then it fails with a clear error: "LLM provider '<name>' not found. Install it or update
  .harness/config.yml"
