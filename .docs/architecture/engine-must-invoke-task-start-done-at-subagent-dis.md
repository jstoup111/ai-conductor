# Component Diagram: Engine-Invoked Task Start/Done at Subagent Dispatch (#477)

**Last updated:** 2026-07-10
**Scope:** Closes the last prompt-discipline link in the #433/#452 attribution chain. Today
`skills/pipeline/SKILL.md` step 0 *instructs* the orchestrator agent to run `conduct-ts task
start «id»` before each subagent dispatch — nothing deterministic fires it, so builds converge
only when the agent complies. This feature installs Claude-session PreToolUse/PostToolUse
hooks (matched on the subagent-dispatch tool) at worktree provisioning; the hooks stamp
`.pipeline/current-task` and flip `task-status.json` mechanically on every dispatch,
fail-closed. The Node engine still never sees task boundaries (one headless `/pipeline`
session per build step) — the session hook IS the engine's proxy at the dispatch boundary.
Everything downstream (#452 git hooks, evidence gate) is unchanged.

## Diagram

```mermaid
graph TD
    subgraph DAEMON["Daemon (worktree provisioning)"]
        PREP["prepareWorktree (worktree-prepare.ts)<br/>#452: git config core.hooksPath<br/>NEW: write session-hook assets +<br/>wire PreToolUse/PostToolUse into build-worktree settings"]
    end

    subgraph SESSION["Build session (headless claude, one per build step)"]
        ORCH["/pipeline orchestrator agent<br/>SKILL.md step 0/6 becomes documentation<br/>no longer trusted to invoke the CLI"]
        DISPATCH["Agent-tool dispatch of task subagent<br/>prompt carries Task: «id» (existing template)"]
    end

    subgraph SHOOKS["Session hooks (NEW: embedded assets, pure bash + node -e, no dist)"]
        PRE["PreToolUse (matcher: subagent-dispatch tool)<br/>parse LINE 1 only of dispatch prompt: Task: «id» or Task: none<br/>missing/malformed/unknown id → BLOCK (fail-closed)<br/>Task: none (review/grader) → pass through; body Task: tokens invisible<br/>overlap: 2nd in-flight task → clear stamp"]
        POST["PostToolUse (same matcher)<br/>task-done: validated stamp removal<br/>never edits task-status.json rows to completed"]
    end

    subgraph STATE["Worktree .pipeline/ state (#452, unchanged shape)"]
        SEED["task-status.json<br/>engine-seeded rows (task-seed.ts)<br/>= the valid id set"]
        CURR[".pipeline/current-task<br/>now machine-written at dispatch"]
    end

    subgraph GHOOKS["Git hooks (#452, unchanged)"]
        PCM["prepare-commit-msg<br/>stamp Task: «id» from current-task<br/>else unique in_progress row, else abstain"]
        CMSG["commit-msg<br/>validate trailer vs seeded set"]
    end

    subgraph ENGINE["Engine gate (unchanged)"]
        DERIVE["deriveCompletion (autoheal.ts)"]
        GATE["build completion gate (artifacts.ts)"]
    end

    PREP -->|"writes assets + settings wiring at provisioning"| SHOOKS
    ORCH --> DISPATCH
    DISPATCH -->|"fires mechanically on every dispatch"| PRE
    PRE -->|"in_progress + stamp (atomic, #452 semantics)"| SEED
    PRE -->|"write / clear"| CURR
    DISPATCH -->|"subagent completes"| POST
    POST -->|"validated removal"| CURR
    CURR -->|"read"| PCM
    SEED -->|"fallback: unique in_progress row"| PCM
    SEED -->|"valid id set"| CMSG
    PCM --> CMSG
    CMSG --> DERIVE
    DERIVE --> GATE
```

## Sequence: one per-task dispatch under #477

```mermaid
sequenceDiagram
    participant ORCH as pipeline orchestrator
    participant PRE as PreToolUse hook
    participant ST as .pipeline/ state
    participant AGENT as task subagent
    participant POST as PostToolUse hook
    participant PCM as git hooks (#452)

    ORCH->>PRE: Agent-tool dispatch (prompt carries Task: «id»)
    alt impl dispatch, no parseable id
        PRE-->>ORCH: BLOCK dispatch with instructive error (fail-closed)
    else id parsed
        PRE->>ST: flip «id» to in_progress, write current-task
        alt another task already in flight
            PRE->>ST: clear current-task (git hook falls back to abstain path)
        end
        PRE-->>AGENT: dispatch proceeds
        AGENT->>PCM: git commit — trailer stamped from current-task
        AGENT-->>POST: subagent returns
        POST->>ST: remove current-task iff it matches «id»
    end
    Note over ORCH,POST: SKILL.md step 0/6 no longer load-bearing — hooks fire on 100% of dispatches
```

## Legend

- **NEW** — surfaces this feature adds; #452 state files, git hooks, and the evidence gate
  keep their exact shapes and semantics (the gate stays the single completion authority).
- **Fail-closed** — an implementation dispatch whose prompt carries no parseable task id is
  rejected at dispatch time (instant, orchestrator-visible), not discovered 13 unevidenced
  tasks later at the build gate.
- **Embedded assets, no dist** — session hooks follow git-hook-assets.ts precedent: pure
  bash + inline `node -e`, written per worktree at provisioning; they never invoke the
  worktree's built engine, so they cannot run stale engine code (#403 class).
- **Overlap guard** — parallel dispatch cannot be represented by a single stamp; clearing it
  degrades to #452's abstain-on-ambiguity (unique-in_progress fallback), never a wrong stamp.
- **Spike gate** — the design assumes PreToolUse tool-matcher hooks fire in headless
  `--print` sessions (verified interactive-only so far); architecture review must confirm
  with a one-shot headless probe before build.
- `«id»` — placeholder for a plan task id.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for #477 (engineer worktree) |
| 2026-07-10 | Marker grammar tightened to line-1-only (`Task: «id»` / `Task: none`) | Conflict resolution vs #417/#302 trailer-instruction `Task:` tokens in prompt bodies |
