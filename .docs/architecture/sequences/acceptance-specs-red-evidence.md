# Sequence: acceptance_specs RED-evidence (engine-owned execution)

**Last updated:** 2026-07-21
**Scope:** The `acceptance_specs` step of a daemon/conduct build — how the RED
execution marker (`.pipeline/acceptance-specs-red.json`) is produced and gated.
Reflects the planned (Hybrid C) architecture for #741.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon/Conductor
    participant S as writing-system-tests skill
    participant WT as Worktree (.pipeline @ root)
    participant G as acceptance_specs gate (artifacts.ts)
    participant R as Engine RED-runner (new)

    D->>S: dispatch acceptance_specs (print mode)
    S->>WT: author + commit spec files
    Note over S,WT: NEW — skill records run contract early
    S->>WT: write .pipeline/acceptance-specs-run.json<br/>{command, cwd, targetSpecs}
    opt skill also executes (best effort)
        S->>WT: write acceptance-specs-red.json @ root
    end
    S-->>D: session exits

    D->>G: completion check
    G->>WT: read acceptance-specs-red.json (authoritative root path)
    alt marker present + valid (failed>=1, skipped==0, errors==0)
        G-->>D: done ✓
    else marker missing/invalid BUT specs committed
        Note over G,R: NEW — engine self-heal, no re-dispatch
        G->>R: run contract (acceptance-specs-run.json)
        R->>WT: exec «command» from «cwd»
        R->>WT: write acceptance-specs-red.json @ root
        R->>G: re-validate
        alt specs genuinely RED
            G-->>D: done ✓
        else PASS / skipped / errors
            G-->>D: fail (real evidence, not "missing")
        end
    else no spec files at all
        G-->>D: fail — specs must be generated
    end
```

## Legend

- **NEW** notes mark the two additions for #741: (1) the skill records a
  `{command, cwd, targetSpecs}` run contract when it authors specs; (2) the engine
  gate self-heals a missing/invalid RED marker by executing that recorded contract
  itself (from the recorded cwd) and writing the marker to the **authoritative
  worktree-root path** — instead of failing "missing" and re-dispatching a prompt.
- `«command»` / `«cwd»` are guillemet placeholders for the recorded contract values.
- The old behavior (removed): a missing marker → HALT after ~15s no-op retries, with
  the marker occasionally stranded in a nested `src/conductor/.pipeline/` by a
  cwd-relative write.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-21 | Initial generation | #741 — engine-owned RED execution + cwd-robust marker resolution |
