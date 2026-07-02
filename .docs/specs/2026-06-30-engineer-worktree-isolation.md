# PRD: Engineer Worktree Isolation

**Date:** 2026-06-30
**Status:** Approved

## Problem / Background

The **engineer** (idea→spec control plane) authors a feature's entire DECIDE artifact set —
PRD, complexity, stories, conflicts, architecture, ADRs, plan — and lands them on a
`spec/<slug>` branch, all inside the **target repo's primary working tree** (the registry's
canonical path). The deterministic `landSpec` primitive does its branch work as a
`git checkout -b spec/<slug> <default>` → commit → `git checkout <default>` **dance in that
shared tree**, and refuses to run if the tree is dirty outside `.docs/`.

The per-repo **daemon** already isolates every build in its own git worktree. The engineer does
not — it mutates the shared checkout. That asymmetry causes real collisions:

- A **running daemon** for the same target repo can be mid-build (its own checkout/branch state)
  when the engineer switches the primary tree's branch out from under it.
- A **second engineer session** (or an operator working in the repo) on the same target races on
  the same working tree; `landSpec` additionally **sweeps all untracked `.docs/`**, so two
  in-flight ideas can have their artifacts cross-contaminated into one commit.
- The shared-tree requirement (clean outside `.docs/`, on the default branch) makes the engineer
  fragile to whatever else is touching that repo.

The fix is to make the engineer use the **same per-idea worktree isolation the daemon already
uses**, so authoring and landing never touch the target's primary working tree and concurrent
work on a target repo never collides.

## Goals & Non-Goals

**Goals**
- The engineer authors and lands every idea in a dedicated, per-idea worktree of the target repo.
- The target repo's **primary working tree is never mutated** by the engineer — its checked-out
  branch and cleanliness are invariant across an engineer session.
- Concurrent actors on a target repo (a second engineer session, or a running daemon) cannot
  corrupt each other's branch or working state.
- Operator-visible output is **unchanged**: the same spec PR (or no-remote local-commit
  fallback), the same daemon nudge, the same ledger/intake write-back.

**Non-Goals**
- No change to the daemon (already worktree-isolated).
- No change to the DECIDE skills themselves (`/brainstorm`, `/stories`, `/plan`, …).
- No change to project scaffolding git setup (`conduct create` / `/bootstrap` git work is
  tracked separately).
- Not introducing multi-idea-per-session; the engineer still handles exactly one idea per session.

## Users / Personas

- **Operator** — drives the engineer from a terminal/phone to route an idea and deliver a spec PR.
  Wants the engineer to "just work" even when a daemon is building in the same repo.
- **Per-repo daemon** (non-human actor) — builds merged specs in its own worktrees. Must never
  have its working-tree/branch state disturbed by a concurrent engineer session.

## Functional Requirements

- **FR-1:** For each idea, the engineer authors the full DECIDE artifact set inside a dedicated
  per-idea **worktree** of the resolved target repo, checked out on the idea's `spec/<slug>`
  branch — never in the target's primary working tree.
- **FR-2:** Creating and using the per-idea worktree leaves the target's **primary working tree
  unchanged**: its checked-out branch is the same before and after, and the tree is no dirtier
  than the engineer found it.
- **FR-3:** The complete DECIDE set required for the feature's tier (`specs`, `complexity`,
  `stories`, `plans`, plus `conflicts`/`architecture`/`decisions` for non-Small) is committed
  onto the `spec/<slug>` branch **from within the isolated worktree**, including the
  `.docs/intake/<slug>.md` marker for intake-sourced ideas.
- **FR-4:** The spec PR opens for the `spec/<slug>` branch exactly as today, including the
  **no-remote local-commit fallback**; the operator-visible result (PR URL or branch, the
  `engineer:handled`/`Refs <ref>` write-back, the authored-ledger entry, and the fire-and-forget
  daemon `ensureRunning` nudge) is identical to the pre-isolation behavior.
- **FR-5:** On a **successful** handoff, the per-idea worktree is **removed**; the `spec/<slug>`
  branch and its commit persist and remain reachable (including in the no-remote fallback case).
- **FR-6:** If authoring, `land`, or `handoff` **fails**, the per-idea worktree is **left in
  place** (not removed) so the half-authored `.docs/` can be inspected.
- **FR-7:** If an isolated worktree **cannot be created** for the target, the engineer **aborts
  the idea** with a clear message and makes **zero mutations** to the target's primary working
  tree. There is no fallback to authoring in the shared checkout.
