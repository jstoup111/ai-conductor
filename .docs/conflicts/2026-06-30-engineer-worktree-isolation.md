# Conflict Check: Engineer Worktree Isolation

**Date:** 2026-06-30
**Stories file:** `.docs/stories/engineer-worktree-isolation.md`
**Verdict:** PASS WITH REQUIRED ADR AMENDMENT (no blocking story-vs-story contradictions; one
governing-decision change that must be ratified by an ADR-008 amendment in architecture-review).

Checked this spec's 11 stories against existing stories in `.docs/stories/` and the governing
APPROVED decisions in `.docs/decisions/`.

## Finding 1 — Governing-decision change (ADR-008 authoring-location)  [MUST ratify via ADR]

- **Where:** `phase-9.3-engineer-redesign.md` stories + **ADR-008** lock the engineer's authoring
  location as *"the target's canonical path, on a `spec/<slug>` branch, confined by a path-prefix
  write guard"* (the OS-process-boundary of ADR-004 was deliberately removed).
- **This spec** moves authoring into a **dedicated per-idea worktree** (FR-1/FR-2).
- **Is this a contradiction?** Not at the story-behavior level — ADR-008 *itself* documents this as
  **Option B, the sanctioned escalation** ("author inside a dedicated worktree of the target … the
  escalation if a leak is ever observed"). What changed is the **triggering force**: ADR-008
  weighed only **cross-repo** leakage (A→B), which its path-prefix guard already prevents; it did
  **not** weigh **same-repo concurrency** (engineer vs. a running daemon vs. a second session on the
  *same* target), which the guard does nothing for. That new force justifies invoking the escalation
  now.
- **Resolution:** Architecture-review MUST emit an **ADR-008 amendment** (or successor ADR) adopting
  Option B for the engineer, citing same-repo concurrency as the new force. The path-prefix guard
  (ADR-008 FR-11 / ADR-004's no-cwd-fallback canonical-path rule) is **retained and subsumed** — a
  worktree adds confinement, it does not remove the guard. **Not a silent change.**

## Finding 2 — Shared worktree mechanism with daemon/conduct (ST-007)  [coordinate, non-blocking]

- **Where:** `features/conduct/ST-007-worktree-isolation.md` defines the daemon/conduct worktree
  isolation backed by `engine/worktree.ts`. This spec (FR-1, Key Decision) **reuses that same
  mechanism**.
- **Conflict class:** resource contention — both the daemon and the engineer may create worktrees in
  the **same** target repo simultaneously (the very FR-8 scenario). A path/branch-naming collision
  (e.g. both wanting `spec/<slug>` or the same `.worktrees/<slug>` dir) would corrupt one of them.
- **Resolution:** the engineer's worktree path/branch must be **distinct and namespaced** from the
  daemon's (e.g. an `engineer`-scoped worktree dir / the `spec/<slug>` branch the daemon only reads
  post-merge). Architecture-review fixes the naming convention (PRD Open Question #2). Reusing one
  mechanism is complementary, not contradictory — this is a coordination requirement, not a clash.

## Finding 3 — Engineer cleanup follow-up overlap  [no conflict]

- **Where:** `phase-9.3-engineer-cleanup-followup.md` covers engineer cleanup/robustness items.
- **Assessment:** no behavioral contradiction. This spec's FR-5/FR-6 (remove-on-success /
  keep-on-failure) add a worktree-lifecycle cleanup that is additive to, and consistent with, the
  existing cleanup direction. No overlap requiring a merge.

## Finding 4 — Cross-repo isolation invariant (ADR-004 retained rule / FR-10)  [reinforced]

- **Where:** ADR-004's canonical-path-no-cwd-fallback rule (retained by ADR-008) and this spec's
  FR-10 both assert sibling repos stay byte-for-byte unchanged.
- **Assessment:** fully aligned — FR-10 + the FR-1 requirement that worktree paths resolve only
  within the target repo *strengthen* the existing invariant. No conflict.

## State / resource / ordering conflicts within this spec's own stories

- **State:** FR-5 (remove on success) and FR-6 (keep on failure) are mutually exclusive on the
  success/failure axis — no overlap. FR-7 (abort) precedes any worktree existing — no state clash.
- **Ordering:** create (FR-1) → author → land (FR-3/FR-9) → handoff (FR-4) → cleanup (FR-5/FR-6) is a
  single linear lifecycle; FR-11 (leftover handling) is the only re-entrant edge and is explicitly
  specified. No circular dependency.
- **Resource:** the only shared resource is the target repo's git dir; FR-2/FR-8 are precisely the
  stories that pin the non-interference contract. Internally consistent.

## Required action before `/plan`

1. Architecture-review emits the **ADR-008 amendment** (Finding 1).
2. Architecture-review fixes the **engineer-vs-daemon worktree naming convention** (Finding 2).
