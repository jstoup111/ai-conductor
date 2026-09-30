# Complexity: intake filing-time overlap detection (#1606)

Tier: M

## Rationale

- Extends one existing engine seam (`fileIntakeIssue` behind `bin/intake-file`) with a pre-create
  preflight; no new models, auth surfaces, or external services — only additional GitHub reads
  (open-issue bodies) through the existing tracker read interface and local git diffs.
- Reuses the DECIDE-time overlap primitives (`intersectFiles`, `changedPathsSinceMergeBase`) at a
  new seam; the reuse-vs-duplicate boundary and the in-flight branch set (`spec/*` plus
  `feat/daemon-*`) are architectural choices worth a lightweight review.
- New filer-visible behavior: TTY prompt, non-TTY refusal until an explicit accept/decline
  decision, and a new decline flag on the filer CLI — consumer-facing across projects.
- Story count moderate (~5-6: open-issue overlap, in-flight branch overlap, TTY accept/decline,
  non-TTY refusal + explicit decision, no-overlap unchanged, degraded reads never block filing).
- Estimated effort ~1 day (matches intake `size: M` label).

Medium ⇒ PRD (product track) + architecture-diagram + lightweight architecture-review +
conflict-check + coherence-check; stories + plan as always.
