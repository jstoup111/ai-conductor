# Stories: rekick-resume-republish-stale-worktree-engine

Status: Accepted

**Source:** jstoup111/ai-conductor#625 · **Track:** technical · **Tier:** S
**Design:** direction H-b (republish after rebase; no ADR — reuses existing publish primitive)

## Story 1 — Engine-touching re-kick rebase republishes the worktree dist before the gate (happy)

- **Given** a self-host feature worktree that setup already built a `dist` for from its
  pre-rebase source,
  **And** a re-kick whose rebase-onto-latest (`resumeRebaseFirst`) cleanly replays commits
  that change files under `src/conductor` (a real, non-noop rebase outcome),
  **When** `resumeRebaseFirst` returns `'rebased'` and control returns to
  `runConductorInWorktree`, before `conductor.run()`,
  **Then** the engine is republished from the post-rebase worktree source (the existing
  content-addressed `npm run build` → `publish-engine.mjs`), the worktree's `dist` current
  target now corresponds to the post-rebase content hash, and the gate runs on that fresh
  engine — the plan parses to its real task count, not `0/0`.

## Story 2 — Pure-noop or non-engine rebase does no redundant rebuild (no-op boundary)

- **Given** a re-kick whose rebase is a pure noop (base did not advance) OR replays only
  commits that touch no file under `src/conductor`,
  **When** the resume path evaluates whether to republish,
  **Then** no engine rebuild is triggered (or, if the content-addressed publish is invoked
  defensively, it self-detects unchanged engine content and skips the flip — `content
  unchanged … publish skipped`), and resume latency is not materially increased.

## Story 3 — Non-self-host worktrees are untouched (scope boundary)

- **Given** a consumer (non-self-host) worktree, which runs the globally installed engine and
  has no per-worktree `dist` to rebuild,
  **When** a re-kick rebase completes on it,
  **Then** the republish step is skipped entirely (gated on the same self-host flag the
  daemon already carries), and behavior is byte-for-byte unchanged from today.

## Story 4 — A failed republish fails closed, never gates on the stale dist (negative)

- **Given** an engine-touching re-kick rebase on a self-host worktree,
  **And** the post-rebase `npm run build` / publish exits non-zero (e.g. a transient build
  error),
  **When** the resume path handles the failure,
  **Then** the gate does NOT proceed on the stale `dist`: the failure surfaces as a
  HALT/park with an actionable reason naming the failed republish, `conductor.run()` is not
  invoked on stale engine, and the worktree is kept for triage.

## Story 5 — Idempotent / re-entrant (negative)

- **Given** the resume path is re-entered after a crash (the REKICK sentinel is one-shot and
  already consumed),
  **When** no rebase re-runs on the second entry (`resumeRebaseFirst` returns `'skipped'`),
  **Then** no stale republish is forced and no duplicate build is triggered — the republish is
  bound strictly to a `'rebased'` outcome in the same invocation.
