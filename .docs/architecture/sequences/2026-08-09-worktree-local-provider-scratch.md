# Sequence: Provider scratch acquire, release, and orphan recovery

**Last updated:** 2026-08-09
**Scope:** The three lifecycle paths for a throwaway provider home — normal completion, an interrupted attempt recovered by the dead-owner sweep, and the worktree-reap backstop.

## Diagram: normal attempt

```mermaid
sequenceDiagram
    participant PE as Provider execution
    participant PORT as Scratch store port
    participant FS as Worktree filesystem
    participant CH as Provider child process
    participant BUS as Event spine

    PE->>PORT: acquire home for run «runId» attempt «n»
    PORT->>FS: create «worktree»/.daemon/scratch/«runId»/«n»-«provider»
    PORT->>FS: write owner lease - repo, slug, run, attempt, pid, startedAt
    PORT-->>PE: home path
    PE->>CH: spawn with provider home env pointing at the path
    CH-->>PE: attempt result
    PE->>PORT: release home - runs in the existing finally
    PORT->>FS: remove attempt home and its lease
    Note over PORT,BUS: no event on the normal path - see the legend
```

## Diagram: interrupted attempt recovered at the next dispatch boundary

```mermaid
sequenceDiagram
    participant CH as Provider child process
    participant PE as Provider execution
    participant FS as Worktree filesystem
    participant D as Daemon dispatch boundary
    participant SW as Dead-owner sweeper
    participant BUS as Event spine

    Note over PE,CH: attempt is in flight, lease present on disk
    CH--xPE: process killed - SIGKILL, OOM, or daemon restart
    Note over PE: the finally never runs, so the home survives

    D->>SW: sweep before the next dispatch - best effort
    SW->>FS: enumerate attempt homes under the scratch root
    SW->>FS: read each owner lease
    SW->>SW: classify each owner as live or dead

    alt owner process is gone
        SW->>FS: remove the attempt home immediately
        SW->>BUS: scratch reclaimed - owning feature, run, attempt, reason
    else owner process is still running
        SW->>BUS: scratch retained - owning feature, run, attempt, reason
    end

    alt removal fails
        SW->>BUS: scratch cleanup failed - path and error
        Note over SW,D: the sweep never throws into the dispatch loop
    end
```

## Diagram: worktree reap backstop

```mermaid
sequenceDiagram
    participant OP as Finish, park, or reconciliation path
    participant G as git worktree remove --force
    participant FS as Worktree filesystem
    participant BUS as Event spine

    OP->>G: remove «worktree»
    G->>FS: delete the worktree directory including gitignored content
    Note over FS: every scratch home under it goes with it - no new reaper
    OP->>BUS: existing worktree removal reporting is unchanged
```

## Legend

- **Owner lease** carries repository, feature slug, run id, attempt, owning process id, and start time. It is what makes "dead" decidable without inspecting a live home.
- **Live owner** is never deleted. When liveness cannot be determined, the home is retained and the reason is reported — the sweep fails toward retention, because deleting a live provider home corrupts an in-flight attempt.
- **Dead owner** is deleted immediately. Provider homes hold no post-attempt value, so no grace window is needed to preserve one.
- The sweep is best-effort in exactly the way the existing daemon reconciliation hooks are: a throw is caught and reported, and the dispatch loop is never disrupted.
- Cleanup reporting rides the existing event spine; nothing writes a bespoke log or sidecar format.
- **No event is emitted on the normal completion path.** Release happens on every attempt of every step, so an event for it would be high-volume and carry no diagnostic value none of the intake's outcomes ask for. The three variants are reclaimed, retained, and failed — the cases an operator investigating storage growth actually needs.

> **Amended 2026-08-10 by #1223:** the normal-path "scratch released" emission was removed from the first diagram. Conflict-check found it inconsistent with the three-variant set the stories enumerate; the three-variant set stands.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Initial generation | DECIDE for intake #1223 — interrupted self-host runs leak provider homes until the tmpfs quota fails |
