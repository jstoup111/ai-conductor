# Components: one branch, one PR, one halt state

**Last updated:** 2026-08-09
**Scope:** the components that own a feature branch's pull-request identity — draft-PR birth,
HALT escalation, presentation repair, and the two eligibility readers that consume the
`needs-remediation` label. Source issue: jstoup111/ai-conductor#1415.

## Diagram

```mermaid
graph TD
  subgraph Today["Today — two PR shapes race for one slot"]
    T_BUILD["BUILD phase\nplan task needs the retained PR"]
    T_SHIP["SHIP entry\nconductor.ts openShipDraftPr"]
    T_ESC["build-failure-escalation.ts\nescalateBuildFailure«»"]
    T_FEAT["PR shape 1\ntitle feat «desc», draft\nborn only at SHIP entry"]
    T_PLACE["PR shape 2\ntitle needs-remediation «branch»\nlabel + body marker\nborn at any HALT with commits"]
    T_REPAIR["conductor.ts\nmakeRetainedShipPrPresentable«»\nSINGLE call site, SHIP-only"]
    T_BUILD -->|"no PR exists yet — HALT"| T_ESC
    T_ESC -->|"gh pr create --draft"| T_PLACE
    T_SHIP -->|"findOrCreatePr adopts any OPEN PR"| T_FEAT
    T_SHIP -->|"outcome published ONLY"| T_REPAIR
    T_REPAIR --> T_PLACE
    T_BUILD -.->|"retry: slot taken by a PR it refuses;\nrepair unreachable from BUILD"| T_PLACE
  end

  subgraph Target["Target — one PR carrying a halt state"]
    N_BIRTH["NEW: PR birth at BUILD entry\nfirst commit over base\nreuses openShipDraftPr"]
    N_PR["The branch's ONE PR\ntitle feat «desc», draft\nhalt state = label present or absent"]
    N_ESC["build-failure-escalation.ts\ndecorates, never creates a second shape"]
    N_CLEAR["NEW: deterministic clear on resume\nreuses makeRetainedPrPresentable"]
    N_BIRTH -->|"gh pr create --draft"| N_PR
    N_ESC -->|"add label + halt comment"| N_PR
    N_CLEAR -->|"remove label + marker, retitle floor"| N_PR
  end

  subgraph Consumers["Eligibility readers (unchanged code, restored behaviour)"]
    CIFIX["ci-fix.ts\nlabel present -> ineligible"]
    SWEEP["mergeable-sweep.ts\nlabel present -> mergeable withheld"]
    GATE["conductor.ts\nresolveRetainedShipDraftPrUrl«»\nrelease gate + pre-finish snapshot"]
  end

  N_PR --> CIFIX
  N_PR --> SWEEP
  N_PR --> GATE
  T_PLACE -.->|"sticky label strands recovery"| CIFIX
  T_PLACE -.->|"sticky label strands recovery"| SWEEP
```

## Legend

- **Today** — the defect. `makeRetainedShipPrPresentable` exists and is correct, but its only
  call site (`conductor.ts`) is guarded by `step.phase === 'SHIP'` **and** an
  `openShipDraftPr` outcome of `published`. A HALT that occurs in BUILD therefore leaves a
  placeholder that nothing on the retry path adopts, repairs, or de-labels.
  `resolveRetainedShipDraftPrUrl` will happily *return* that placeholder to the release gate,
  but applies no repair on the way through.
- **Target** — PR birth moves earlier (BUILD entry, first commit over base) and escalation is
  demoted from *creator* to *decorator*. A branch then has exactly one PR whose halt condition
  is a removable label, not a second immutable shape competing for the slot.
- **Consumers** — no change to `ci-fix.ts` or `mergeable-sweep.ts` logic; their sticky-label
  precedence is correct. What changes is that the label now has a deterministic clearing path,
  so "sticky" stops meaning "permanent".
- `«»` marks variable parts of labels (function arguments, branch names, descriptions).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Initial generation | DECIDE phase for issue #1415 (engineer session) |
