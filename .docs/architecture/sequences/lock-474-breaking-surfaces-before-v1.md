# Sequence: Parallel task-stream dispatch with dual-stamp attribution (#474 target, #552 spec-lock)

**Last updated:** 2026-07-12
**Scope:** One batch boundary in the post-v1 build loop: stream detection, GroupCore
fan-out, per-stream stamp/hook attribution, and the join. Serial mode (cap 1 or veto)
is the unchanged v1 path and is shown as the alternative.

## Diagram

```mermaid
sequenceDiagram
    participant C as conductor build loop
    participant D as stream detector (NEW)
    participant G as GroupCore (#469)
    participant A as stream «a» agent
    participant H as generated hooks (per worktree)
    participant P as .pipeline state

    C->>D: batch boundary - ready tasks + plan graph
    D->>D: partition by dependency edges
    D->>D: pairwise path-set intersection (hard veto)
    alt streams ≥ 2 and build_concurrency ≥ 2
        D->>G: dispatch N streams (capped)
        par each stream
            G->>A: fresh session, tasks of stream «a»
            A->>P: task start - row in_progress (stream field set)
            G->>P: write current-task.d/«a» stamp (NEW namespace)
            A->>A: TDD cycle, commit
            H->>P: prepare-commit-msg reads current-task.d/«a» first
            H->>A: stamps Task: «id» trailer
            A->>P: task done - remove stream stamp iff content matches
        end
        G->>C: join - all stream outcomes (single-writer state)
    else serial (cap 1, veto, or single stream)
        C->>A: existing dispatch, byte-for-byte v1
        A->>P: scalar .pipeline/current-task (unchanged)
        H->>P: scalar stamp resolved via fallback branch
    end
    C->>P: evidence gate derives completion from task-evidence.json (unchanged)
```

## Legend

- **Stream stamp write** — the pre-dispatch session hook (engine-generated) writes the
  per-stream stamp; the post-dispatch hook removes it iff content matches, mirroring the
  scalar stamp's existing compare-and-clear semantics.
- **Hook resolution order** — stream stamp matching the committing session first, scalar
  `.pipeline/current-task` as fallback; absent both, the hook abstains (existing behavior).
- **Join** — GroupCore returns stream outcomes; only the core writes shared state
  (single-writer invariant from #469's APPROVED ADR).
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-12 | Initial generation | DECIDE phase for #552 (#474 interface spec-lock) |
