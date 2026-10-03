# Complexity: build-step-completes-with-every-plan-task-still-pe

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One persisted per-task content fingerprint on seeded task rows |
| External integrations | None |
| Auth / permission surface | None |
| State machines | Extends the existing repair-obligation lifecycle (#2355) with a new admission source |
| Story count | ~3 (stale-trailer reopen, pending-task naming, clean all-complete pass) |
| Files touched | Engine: task seeding, task resolution / repair obligations, build completion predicate reason, related tests |
| New runtime code | Yes — evidence semantics of the `build` step completion predicate |

## Rationale

Changes the evidence rule that decides whether the `build` step is complete, by adding an admission
source to the existing repair-obligation machinery and persisting a per-task fingerprint. It touches
a load-bearing gate and an existing ADR-governed mechanism, so it needs a lightweight architecture
review, but it adds no integration, schema surface outside `.pipeline/`, or new subsystem. → **Medium.**
