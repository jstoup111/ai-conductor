# PRD: Pluggable Memory (per-project, LLM-driven retrieval)

**Date:** 2026-06-29
**Status:** Approved

> **Product-only.** This document states goals and requirements — *what* and *why*. Implementation
> choices (how platforms integrate, how they're installed, where memory is stored, how migration runs,
> the command/config surface) are deliberately **out** of the PRD; they are weighed as trade-offs in
> architecture-review and recorded as ADRs.

> **Earlier drafts superseded.** Two prior versions are archived (`SUPERSEDED-…worktree-shared-memory`,
> `SUPERSEDED-…pluggable-memory-backend`): the first reduced the problem to a storage trick, the second
> put retrieval logic in the harness. Both were wrong layers — see Key Decisions.

## Problem / Background

Harness memory is a single, fixed local store, with three product limitations:

1. **No choice of memory platform.** An operator cannot decide, per project, to back memory with a
   richer platform (e.g. a semantic or managed memory service) instead of the built-in local store.
   Such platforms exist and are designed to be queried *by the agent*, but the harness offers no way to
   adopt them.
2. **Retrieval is hardcoded to the built-in store.** Today recall is the LLM reading that store and
   judging relevance — which is the *right* behavior and should be **generalized, not replaced** by
   harness logic. There is no path for the LLM to recall from an alternative platform.
3. **Memory is entangled with the working tree.** It is isolated per branch/worktree and lost when a
   worktree is removed, so an operator running multiple worktrees does not have one durable, shared
   memory.

This affects every project that uses the harness, not just this repo.

## Goals & Non-Goals

**Goals**
- **G1 — Per-project choice:** an operator can choose which memory platform backs a project (a default
  built-in one, or an alternative).
- **G2 — LLM owns retrieval:** recall is performed by the LLM against the chosen platform; the harness
  contributes no search, ranking, or relevance logic.
- **G3 — Addable platforms:** new memory platforms can be adopted by a project with minimal manual
  setup, including any required provisioning and credentials.
- **G4 — Self-describing platforms:** each non-default platform carries the guidance the LLM needs to
  recall from and persist to it.
- **G5 — Durable, shared memory:** harness memory is shared across a project's worktrees and survives
  worktree removal.
- **G6 — Safe adoption:** moving an existing project to the new model loses no memory and is reversible.
- **G7 — Works out of the box:** the default platform needs no external service, dependency, or credential.

**Non-Goals**
- **Harness-side retrieval** (search/ranking/relevance) — the defining exclusion; it is the LLM's job.
- **Building or operating the platforms themselves** — the harness adopts and integrates existing ones.
- **The specific alternative platforms** (e.g. a managed memory service, a vector store) — those are
  later phases; this phase establishes the model + the default platform.
- **Serena's worktree-sharing** — separate effort, tracked in issue #141.
- **The global assistant auto-memory** — a separate system, untouched.

## Users / Personas
- **Harness operator (James)** — wants to pick, per project, where memory lives (built-in now, a richer
  platform later) and have the agent recall from it, with memory durable across worktrees.
- **The agent (LLM)** — performs all recall and persistence; owns retrieval and relevance judgment.
- **A project using the harness** — must keep working whether it uses the default platform or another.

## Functional Requirements

### Choosing a platform
- **FR-1:** An operator can select the active memory platform **per project**; with no selection, a
  default built-in platform is used.
- **FR-2:** Selecting an unknown or unavailable platform does not break a run — the harness reports it
  clearly and falls back to the default platform.

### Retrieval is the LLM's
- **FR-3:** All memory retrieval is performed by the LLM against the active platform. The harness
  contains no search, ranking, relevance, or embedding logic. *(Verifiable: no such logic exists.)*
- **FR-4:** Each non-default platform provides LLM-facing guidance for recalling and persisting memory,
  and that guidance is in effect when the platform is active.

### Durability across worktrees
- **FR-5:** Harness memory written while working in one worktree is available in the project's other
  worktrees and **persists after that worktree is removed**.

### Adopting & removing platforms
- **FR-6:** An operator can adopt a memory platform for a project in a single deliberate action that
  performs the needed setup (including credentials for external platforms). Repeating the action is
  safe — no duplication and no overwrite of existing configuration.
