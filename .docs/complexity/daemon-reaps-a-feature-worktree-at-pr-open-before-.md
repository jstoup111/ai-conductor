# Complexity: defer the feature-worktree reap until the shipped record is on main (#1091)

Tier: M

## Rationale

Assessed against the same signals `/conduct` uses (models, integrations, auth, state machines,
story count). Corroborates the issue's own `size: M` triage label.

**Why not Small.** The change is not a single-call-site edit. It spans at least four engine modules
with a real lifecycle change between them:

- `daemon-runner.ts` — remove the PR-open reap at the `outcome.done` happy path (:446).
- `mergeable-sweep.ts` — becomes the reap owner, and must stop treating `CLOSED` (unmerged) as
  equivalent to `MERGED` (today both prune, FR-13).
- `daemon-deps.ts` — `teardownWorktree` gains a proven-safe precondition rather than an
  unconditional `git worktree remove --force`.
- A new "is the shipped record on main" probe (fetch + path-presence read on `origin/main`).

It also introduces a genuine **state machine** — retained → reaped-on-main, versus retained →
closed-unmerged → reclaimable — plus a new operator-facing reclaim surface and its documentation.
Small tier would skip architecture-diagram, architecture-review and conflict-check, and this change
is too entangled with adjacent in-flight work for that to be safe.

**Why not Large.** No new subsystem, no schema/API redesign, no auth, no external integration, no
model work. The blast radius is the daemon ship path only; the detection mechanism is already
settled by measurement (file-presence on `origin/main`, since squash-merge kills ancestry — verified
against PR #1138), so the highest-risk design question is answered before planning rather than
during it. Expected story count is mid-single-digit, not the sprawling multi-epic shape of an L.

## Consequences for DECIDE

Medium tier runs the full remaining chain: `/architecture-diagram`, a **lightweight**
`/architecture-review`, `/stories`, `/conflict-check`, `/plan`, and `/coherence-check`. No PRD —
technical track (`.docs/track/` marker).

## Coordination load (a real contributor to the tier)

Must be planned against adjacent work rather than in isolation:

- **PR #1146** (open) — adds a missing-working-directory dispatch preflight and
  shipped-record-on-feature-branch dedup in `daemon-backlog.ts` / `daemon-work-source.ts`.
  Complementary, but overlapping files.
- **#564 / PR #770** (open, size L) — relocating run-state out of the worktree; must not be
  duplicated or contradicted.
- **#1102 / PR #1118** (merged) — already self-heals `task-status.json`, which removes part of the
  original motivation and must not be re-implemented.
- **#1114** — records the squash-merge ancestry trap this design deliberately sidesteps.
