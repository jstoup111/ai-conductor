# Component Diagram: Deterministic Build Evidence Attribution (#433)

**Last updated:** 2026-07-09
**Scope:** The attribution path from per-task dispatch to evidence-gate verdict, and where
#433 moves it from prompt discipline to machinery: an engine-owned `conduct-ts task` CLI
that owns `task-status.json` transitions and stamps `.pipeline/current-task`, plus two
pure-bash git hooks (`prepare-commit-msg` auto-stamp, `commit-msg` validation) wired
per-build-worktree via `core.hooksPath` at `prepareWorktree` time. The evidence gate is
unchanged and remains the final arbiter.

## Diagram

```mermaid
graph TD
    subgraph DAEMON["Daemon (worktree provisioning)"]
        PREP["prepareWorktree (worktree-prepare.ts)<br/>namespace + bin/setup<br/>NEW: git config core.hooksPath → hooks/git/"]
    end

    subgraph SKILLS["Skill layer (contracts)"]
        PIPE["skills/pipeline/SKILL.md step 0<br/>OLD: hand-edit task-status.json<br/>NEW: conduct-ts task start «id»"]
        TDD["skills/tdd/SKILL.md COMMIT step<br/>trailer discipline stays as documentation<br/>hooks now enforce it mechanically"]
    end

    subgraph CLI["Engine CLI (new)"]
        TASKCLI["conduct-ts task start/done «id»<br/>validates id vs seeded id set<br/>atomic task-status.json transition<br/>stamps/clears .pipeline/current-task"]
    end

    subgraph STATE["Worktree .pipeline/ state"]
        SEED["task-status.json<br/>engine-seeded rows (task-seed.ts)<br/>= the valid id set"]
        CURR[".pipeline/current-task<br/>NEW: single id, engine-written"]
    end

    subgraph HOOKS["Git hooks (pure bash, NEW: embedded in git-hook-assets.ts, written per worktree)"]
        PCM["prepare-commit-msg<br/>no Task: trailer → append Task: «id»<br/>id from current-task, else unique in_progress row<br/>abstains if neither yields exactly one id"]
        CMSG["commit-msg<br/>reject unknown trailer id (vs seeded set)<br/>reject empty commit without Evidence: satisfied-by «sha»<br/>warn-only on multi-task bundling"]
    end

    subgraph BUILD["Build worktree (git history)"]
        COMMITS["Feature commits<br/>Task: «id» trailers — now stamped/validated at commit time"]
    end

    subgraph ENGINE["Engine gate (unchanged)"]
        DERIVE["deriveCompletion (autoheal.ts)<br/>#418 grammar: TASK_ID_PATTERN, alias, satisfied-by"]
        GATE["build completion gate (artifacts.ts)"]
    end

    PREP -->|"sets hooksPath at provisioning"| HOOKS
    PIPE -->|"calls per task"| TASKCLI
    TASKCLI -->|"atomic write"| SEED
    TASKCLI -->|"stamp / clear"| CURR
    CURR -->|"read"| PCM
    SEED -->|"fallback: unique in_progress row"| PCM
    SEED -->|"valid id set"| CMSG
    PCM -->|"auto-stamped trailer"| COMMITS
    CMSG -->|"reject at commit = instant, agent-visible"| COMMITS
    TDD -.->|"documents the same grammar"| CMSG
    COMMITS -->|"git log trailers"| DERIVE
    DERIVE --> GATE
```

## Sequence: one per-task build dispatch under #433

```mermaid
sequenceDiagram
    participant ORCH as pipeline orchestrator
    participant CLI as conduct-ts task
    participant ST as .pipeline/ state
    participant AGENT as task subagent
    participant PCM as prepare-commit-msg
    participant CMSG as commit-msg
    participant GATE as evidence gate

    ORCH->>CLI: task start «id»
    CLI->>ST: validate «id» vs seeded set, mark in_progress, write current-task
    ORCH->>AGENT: dispatch task «id»
    AGENT->>PCM: git commit (no trailer)
    PCM->>ST: read current-task (fallback unique in_progress)
    PCM->>AGENT: message += Task: «id»
    AGENT->>CMSG: commit-msg validation
    CMSG->>ST: trailer id in seeded set?
    alt unknown id or bare-trailer empty commit
        CMSG-->>AGENT: reject with instructive message (fix now)
    else valid
        CMSG-->>AGENT: commit lands with correct trailer
    end
    ORCH->>CLI: task done «id»
    CLI->>ST: clear current-task
    GATE->>GATE: deriveCompletion unchanged — trailers now reliable
```

## Legend

- **NEW** markers — surfaces this feature adds or changes; everything in **Engine gate**
  is deliberately untouched (the gate stays the single completion authority, per #302/#418).
- **Pure bash hooks** — read only `.pipeline/` files and git state; no dependency on the
  worktree's built engine `dist`, so they cannot run stale engine code (#403 class).
- **Abstain** — when the stamp source is ambiguous (0 or >1 candidate ids) the
  `prepare-commit-msg` hook writes nothing; `commit-msg` validation still applies, so the
  failure mode degrades to today's behavior, never a wrong stamp.
- `«id»` / `«sha»` — placeholders for a plan task id / an existing commit sha.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-09 | Initial generation | DECIDE phase for #433 (engineer worktree) |
| 2026-07-09 | Hooks shown as engine-embedded assets (git-hook-assets.ts), not a hooks/git/ dir | Plan decision: embedding avoids publish-script changes and loose-asset staleness |
