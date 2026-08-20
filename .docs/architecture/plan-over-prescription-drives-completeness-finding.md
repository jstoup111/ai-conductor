# Components: Preservation-Anchored Completeness Exception (#1580)

**Last updated:** 2026-08-16
**Scope:** The evidence flow for the first closed Completeness exception ("preservation
maintenance") — a plan-side behavior-level preservation form, its deterministic engine parse
(`plan-task-parse.ts`), the build_review source snapshot (`build-review-inputs.ts`), the
Completeness rubric's v2 projection (`build-review-projections.ts`), and the rubric judgement
contract in `skills/build-review-completeness/SKILL.md`.

Deliberately **not** in scope: `build-review-prompt.ts`. The rubric fan-out
(`build-review-registry.ts`) dispatches each rubric to its own SKILL.md against a versioned
projection; `buildGraderPrompt` is no longer on the live dispatch path (referenced only from
tests and comments), so the exception contract lands in the rubric skill, not the monolithic
prompt.

## Diagram

```mermaid
graph TD
    subgraph Authoring["DECIDE authoring contract"]
        PLAN["/plan task block<br/>NEW: Preserves: «behavior»<br/>behavior-level, never named test cases"]
        PSKILL["skills/plan/SKILL.md<br/>NEW: authoring form + boundary —<br/>state the behavior that must survive,<br/>not the cases that carry it today"]
    end

    subgraph Parse["Deterministic engine parse"]
        PPP["parsePlanTaskPreserves<br/>plan-task-parse.ts<br/>NEW — fail-closed clause parse,<br/>shape mirrors parsePlanTaskVerifyOnly"]
        PVO["parsePlanTaskVerifyOnly<br/>autoheal.ts:638<br/>existing sibling parser (#1579)"]
    end

    subgraph Inputs["build-review-inputs.ts"]
        BRI["BuildReviewSourceSnapshot<br/>NEW: preservationContext —<br/>task id + preserved-behavior clause"]
        RC["removalContext<br/>deriveBuildReviewRemovals<br/>existing — deleted files,<br/>removed exports, removed members"]
    end

    subgraph Proj["build-review-projections.ts"]
        P2["Completeness projection v2<br/>NEW field, additively —<br/>same versioning move #1579 made<br/>for verifyOnlyContext"]
    end

    subgraph Rubric["skills/build-review-completeness/SKILL.md"]
        DOC["CHANGED line 24 doctrine:<br/>removalContext ceases to be<br/>'never an exemption' —<br/>it anchors one closed exception"]
        EXC["NEW closed exception:<br/>preservation maintenance<br/>(3-condition per-clause predicate)"]
    end

    JUDGE["Completeness judgement<br/>per preserved behavior:<br/>(1) engine block names the clause<br/>(2) removal evidence shows this<br/>diff moved or deleted its carrier<br/>(3) NO equivalent assertion survives<br/>anywhere post-diff → finding"]

    VERDICT[("judged result v1<br/>no finding: coverage relocated<br/>with equivalent assertions<br/>FINDING: behavior genuinely absent")]

    TAUT["skills/build-review-tautology/SKILL.md<br/>existing exception 3 'fixture relocation'<br/>— the asymmetry this feature closes"]

    PSKILL -.->|"author follows form"| PLAN
    PLAN --> PPP
    PPP --> BRI
    RC --> P2
    BRI --> P2
    P2 --> JUDGE
    DOC --> EXC
    EXC --> JUDGE
    JUDGE --> VERDICT
    TAUT -.->|"same diff, opposite verdict<br/>before this feature"| JUDGE
    PVO -.->|"parser shape precedent"| PPP
```

## Legend

- **NEW** / **CHANGED** — surfaces added or altered by this feature; everything else exists today.
- Solid arrows: data/evidence flow. Dotted arrows: contract, precedent, or the defect being closed.
- The engine block is *evidence, not exemption* — the same doctrine as the #1521 removal anchor and
  the #1579 verify-only anchor. The rubric still applies a closed per-clause predicate; a preserved
  behavior with no surviving equivalent assertion still produces a Completeness finding.
- The negative path is condition (3): relocation alone never exempts. A deleted carrier whose
  assertions were not re-established anywhere is exactly the case this rubric must keep failing.
- Excluded by operator scope decision: the task-count warning band (outcome 3) and a non-human
  resolution path for over-specified plans (outcome 4).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-16 | Initial generation | DECIDE phase for #1580 |
