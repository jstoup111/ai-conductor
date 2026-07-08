# Architecture: ship→CI feedback loop + fixture-portability guards (ai-conductor#397)

Mergeable sweep after this change. New elements marked with `*`. The sweep already fetches
`statusCheckRollup` per watched PR (`prMergeState`, pr-labels.ts) — today it only gates the
`mergeable` label. This change adds a CI-failure branch that dispatches bounded remediation,
mirroring the existing Task-17 conflict-autoresolve seam.

```mermaid
flowchart TD
    TICK[daemon idle tick / startup / post-feature] --> SBE[sweepBestEffort]
    SBE --> SML[sweepMergeableLabels]
    SML --> RW[readWatch .daemon/mergeable-watch.jsonl]
    RW --> PMS[prMergeState via gh pr view - state, mergeable, statusCheckRollup, labels]
    PMS -->|MERGED / CLOSED / NOTFOUND| PRUNE[prune entry from registry]
    PMS -->|UNKNOWN transient| KEEP[log + keep entry]
    PMS -->|checks pending| KEEP
    PMS -->|*rollup has FAILED checks| CIF[*ensure ci-failed label + emit ci_failed event]
    PMS -->|checks green / none| LBL[existing mergeable label logic]
    CIF --> ATT{*ciFixAttempts below MAX?}
    ATT -->|yes| DISP[*dispatch remediation - fresh worktree from PR branch, failing-job log excerpt as retryReason, increment ciFixAttempts]
    ATT -->|no - exhausted| HALT[*HALT + needs-remediation label + escalation comment via build-failure-escalation]
    DISP --> FIX[remediation run pushes fix to same PR branch]
    FIX -.->|next sweep re-reads rollup| PMS
```

Bounding state lives in the watch entry itself (`ciFixAttempts`, like the existing
`resolveAttempts`), so a permanently-red PR converges to a human HALT instead of looping.
The `ci-failed` label is removed when a later sweep sees the rollup green again.

```mermaid
sequenceDiagram
    participant DL as daemon loop
    participant MS as mergeable sweep
    participant GH as gh / origin
    participant RD as remediation dispatch
    participant HM as halt-monitor / operator

    DL->>MS: sweepBestEffort (startup, idle tick, post-feature)
    MS->>GH: gh pr view «prUrl» - state, statusCheckRollup, labels
    alt rollup FAILED and attempts below MAX
        MS->>GH: *add ci-failed label
        MS->>GH: *fetch failing job log excerpt
        MS->>RD: *dispatch fix run - worktree from PR branch «slug», RETRY hint = log excerpt
        RD->>GH: push fix commit to same PR branch
        Note over MS: *ciFixAttempts incremented in watch entry
    else rollup FAILED and attempts exhausted
        MS->>GH: *needs-remediation label + escalation comment
        MS->>HM: *HALT-grade ci_failed event (✋ visible)
    else rollup green
        MS->>GH: *remove ci-failed label if present
        MS->>MS: existing mergeable label logic
    end
```

## Fixture-portability guards (second deliverable)

Structural meta-test (new file under `src/conductor/test/structural/`), same conventions as
`non-autonomy.test.ts` (falsifiability tests + comment-marker escape hatch), but **glob-based
over `src/conductor/test/**`** rather than import-graph:

| Guard | Pattern flagged | Escape hatch |
|-------|-----------------|--------------|
| Branch portability | `git init` without `-b «branch»` (and not `--bare`), across all exec wrapper shapes | `// portability-ok: «reason»` |
| Timer lifecycle | `.unref()` on timers in `src/engine` loop paths | annotation comment |
| Atomic writes | tmp-file staged outside target dir then rename/copy | annotation comment |

No runtime coupling to the sweep — pure test-time guard; the ~16 existing non-portable
`git init` call sites are fixed in the same change so the guard lands green.

## Legend

- `*` — new element introduced by this feature
- `«…»` — variable placeholder (slug, branch, PR URL)
- Watch registry — `.daemon/mergeable-watch.jsonl`, one JSON object per line per shipped PR

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | Spec for #397 ship→CI feedback loop (engineer DECIDE) |
