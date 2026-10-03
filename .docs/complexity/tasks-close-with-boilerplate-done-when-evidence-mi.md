# Complexity: tasks-close-with-boilerplate-done-when-evidence-mi

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One inline Done-when test tag; a structured test-reference evidence form; a third close-record source (`unverified`) beside `reported` / `verify-only` |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None new — reuses task close, build_review mechanical findings, and existing remediation laps |
| Story count | ~5 (tag + land validation, verified test close, generic-evidence refusal, unverified close to build_review, remediation tagging) |
| Files touched | Engine: plan-task-parse / plan-done-when, task-progress + task-cli, remediation-append, build_review mechanical findings input; skills: plan, pipeline |
| New runtime code | Yes — task-close evidence semantics on opted-in plans |

## Rationale

Changes the evidence rule at BUILD task close and adds one input to build_review, amending the
approved `adr-2026-08-22-done-when-evidence-at-task-close`. It spans plan authoring, the land gate,
task close, and remediation generation, but adds no subsystem, integration, or persisted schema
outside `.pipeline/` task records. Needs a lightweight architecture review. → **Medium.**
