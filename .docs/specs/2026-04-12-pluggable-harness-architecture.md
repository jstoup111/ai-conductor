# Design: Pluggable Harness Architecture

**Date:** 2026-04-12
**Status:** Approved

## Problem

The harness is a monolithic bash script (~3000 lines) with a hardcoded 14-step SDLC sequence.
Every project gets the same flow regardless of whether the steps apply. There is no way to:

- Disable steps that don't apply to a project (e.g., architecture-review for a Markdown repo)
- Add project-specific steps (e.g., deploy-to-staging between build and manual-test)
- Override or augment a skill with project-specific behavior
- Plug in different UI frontends (terminal, tmux, web, IDE)
- Rebuild the harness from scratch — no specification exists that captures all behavior

The bash conductor has grown organically and now has JSON parsing via grep/sed hacks, no module
system, no test framework, and presentation logic tangled with state machine logic. Extending it
further (pluggable config, skill resolution, UI abstraction) is not feasible in bash.

Additionally, the harness has no formal specification of its own behavior. The SKILL.md files
describe *what to do* but not *why* or *what the user expects*. A new Claude session cannot
rebuild the harness without reading all the source code.

## Approaches

### Approach A: Stories First, Then Phased Rewrite (Recommended)

**How:** Write a complete product + feature story catalog that specifies all harness behavior
as Given/When/Then acceptance criteria. Use this catalog to scope and drive a phased rewrite
of the conductor in a proper language with pluggable architecture.

**Phases:**

1. **Story catalog** — Epic-level product stories + feature-level stories per skill. Stored in
   `.docs/stories/` in this repo. Captures all current behavior plus the pluggable config
   requirements. Ships as its own deliverable.

2. **Language evaluation** — Evaluate Python, TypeScript, and Rust against the requirements
   revealed by the stories: pluggable UI, config parsing, subprocess management (Claude CLI),
   cross-platform, state machine, skill resolution. Produce an ADR.

3. **Conductor rewrite** — Rewrite bin/conduct in the chosen language with:
   - Core engine (state machine, config, skill resolution) separated from UI
   - Per-project config file (step enable/disable, custom steps)
   - Skill resolution: project-local > harness default
   - Before/after hooks on skills

4. **Skill override system** — Projects can fully replace a skill or hook before/after it.

5. **UI abstraction** (future) — Pluggable frontends: terminal, tmux, web, IDE.

**Pros:**
- Stories are immediately useful even before the rewrite starts
- Each phase ships independently — no big-bang risk
- Stories become the acceptance criteria for the rewrite (test-driven architecture)
- A fresh Claude session can rebuild from stories alone
- Language decision is informed by real requirements, not speculation

**Cons:**
- Writing comprehensive stories for 20+ skills is significant upfront work
- The current bash conductor keeps running during the transition (dual maintenance)
- Full vision (pluggable UI) is phases away

**Best when:** The goal is a production-quality, maintainable system that can evolve over years.

### Approach B: Architecture-First Rewrite

**How:** Design the pluggable architecture and config schema first, choose a language, rewrite
the conductor, then backfill stories as you go.

**Pros:**
- Faster path to working pluggable config
- Architecture decisions aren't constrained by existing behavior documentation

**Cons:**
- High risk of missing edge cases that the current bash handles
- No specification to validate against — "does it work?" is subjective
- Harder to parallelize — one big feature branch
- Can't rebuild from scratch without reading the new source code (same problem as today)

**Best when:** Speed to pluggable config matters more than specification completeness.

### Approach C: Incremental Pluggability in Bash

**How:** Keep bash, add a config file, implement step skip/add via config, add skill resolution
order. Defer the rewrite.

**Pros:**
- Smallest change, fastest delivery
- No new language dependency
- Existing tests and validation still work

**Cons:**
- Bash fundamentally cannot support pluggable UI
- JSON/YAML config parsing in bash is fragile
- No path to the long-term vision (IDE integration, web frontend)
- Complexity ceiling — bash at 3000+ lines is already straining

**Best when:** Pluggable config is the only goal and the UI/rewrite vision is abandoned.

## Solution

**Approach A: Stories first, then phased rewrite.**

### Story Catalog Structure

Stories live in `.docs/stories/` in this repo, organized as:

