# Track decision: Re-kick resume republishes a stale worktree engine after the rebase

**Source:** jstoup111/ai-conductor#625 (priority: high)
**Track:** technical
**Date:** 2026-07-13

## Problem statement (WHAT, not the filer's HOW)

On a self-host build, a feature worktree that resumes after a re-kick gates on a **stale
worktree engine** — the `dist` it built during setup, not the engine its post-rebase source
describes. The daemon's per-feature order is fixed:

1. `prepareWorktree` runs `bin/setup` → `npm run build` → `scripts/publish-engine.mjs` in the
   worktree's `src/conductor`. The worktree source is still **pre-rebase** here, so the
   content-addressed publish is a no-op and the worktree keeps its stale `dist`
   (`makeRunFeature`, `engine/daemon-runner.ts:223-282`; `runProjectSetup`,
   `engine/worktree-prepare.ts`).
2. Only afterward does the re-kick's rebase-onto-latest run (`resumeRebaseFirst`,
   `engine/daemon-rekick.ts:313`, inside `runConductorInWorktree` in `daemon-cli.ts`),
   pulling merged `src/conductor` fixes into the worktree **source**.
3. The gate then executes on the pre-rebase `dist`. In the verified 2026-07-13 ~10:05Z
   incident (feature `2026-07-12-rtk-hook-preservation`), the merged plan-parser fixes
   (#615/#622) were in the source but not the `dist`, so the gate parsed the plan as
   `▶ build 0/0` and halted "retries exhausted" in ~90s.

The ordering is one-directional the wrong way: setup builds the engine, then the rebase
mutates the engine SOURCE underneath the already-built `dist`, and `dist` is never rebuilt
before the gate runs.

## Desired outcomes (observable acceptance signals)

1. A resumed/re-kicked self-host feature always gates on an engine built from its
   **post-rebase** source: the `dist` its gate executes corresponds to the worktree source
   after the re-kick rebase, not before it.
2. A re-kick rebase that changes any file under `src/conductor` invalidates the worktree's
   previously-published `dist`; the stale artifact is never the one the gate runs.
3. Negative/scope safety: when the re-kick rebase changes nothing under `src/conductor`
   (pure noop, or non-engine files only), no redundant rebuild happens; consumer
   (non-self-host) worktrees, which do not run their own `dist`, are untouched.
4. Fail-closed: a post-rebase republish that itself FAILS must never leave the gate running
   the stale `dist` silently — it surfaces (HALT/park), it does not proceed on stale.

## Why technical track (no PRD)

Engine-internal correctness of the daemon's self-host build machinery. No user-facing
product requirement; acceptance lives in stories + acceptance specs against the conductor
engine. Per the engineer loop, `/prd` is skipped on the technical track.

## Filer's hypotheses (candidates carried into DECIDE)

- **H-b (primary):** After a re-kick rebase that touches `src/conductor`, re-run the
  worktree engine publish (`npm run build` → `publish-engine.mjs`) before the gate. The
  content-hash logic already exists (publish skips on unchanged content;
  `daemon-cli.ts:rebuildEngineFromSource` already shells `npm run build`), so this is a
  localized addition to the resume path and a no-op when engine source is unchanged.
- **H-a (alternative):** Reorder the re-kick rebase ahead of setup so setup builds from
  post-rebase source. Structurally larger — the rebase is REKICK-sentinel-gated and lives
  inside `runConductor`, while setup is unconditional and earlier; reordering means hoisting
  the rebase (and its operator-park / merged-PR-guard neighbors) ahead of `prepareWorktree`.

## Sibling / cluster context

- **#598** is the sibling class for the DAEMON's own long-running engine going stale after a
  merge. This feature is the **worktree-engine variant**; a fix here does not close #598 and
  vice versa. Both are the "merged != loaded != exercised" class, different engine.
- Governing surfaces: `resumeRebaseFirst` / `performRebase` (`engine/daemon-rekick.ts`,
  `engine/rebase.ts`), `runConductorInWorktree` (`daemon-cli.ts`), the content-addressed
  publish (`scripts/publish-engine.mjs`, `engine-store.ts`).
