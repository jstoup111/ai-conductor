# Sequence: existing-task remediation restage survives the Task-trailer union

**Last updated:** 2026-09-06
**Scope:** One existing-task remediation round from disposition through restage, the D1 no-op
guard's completion recheck, the build re-dispatch, and the post-restage commit that legitimately
re-resolves the task. Also covers the two behaviors that must not regress: a genuinely no-op
round, and the #859 fresh-build case whose rows were never flipped.

## Diagram

```mermaid
sequenceDiagram
  participant A as Remediation admission
  participant P as Active plan
  participant S as task-status.json
  participant W as main-root restage watermarks
  participant F as resolveTaskIds fold
  participant G as D1 no-op guard
  participant B as build step
  participant E as Event spine

  A->>P: resolve existing-task bindings to plan task ids
  P-->>A: bound ids

  alt round binds at least one existing task
    A->>S: flip bound rows to pending
    A->>W: record each bound id with its current trailer count at «mainRoot»/.daemon
    W-->>A: watermarks persisted
    A->>G: recompute build completion after restage
    G->>F: resolve plan ids
    F->>S: rows completed or skipped
    F->>W: watermark for each candidate id
    W-->>F: watermark counts
    F->>F: a watermarked id resolves from trailers only when its count has grown
    F-->>G: bound ids unresolved
    G-->>B: not done, dispatch build with the remediation hint
    B->>B: implement the finding and commit with the Task trailer
    B->>F: resolve plan ids again
    F->>F: the trailer count grew past the watermark, so the id resolves
    F-->>G: all ids resolved
    G->>E: emit the round outcome
    G-->>A: build complete through post-restage work, hand off to build_review
  else round stages nothing new
    A->>G: recompute build completion with no watermark recorded
    G->>F: resolve plan ids
    F-->>G: every id already resolved
    G->>E: emit kickback outcome derived-already-complete
    G-->>A: halt needs-human with the gap ledger
  end
```

## Legend

- **Restage watermark** — the number of trailered commits an id already had when an
  existing-task remediation reopened it, stored at the main repo root under `.daemon/` so it
  survives worktree recreation. Until that count grows, the trailers are pre-restage history and
  cannot resolve the task; a `Done when:` row close still can.
- **Fold** — `resolveTaskIds` in `task-progress.ts`, the single resolution definition shared by
  the build completion predicate, the D1 no-op guard, and the stall circuit breaker.
- **#859 fresh build (unchanged)** — a build whose rows were never flipped records no watermark,
  so its trailer-evidenced tasks resolve exactly as they do today and it routes to build_review
  without stalling.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | Spec for #2196 restage watermark |
| 2026-09-06 | Watermark moved to main-root `.daemon/` | Conflict-check: worktree recreation erased the restage with no trace (#549 Story 6) |
