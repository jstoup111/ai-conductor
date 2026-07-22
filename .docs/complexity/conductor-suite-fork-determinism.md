# Complexity: Conductor test suite determinism under parallel forks (#573)

Tier: M

Rationale: two independent flake families across the `src/conductor` test tree, each with
its own seam:

- **Family A** — a small production-code seam change (inject a `now: () => number` clock
  into `BuildProgressWatcher`, ~1 file) plus rewriting three timer-driven test blocks to
  drive awaited ticks against a fake clock instead of `advanceTimersByTimeAsync`.
- **Family B** — a new shared hardened git-repo test helper, migrating the object-heavy
  real-git tests onto it, and an optional second vitest project config to serialize the
  heaviest files.

No data models, no external integrations, no auth, no product state machine. But it spans
production code + test infrastructure + vitest config across multiple files, touches a
seam (the watcher clock) other tests depend on, and carries a cross-cutting migration
(53 files `git init` inline; a subset migrates), with a real risk of regressing timing
semantics if the clock seam is wired wrong. Expected story count 4–5. That is squarely
**Medium** (matches the issue's `size: M` label), above the Small bar (single module,
2–3 stories, no shared-seam change).

Per tier rules for Medium: architecture-diagram is skipped; architecture-review is
**lightweight** (feasibility + alignment, one ADR for the clock-seam decision);
conflict-check is **run**.
