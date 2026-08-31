# Sequence: Verdict Table plan-task citation resolution (#2064)

**Last updated:** 2026-08-30
**Scope:** prd_audit report parse citing an engine-appended remediation task, before and after
the resolver seam.

## Diagram

```mermaid
sequenceDiagram
  participant Audit as prd_audit report
  participant Parser as artifacts.ts Verdict Table parser
  participant Resolver as resolveArtifactReference (new)
  participant Plan as active plan id set

  Audit->>Parser: row S1.6 with Plan task "rem-prd-audit-rem-s1-6-1 (landed)"
  Note over Parser: TODAY: Number(cell) → NaN → row rejected,<br/>mechanical halt regenerates identically
  Parser->>Resolver: raw cell
  Resolver->>Resolver: strip tolerated annotation "(landed)"
  Resolver->>Resolver: validate H9 grammar [A-Za-z0-9._-]+
  Resolver->>Plan: is "rem-prd-audit-rem-s1-6-1" a member?
  alt id present in plan
    Plan-->>Resolver: yes
    Resolver-->>Parser: resolved id
    Parser-->>Audit: row accepted
  else id absent
    Plan-->>Resolver: no
    Resolver-->>Parser: diagnostic naming criterion + unresolvable id
    Parser-->>Audit: row rejected with actionable reason
  end
```

## Legend

- «…» — variable segment placeholder.
- The "TODAY" note shows the defect path this feature removes.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-30 | Initial generation | DECIDE for #2064 |