- **FR-8:** Two engineer sessions — or an engineer session and a running daemon — operating on
  the **same** target repo concurrently do not corrupt each other's branch or working-tree state;
  each idea's artifacts are committed only from that idea's own worktree.
- **FR-9:** `land` commits **only the current idea's artifacts** (the per-idea worktree contains
  only this idea's `.docs/`), eliminating the prior "sweep all untracked `.docs/`" cross-idea
  bleed.
- **FR-10:** Sibling repos remain byte-for-byte unchanged (the existing cross-repo isolation
  invariant is preserved).
- **FR-11:** A leftover per-idea worktree or branch from a prior failed run for the same slug is
  handled deterministically (reused or cleanly replaced) so a retry is not blocked by manual
  cleanup; the chosen behavior is observable and reported.

## Non-Functional Requirements

- **Parity:** the engineer reuses the daemon's existing worktree mechanism rather than a parallel
  bespoke implementation, so there is one worktree story across the harness.
- **No new long-lived processes**; worktree create/remove cost is comparable to the daemon's
  per-feature cost.
- **Determinism/testability:** the isolation invariants (FR-2, FR-7, FR-8) are assertable with
  injected runners and a real-git smoke test (an injected-runner argv test alone is insufficient
  for an external-git contract).

## Acceptance Criteria / Success Metrics

- All FRs covered by passing tests, including: primary-tree branch + cleanliness asserted
  unchanged across a full author→land→handoff cycle (FR-2); a concurrent-actor test proving no
  cross-corruption (FR-8); a strict-abort test proving zero primary-tree mutation when worktree
  creation fails (FR-7); remove-on-success and keep-on-failure tests (FR-5/FR-6); and a
  real-git smoke test exercising the actual `git worktree` lifecycle end-to-end.
- A manual scenario: with a daemon running in a target repo, an engineer session routes and
  delivers a spec PR for that repo without disturbing the daemon's in-flight build.

## Scope

### In Scope
- `skills/engineer/SKILL.md` — author DECIDE inside the per-idea worktree; the abort/cleanup
  contract; the branch-policy note updated to the worktree flow.
- The deterministic primitives `land-spec.ts` and `handoff.ts` (+ `handoff-step.ts`) and their
  engineer-CLI dispatch — operate on the per-idea worktree instead of the primary checkout.
- Per-idea worktree creation and removal for the engineer, reusing the daemon's
  `engine/worktree.ts` mechanism where practical.
- Tests (vitest) for the new invariants + a real-git smoke test.
- Docs: the engineer sections of `README.md` and `src/conductor/README.md`; CHANGELOG; any ADR
  amendment ADR-008 needs.

### Out of Scope
- Daemon changes.
- The DECIDE skills' internals.
- `conduct create` / `/bootstrap` git setup.
- Multi-idea-per-session concurrency within a single engineer session.

## Key Decisions & Rationale

- **Mirror the daemon's worktree mechanism** (`engine/worktree.ts`) rather than inventing a new
  one — one isolation story, less surface, and the daemon path is already battle-tested.
- **Strict abort, never fall back to the main checkout** (operator decision) — the isolation
  invariant is absolute; a guarantee with a silent fallback hole is not a guarantee.
- **Remove-on-success, keep-on-failure** (operator decision) — matches the daemon's "keep the
  worktree only when something went wrong (HALT)" semantics, so debugging state survives failures
  while success leaves a clean tree.
- **Create the `spec/<slug>` branch as the worktree's branch at creation time** so `land` commits
  in-place and the old `checkout -b … / checkout back` dance in the shared tree disappears
  entirely — that dance is the root cause being removed.

## Dependencies

- The daemon's existing `engine/worktree.ts` worktree create/remove mechanism.
- ADR-008 (the engineer is a host-agent skill calling deterministic conduct-ts primitives) — this
  change amends the primitives' working-directory contract and likely warrants an ADR amendment.

## Open Questions

- **Ownership of the worktree lifecycle:** does the skill call a new `conduct-ts engineer worktree`
  primitive to create it before DECIDE, or does `land` create-and-own it? (Resolve in
  architecture-review — affects the CLI surface and where the cwd boundary sits.)
- **Worktree path/branch convention:** `.worktrees/engineer-<slug>` on `spec/<slug>` vs. the
  daemon's existing naming — pick one convention for parity.
- **No-remote fallback reachability:** confirm the local-commit-only branch remains reachable
  after the worktree is removed on success (FR-5).
