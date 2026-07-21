# Complexity: Build progress marker increments per completed task (#757)

Tier: S

## Rationale

Localized observability change confined to the build-progress read path:
`BuildProgressWatcher` / `readSnapshot` compute the live `resolved` count from
git-derived evidence (the same source the build gate re-derives from at its
boundary) instead of from `.pipeline/task-status.json`'s stored `completed`
status. The `build_progress` event and its daemon-cli render line are unchanged
in shape.

Signals:
- **New models / schemas:** 0
- **External integrations:** 0 (reuses existing `deriveCompletion` / git runner)
- **Auth / permissions:** none
- **New state machines:** none — reuses the existing evidence-derivation path;
  no change to the gate's ownership of task-status.json
- **Story count:** ~2-3 (live increment happy path; graceful degradation when
  derivation fails or the plan path is unresolved; no double-counting vs. the
  gate boundary)

Small tier → architecture-diagram, architecture-review, and conflict-check are
skipped; technical track skips the PRD. Remaining DECIDE steps: /stories → /plan.