```
.docs/stories/
  epics/
    EP-001-pluggable-step-config.md        # Product-level epic
    EP-002-skill-override-system.md
    EP-003-conductor-core-engine.md
    EP-004-ui-abstraction.md
    ...
  features/
    conduct/
      ST-001-step-progression.md           # Feature-level per skill
      ST-002-checkpoint-validation.md
      ST-003-backward-navigation.md
      ST-004-tier-based-skipping.md
      ...
    brainstorm/
      ST-010-design-doc-generation.md
      ...
    tdd/
      ST-020-red-green-cycle.md
      ...
```

Each story follows the existing harness format:
- Title, description, acceptance criteria as Given/When/Then
- Mandatory happy path + negative path
- Status: DRAFT | ACCEPTED

Epics reference their child feature stories. Feature stories reference which SKILL.md they
specify behavior for.

### Per-Project Config (Target State)

```yaml
# .harness/config.yml
harness_version: ">=1.0.0"

steps:
  disable:
    - architecture-review
    - architecture-diagram
    - retro
  add:
    - name: deploy-staging
      after: build
      skill: .harness/skills/deploy-staging/SKILL.md
      enforcement: gating

skills:
  overrides:
    tdd: .harness/skills/tdd/SKILL.md          # full replacement
  hooks:
    brainstorm:
      after: .harness/hooks/notify-slack.sh     # augmentation

complexity:
  default_tier: S                               # skip tier assessment
```

Resolution order: project `.harness/skills/` > harness `skills/`.
Missing config = harness defaults (backward compatible).

### Conductor Core Engine (Target State)

The conductor becomes three layers:

```
┌─────────────────────────────┐
│  UI Layer (pluggable)       │  terminal / tmux / web / IDE
├─────────────────────────────┤
│  Conductor Engine           │  state machine, config, skill resolution
├─────────────────────────────┤
│  Execution Layer            │  Claude CLI invocation, subprocess mgmt
└─────────────────────────────┘
```

- **Engine** owns: step registry, state transitions, gating logic, config parsing
- **UI** owns: display, user prompts, progress rendering
- **Execution** owns: Claude CLI calls, session management, rate limiting

Engine emits events (step_started, step_completed, checkpoint_reached, etc.).
UI subscribes to events. Engine never prints directly.

## Scope

### In Scope (This Design Doc)
- Story catalog structure and conventions
- Per-project config schema design
- Conductor architecture (3-layer separation)
- Language evaluation criteria
- Phased rollout plan

### Out of Scope
- Swappable memory backends (later enhancement)
- Swappable Markdown viewers (later enhancement)
- Specific UI implementations beyond terminal (Phase 5)
- Migration tooling from bash conductor to new conductor (Phase 3 concern)

## Key Decisions

1. **Stories before code.** The story catalog is the first deliverable. It defines the product
   and enables rewrite-from-scratch capability. No architecture work starts until stories exist.

2. **Language decision deferred to Phase 2.** Evaluated against real requirements from the story
   catalog, not speculation. Candidates: Python, TypeScript, Rust.

3. **Strict migration path.** Existing projects MUST go through a migration when upgrading
   to the new conductor. No silent fallback to defaults — `bin/migrate` generates a
   `.harness/config.yml` from the project's current state (detected stack, tier, etc.) and
   the user approves it. The new conductor must pass all existing acceptance criteria before
   replacing the bash version.

4. **Event-driven UI separation.** The engine emits events, UI subscribes. This enables
   pluggable frontends without touching engine logic.

5. **Skill resolution order.** Project-local overrides harness default. Full replacement and
   before/after hooks are both supported mechanisms.

6. **This is v1.0.0.** Defining the product specification via stories and committing to a
   pluggable architecture is the maturity signal for major version 1.

## Resolved Questions

1. **Story granularity:** One story per user-observable behavior. This is the finest
   rewrite-testable unit — each story maps to a precise, verifiable behavior.

2. **Config format:** YAML. Most readable, supports comments, mature parsers in all candidate
   languages (Python, TypeScript, Rust).

3. **LLM CLI abstraction:** Yes. The execution layer defines a simple LLM provider interface
   (invoke, resume, session management). Claude CLI is the default implementation. Keeps the
   door open for other providers without over-engineering.

4. **Story ownership during rewrite:** Update existing stories as behavior evolves. Stories
   always reflect current desired behavior. The CHANGELOG tracks what changed between versions.
