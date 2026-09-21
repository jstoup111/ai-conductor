# Components: Sweep tier-2 conflict judgement under engine verification

**Last updated:** 2026-09-20
**Scope:** Proposed change to the mergeable sweep's autoresolve path for #2607. Extends the existing daemon process; no new deployment, data store, or telemetry channel. The finish-time rebase path is shown only to mark it as unchanged.

## Diagram

```mermaid
graph TD
  Sweep["Mergeable sweep"] --> Elig["Eligibility gates"]
  Registry["Watch registry entry with escalation cause"] --> LabelClear["Conflict-caused stale label clear"]
  Elig --> LabelClear
  Escalate --> Registry
  LabelClear --> GitHub["GitHub pull request"]
  Elig --> Tier1["Tier 1 mechanical resolution"]
  Tier1 --> Scope["Engine test-only conflict classification"]
  Scope --> Tier2["Tier 2 resolver dispatch, judgement only when test-only"]
  Tier2 --> Skill["Shared rebase skill"]
  Finish["Finish-time rebase, strict mode unchanged"] --> Skill
  Skill --> Verdict["Schema-bound resolution verdict"]
  Verdict --> Validate["Engine verdict validation"]
  Validate --> Guards["Work-preservation guards, declared drops only"]
  Guards --> SuiteGate["Suite gate"]
  SuiteGate --> Publish["Lease-protected publish"]
  Publish --> Audit["Resolution audit comment"]
  Audit --> GitHub
  Validate --> Escalate["Escalation with diagnostic detail"]
  Guards --> Escalate
  SuiteGate --> Escalate
  Escalate --> GitHub
  Validate --> Events["Existing event emitter and persister"]
  Publish --> Events
  Escalate --> Events
```

## Sequence: a supersession conflict resolved without the operator

```mermaid
sequenceDiagram
  participant SW as Mergeable sweep
  participant AR as Autoresolve engine
  participant RS as Tier 2 resolver
  participant GH as GitHub pull request

  SW->>GH: read label and mergeable state
  alt label present, recorded cause is conflict, no longer conflicting, no halt marker
    SW->>GH: remove stale escalation label
  end
  SW->>AR: dispatch eligible conflicting pull request
  AR->>AR: tier 1 leaves conflicts
  AR->>AR: classify conflicted paths as test-only or not
  AR->>RS: dispatch, judgement exception in force only when test-only
  RS->>RS: capture source and upstream intent
  alt any conflicted path is not test code, or resolver cannot choose
    RS-->>AR: unresolved with competing intents
    AR->>GH: escalate with diagnostic detail
  else resolver can choose
    RS-->>AR: verdict with choice, rationale, declared superseded commits
    AR->>AR: validate verdict against schema and replayed commits
    AR->>AR: preservation guards accept only declared drops
    AR->>AR: run suite gate
    alt verification passes
      AR->>GH: lease-protected push
      AR->>GH: post audit comment naming choice and verification
    else verification fails
      AR->>GH: escalate, nothing published
    end
  end
```

## Responsibilities and limits

The resolver owns the judgement the machinery cannot make: which side's intent survives when both changed the same lines, including declaring a replayed commit superseded by upstream. It makes that judgement only when dispatched by the sweep and only when the engine has established that every conflicted path is test code; a conflict touching any non-test path keeps today's stop. The finish-time rebase invokes the same skill in today's strict mode and still halts at the first ambiguity.

The engine owns everything checkable. It validates the verdict's shape, classifies the conflict as test-only using the existing test-path convention, confirms every declared-superseded commit is one the rebase actually replayed and touched only test paths, lets the work-preservation guard excuse exactly those commits and no others, runs the suite gate, and publishes only after it passes. An undeclared missing commit fails the guard as it does today. The audit comment names the choice, the rationale, and the verification that passed, so a publication without a named passing verification cannot occur.

The sweep owns label hygiene for the escalations it caused. Autoresolve records the escalation cause on the existing watch registry entry. A `needs-remediation` label whose recorded cause is conflict resolution, on a pull request that is no longer conflicting and carries no halt marker, is stale, and the sweep removes it before evaluating eligibility; labels written for CI exhaustion, setup stops, or halted builds are never touched, so an operator or a later main that clears the conflict restores eligibility without a manual label edit.

Escalation keeps today's diagnostic detail. It fires when any conflicted path is not test code and the resolver cannot settle it under the strict contract, when the verdict is malformed, when a guard rejects the result, or when the suite fails.

## Legend

- "Sweep judgement mode" and "strict mode" are two invocations of one shared skill, selected by the dispatching path.
- "Declared drops" are replayed commits the verdict names as superseded by upstream.
- All observation rides the existing `ConductorEvent` spine; no sidecar file or second channel is introduced.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-20 | Initial generation | DECIDE for #2607 |
| 2026-09-20 | Narrowed judgement to test-only conflicts; label clear keyed on recorded cause | Architecture review ADR sweep, operator decision |
