# Sequence: Coherence check from intake claim to land verdict

**Last updated:** 2026-07-22
**Scope:** The end-to-end flow for intake jstoup111/ai-conductor#539 — early outcome
persistence, mapping authoring, and the deterministic land-time validation with waiver
and duplicate-claim handling.

## Diagram

```mermaid
sequenceDiagram
    participant OP as Operator
    participant ENG as Engineer session (skills)
    participant WT as Per-idea worktree .docs/
    participant LAND as engineer land (deterministic)
    participant GH as GitHub (intake issue)

    ENG->>GH: claim intake idea
    GH-->>ENG: text + Source-Ref + Desired-outcome bullets
    ENG->>WT: NEW stage outcomes in gitignored .pipeline/<br/>(Source-Ref + outcome bullets — no committed file yet)
    Note over ENG,WT: DECIDE runs: explore → complexity → prd →<br/>architecture → stories → conflict-check → plan
    ENG->>WT: NEW /coherence-check (tier M/L — skipped for S,<br/>L pins opus) authors .docs/coherence/«plan-stem».md<br/>(outcome→story→task rows, verdicts)
    OP->>LAND: conduct-ts engineer land
    LAND->>WT: existing ladder (guards, C2, DRAFT-ADR, tier)
    LAND->>WT: NEW (tier ≠ S) parse coherence artifact (fail-closed if absent/unparseable)
    LAND->>WT: NEW cross-check row ids vs real stories/plan/intake files
    LAND->>WT: NEW duplicate check: Source-Ref vs default-branch .docs/intake markers
    LAND->>WT: NEW commit staged outcomes inside .docs/intake/«plan-stem».md
    alt chain coherent (or every gap named by fresh-in-diff waiver)
        LAND->>WT: commit .docs on spec/«slug» branch
        LAND-->>OP: land OK → handoff opens spec PR
    else unwaived gap / orphan task / unmapped outcome / duplicate claim
        LAND-->>OP: fail-closed reject with per-gap report<br/>(worktree kept for inspection)
        OP->>ENG: fix artifact or author waiver naming the gap
    end
```

## Legend

- `«…»` — variable placeholder (slug, plan stem).
- "NEW" marks steps introduced by this feature; all NEW land-side steps are pure code
  (no model dependency at the landing boundary).
- Technical-track and no-intake specs run the same sequence with the FR layer or the
  outcome layer omitted from the mapping (never treated as a gap — PRD FR-10/FR-11).
- A trivially coherent spec takes the happy branch with zero added operator
  interaction (PRD FR-12).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE-phase design for intake #539 |
