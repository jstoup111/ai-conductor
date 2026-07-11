# Component Diagram: Evidence-Gate Task-Id Grammar Unification (#417)

**Last updated:** 2026-07-07
**Scope:** The build-evidence derivation path (plan → trailers → gate verdict), the two
skill contracts that feed it, and where the #417 fix lands: one id grammar declared at the
skill layer, trailer discipline at COMMIT, the engine-side `task-«id»` alias in
`deriveCompletion`, and the operator-gated recovery path for parked features.

## Diagram

```mermaid
graph TD
    subgraph SKILLS["Skill layer (contracts)"]
        TDD["skills/tdd/SKILL.md<br/>COMMIT step: Task trailer = plan id<br/>NEW: reject subject-names-task without trailer<br/>NEW: Evidence forms live in empty commits"]
        PIPE["skills/pipeline/SKILL.md<br/>Dispatch injects Task: «plan id»<br/>NEW: task-N spelling banned in trailers"]
    end

    subgraph BUILD["Build worktree (git history)"]
        COMMITS["Feature commits<br/>Task: «id» trailers"]
        NOOP["Verification-only tasks<br/>empty commit with Task: «id»<br/>plus Evidence: satisfied-by «sha»"]
    end

    subgraph ENGINE["Engine (src/conductor)"]
        PLAN["parsePlanTaskPaths<br/>plan headers → bare ids 1..N"]
        DERIVE["deriveCompletion (autoheal.ts)<br/>trailer-first exact match<br/>NEW: task-«id» alias, ambiguity-guarded"]
        SIDECAR["task-evidence.json sidecar<br/>evidenceStamps"]
        GATE["build completion gate (artifacts.ts)<br/>unresolved tasks → auto-park"]
    end

    subgraph RECOVERY["Recovery (operator-gated)"]
        BACKFILL["Documented backfill procedure<br/>empty commit Task: «id»<br/>Evidence: satisfied-by «real sha»<br/>no history rewrite"]
    end

    TDD -->|"agents stamp trailers"| COMMITS
    TDD -->|"no-op form"| NOOP
    PIPE -->|"injects plan id per dispatch"| COMMITS
    PLAN --> DERIVE
    COMMITS -->|"git log trailers"| DERIVE
    NOOP -->|"git log trailers"| DERIVE
    DERIVE --> SIDECAR
    SIDECAR --> GATE
    BACKFILL -->|"appends honest evidence commits"| COMMITS
```

## Legend

- **Skill layer** — Markdown contracts agents follow; the #417 root cause is a grammar
  split between these contracts and the engine's plan-id source of truth.
- **Engine** — deterministic TypeScript; `deriveCompletion` is the only completion
  authority (H6/H7: task-status.json rows are never trusted).
- **NEW** markers — surfaces this feature changes.
- `«id»` — placeholder for a plan task id (bare, e.g. `7`); `task-«id»` is the legacy
  prefixed spelling the alias accepts only when the plan does not itself declare a
  literal `task-N` id.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | DECIDE phase for #417 (engineer worktree) |
