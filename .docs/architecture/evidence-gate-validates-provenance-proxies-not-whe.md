# Components: Semantic Attribution Verification (two-lane evidence gate)

**Last updated:** 2026-07-11
**Scope:** BUILD-gate attribution machinery — the existing mechanical lane and the new
semantic verification lane, their shared evidence sidecar, and the spot-audit accuracy
loop. Feature slug: `evidence-gate-validates-provenance-proxies-not-whe` (#520).

## Diagram

```mermaid
graph TD
    subgraph BuildTry [Build step try - conductor.ts run loop]
        GATE[Build completion gate<br>artifacts.ts CUSTOM_COMPLETION_PREDICATES.build]
        HEAL[Mechanical lane<br>deriveCompletion + applyDerivedCompletion<br>autoheal.ts]
        LANE[Semantic verification lane<br>verifier-lane orchestrator - NEW]
        FAILPATH[Existing failure path<br>retry ladder / stall / auto-park]
    end

    subgraph LaneInternals [Semantic lane internals - NEW]
        RESIDUE[Residue resolver<br>unresolved ids = plan ids minus evidence stamps]
        INPUTS[Input assembler<br>task defs + candidate diffs + scoped test runs]
        JUDGE[Fresh-context verifier agent<br>opus tier - one shot per residue set]
        VALID[Verdict validator<br>engine-side - citations must resolve]
        STAMP[Evidence stamp writer<br>form semantic-verified - engine only]
        AUDIT[Spot-audit sampler<br>re-verifies N pct of fast-lane stamps]
        LEDGER[Accuracy ledger<br>agreement rate + divergence flags]
    end

    SIDE[.pipeline/task-evidence.json<br>evidence sidecar - sole gate currency]
    VERDICT[.pipeline/attribution-verdict.json<br>BranchOutcome-shaped union]
    CFG[.ai-conductor/config.yml<br>semantic verification cutover flag]
    GROUP[Future: #469 validation group<br>spot-audit as ordinary member]
    CLI[conduct-ts evidence judge «feature»<br>operator recovery entry - NEW]

    CLI -->|same lane, manual invocation| LANE

    GATE -->|gate missed| HEAL
    HEAL -->|stamps written| SIDE
    HEAL -->|still unresolved| LANE
    LANE --> RESIDUE
    RESIDUE --> INPUTS
    INPUTS --> JUDGE
    JUDGE -->|writes| VERDICT
    VERDICT --> VALID
    VALID -->|verdict pass per task| STAMP
    STAMP --> SIDE
    SIDE -->|re-check| GATE
    VALID -->|verdict fail or no-verdict| FAILPATH
    CFG -->|inactive - lane skipped| FAILPATH
    AUDIT -->|samples| SIDE
    AUDIT --> JUDGE
    AUDIT --> LEDGER
    LEDGER -.->|divergence signal| GROUP
    VERDICT -.->|same union shape| GROUP
```

## Legend

- **Mechanical lane** — today's deterministic derivation: trailer grammar, path
  corroboration, `Evidence: satisfied-by` resolution. Unchanged; stays first and cheap.
- **Semantic verification lane (NEW)** — runs only when the mechanical lane leaves
  residue, config cutover is active, and the try would otherwise fail. The agent judges;
  the **engine** validates citations and writes stamps (agent never touches the sidecar).
- **BranchOutcome-shaped union** — `verdict (pass|fail|blocked)` / `no-verdict (reason)` /
  `skipped`, matching the #469/#500 group-core member interface so the spot-audit can
  later join the validation group without a new scheduler.
- **CLI recovery entry (NEW)** — `conduct-ts evidence judge «feature»` invokes the same
  lane (same input assembly, same citation validation, same engine-only stamping) so an
  operator can resolve an evidence halt without insider trailer knowledge (#467). No
  separate judgement path — one verifier, two invokers.
- **Split attribution** — one commit may satisfy several tasks (mono-dispatch bundling,
  #519/#520 shape 6): the verdict union is per-task, so multiple tasks may cite the same
  sha; the validator accepts overlapping citations. This is also the seam #474 concurrent
  streams will lean on.
- Dashed edges — future composition, not built by this feature.
- `«slug»` / `«feature»` placeholders denote variable parts.

## Sequence: residue verification on a failing build try

```mermaid
sequenceDiagram
    participant RUN as conductor.run build try
    participant GATE as build gate
    participant HEAL as mechanical lane
    participant LANE as semantic lane
    participant J as verifier agent (fresh session)
    participant EV as task-evidence.json

    RUN->>GATE: checkStepCompletion
    GATE-->>RUN: missed - X of Y tasks pending
    RUN->>HEAL: deriveCompletion + apply
    HEAL->>EV: stamps for derivable tasks
    RUN->>GATE: re-check
    GATE-->>RUN: still missed (residue)
    RUN->>LANE: verify residue (cutover active)
    LANE->>LANE: assemble per-task inputs<br>task def, candidate diffs, scoped tests
    LANE->>J: dispatch one-shot judge (opus)
    J-->>LANE: attribution-verdict.json (union)
    LANE->>LANE: validate citations<br>shas reachable, tests green
    alt verdict pass for task
        LANE->>EV: stamp form semantic-verified
        RUN->>GATE: re-check gate
        GATE-->>RUN: satisfied
    else fail / no-verdict / invalid citation
        LANE-->>RUN: no stamp - existing failure path
    end
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-11 | Initial feature diagram | DECIDE phase for intake #520 (semantic attribution verification) |
| 2026-07-11 | Added CLI recovery entry + split-attribution legend | Operator-approved design: engine-embedded verifier with `conduct-ts evidence judge` manual entry (#467); mono-dispatch split case made explicit |
