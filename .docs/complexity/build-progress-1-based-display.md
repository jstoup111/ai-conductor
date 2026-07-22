# Complexity: Build progress display should be 1-based

Tier: S

## Signals

| Signal | Value |
| --- | --- |
| New models / schema | none |
| Integrations | none |
| Auth / permissions | none |
| State machines | none (accounting/gate logic untouched) |
| New event fields | none (transform reads existing `resolved`/`total`/`currentTaskId`/`currentTaskName`) |
| Story count | 2 (one happy multi-scenario, one negative-boundary) |
| Surfaces touched | 4 render sites + 1 shared helper (all display-layer) |

## Rationale

This is a presentation-only relabelling of an existing telemetry line. The change
is confined to the string-formatting seams in `daemon-cli.ts` and
`create-renderer.ts`, backed by one small pure helper. No data model, no API, no
gate/accounting change, no cross-service coordination. The event payload and the
`BuildProgressWatcher` computation are unchanged.

Per the engineer/conduct flow, a Small (S) tier **skips** architecture-diagram,
architecture-review, and conflict-check. No ADR is required.

## Boundary risk (assessed, not deferred)

The only non-trivial concern is the boundary (outcome 3): the transform must not
turn a completed `N/N` into `N+1/N`. This is contained by keying the `+1` on the
presence of an in-progress task and clamping the numerator to `total`
(`Math.min(resolved + (hasCurrent ? 1 : 0), total)`). Fully expressible as a
negative-path acceptance test — see stories. No architectural review needed.
