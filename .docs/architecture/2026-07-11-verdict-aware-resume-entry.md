# Components: Verdict-Aware Resume Entry (#532)

**Last updated:** 2026-07-11
**Scope:** The conductor resume seam — how `conductor.run()` with `resume: true` picks its
starting step, and how the fix makes that derivation consult persisted gate verdicts via the
same selector the loop tail already trusts. Covers both resume entry branches and the daemon
rekick path that shares the seam.

## Diagram

```mermaid
graph TD
    subgraph Callers
        REKICK["daemon-rekick resumeRebaseFirst<br/>pre-loop rebase + rebase state stamp"]
        DCLI["daemon-cli<br/>conductor.run with resume true"]
        CLI["conduct-ts --resume<br/>operator CLI resume"]
    end

    subgraph ResumeSeam["Resume entry seam (conductor.run)"]
        FRI["findResumeIndex<br/>state-only: first in_progress<br/>else lastDone + 1"]
        CLAMP["verdict clamp NEW<br/>earliestUnsatisfiedGateIndex selector.ts<br/>backward-only min with state index"]
    end

    subgraph VerdictLayer["Verdict layer (existing, reused)"]
        RAV["readAllVerdicts<br/>.pipeline/gates/*.json"]
        GS["gateSatisfied selector.ts<br/>verdict wins over state<br/>stale never satisfied"]
        SNG["selectNextGate<br/>earliest unsatisfied gate<br/>at or after regionStart"]
    end

    subgraph StateLayer["State layer (existing)"]
        STATE[".pipeline/conduct-state.json<br/>per-step status"]
        GATES["checkGate gates.ts<br/>state-only prereq check<br/>unchanged"]
    end

    LOOP["step dispatch loop<br/>advanceTail already verdict-aware"]

    REKICK --> DCLI
    DCLI --> FRI
    CLI --> FRI
    FRI --> CLAMP
    STATE --> FRI
    RAV --> CLAMP
    GS --> CLAMP
    SNG --> CLAMP
    CLAMP --> LOOP
    STATE --> GATES
    GATES --> LOOP
    RAV --> LOOP

    style CLAMP fill:#2d6a4f,color:#fff
```

## Legend

- **Green node** — the new element: a verdict clamp applied to the resume start index. All
  other nodes exist today and are reused unchanged.
- **Resume entry seam** — the only place the fix changes behavior. `findResumeIndex` stays
  as the state-derived candidate; the clamp overrides it when any loop-region gate's on-disk
  verdict is `satisfied: false` (or its state is `stale`), landing on the earliest such gate.
- **Verdict layer** — `gateSatisfied` and `selectNextGate` are the loop tail's existing,
  verdict-authoritative selection machinery (`selector.ts`); the fix feeds them
  `readAllVerdicts` output at resume entry instead of inventing a second authority.
- **checkGate is intentionally unchanged** — `finish`'s only prerequisite is `rebase`, whose
  verdict was correctly satisfied in the #532 incident; prereq-level verdict checks cannot
  block this failure mode (verified during explore).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-11 | Initial generation | DECIDE phase for #532 (verdict-aware resume entry) |
| 2026-07-11 | Clamp named: earliestUnsatisfiedGateIndex in selector.ts (plan update) | Plan located the helper beside selectNextGate to share its skip-aware scan |
