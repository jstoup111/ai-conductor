# Delivery Decision: Pluggable Memory ships as two slices (1a + 1b)

**Date:** 2026-06-29
**Status:** ACTIVE (operator decision)
**Feature:** Pluggable Memory (per-project, LLM-driven retrieval)
**PRD:** `.docs/specs/2026-06-29-pluggable-memory-source.md`
**Umbrella stories:** `.docs/stories/pluggable-memory.md` (full FR set; authoritative for the
end-of-feature PRD audit)
**ADRs (all APPROVED):** 015–021 · **Architecture review:**
`.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md` (APPROVED, C1–C8)

> **Read this first if you are a fresh `/conduct` or `/pipeline` session.** This feature is built
> as **two independent PRs on two branches**. Each branch has exactly one *active* plan + stories.
> Do **not** try to build both slices in one branch, and do **not** regenerate the other slice's
> artifacts. The per-branch lock is below.

## Why split

The combined Phase-1 plan exceeded 40 tasks (the `/plan` hard-stop threshold). The operator chose to
ship two smaller, independently-reviewable PRs instead of one large change:

- **1a — Durable Default Memory** — establishes the `memory_provider` model with built-in `local`,
  relocates the default store to a durable, shared, branch-independent canonical store
  (`.memory/` → symlink), migrates existing memory safely/reversibly, and locks the FR-3 invariant.
  **No behavior change** for existing users. Ships **first**.
- **1b — Provider Framework** — the pluggable surface: selecting/adopting/removing a non-default
  platform (`conduct memory add|remove|status`), per-provider guidance selection, and the
  best-effort write-fallback/reconcile resilience. Built/tested against a **test-double provider**
  (Phase 1 ships no concrete external platform). Authored **after** 1a, builds **on** 1a's code.

## Per-branch lock (the "don't get hung up" contract)

| Branch | Active plan | Active stories | `feature_desc` | conduct-state `active_slice` |
|---|---|---|---|---|
| `feat/pluggable-memory-source` (**1a**) | `.docs/plans/2026-06-29-pluggable-memory-1a-durable-default-memory.md` | `.docs/stories/pluggable-memory-1a-durable-default-memory.md` | `2026-06-29-pluggable-memory-source` | `1a` |
| `feat/pluggable-memory-1b-provider-framework` (**1b**) | `.docs/plans/2026-06-29-pluggable-memory-1b-provider-framework.md` | `.docs/stories/pluggable-memory-1b-provider-framework.md` | `pluggable-memory-1b-provider-framework` | `1b` |

**How the harness resolves the active artifacts (verified against the conductor code):**

- **Daemon mode** resolves stories from the **plan's `**Stories:**` line**
  (`src/conductor/src/engine/daemon-backlog.ts:276-293`), so each plan pulls its own stories
  automatically. Both plans carry an explicit `**Stories:**` line.
- **Interactive `/conduct` + `/pipeline`** glob **all** `.docs/plans/*.md` and `.docs/stories/**/*.md`
  (`src/conductor/src/engine/artifacts.ts:23,25`) and rely on the skill reading `feature_desc`.
  There is **no** code-level feature filter. To make selection unambiguous we therefore:
  1. Keep the **1a branch's `.docs/plans/` to a single plan** (the 1a plan only) → glob is unambiguous.
  2. Write the active plan path to **`.pipeline/plan-ref.md`** (the pipeline's documented active-plan
     pointer, `skills/pipeline/SKILL.md`) on each branch.
  3. Record `active_plan` / `active_stories` / `active_slice` in **`.pipeline/conduct-state.json`**.
  4. This decision doc is the human-readable backstop.

> Note: the **1b branch is forked from the 1a branch** (to inherit the PRD, ADRs, architecture
> review, and umbrella + slice stories), so it carries **both** plan files. On the 1b branch the
> single-plan guarantee does **not** hold — selection there relies on `.pipeline/plan-ref.md` +
> `conduct-state.active_slice = 1b` + this table. Do not build the 1a plan on the 1b branch (it is
> already shipped via its own PR).

## Build-order dependency (important)

**1b depends on 1a's landed code** — the `memory_provider` plugin kind, the built-in `local`
provider, the `resolveMemoryProvider` resolver, and `memory-store.ts` are all created by **1a**.
Consequences:

- The 1b branch was cut from the 1a branch, so it can *see* 1a's plan/specs, but 1b's **tests will
  not pass until 1a's implementation exists** in the branch.
- **Before running 1b's `/pipeline`, rebase the 1b branch onto the merged 1a** (or onto the 1a branch
  once 1a's implementation is committed). Do not run 1b's build against a branch that lacks 1a's code.
- 1b's writing-system-tests have **not** been authored yet (only 1a's). A fresh 1b session runs
  `/conduct` → `writing-system-tests` (1b stories only) → `/pipeline`.

## Status at time of writing (2026-06-29)

- **1a:** DECIDE complete; plan + story slice committed; **acceptance specs written and RED**
  (23 specs, all failing for the right reason; `tsc --noEmit` clean; harness integrity 133/0).
  Ready for `/pipeline` on `feat/pluggable-memory-source`.
- **1b:** story slice committed; **plan authored** on `feat/pluggable-memory-1b-provider-framework`.
  writing-system-tests + pipeline pending; **must be rebased onto landed 1a first.**

## VERSION / release

Each slice opens its own PR with its own `## [Unreleased]` CHANGELOG entry. The new plugin kind +
config field + CLI are **MINOR** (additive). VERSION stays on the 0.99.x line; the operator approves
the exact bump per PR before it is opened (do not edit `VERSION` or open a PR without that approval).
