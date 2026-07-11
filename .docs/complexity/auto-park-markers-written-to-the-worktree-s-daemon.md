# Complexity: auto-park markers written to the worktree's .daemon (#486)

Tier: M

## Rationale

- **Cross-process state correctness** — one path-resolution seam
  (`resolveMainRepoRoot`) consumed by four distinct consumers (auto-park writer in the
  conductor, rekick-sweep gate, park/unpark CLI, dashboard/stale-park listing); a
  divergence between any pair reintroduces the fail-open loop.
- **Migration/reconciliation step** — a one-time sweep that moves already-stranded
  `.worktrees/<slug>/.daemon/parked/<slug>` markers to the main root; must be idempotent
  and safe when both locations hold a marker.
- **Negative paths dominate** — non-git roots (test tmp dirs), bare/unborn repos,
  markers present at both roots, unpark of a slug whose worktree is gone, counter reset
  targeting a missing worktree `.pipeline/`.
- **No new models, integrations, auth, or persistent schema** — marker format and
  `.daemon/parked/<slug>` layout are unchanged; only *where* the path is anchored moves.
- Expected story count ~5–6; single subsystem (daemon park machinery) — below Large.

Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check are
required before the plan (per tier table); PRD skipped (technical track).
