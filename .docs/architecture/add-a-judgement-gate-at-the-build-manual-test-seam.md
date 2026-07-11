# Feature Architecture: build_review judgement gate (build → manual_test seam)

**Last updated:** 2026-07-07
**Scope:** New first-class loopGate step `build_review` between `build` and `manual_test` in the
conductor engine — grader dispatch, verdict predicate, kickback wiring, opt-in config flag.

## Gate topology (BUILD tail)

```mermaid
graph TD
    subgraph TAIL["Gate-driven tail loop"]
        BUILD["build step<br/>skill /pipeline<br/>loopGate true"]
        BR["build_review step NEW<br/>phase BUILD, loopGate true<br/>enforcement gating<br/>prerequisites build"]
        MT["manual_test step<br/>phase SHIP, loopGate true<br/>prerequisites build_review<br/>(was build)"]
    end

    CFG["resolved-config<br/>build_review.enabled<br/>default OFF"] -->|off = step skipped| BR
    BUILD --> BR
    BR -->|PASS verdict| MT
    BR -->|FAIL kickback with evidence| BUILD
    BR -->|self-heal cap exceeded| HALT["LOOP_HALT_MARKER<br/>.pipeline/halt-user-input-required"]

    subgraph GRADER["Grader dispatch (input-isolated)"]
        RUNNER["step-runners<br/>fresh one-shot session<br/>resume false, new uuid"]
        INPUTS["Inputs fed to grader<br/>git diff vs plan baseline<br/>raw test output ONLY<br/>engineer summary excluded"]
        VERDICT["Grader verdict artifact<br/>.pipeline/build-review.json"]
    end

    BR --> RUNNER
    INPUTS --> RUNNER
    RUNNER --> VERDICT
    VERDICT --> PRED["CUSTOM_COMPLETION_PREDICATES<br/>build_review — fail-closed parse<br/>fresh-since-session check"]
    PRED -->|writes GateVerdict| GV["gate-verdicts<br/>.pipeline/gates/build_review.json"]
```

## Kickback sequence

```mermaid
sequenceDiagram
    participant C as Conductor (advanceTail)
    participant SR as StepRunner
    participant G as Grader session (one-shot)
    participant FS as .pipeline artifacts
    participant B as build step

    C->>SR: run build_review
    SR->>SR: assemble diff + raw test output (structural, no summary)
    SR->>G: fresh session «uuid», resume false
    G->>FS: write build-review.json verdict PASS or FAIL with reason
    C->>FS: predicate parses verdict fail-closed
    alt PASS
        C->>FS: GateVerdict satisfied true
        C->>C: selectNextGate → manual_test
    else FAIL and selfHeals below MAX_KICKBACKS_PER_GATE
        C->>FS: GateVerdict satisfied false, kickback from build_review with evidence
        C->>C: pendingRetryHints set for build (grader reason + evidence)
        C->>B: navigateBack(build), mark downstream stale
        Note over B: task completion survives —<br/>engine-owned task-status re-derives from git
    else FAIL at cap
        C->>FS: write LOOP_HALT_MARKER
        C->>C: emit loop_halt, stop
    end
```

## Legend

- **NEW** — components introduced by this feature; everything else exists today.
- `build_review.enabled` — per-project opt-in flag in `.ai-conductor/config.yml`, resolved
  safe-by-default (absent → off → step skipped, `manual_test` prerequisite auto-satisfied by skip).
- Grader inputs are assembled **structurally** by the engine (git diff + captured test output);
  the maker session's transcript and summary are never passed — input isolation is enforced by
  construction, not convention. Session isolation is already unconditional (#325).
- Kickback/cap machinery mirrors the existing `manual_test → build` self-heal block
  (`conductor.ts` daemon path) and the generic `scanKickbackVerdicts` bound.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial feature diagram | DECIDE phase for intake jstoup111/ai-conductor#324 |
