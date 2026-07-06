# Architecture: daemon false-ship guard (ai-conductor#337)

Finish→DONE→ship flow after this change. New elements marked with `*`.

```mermaid
flowchart TD
    F[finish step runs /finish] --> FC{finish-choice written}
    FC -->|pr + pr_url in state| GATE[finish completion gate]
    FC -->|keep or merge-local| DMODE{daemon mode?}
    DMODE -->|no - interactive| GATE
    DMODE -->|yes| REM[*non-converging: remediation, no DONE]
    GATE -->|*choice=pr: pr_url non-null AND origin/branch contains HEAD| DONE[.pipeline/DONE written]
    GATE -->|*push evidence missing or remote not advanced| REM
    DONE --> RO[daemon readWorktreeOutcome]
    RO --> SHIP{*ship guard in done-branch}
    SHIP -->|finishChoice=pr AND verified prUrl| MP[markProcessed status=shipped + teardown worktree]
    SHIP -->|*anything else| HALT[*HALT written + DONE deleted: worktree kept, NO shipped marker]
    HALT --> PUSHED[*escalation pushes branch - work preserved on origin]
```

The two guards are independent: the gate stops an evidence-free `DONE` from converging; the
daemon guard stops a `DONE` that slipped through (or a stale/pre-existing PR URL) from writing
a `shipped` processed marker.

Pre-change defect path (for contrast): gh failure in `/finish` → auto-prompt fallback writes
`keep` → gate passes `keep` with zero evidence → DONE → daemon ships on `outcome.done` alone →
`{status:'shipped', prUrl:null}` + worktree removed → work stranded, feature locked done.

```mermaid
sequenceDiagram
    participant FS as finish step (skill)
    participant CG as completion gate (artifacts.ts)
    participant CT as conductor tail
    participant DR as daemon runner
    participant GH as origin / gh

    FS->>GH: push branch + gh pr create (skill-side, *STOP gate verifies)
    FS->>CG: finish-choice=pr, pr_url in conduct-state
    CG->>GH: *git ls-remote: origin/«branch» contains HEAD?
    alt evidence ok
        CG->>CT: complete → DONE marker
        CT->>DR: outcome {done, finishChoice, prUrl}
        DR->>DR: *guard: finishChoice=pr AND prUrl non-null
        DR->>DR: markProcessed(shipped, prUrl) + remove worktree
    else no push / null pr_url / remote unmoved
        CG->>CT: *incomplete → remediation, no DONE
        CT->>GH: *surfaceRemediationPr (push + draft PR + HALT)
        Note over DR: *no shipped marker, worktree kept
    end
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-06 | Initial generation | Spec for #337 false-ship guard (engineer DECIDE) |
| 2026-07-06 | HALT node: DONE marker deleted on failed ship | Conflict resolution — done/halted stay disjoint (plan update) |
