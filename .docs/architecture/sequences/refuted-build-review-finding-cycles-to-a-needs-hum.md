# Sequence: a re-raised build_review finding is refuted and settled, or halts as a genuine repeat

**Last updated:** 2026-09-09
**Scope:** The lap after BUILD attempted a remediation case: the rubric re-raises the same source,
the judge either refutes the claim under the bounded lane or re-proposes action; the engine settles
or halts accordingly and makes the outcome visible.

## Diagram

```mermaid
sequenceDiagram
  participant C as Conductor
  participant J as Raw join
  participant H as RemediationCaseStore
  participant W as Work order
  participant R as Remediate case-v1
  participant V as Validator and reconciler
  participant X as Deferral effect executor
  participant K as Kickback ledger
  participant F as build-review findings CLI
  participant E as Event spine

  C->>J: lap L2 after BUILD attempted case «case-id»
  J-->>C: same source id re-raised, no operator disposition
  C->>H: read prior cases
  C->>W: read attemptedCaseIds
  C->>R: dispatch with prior case «case-id» marked BUILD attempted

  alt judge refutes the re-raised claim
    R-->>V: rebind existingCaseId «case-id» with refutation record (claim, assertion verdicts, anchors, confidence high, optional residual)
    V->>V: existing case is act, open, attempted, effect applied
    V->>V: no prior refutation on «case-id»
    V->>V: every anchor resolves in the tree
    V->>H: resolve «case-id» with refuted terminal and persisted rationale
    V->>E: emit remediation_case_refuted
    opt residual present
      V->>X: reserve deferral effect for the residual
      X-->>V: intake issue filed and applied
    end
    V->>K: charge nothing
    V-->>C: route PASS: all current findings have finalized non-action outcomes
    C->>F: operator runs findings
    F->>H: read case store
    F-->>C: shows «case-id» refuted with the judge rationale
  else judge re-proposes act on «case-id»
    R-->>V: rebind existingCaseId «case-id» with disposition act
    V->>V: classifyRemediationCaseReuse is halt-repeat
    V->>E: emit remediation_semantic_repeat_halt
    V-->>C: HALT needs-human: semantic remediation case repeat «case-id»
  else second refutation of an already refuted case
    R-->>V: rebind «case-id» with another refutation record
    V->>V: refutation bound exceeded for «case-id»
    V-->>C: fail closed: refutation repeat «case-id»
  end
```

## Legend

- **Refuted branch** — the only new path. Every admission check is engine-side and mechanical;
  the judge supplies the judgement, the schema constrains it.
- **Repeat branch** — unchanged from today; proves the lane cannot wave through an unrefuted repeat.
- **Second refutation** — the once-per-case bound; a judge that keeps refuting the same case cannot
  loop.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-09 | Initial generation | DECIDE for jstoup111/ai-conductor#2409 |
