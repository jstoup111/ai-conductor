# Complexity: parallel validation with serial, fenced publication (#922)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | One existing SHIP loop boundary gains a redirect; no new persisted state |
| Story count | 1 technical story with concurrent happy paths and six negative/safety paths |
| Files touched | Existing step registry and conductor loop, focused acceptance/unit/integration fixtures, ADR/story/plan/diagram |
| New runtime code | One bounded finish pre-dispatch fence reusing existing group membership and verdict machinery |
| Decisions / conflicts | Rebase-tail ADR supersession plus a narrow amendment separating #532 navigation override from publication authority |

## Rationale

The production change is localized to an existing registry edge and the common finish pre-dispatch
branch, with no new schema, configuration, integration, event type, or durable token. It is not
Small because the safety invariant crosses normal, resume, pre-loop rebase, changed-rebase, and
explicit `fromStep` paths, and must preserve the validation group's capped parallel join. The
acceptance matrix and compatibility updates span several mature engine behaviors. It is not Large
because ownership remains inside the existing conductor, validation group, completion predicates,
and verdict store. → **Tier M.**
