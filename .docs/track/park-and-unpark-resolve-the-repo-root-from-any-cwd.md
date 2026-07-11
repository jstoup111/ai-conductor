# Track: park and unpark resolve the repo root from any cwd

Track: technical

## Rationale

This change fixes the project-root resolution of the pre-boot `daemon park` / `daemon unpark`
CLI verbs (`src/conductor/src/engine/daemon-park-cli.ts`, wired in `src/conductor/src/index.ts`).
Today those verbs scan `.docs/plans/<slug>.md` and `.worktrees/<slug>` relative to `process.cwd()`,
so an operator who runs `daemon park <slug>` from inside a worktree or any subdirectory gets a
misleading `slug '…' not found in plans/ or worktrees/` even though the slug is correct — the paths
simply do not exist relative to that cwd. The fix resolves the main repo root from any cwd (via
`git rev-parse --git-common-dir`, the #486 precedent already used in `memory-store.ts`) before
scanning.

There is no user-facing product requirement, no new command, no new config key, and no new
functional surface an end user perceives — it is an internal correctness fix to an existing CLI
verb plus friendlier error text and an operator runbook entry. Acceptance criteria for this
behavior belong in stories, not a PRD. → **technical track** (skip `/prd`).
