# Sequence: Task Completion Corroboration (deriveCompletion) — #707

**Last updated:** 2026-07-20
**Scope:** How `deriveCompletion` in `src/conductor/src/engine/autoheal.ts` credits (or
rejects) a task from the commit that carries its `Task: N` trailer. #707 adds exactly ONE
new stage: a **bounded deterministic dirname/subsystem overlap pass** (marked NEW below).
The semantic attribution-judge fallback shown here already exists and is armed
(`attribution_judge_cutover`); its resume-dispatch gap was closed by PR #700 — #707 does
**not** modify it, and it is drawn only to show where the new deterministic pass sits
relative to it.

## Diagram

```mermaid
sequenceDiagram
    participant Eng as conductor.ts (completion check)
    participant DC as deriveCompletion (autoheal.ts)
    participant PC as corroborateFiles (matcher)
    participant JL as attribution-lane.ts (judge — EXISTING, #700)
    participant SC as evidence sidecar (stamps)

    Eng->>DC: deriveCompletion(root, planPath)
    loop each task with a Task: N trailer commit
        DC->>PC: exact/suffix overlap? (fileMatchesPlanPath)
        alt overlap found (unchanged happy path)
            PC-->>DC: hit
            DC->>SC: stamp {form: trailer}
            DC-->>Eng: task completed
        else no exact/suffix overlap
            Note over DC,PC: #707 NEW — bounded, deterministic, token-free
            DC->>PC: dirname(file) == dirname(planDeclaredPath)?<br/>(immediate parent dir ONLY — guards #445)
            alt bounded dirname overlap
                PC-->>DC: hit
                DC->>SC: stamp {form: trailer-dirname}
                DC-->>Eng: task completed
            else still no overlap
                Note over DC,JL: EXISTING fallback (armed; #700) — #707 leaves unchanged
                DC->>SC: semantic-verified stamp present?
                alt judge lane already stamped (residue path)
                    SC-->>DC: yes
                    DC-->>Eng: task completed
                else no stamp / judge unsatisfied / cutover off
                    DC-->>Eng: task incomplete (audit + warnOnce)
                end
            end
        end
    end
    Note over Eng: incomplete task → completion-check-failed →<br/>no_task_progress stall → retry / auto-park
```

## Legend

- **corroborateFiles / matcher** — `filesOverlappingTaskPaths` + `fileMatchesPlanPath`.
  Today: `f === p` or `f.endsWith('/' + p)`. **#707 adds the bounded dirname branch only.**
- **Bounded dirname match (#707):** a commit file corroborates iff its immediate parent
  directory equals the immediate parent directory of a plan-declared path. NOT any ancestor,
  NOT repo-root — this bound is what keeps #445's "same as Task N" inheritance closed.
- **stamp forms** — `trailer` (exact/suffix), `trailer-dirname` (new #707 deterministic),
  `semantic-verified` (existing judge lane). Persisted in the evidence sidecar so later gate
  runs and `task-status.json` rows agree.
- **Judge lane (EXISTING):** `runAttributionLane`, gated by `attribution_judge_cutover`;
  dispatches on residue (incl. inherited/resumed residue since #700) with a same-attempt
  re-derive at conductor.ts:3326. #707 does not touch it.
- **Reject path** — unchanged sink: audit entry + `warnOnce` "Path corroboration failed",
  task stays incomplete → `no_task_progress`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-20 | Initial creation | #707 — document the corroboration decision flow |
| 2026-07-20 | Re-scoped to bounded dirname pass only | DECIDE correction: judge fallback already exists/armed and #700 closed its resume-dispatch gap; #707 adds only the deterministic dirname stage, bounded to guard #445 |
