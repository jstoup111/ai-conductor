# Architecture: Mid-loop `.pipeline` wipe / kickback crash (ai-conductor#549)

**Last updated:** 2026-07-11
**Scope:** The finish→build kickback incident path and the `.pipeline` shared-state
boundary. This is a bug-fix diagram: it shows only the actors that touch `.pipeline`
during a step-kickback, where the crash lands, and the three guard points the fix adds.
It is not a full conductor map.

## Diagram 1 — Incident sequence (finish-failure → kickback → crash)

```mermaid
sequenceDiagram
    participant Cond as Conductor run-loop
    participant Finish as finish step
    participant Remed as planRemediation
    participant Build as build step in sandbox
    participant Deleter as unknown deleter
    participant SR as StepRunner persist
    participant PD as pipeline shared-state
    participant Crash as crash HALT handler

    Note over PD: holds conduct-state, task-status, task-evidence, gates, session hooks

    Finish->>PD: read and write during finish
    Finish-->>Cond: finish completed
    Cond->>Cond: completion gate FAILS, finish-choice missing
    Cond->>Remed: finish-remediation self-heal
    Remed->>PD: write remediation.json, route to build
    Cond->>Cond: kickback finish to build, navigateBack sets build stale
    Cond->>Build: re-dispatch build, CONFIG_DIR points at tmp sandbox
    Build->>Deleter: runs mutation-gate-probe tests
    Deleter--xPD: rm -rf resolves to REAL pipeline dir, outcome 1 pins this
    Build-->>Cond: build step succeeds, commit made
    Cond->>SR: persist success marker
    SR--xPD: writeFile session-created, ENOENT parent dir gone, UNGUARDED
    SR-->>Crash: unhandled ENOENT bubbles up
    Crash->>PD: mkdir pipeline recursive, then write HALT
    Note over PD: post-mortem, only audit-trail and HALT survive
```

## Diagram 2 — `.pipeline` shared-state boundary + the three guard points

```mermaid
graph TD
    subgraph writers["Actors that touch the .pipeline root"]
        SR["StepRunner<br/>session-created / conduct-session-id<br/>(step-runners.ts 423,498)"]
        RESET["resetSession<br/>(step-runners.ts 517-529)"]
        CLEARMARK["clearStaleMarker<br/>build-step-active (task-seed.ts)"]
        SWEEP["sweepStaleReviewArtifacts<br/>(artifacts.ts) — scoped globs"]
        DSWEEP["daemon-cli pre-run sweep<br/>(daemon-cli.ts 621-627)"]
        SANDBOX["self-build sandbox teardown<br/>(sandbox-build-env.ts) — /tmp only"]
        TESTS["mutation-gate-probe tests<br/>create + rm -rf temp .pipeline"]
        CRASHH["crash / HALT handler<br/>mkdir + write HALT"]
    end

    PIPE[(".pipeline/ shared root<br/>conduct-state · task-status ·<br/>task-evidence · gates/«*» · session hooks")]

    SR -->|"write"| PIPE
    RESET -->|"unlink marker (guarded)"| PIPE
    CLEARMARK -->|"clear one marker"| PIPE
    SWEEP -->|"rm scoped artifacts"| PIPE
    DSWEEP -->|"rm 2 session files (guarded)"| PIPE
    TESTS -.->|"UNSCOPED rm -rf (bug)"| PIPE
    SANDBOX -.->|"must stay in /tmp"| PIPE
    CRASHH -->|"recreate + HALT"| PIPE

    G1["GUARD 1 — crash-proof writes:<br/>ensure-dir / catch ENOENT →<br/>logged recovery, never crash"]
    G2["GUARD 2 — scope cleanup:<br/>delete only own artifacts,<br/>never the .pipeline root"]
    G3["GUARD 3 — regression test:<br/>pin finish→build kickback;<br/>identify the real deleter"]

    G1 -.marks.-> SR
    G2 -.marks.-> TESTS
    G2 -.marks.-> SANDBOX
    G3 -.marks.-> PIPE

    classDef guard fill:#fde68a,stroke:#b45309,color:#111;
    classDef bug fill:#fecaca,stroke:#b91c1c,color:#111;
    class G1,G2,G3 guard;
    class TESTS bug;
```

## Legend

- **Solid arrow** — a normal, scoped write/delete the actor is entitled to make.
- **Dashed red arrow (`TESTS`)** — the suspected out-of-scope `rm -rf` that reaches the
  real worktree `.pipeline` under host load; the leading root-cause candidate the
  regression test (Guard 3) must confirm and pin.
- **`--x` (sequence)** — a failed operation: the test's delete of live state, and the
  subsequent unguarded `session-created` write that throws ENOENT and crashes the loop.
- **GUARD 1 / 2 / 3** — the three fix zones. Guard 1 makes the crash impossible
  regardless of cause (writes/reads of `.pipeline` bookkeeping degrade to a logged
  recovery). Guard 2 scopes every kickback/teardown cleanup to its own artifacts. Guard
  3 is the root-cause regression test pinning the exact finish→build transition.
- **`«slug»` / `«*»`** — placeholder notation (guillemets) for variable path parts.
- Self-build only: the build step runs with `CLAUDE_CONFIG_DIR` redirected to a
  throwaway `/tmp` sandbox, so the build session's transcript is discarded on teardown —
  which is why the incident window has no forensic trail. The sandbox teardown itself is
  correctly `/tmp`-scoped and is shown only to explain the missing evidence.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-11 | Initial generation | DECIDE for ai-conductor#549 — depict the kickback crash path and the `.pipeline` shared-state guard points |
