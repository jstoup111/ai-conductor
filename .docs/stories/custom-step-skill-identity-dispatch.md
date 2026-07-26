# Story: Custom-Step Skill Identity Dispatch

**Status:** DRAFT
**Track:** Technical
**Source:** `.docs/retros/2026-07-25-maintain-documentation.md` A-1 and A-2

As a project maintainer, I want a custom step to invoke the configured skill independently of the
step's state key so that repository-local gates run consistently in interactive and daemon flows.

## Happy Path

- **Given** `steps.docs-gate.skill` points to a valid `maintain-documentation` skill,
- **When** the custom step runs through the direct or provider-aware runner in default,
  interactive, or daemon `auto` mode,
- **Then** the configured skill is invoked and pipeline state remains keyed by `docs-gate`,
- **And** Claude and Codex receive equivalent skill intent through their native invocation paths.

## Negative Paths

- **Given** the custom step key differs from the configured skill identity,
- **When** the runner builds the provider prompt,
- **Then** it does not substitute the step key as an unverified slash-command name.
- **Given** a configured custom skill is unavailable or invalid,
- **When** configuration or dispatch validates it,
- **Then** the run fails closed with the custom step and configured skill identified.
- **Given** a repository has no custom steps,
- **When** built-in steps run,
- **Then** their existing prompts, provider routing, and state keys are unchanged.

## Done When

- [ ] A table-driven real-runner test covers direct and provider-aware execution in default,
      interactive, and daemon `auto` modes.
- [ ] The table covers Claude and Codex with a custom step key that differs from its skill identity.
- [ ] Validation or dispatch tests cover an unavailable configured skill without falling back to
      an unrelated command.
- [ ] Existing built-in prompt and provider-routing tests remain green.
