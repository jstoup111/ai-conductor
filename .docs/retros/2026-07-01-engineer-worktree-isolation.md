# Retro: Engineer Worktree Isolation
**Date:** 2026-07-01 | **Stats:** 12 plan tasks (T1–T12), 1 prd-audit rework cycle, 1 human decision (rebase-vs-stack), 2686 tests passing

## Part A: Harness

- **H-1 (Correctness/Autonomy, HIGH):** The implementation was built on the #168 spec branch, which was **11 commits behind `origin/main`** — so `land-spec.ts`/`engineer-cli.ts`/`intake-marker.ts` were rewritten against *stale* versions and would have silently reverted the merged owner-gate (#175) + track-split (#146) work. Nothing in `/conduct` flags that a spec branch's base is behind origin before BUILD; the regression was caught only by a manual pre-PR diff review. Fix: when implementing from an unmerged spec branch, `/conduct` (or `/engineer` handoff) should compare the base to `origin/<default>` and prompt to rebase/refresh **before** BUILD. See [[project_bsp_specs_on_unmerged_branches]].
- **H-2 (Gate Quality, MED):** FR-8's story Done-When named **two** distinct fixtures ("two concurrent per-idea worktrees" AND "a daemon-running scenario … leaves the daemon's worktree untouched") and plan T10 listed both, but the shipped acceptance test covered only the two-engineer half. `writing-system-tests`/code-review passed it; only the adversarial `prd-audit` caught it. Fix: when a Done-When enumerates multiple distinct scenarios/fixtures, generate one test per scenario (add a negative-path category to `skills/writing-system-tests`).

## Part B: Application

- **A-1 (Test Quality, MED):** `engineer-cli.ts` handoff calls `removeEngineerWorktree` directly (not injectable), so the FR-5 "removal failure reported, not swallowed" branch (`engineer-cli.ts:675-681`) has no test — a real `git worktree remove` failure is hard to force deterministically. Fix (new story): add an injectable `removeWorktree` seam to `DispatchEngineerOpts` so the reported-not-swallowed branch is unit-testable.
- **A-2 (Code Quality, LOW):** `createEngineerWorktree` dirty-check uses `worktreeStatus(...).catch(() => '')` (`engineer/worktree-authoring.ts:85`) — a `git status` *error* on a reused worktree is swallowed and treated as clean, so a genuinely broken leftover could be reused. Fix (new story): treat a status error as "surface it" (fail closed), not "clean".
- **A-3 (Code Quality, LOW):** the AuthoringGuard is rooted at the target canonical path rather than the worktree `.docs/` the ADR specified (as-built drift D3). Confinement holds in practice (worktree ⊂ canonical, only worktree paths constructed) but tightening the root to the worktree would be defense-in-depth. Fix (new story, optional): root the guard at `worktreePath`.

## Part C: Context Efficiency

- **C-1 (MED):** Understanding-phase read 5 large files in full (`land-spec`, `engineer-cli`, `handoff`, `daemon-deps`, `loop`) before touching code. Justified by the delicacy of the primitive rewrite, but `loop.ts` (test-only path) was read in full and never modified — an Explore/grep scoping pass would have confirmed it was out-of-scope for ~1 read instead of a 564-line load. Fix: scope "is this file in the live path?" via grep before a full read.
- **C-2 (LOW):** The 3 prd-auditor dispatches were correctly scoped to non-overlapping FR clusters (3/4/4) — proportionate for Tier L; no change.
- **C-3 (MED):** The rebase reconciliation showed large conflict diffs inline in the main loop. For a future stale-base rebase, delegating conflict resolution of a single file to a `fork` subagent (returning only the resolved file) would keep the big diffs out of the main context. Fix: on a multi-file rebase, resolve each conflicted file in a fork.

## Trends
- Recurring: building on **unmerged spec branches** that drift behind main (H-1) echoes [[project_bsp_specs_on_unmerged_branches]] and [[project_jsa_not_registered]] — this repo isn't daemon-registered, so spec branches sit unmerged and go stale. A pre-BUILD base-freshness check would retire the recurring manual catch.
- Positive delta: adversarial prd-audit (independent auditors) caught a coverage gap the build-time gates missed — worth keeping for Tier L features.
