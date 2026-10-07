# Components: Remediation dispositions on an engine-owned contract

**Last updated:** 2026-10-07
**Scope:** Proposed migration of the `remediate` gap-plan boundary for #2522. Current production
dispatches `remediate` without a native schema and reads `.pipeline/remediation.json` through the
tolerant, mtime-gated `readRemediationPlanResult`. The shipped as-built (#2188) and PRD-audit
(#2521) migrations are the local precedent. The existing PRD-widening reconciliation mode of
`remediate` already uses the native-schema seam and is unchanged; the build_review case-v1/v2
adjudication mode keeps its own contract and reader and is out of scope.

## Diagram

```mermaid
graph TD
    subgraph Sources["Existing remediation sources"]
        PRDV["Typed PRD verdict: FIXABLE criteria with engine criterion ids"]
        ABV["Typed as-built verdict: REMEDIABLE findings, engine-stamped ids"]
        UNTYPED["Untyped sources by existing keys: finish verification, build stall"]
    end
    subgraph Context["Existing worktree authorities"]
        PLAN["Active plan: task ownership"]
        PRIOR["Prior remediation decisions, pending repairs, refusal decisions"]
        VOCAB["Code-owned disposition vocabulary and target steps"]
    end
    subgraph Engine["Conductor engine"]
        PROJECTION["Versioned, bounded remediation projection"]
        DISPATCH["Existing provider-aware one-shot dispatch"]
        CONTRACT["Engine-owned disposition schema and reference validation"]
        PERSIST["Stamp current attempt; persist validated plan"]
        STORE["Typed remediation plan: sole disposition authority"]
        READER["Single typed-plan reader"]
        FAULT["Field-specific mechanical fault"]
        SPINE["Existing event spine: rejection diagnostics and halts"]
    end
    subgraph Providers["Existing provider adapters"]
        CLAUDE["Claude native structured output"]
        CODEX["Codex native structured output"]
    end
    subgraph Downstream["Existing planRemediation semantics: preserved"]
        ADMIT["Sealed redirect, admission and existing-task binding"]
        BUDGET["Growth and lap budgets"]
        AUTH["Operator authority on DECIDE re-entry"]
        REPAIR["Pending-repair receipt, idempotent charge, no-op guard"]
    end
    SKILL["Remediate skill: judgment guidance only"]
    PRDV --> PROJECTION
    ABV --> PROJECTION
    UNTYPED --> PROJECTION
    PLAN --> PROJECTION
    PRIOR --> PROJECTION
    VOCAB --> PROJECTION
    VOCAB --> CONTRACT
    PROJECTION --> DISPATCH
    CONTRACT --> DISPATCH
    SKILL -. role instructions .-> DISPATCH
    DISPATCH --> CLAUDE
    DISPATCH --> CODEX
    CLAUDE -- terminal structured dispositions --> CONTRACT
    CODEX -- terminal structured dispositions --> CONTRACT
    CONTRACT -- every required reference accounted for --> PERSIST
    PERSIST --> STORE
    STORE --> READER
    READER --> ADMIT
    ADMIT --> BUDGET
    BUDGET --> AUTH
    AUTH --> REPAIR
    PROJECTION -- missing or over-limit required input --> FAULT
    DISPATCH -- unsupported capability or missing result --> FAULT
    CONTRACT -- missing, duplicate, foreign or malformed reference; unknown disposition --> FAULT
    FAULT --> SPINE
```

## Ownership and boundaries

- The engine owns the projection, the schema, the disposition vocabulary, validation, and
  persistence. The vocabulary has one definition in code; neither the skill nor the prompt
  defines accepted values or the wire format.
- The projection names every required reference. For typed sources these are structural ids:
  PRD-audit `criterionId` and engine-stamped as-built finding ids. Untyped sources are projected
  by their existing keys; no new identity scheme is introduced for them.
- Validation accounts for every required typed reference exactly once. Missing, duplicate,
  foreign or malformed references and unknown dispositions or categories are mechanical faults
  that name the field. A schema-invalid response is never treated as a successful partial plan,
  and never becomes a substantive BLOCKED or halt judgment.
- #2187 rejection diagnostics (`remediation_disposition_rejected`) remain observable on the
  existing event spine for every rejected entry.
- One typed reader feeds `planRemediation`. Everything downstream of validation (sealed
  redirect, admission, budgets, operator authority, pending-repair idempotence, no-op guard) keeps
  its current semantics; this migration changes the boundary, not the rules.
- Restart and replay read the persisted plan for the current attempt. A file from a prior
  attempt, or a legacy prose-authored `remediation.json`, never substitutes for the current
  dispatch's validated result.
- The skill keeps judgment guidance and stays usable interactively; format prose is removed and
  a contract audit rejects its reintroduction.
- No new provider option, daemon channel, finding-history store, cross-gate policy, or generic
  step-contract registry is introduced.

## Related flows

- [Successful plan](sequences/remediation-typed-plan-success.md)
- [Missing or invalid output](sequences/remediation-typed-plan-fault.md)
- [Restart and legacy plan handling](sequences/remediation-typed-plan-restart.md)

## Legend

Solid arrows carry existing authority, structured dispositions, or typed evidence. The dotted
arrow supplies judgment guidance. Components sit inside the existing engine process; no
deployable service is added.

Event-spine verdict: no new telemetry channel. The validated plan is durable state (exception C);
fault and rejection occurrences use the existing ConductorEvent spine and halt path.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-06 | Initial target component diagram | Operator selected approach A for #2522 |
| 2026-10-06 | Drop build_review case from untyped sources | Architecture review: case mode never enters `planRemediation` |
| 2026-10-07 | Refusal decisions projected as a typed `refusal` reference kind | OD-5: validator rejects foreign/duplicate/malformed refusal refs; completeness stays with refusal-rework admission |
