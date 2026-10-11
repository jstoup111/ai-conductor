# Components + Sequence: one plan compiler as the only task-structure parser (#623)

**Last updated:** 2026-10-10
**Scope:** how a plan's task structure (ids, titles, dependency edges, declared paths,
`Done when`, story ids, verify-only, slices, bodies, digests) reaches every engine consumer.
Today ~51 call sites read it through `plan-task-parse.ts` / `autoheal.ts` parsers, and at least
six engine modules carry their own ad-hoc task-heading regexes. After this change one module,
the plan compiler, is the only code that recognizes a task heading. It has two modes, chosen by
a format marker the `/plan` skill stamps into new plans: **strict** (closed grammar, any
violation is a named compile error) and **legacy** (today's tolerant grammar, outputs identical
to today's parsers, including task digests). Plans stay authored Markdown; no JSON is committed.

## Diagram

```mermaid
graph TD
    subgraph AUTHOR["DECIDE authoring"]
        PS["skills/plan/SKILL.md<br/>stamps Plan-Format marker,<br/>one canonical task-heading shape"]
        MD[".docs/plans/«stem».md<br/>(sealed, Markdown, human narrative)"]
        PS --> MD
    end

    subgraph COMPILER["plan compiler (new single parser module)"]
        DET["mode detection:<br/>Plan-Format marker present → strict<br/>absent → legacy"]
        STRICT["strict grammar<br/>closed heading shape + required fields<br/>→ PlanTasks or CompileError list"]
        LEGACY["legacy views (one per current consumer)<br/>each reproduces that consumer's<br/>today behavior exactly, quirks included<br/>digests byte-identical"]
        PT["PlanTasks (typed, frozen)<br/>ordered tasks: id, title, deps,<br/>paths, doneWhen, stories, verifyOnly,<br/>slice, body, digest"]
        MEMO["in-process memo<br/>keyed by sha256 of plan text"]
        DET --> STRICT
        DET --> LEGACY
        STRICT --> PT
        LEGACY --> PT
        PT --> MEMO
    end

    subgraph GATES["authoring-time and discovery-time refusal"]
        LAND["engineer/land-spec.ts<br/>refuses strict CompileErrors<br/>(replaces done-when / task-count /<br/>slice regex validators)"]
        DISC["daemon-backlog.ts discovery<br/>warn-skips merged spec on CompileError<br/>(replaces planHasDependencyTree regex)"]
    end

    subgraph BUILD["build-time consumers (read PlanTasks only)"]
        SEED["task-seed / task-progress<br/>completion, #2929 reopen by digest<br/>compile failure → one needs-human halt"]
        EVID["autoheal evidence + per-task commit floor<br/>task attribution, park"]
        REV["build_review inputs, scope deps,<br/>test bindings, adjudication"]
        COV["coherence-validator, coverage binding,<br/>prd_audit / as-built projections"]
        REM["remediation-append<br/>renders canonical task Markdown,<br/>re-compiles to confirm the append"]
        SEAL["protected-artifact-seal<br/>remediation-tail check uses<br/>compiler, not its own regex"]
    end

    MD --> DET
    PT --> LAND
    PT --> DISC
    MEMO --> SEED
    MEMO --> EVID
    MEMO --> REV
    MEMO --> COV
    REM -->|"appended Markdown"| MD
    REM --> SEAL
    SEAL --> DET
    LAND -->|"clean compile"| MERGE["merged spec PR on main"]
    MERGE --> DISC
```

```mermaid
sequenceDiagram
    participant PL as /plan skill (author)
    participant LD as engineer land
    participant CP as plan compiler
    participant DS as daemon discovery
    participant BD as build consumers
    participant RA as remediation-append
    participant SL as protected-artifact seal

    PL->>LD: plan.md with Plan-Format marker
    LD->>CP: compile(plan text)
    alt strict mode, clean
        CP-->>LD: PlanTasks
        LD-->>PL: land proceeds
    else strict mode, violations
        CP-->>LD: CompileError list (line, task, rule)
        LD-->>PL: refuse land, name every error
    end
    DS->>CP: compile(main's plan text)
    alt unmarked legacy plan
        CP-->>DS: PlanTasks + legacy-mode warning
    else CompileError
        CP-->>DS: errors
        DS-->>DS: warn-skip spec, name errors
    end
    BD->>CP: compile(worktree plan text)
    CP-->>BD: memoized PlanTasks (ids, deps, paths,<br/>Done when, digests ...)
    RA->>RA: render remediation tasks in canonical shape
    RA->>CP: compile(plan + appended tail)
    CP-->>RA: PlanTasks including appended ids
    RA->>SL: amendment
    SL->>CP: compile tail, compare against recorded ids
    SL-->>RA: accept only recorded appended tasks
```

## Legend

- **Plan compiler:** the new single module. No other engine module may match a task heading;
  every caller uses its typed `PlanTasks` (or `CompileError` list).
- **Strict / legacy:** the format marker (a plain non-heading line before the first task
  heading) selects the mode. Legacy mode exists only so plans authored before the marker
  (in-flight builds, merged-unbuilt specs, consumer plans) keep working unchanged: it is a set of
  named legacy views, one per current consumer interpretation, because today's parsers disagree
  with one another. Its removal is a later, separate feature.
- **Build-time halt:** a marked plan that stops compiling mid-build raises one `needs-human`
  halt at plan read naming every error; no consumer treats a compile failure as an empty plan.
- **Module layout (from the plan):** `src/conductor/src/engine/plan-compiler/` holds `compilePlan`,
  the marker, legacy views, strict grammar, dependencies, digests, and `checkPlan`. `checkPlan`
  applies the engine's appended-task record after compilation and enforces authored-task required
  fields. The existing `plan-task-parse.ts` and `autoheal.ts` exports become adapters over
  `compilePlan` that throw `PlanCompileFailure` on a failed compile.
- **In-process memo:** a pure cache keyed by the plan text's sha256. Nothing is written to disk,
  so no derived artifact can go stale or trip the `.docs/plans` seal.
- **Digest identity:** for an unchanged legacy plan, the compiler's task digests equal today's
  `planTaskDigests` output byte for byte, so the #2929 reopen flow does not fire on upgrade.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | #623 — replace drifting task-heading regexes with one two-mode plan compiler |
