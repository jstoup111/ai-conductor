# Components + Sequence: coverage claims bound to `Done when` (#2088)

**Last updated:** 2026-08-31
**Scope:** how a criterion→task coverage claim is grounded before BUILD. Two mechanisms on both
claim surfaces (the coherence artifact's criterion rows at M/L, the plan's own coverage table at
S): a mechanical land-time contract that the claim quotes a check from the cited task's
`Done when` block, and a config-gated (default off) fresh-context binding judge that runs as an
engine-native BUILD-phase step before `build` and halts to DECIDE when the cited check does not
assert the criterion.

## Diagram

```mermaid
graph TD
    subgraph AUTHOR["DECIDE authoring (composer session)"]
        CC["skills/coherence-check/SKILL.md<br/>criterion row (M/L): quote MUST be<br/>a check from the cited task's Done when"]
        PL["skills/plan/SKILL.md §7<br/>## Coverage Check table (S):<br/>criterion | task | Done-when quote | disposition"]
    end

    subgraph LAND["engineer land (deterministic, offline)"]
        DW["plan-task-parse.ts<br/>parsePlanTaskDoneWhen<br/>(per-task Done when checks)"]
        CV["coherence-validator.ts<br/>checkCriterionCoverage: quote substring<br/>scoped to Done when, not whole body<br/>gap id criterion:quote-not-done-when:«n»"]
        CT["coherence-validator.ts<br/>checkCoverageTableConsistency:<br/>parses the criterion-shaped table<br/>and applies the same quote rule (all tiers)"]
    end

    subgraph DISPATCH["daemon dispatch → BUILD phase (engine-native step)"]
        CFG["config: coverage_binding.judge.enabled<br/>default false → step reports 'disabled'"]
        SCOPE["binding-judge inputs:<br/>one (criterion, cited task Done when) pair<br/>per claim — nothing else"]
        JUDGE["fresh one-shot judge session<br/>(build_review grader pattern:<br/>fresh uuid, resume:false, model ladder)"]
        VER["schema-constrained verdict<br/>asserts | does-not-assert<br/>+ missingAssertion text"]
        PERSIST[".pipeline/coverage-binding.json<br/>+ ConductorEvent occurrences<br/>via the existing spine"]
        HALT["HALT needs-human DECIDE<br/>names criterion, task, and the<br/>task's actual Done when"]
        BUILD["build step"]
    end

    CC --> CV
    PL --> CT
    DW --> CV
    DW --> CT
    CV -->|"quote grounded in Done when"| MERGE["merged spec PR"]
    CT -->|"quote grounded in Done when"| MERGE
    MERGE --> CFG
    CFG -->|"enabled"| SCOPE
    CFG -->|"disabled (default)"| BUILD
    SCOPE --> JUDGE
    JUDGE --> VER
    VER --> PERSIST
    PERSIST -->|"every claim asserts"| BUILD
    PERSIST -->|"any does-not-assert"| HALT
```

```mermaid
sequenceDiagram
    participant AU as coherence-check / plan (author)
    participant LD as engineer land
    participant DP as parsePlanTaskDoneWhen
    participant DM as daemon dispatch
    participant JG as binding judge (one-shot)
    participant EN as engine (schema validator)
    participant BD as build

    AU->>LD: claim row: criterion, task-«id», quote
    LD->>DP: Done when checks for task-«id»
    DP-->>LD: 2-5 enumerated checks
    alt quote is a substring of a Done when check
        LD-->>AU: land proceeds
    else quote absent from Done when
        LD-->>AU: reject criterion:quote-not-done-when:«n»<br/>names criterion, task, and the task's checks
    end
    LD->>DM: merged spec, dispatched
    alt coverage_binding.judge.enabled = false (default)
        DM->>BD: step 'disabled' — proceed
    else enabled
        loop each claim
            DM->>JG: (criterion, task Done when) only
            JG-->>EN: asserts | does-not-assert + missingAssertion
            EN->>EN: validate closed vocabulary, persist
        end
        alt all asserts
            DM->>BD: proceed
        else any does-not-assert
            DM->>DM: HALT needs-human DECIDE<br/>criterion + task + actual Done when
        end
    end
```

## Legend

- **Done-when scoping (mechanical)** — today `checkCriterionCoverage` proves only that the quoted
  text exists somewhere in the cited task's body. The contract narrows the search to the output of
  `parsePlanTaskDoneWhen` for that task, so a claim must point at a falsifiable completion check.
  The rejection is a coverage-shaped gap with a stable id in the existing waiver vocabulary.
- **S-tier surface** — the plan's `## Coverage Check` table gains the same three-cell shape
  (criterion | task | Done-when quote | disposition) and the same quote and disposition rules, checked at land at every tier;
  Small specs currently have no parsed claim surface at all.
- **binding judge (judgement)** — the question "does this check assert this criterion" is
  judgement-shaped. Machinery scopes the inputs to one pair per claim and persists the verdict; the
  LLM answers only that question, output constrained to a closed vocabulary the engine validates.
  Runs at every dispatch, so a coverage amendment made after land is re-judged.
- **default off** — the step is config-gated and ships disabled; a follow-up PR flips the default
  after this spec lands. Disabled reports success with a `disabled` output, mirroring the
  `build_review` gate-disabled branch, so no existing build path changes behavior.
- **placement** — a BUILD-phase engine-native step after `plan`/`coherence_check` and before
  `acceptance_specs`/`build`, not tier-skippable. It is not inside `land`, honoring
  `adr-2026-07-22-coherence-gate-placement-and-validation-split`'s rejection of a model
  dependency at land; that ADR is amended to place the step.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-31 | Initial generation | DECIDE for #2088 (approach C, judge default off) |
| 2026-08-31 | Plan-update pass: S rows are four cells (disposition added); halt rides step_refused/loop_halt; two step-specific events | /plan §8b for #2088 |
