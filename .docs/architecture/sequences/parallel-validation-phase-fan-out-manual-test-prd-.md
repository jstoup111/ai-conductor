# Sequence: SHIP-tail validation fan-out, join, and consolidated kickback (#469)

**Last updated:** 2026-07-10
**Scope:** One daemon dispatch reaching the validation group after `build_review` —
capped concurrent branches, a rate-limit episode mid-flight, one FAIL verdict, and
the single consolidated remediation work order.

## Diagram

```mermaid
sequenceDiagram
    participant RunLoop as run loop
    participant Core as GroupCore
    participant MT as manual_test branch
    participant PA as prd_audit branch
    participant AB as as-built branch
    participant Epi as rate-limit episode
    participant Rem as planRemediation

    RunLoop->>Core: validation group reached after build_review
    Note over Core: resolve members - tier and track skips<br/>cap = validation_concurrency «2»
    Core->>MT: dispatch, fresh session «uuid-1»
    Core->>PA: dispatch, fresh session «uuid-2»
    Note over AB: queued - cap is 2
    PA-->>Epi: 429 - enter(deadline)
    Note over Epi: episode active - siblings pause,<br/>later-deadline-wins
    Epi-->>PA: window clear - retry same budget rules
    MT-->>Core: verdict FAIL - results marker written
    Note over Core: FAIL verdict does NOT cancel siblings -<br/>verdicts join
    Core->>AB: dispatch, fresh session «uuid-3»
    PA-->>Core: verdict PASS - prd-audit marker written
    AB-->>Core: verdict BLOCKED - as-built marker written
    Core->>Core: join - all branches produced verdicts
    Note over Core: if a branch had exited with NO verdict<br/>after its retries, the group fails -<br/>normal step-failure halt path
    Core->>Core: manual_test FAIL - deterministic<br/>build classification, ADR preserved
    Core->>Rem: ONE call - union of as-built gaps<br/>manual_test rows attached as evidence
    Rem-->>Core: dispositions per gap
    Core-->>RunLoop: one consolidated work order, earliest target wins
    Note over RunLoop: all-green case instead - group done,<br/>continue to rebase then finish
```

## Legend

- **Cap** — only `validation_concurrency` (default 2) branches run at once; the third
  member queues until a slot frees.
- **Rate-limit episode** — the existing per-process coordinator; a 429 in any branch
  enters the shared episode so concurrent branches wait for the same window instead
  of independently burning retries.
- **Join policy** — verdicts join, infra fails fast (operator-locked 2026-07-10).
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for #469 spec |