- **FR-7:** An operator can remove or disable a platform; the project then falls back to the default.
  Removal is clean and repeatable, and does not affect other platforms or unrelated configuration.
- **FR-8:** The default platform requires no adoption step, no external service, and no credentials.

### Continuity & parity
- **FR-9:** The default platform preserves today's memory experience — the same categories and recall
  quality the operator has now.
- **FR-10:** Existing harness behaviors that read or write memory (the memory step, design steps that
  recall prior decisions, project setup) work unchanged regardless of the active platform.

### Safe adoption for existing projects
- **FR-11:** Moving an existing project to the new memory model **preserves all existing memory entries
  and is reversible**. If the entries cannot first be safely preserved, the move makes **no destructive
  change**.
- **FR-12:** A newly set-up project uses the default platform and needs no migration.

### Resilience
- **FR-13:** Memory problems (a misconfigured or unavailable platform, a failed persist) are surfaced as
  warnings and **never abort** a harness run — memory is best-effort.

## Non-Functional Requirements
- **LLM owns retrieval** (FR-3) — the architectural invariant the whole feature is shaped around.
- **Per-project** resolution (FR-1).
- **Best-effort / non-blocking** (FR-13): memory never blocks the SDLC flow.
- **Non-destructive** (FR-6, FR-7, FR-11): adoption, removal, and migration never clobber operator
  configuration or lose memory.

## Acceptance Criteria / Success Metrics
- A project with no selection behaves exactly as today (same categories, same recall), and its memory is
  now durable across worktrees and survives worktree removal.
- An operator can adopt an alternative platform for one project and have the agent recall from it, while
  another project still uses the default — and **no harness-side search is involved**.
- Adopting a platform twice is a no-op; removing it returns the project to the default cleanly.
- Migrating an existing project preserves every memory entry and is reversible; a failed safe-copy makes
  no destructive change; a fresh project needs no migration.
- A misconfigured platform produces a clear warning and the run continues.

## Scope
### In Scope (Phase 1)
- The per-project platform-selection model; the **default built-in platform**; durable cross-worktree
  memory; the framework for adopting/removing platforms and for platform-supplied LLM guidance; safe
  migration for existing projects; parity for existing memory behaviors.

### Out of Scope (later)
- **Phase 2:** specific alternative platforms (a managed memory service first, then a vector store) — each
  adopted into the Phase-1 framework.
- Serena worktree-sharing (issue #141).

## Key Decisions & Rationale *(product-level only)*
1. **Retrieval belongs to the LLM, not the harness.** Recall is an adaptive, in-context judgment, and the
   richer platforms are built to be queried by the agent. A harness retrieval layer would be redundant
   and less capable. This is the invariant the design is shaped around (FR-3).
2. **Memory platform is chosen per project** (FR-1) — different projects, different needs.
3. **A platform is adopted as a usable, self-describing unit** — adopting it sets it up *and* supplies the
   LLM guidance to use it (FR-4, FR-6), so adding a platform is turnkey for the operator and legible to
   the agent. *(How a platform is packaged/integrated is an architecture decision, not a product one.)*
4. **A zero-dependency default works out of the box** (FR-8) — no operator is forced to adopt anything.
5. **Phased:** establish the model + default platform now; adopt specific alternatives later, with no
   change to existing call sites.
6. **Serena is decoupled** (issue #141) — an external tool with its own store.

## Dependencies
- The existing harness memory behaviors (memory step, recall in design steps, project setup) that this
  model must preserve (FR-10).
- Phase 2 only: the specific external platforms an operator chooses to adopt.

## Open Questions — to weigh in architecture-review (implementation trade-offs)
*(Deliberately not decided here. These are the "how" trade-offs to discuss and capture as ADRs.)*
- **How platforms integrate so the LLM can query them directly** — e.g. an MCP-server model vs.
  alternatives — and the trade-offs (capability, coupling, operability).
- **How a platform is adopted/installed** — the operator UX/surface, provisioning, and credential handling.
- **Where shared memory lives and how cross-worktree durability is achieved** (placement vs. other means).
- **How an existing project's memory is migrated safely** (preservation, reversibility, failure handling).
- **Where per-platform retrieval guidance lives** — bundled with each platform vs. a central, source-aware skill.
- **How a project expresses its platform choice** (configuration surface).
