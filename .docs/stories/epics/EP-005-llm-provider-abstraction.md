# Epic: LLM Provider Abstraction

**Status:** ACCEPTED

> **Availability amendment (#927, approved 2026-07-24):** In a scalar run, or
> when no configured alternative is usable, a missing provider executable still
> fails with the clear diagnostic below. In an ordered multi-provider run, a
> registered provider whose executable is missing is classified as
> deterministically unavailable, emits a warning, and permits ordered fallback.
> Unknown or unregistered provider names still fail validation before dispatch.

## Description

As the harness maintainer, I want the execution layer to abstract LLM CLI invocation behind
a simple interface so that the harness can theoretically work with providers other than Claude
without rewriting the conductor.

## Child Stories

- ST-080 LLM provider interface (invoke and session management; the retained
  resume capability is fail-closed and neither built-in provider enables it)
- ST-081 Claude CLI provider (default implementation)

## Acceptance Criteria (Epic Level)

### Happy Path
- Given the Claude CLI provider is configured (default), when the conductor invokes a skill,
  then it calls the Claude CLI with fresh-session flags and the appropriate system prompt;
  it never supplies `--resume`

### Negative Paths
- Given the configured LLM provider binary is not found on PATH, when the conductor starts,
  then it fails with a clear error: "LLM provider '<name>' not found. Install it or update
  .harness/config.yml"
