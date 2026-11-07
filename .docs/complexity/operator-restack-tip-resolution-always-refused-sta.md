# Complexity: Operator restack --tip resolution always refused stale on a stacked feature (#3582, folding #3557 and #3576)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One durable record: a ref-backed halt record for features in the stacked-child lifecycle. Conflict-record lifecycle changes on a stale resolution |
| External integrations | None. Resolver environment delivery reaches every provider through the existing invocation options |
| Auth / permission surface | None |
| State machines | Stale-resolution outcome changes: the restack halt carries a fresh conflict record. The journal states are unchanged |
| Data loss exposure | A resolver-settled restack can silently drop a child's commits today, which the first task closes |
| Cross-cutting | The halt-marker seam serves every halting feature, and the record readers span restack recovery, cursor resolution and operator routing |

## Rationale

Three approved ADRs change (committed halt record, operator-recorded restack resolution, restack journaled replay), the record seam moves for stacked features, and an unsafe outcome silently loses work. Full architecture review is warranted.
