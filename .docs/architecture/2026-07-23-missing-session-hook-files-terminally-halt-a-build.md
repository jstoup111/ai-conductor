# Architecture: session-hook repair at the build-dispatch preflight (#896)

**Date:** 2026-07-23
**Scope:** C4 Level 3 (component) for the build-dispatch preflight seam and the session-hook
consumer chain it protects.

## C4 L3 — components in play

```mermaid
flowchart TB
  subgraph engine["Conductor engine (src/conductor/src/engine)"]
    COND["conductor.ts<br/>runStep loop :3200-3227"]
    GUARD["seedAndCheckAttributionMachinery :668<br/>checkAttributionMachineryIntact :688"]
    SEED["task-seed.ts<br/>seedTaskStatus"]
    WP["worktree-prepare.ts<br/>writeSessionHooks (private)<br/>wireSessionHookSettings (private)"]
    ASSETS["session-hook-assets.ts<br/>PRE/POST/MUTATION_GATE/DOCS_GUARD"]
    ENF["attribution-enforcement.ts<br/>writeBuildStepMarker :51"]
    TP["task-progress.ts<br/>resolveTaskIds :62<br/>countResolvedTasks :27"]
  end

  subgraph wt["Feature worktree (.pipeline/)"]
    HOOKS[".pipeline/session-hooks/*.sh"]
    SETTINGS[".claude/settings.local.json"]
    STAMP[".pipeline/current-task"]
    MARKER[".pipeline/build-step-active"]
    STATUS[".pipeline/task-status.json"]
    DC[".pipeline/dispatch-count"]
  end

  COND -->|"preflight, build step only"| GUARD
  GUARD --> SEED --> STATUS
  GUARD -.->|"NEW: repair on miss"| WP
  WP --> ASSETS
  WP --> HOOKS
  WP --> SETTINGS
  COND -->|"only when machineryIssue == null"| ENF --> MARKER

  HOOKS -->|"pre-dispatch stamps"| STAMP
  HOOKS -->|"pre-dispatch appends"| DC
  HOOKS -->|"post-dispatch clears"| STAMP
  MARKER --> MG
  STAMP --> MG["mutation-gate.sh<br/>GATE: exit 2 blocks Edit/Write/git commit"]
  STAMP --> PCM["prepare-commit-msg<br/>stamps Task: trailer"]
  PCM --> TP
  STATUS --> TP
  TP -->|"GATE: no_task_progress stall :3768"| COND
  DC --> TEL["detectZeroWorkProduct (pinned false)<br/>detectUnattributedDispatch (event only)<br/>TELEMETRY ONLY"]
```

## Reading the diagram

- Two edges are labelled **GATE** and both terminate in build-stopping behavior. They are the
  reason removal is unsafe: `mutation-gate.sh` fail-closes unstamped mutations, and the
  `current-task → Task: trailer → resolveTaskIds → countResolvedTasks` chain feeds the
  `no_task_progress` stall breaker.
- The only **TELEMETRY ONLY** sink is `.pipeline/dispatch-count`. It is the sole artifact of these
  hooks that #773 actually stranded.
- The `machineryIssue == null` edge into `writeBuildStepMarker` is the ordering hazard: any design
  that lets the guard pass while hooks are still absent arms the mutation gate against a
  nonexistent script.

## Change footprint

- **New (extracted, exported):** `ensureSessionHooks(worktreeRoot, log?)` in `worktree-prepare.ts`
  — the existing `writeSessionHooks` + `wireSessionHookSettings` pair made outcome-reporting and
  callable from the guard. `prepareWorktree` keeps calling them with unchanged fail-open posture.
- **Changed:** `checkAttributionMachineryIntact` gains a repair-then-recheck step on the
  session-hooks branch only. Every other branch (pipeline-dir absent, task-status missing,
  plan unresolvable, stamp path unwritable) is byte-for-byte unchanged.
- **Unchanged:** hook script contents, settings wiring shape, `writeBuildStepMarker` call site and
  its `!machineryIssue` predicate, all consumers in `task-progress.ts` /
  `attribution-enforcement.ts`.

## Invariant this design must preserve

> The build-step-active marker is written **only** after the preflight has confirmed — post-repair,
> by re-reading the filesystem — that all three enforcement scripts exist on disk.

The mutation gate's fail-closed guarantee is exactly as strong as this invariant.
