# ADR 001: Harness Architecture

**Date:** 2026-03-28
**Status:** Accepted

## Context

We need a personal development harness that provides disciplined AI-assisted workflows.
Evaluated three existing systems:

- **Superpowers** (obra): Turnkey Claude Code plugin, focused solo workflow, advisory enforcement
- **agent-skills** (jwilger): Harness-agnostic, domain-driven TDD, 4-level enforcement, factory pipeline
- **Anthropic harness design article**: Generator/evaluator separation, context resets, sprint contracts

Each has strengths but none matches our exact needs: a solo-first harness with real enforcement,
generator/evaluator separation, mandatory story coverage, and a self-improvement feedback loop.

## Decision

Build a custom harness as a pure Markdown skills + agent personas repository, using Claude Code
as the execution engine. No custom runtime.

### Key architectural choices:

1. **Skills are technology-agnostic.** Stack-specific knowledge lives in a separate `tech-context/`
   layer loaded by the bootstrap skill based on project detection.

2. **Agent personas are separate from skills.** Skills define process; agent prompts in `agents/`
   define who executes. This enables generator/evaluator separation without coupling.

3. **4-level enforcement declared per skill:** Advisory, Gating, Structural, Mechanical.

4. **Planning is 4 distinct skills** (brainstorm, stories, conflict-check, plan), each with its
   own enforcement gate, communicating via artifacts in `docs/`.

5. **Dual retrospective** analyzes both harness workflow and application code health after each feature.

6. **Memory protocol** with categorized storage and staleness detection across sessions.

## Consequences

- We own and evolve every skill — no dependency on third-party plugin updates
- Must write and maintain all skills ourselves (higher upfront cost)
- Tech-context layer must be built per stack (starting with Rails + PostgreSQL)
- Dual retro creates a self-improvement feedback loop that should reduce intervention over time
- Skills work standalone by default; pipeline orchestration is opt-in for larger features
