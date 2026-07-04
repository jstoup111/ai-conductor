# Sequence: halt → remediate → re-kick → finish rehabilitates the reused PR

**Last updated:** 2026-07-03
**Scope:** end-to-end flow for issue #271 — a feature that halted (draft
needs-remediation PR exists), was remediated and re-kicked, and now finishes.
The resulting ready PR must be indistinguishable from a never-halted feature's PR.

## Diagram

```mermaid
sequenceDiagram
  participant D as Daemon conductor
  participant E as escalateBuildFailure
  participant GH as GitHub (gh CLI)
  participant F as /finish + /pr skill session
  participant R as rehabilitateHaltPr (NEW)

  Note over D,GH: — halt path (existing, unchanged) —
  D->>E: irrecoverable HALT (commits present)
  E->>GH: push branch, create draft PR «needs-remediation title», add label, comment reason
  GH-->>E: prUrl
  Note over D: worktree parked, HALT marker written

  Note over D,GH: — operator remediates, base advances, re-kick clears HALT —

  Note over D,F: — finish path (this feature) —
  D->>F: run finish step
  F->>GH: gh pr create fails, PR already exists
  F->>GH: gh pr edit «prUrl» --title --body (regenerated presentation)
  F-->>D: finish-choice = pr, pr_url recorded

  D->>D: completion check reads PR title + isDraft + labels
  alt presentation still stale
    D-->>F: step FAILS, retry (bounded) drives the rewrite
  else presentation clean
    D->>R: rehabilitate(prUrl, sourceRef)
    R->>GH: gh pr ready (draft to ready)
    R->>GH: REST remove needs-remediation label (pr-labels.ts)
    R->>GH: injectIssueRef Closes «owner/repo#N» (idempotent, only when sourceRef)
    R-->>D: outcome logged, failures non-fatal (warn, never block ship)
  end
  D->>GH: shipped, PR handed to human for merge
```

## Legend

- The halt path is untouched — this feature only changes what happens when
  `finish` completes a feature whose PR was born as a needs-remediation draft.
- The completion check is the deterministic gate that makes the skill-side
  rewrite reliable (same pattern as existing finish-choice / shipped-record
  checks); the rehabilitation step's mechanics are best-effort and warn-only —
  a gh outage never blocks the ship (mirrors `conduct shipped-record`
  degradation semantics).
- `«»` marks variable label parts.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE phase for issue #271 (engineer session) |
