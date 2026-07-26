# Sequence: post-merge reconciliation and historical backfill (#916)

**Last updated:** 2026-07-25
**Scope:** Recovery when a merged implementation PR lacks its record and the one-time repository
audit. Both paths fail closed on uncertain plan-to-PR association.

## Diagram

```mermaid
sequenceDiagram
  participant GH as GitHub merged PR event
  participant A as Reconcile Action
  participant Q as Audit and association resolver
  participant V as Strict evidence verifier
  participant B as Base branch plans and stories
  participant R as Existing record generator
  participant RP as Record-only repair PR
  participant S as Stable shipped-record status
  participant O as Operator
  participant M as Protected main

  GH->>A: pull_request closed with merged=true
  A->>Q: audit merged PR and candidate «slug»
  Q->>B: find plan/spec and existing shipped record
  Q->>GH: corroborate implementation PR association + merged SHA
  alt matching record already exists
    Q-->>A: aligned, no mutation
  else association proven and record missing
    Q->>R: render record from plan/stories + merged PR evidence
    R->>RP: create or update idempotent record-only PR
    A->>V: verify exact repair head
    V-->>A: valid or typed refusal
    A->>S: post matching success/failure on repair head
    RP-->>O: request human review
    O->>RP: approve and merge
    RP->>M: durable record lands
  else association ambiguous or evidence malformed
    Q-->>A: report unresolved candidate, write nothing
    A-->>GH: visible failed reconciliation result
  end

  Note over Q,M: One-time historical backfill uses the same resolver
  Q->>B: enumerate every plan/spec without same-stem record
  Q->>GH: load every merged-PR history page
  loop each historical candidate
    Q->>GH: prove associated merged implementation PR
    alt proven missing record
      Q->>R: generate record for this feature branch
    else absent or ambiguous evidence
      Q->>Q: report and skip, never fabricate or overwrite
    end
  end
  Q->>Q: persist complete/incomplete machine report before success
  R-->>M: verified backfill records ride this feature's human-reviewed PR
```

## Legend

- The post-merge Action handles bypasses and legacy races; it opens a repair PR rather than
  pushing directly or auto-merging.
- Existing accurate records are immutable. Repeated Action runs converge on the same repair PR or
  no-op once the record lands.
- The creating Action posts the stable status after verifying the exact repair head, so token-created
  repair PRs remain human-mergeable without relying on a recursive PR event.
- Historical backfill is broader than the local processed ledger: it begins with every plan/spec,
  then writes only where the merged implementation association is proven.
- A failed/ambiguous reconciliation is observable but non-destructive.
- Record rendering keeps the current schema and hash/story-resolution semantics; historical identity
  migration is not part of repair or backfill.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial generation | Automate detection and PR authoring while preserving human merge approval |
| 2026-07-25 | Added repair-head status and durable audit report | `/plan` fixed retry/status behavior and complete-history proof before backfill success |
| 2026-07-25 | Preserved current record identity semantics | Scope reduction treats #943 as valid and avoids an unrelated historical hash migration |
