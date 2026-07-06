# Architecture: manual_test FAIL routing (ai-conductor#367)

Tail-loop routing after this change. New elements marked with `*`.

```mermaid
flowchart TD
    B[build] --> MT[manual_test gate]
    MT -->|results fresh, no FAIL rows, fix-evidence ok| NEXT[prd_audit / as-built / finish]
    MT -->|FAIL rows| RETRY{retries left?}
    RETRY -->|yes| MT
    RETRY -->|no, daemon, budget left| KB[*kickback to build with FAIL evidence hint]
    KB --> B
    RETRY -->|no, budget exhausted or not daemon| HALT[*HALT - gating, no silent skip]
    MT -->|PASS rewrite but HEAD unchanged since recorded FAIL| WG[*whitewash guard refuses]
    WG --> RETRY
```

State machine of the fix-evidence marker (`.pipeline/manual-test-fail-evidence.json`):

```mermaid
stateDiagram-v2
    [*] --> none
    none --> observed : gate sees FAIL rows, records headSha
    observed --> observed : more FAILs, sha refreshed
    observed --> cleared : FAIL-free AND head moved past recorded sha
    observed --> refused : FAIL-free AND head unchanged
    refused --> observed : next attempt
    cleared --> [*]
```
