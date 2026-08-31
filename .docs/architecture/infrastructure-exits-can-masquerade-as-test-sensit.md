# Components + Sequence: neutral counterfactual exit facts, reviewer-owned sensitivity (#2051)

**Last updated:** 2026-08-30
**Scope:** the testQuality counterfactual evidence path — how the preflight stops asserting
sensitivity from a bare nonzero exit, and how the sensitivity judgement becomes a
schema-constrained field of the reviewer's result contract (v3 → v4) that the engine
validates and persists.

## Diagram

```mermaid
graph TD
    PF["build-review-test-quality-preflight.ts<br/>counterfactual scoped run"]
    FACT["neutral mechanical fact:<br/>exitCode + runKind + bounded excerpt<br/>(nonzero exit no longer implies sensitivity)"]
    PROJ["build-review-projections.ts<br/>input projection v2 (unchanged shape,<br/>carries the neutral evidence)"]
    SKILL["skills/build-review-test-quality/SKILL.md<br/>reviewer judgement: reads excerpt,<br/>decides what the nonzero exit shows"]
    RES["result contract v4<br/>build-review-domain.ts<br/>new field: counterfactualSensitivity<br/>supports | indeterminate | not-applicable"]
    VAL["engine validation<br/>(closed vocabulary; rejects a v4 result<br/>missing or malforming the field)"]
    ENV["judged envelope + build-review-cache.ts<br/>contractVersion 'v4' persisted"]
    GATE["outer testQuality verdict<br/>step-runners.ts / coordinator<br/>weighs findings; 'indeterminate' supplies<br/>no sensitivity support and no finding"]

    PF --> FACT
    FACT --> PROJ
    PROJ --> SKILL
    SKILL --> RES
    RES --> VAL
    VAL --> ENV
    ENV --> GATE
```

```mermaid
sequenceDiagram
    participant PF as counterfactual preflight
    participant PJ as projection (v2)
    participant RV as testQuality reviewer
    participant EN as engine (v4 validator)
    participant CA as cache/envelope
    participant GV as gate verdict

    PF->>PF: scoped run on reverted checkout
    Note over PF: nonzero exit recorded as fact:<br/>exitCode, excerpt — no RED claim
    PF->>PJ: typed evidence (neutral)
    PJ->>RV: closed input incl. excerpt
    RV->>RV: judge excerpt:<br/>examples failed on reverted behavior?<br/>or environment never came up?
    RV->>EN: findings + counterfactualSensitivity
    EN->>EN: validate closed vocabulary (v4)
    EN->>CA: stamp judged envelope contractVersion v4
    CA->>GV: persisted verdict + sensitivity field
    Note over GV: indeterminate ⇒ neither sensitivity<br/>support nor a finding by itself
```

## Legend

- **neutral mechanical fact** — the preflight keeps recording exactly what is true on every
  test runner: exit code, run kind, bounded head/tail excerpt. The `exitCode !== 0 ⇒ red`
  fiat at `build-review-test-quality-preflight.ts:455` is retired; the classification value
  becomes descriptive (`nonzero-exit`) rather than evidentiary.
- **counterfactualSensitivity** — the reviewer's schema-constrained judgement of what the
  nonzero exit shows: `supports` (assertions/examples failed because reverted production
  matters — preserves #1593's collection-failure case), `indeterminate` (bootstrap, auth,
  or infrastructure died before intended tests ran — the #1915 shapes), `not-applicable`
  (exit zero / no counterfactual). No per-framework output parsing exists anywhere in the
  engine — the judgement call sits with the LLM, the bookkeeping with machinery.
- **fail-closed validation** — a v4 result missing the field, or using a value outside the
  closed vocabulary, is rejected exactly like any other malformed rubric result today.
- **verdict weighing** — `indeterminate` can never supply positive sensitivity evidence nor
  become a finding; the reviewer must still cite a concrete stub-passable assertion to raise
  `test-insensitive`, unchanged from v3.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-30 | Initial generation | DECIDE for #2051 (approach D) |
