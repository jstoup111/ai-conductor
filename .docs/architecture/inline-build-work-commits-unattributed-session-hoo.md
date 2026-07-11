# Components: Inline Build-Work Attribution Enforcement (#505)

**Last updated:** 2026-07-10
**Scope:** The three new enforcement surfaces that make unattributed inline task work
impossible to create silently during a daemon build — (A) a fail-closed branch in the
worktree `commit-msg` git hook, (B) a session PreToolUse gate on file-mutation tools,
and (net) a zero-work-product step-end check — shown against the existing attribution
seam (dispatch session hooks, trailer stamping, evidence gate, auto-park).

## Diagram

```mermaid
graph TD
    subgraph Session["Build session in worktree - interactive tmux"]
        ORCH["Pipeline orchestrator<br/>skills/pipeline"]
        SUB["Implementer subagent<br/>dispatched with Task: «id» line 1"]
        PREH["PRE dispatch hook<br/>session-hook-assets.ts<br/>stamps .pipeline/current-task"]
        POSTH["POST dispatch hook<br/>clears the stamp"]
        MUT["NEW B: PreToolUse gate on<br/>Edit-Write file mutation<br/>blocks exit 2 when stamp absent"]
    end

    subgraph GitHooks["Worktree git hooks - .pipeline/git-hooks"]
        PCM["prepare-commit-msg<br/>stamps Task: «id» trailer<br/>from current-task else unique<br/>in_progress row else abstains"]
        CM["commit-msg validate<br/>NEW A: fail-closed reject of a<br/>content commit with no Task:<br/>trailer while a build is active"]
    end

    subgraph Engine["Engine - daemon build loop"]
        NET["NEW net: step-end zero-work check<br/>zero dispatches and zero commits<br/>deterministic kickback not a<br/>silently burned retry"]
        DC["Evidence gate deriveCompletion<br/>autoheal.ts - sole completion authority"]
        PARK["No-evidence counter<br/>threshold 3 then auto-park"]
    end

    CFG[("Config cutover flag<br/>owner_gate_cutover precedent<br/>config.ts")]

    STAMP[(".pipeline/current-task<br/>present only during a dispatch")]

    ORCH -->|"Agent tool dispatch"| PREH
    PREH --> STAMP
    PREH --> SUB
    SUB --> POSTH
    POSTH -.->|"remove"| STAMP
    ORCH -.->|"inline Edit attempt<br/>no stamp"| MUT
    MUT -.->|"exit 2 redirect:<br/>dispatch or Task: none"| ORCH
    SUB -->|"git commit"| PCM
    STAMP --> PCM
    PCM --> CM
    CM -->|"trailered commit lands"| DC
    CM -.->|"reject with actionable<br/>message when unattributed"| ORCH
    CFG --> CM
    CFG --> MUT
    NET --> PARK
    DC --> PARK

    EX["Exemptions - always pass:<br/>merge commits, amend, rebase,<br/>Task: none flows,<br/>empty commit with Evidence trailer,<br/>engine bookkeeping"]
    EX -.-> CM
    EX -.-> MUT
```

## Legend

- **NEW A / NEW B / NEW net** — the three surfaces this feature adds; every other node is
  the existing merged seam (#452 git hooks, #494 dispatch session hooks, #481 evidence
  gate as sole completion currency).
- **A (commit gate)** — today `commit-msg` validates only trailers that are already
  present; a trailer-less content commit sails through. The new branch rejects it at
  creation with a redirect message, so the failure surfaces at the point of violation
  instead of three burned retries later.
- **B (dispatch shape)** — today inline implementation is forbidden by SKILL prose only.
  The new PreToolUse matcher makes the dispatch shape mechanical: file mutation without
  an active `current-task` stamp is refused at attempt time.
- **net (zero work product)** — a build-step session that ends with zero dispatches and
  zero commits (the prose-victory class) is detected deterministically and kicked back;
  shipped #459 covers only sessions that deliberately write a stall marker.
- **Cutover flag** — both blocking surfaces are gated by a config cutover following the
  `owner_gate_cutover` pattern, so existing repos and in-flight builds are grandfathered.
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for intake #505 |

# Sequence: inline attempt redirected, dispatched work attributed, escape rejected

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Mut as PreToolUse mutation gate
    participant Pre as PRE dispatch hook
    participant Sub as Implementer subagent
    participant Git as git hooks
    participant Gate as Evidence gate

    Orch->>Mut: Edit file inline - no dispatch active
    Mut-->>Orch: exit 2 - dispatch via Agent tool or Task: none
    Orch->>Pre: Agent dispatch, line 1 Task: 4
    Pre->>Pre: stamp current-task = 4
    Pre->>Sub: subagent runs
    Sub->>Mut: Edit file
    Mut-->>Sub: allowed - stamp present
    Sub->>Git: git commit
    Git->>Git: prepare-commit-msg adds Task: 4 trailer
    Git-->>Sub: commit lands attributed
    Sub-->>Orch: task summary
    Orch->>Git: hypothetical unattributed content commit
    Git-->>Orch: commit-msg rejects - no Task: trailer during build
    Note over Git: exemptions pass - merge, amend, rebase,<br/>Task: none, empty commit with Evidence
    Gate->>Gate: deriveCompletion reads trailers
    Note over Gate: canary tally reads N of N attributed
```

# Sequence: zero-work-product session kicked back deterministically

```mermaid
sequenceDiagram
    participant Daemon as Daemon build loop
    participant Sess as Build step session
    participant Net as Step-end zero-work check
    participant Park as Retry and park ledger

    Daemon->>Sess: dispatch build step
    Sess-->>Daemon: session ends - prose only
    Daemon->>Net: step end - inspect work products
    Net->>Net: zero dispatches and zero commits and no halt marker
    Net-->>Daemon: deterministic kickback with reason
    Daemon->>Park: recorded as enforced kickback not silent no-evidence retry
    Note over Daemon,Park: operator sees the cause instead of<br/>three opaque burned retries then park
```
