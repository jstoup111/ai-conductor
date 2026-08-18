# Complexity: Shipped-record timing never reaches `measured` (#1260)

Tier: M

## Rationale

Medium, not Small: the change spans four engine modules rather than one — the execution
emission paths that currently drop a terminal event, the `ConductorEvent` union (a new
`partial` reason needs a schema-level home, and interrupt terminals need an `activeInterval`),
`timing-rollup.ts`, and the `shipped-record.ts` / `kpi-report.ts` write-and-read pair that must
stay round-trip compatible. It also carries a real design trade-off worth an ADR (emission
completeness versus reader-side reconciliation, where the cheap option fabricates totals), and
it overlaps in-flight #1477, which touches the same halt emission paths.

Medium, not Large: no new subsystem, no data migration, no external integration, no auth, no
new persistence surface. The execution lifecycle is an existing state machine being made
complete, not a new one. Expected story count is four to five, all against the existing spine.

## Signals

- Models / schemas: one additive event-union change (interrupt terminal + partial reason)
- Integrations: none
- Auth: none
- State machines: existing execution start/terminal lifecycle, completed rather than introduced
- Estimated stories: 4-5
- Backward compatibility: shipped records already committed must still parse
