# Complexity: per-project-work-tracker-backend-selection-in-regi

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One config block (`tracker`) plus a resolved `TrackerSelection` value |
| External integrations | None new; GitHub path unchanged, Jira fails closed until #849 |
| Auth / permission surface | `tracker.credentials` is a reference only and must never hold a token (ADR #846, #158 amendment) |
| State machines | None |
| Story count | ~5 (config validation, zero-migration invariance, per-project poll selection, write-back routing, Jira fail-closed) |
| Files touched | ~6 production (`types/config.ts`, `engine/config.ts`, `engine/engineer-cli.ts`, a new tracker-selection module, docs) plus tests |
| New runtime code | Yes — a resolver and a composite intake source/port in the composition root |

## Rationale

Medium: a new consumer-visible config key with validation, a behavioral change at the single intake
composition root that every compose/claim/land/handoff path passes through, and an additive
amendment to the APPROVED canonical-tracker-client ADR for the Jira-only `site`/`project_key`
fields. It is not Large: no new external integration, no data migration, and the GitHub path must
stay byte-for-byte identical, which bounds the design space. Lightweight architecture review.
