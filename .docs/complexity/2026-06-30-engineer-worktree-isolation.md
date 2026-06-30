# Complexity Assessment: Engineer Worktree Isolation

**Date:** 2026-06-30
**Plan stem:** 2026-06-30-engineer-worktree-isolation

Tier: L

## Rationale

Signals weighed (same set conduct uses: models, integrations, auth, state machines, story count):

- **Modules touched (multiple):** `land-spec.ts`, `handoff.ts`, `handoff-step.ts`, the engineer
  CLI dispatch, plus a per-idea worktree create/remove path reusing `engine/worktree.ts`, plus
  `skills/engineer/SKILL.md`. Not a single-file change.
- **External-system contract:** the change is fundamentally about the `git worktree` lifecycle —
  an external process whose argv and on-disk effects must be exercised by a real-binary smoke
  test, not just injected-runner argv assertions.
- **Stateful lifecycle:** create → author → land → handoff → (remove on success | keep on
  failure) is a small state machine with branch/worktree invariants at each edge.
- **Concurrency invariants:** correctness is defined partly by what must NOT happen when a second
  engineer session or a running daemon shares the target repo (FR-8) — adversarial, negative-path
  heavy.
- **ADR impact:** amends the working-directory contract of ADR-008's deterministic primitives.
- **Story volume:** 11 FRs, several with explicit negative/edge behavior (strict abort,
  keep-on-failure, leftover-worktree retry) → a non-trivial story set.

A change with multiple modules, an external-process contract, concurrency-defined correctness,
and an ADR amendment is squarely **Large**, not Medium.

## Consequence for the DECIDE flow

Large tier → run the FULL DECIDE phase: conflict-check, architecture-diagram, and a full
architecture-review (with ADR amendment) are all REQUIRED (none skipped).
