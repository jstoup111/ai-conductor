# Complexity: daemon-redispatch-loses-committed-task-progress-af

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None (local git trailer scan already exists) |
| Auth / permission surface | None |
| State machines | Task-status row recovery semantics change (missing-row restore, stale in_progress reset) |
| ADR impact | Additive amendment to `adr-2026-09-06-reopened-task-resolution` (reconstruction vs ordinary reseed distinction) |
| Story count | 2 behaviors with happy + negative criteria, plus acceptance-test restoration |
| Files touched | `engine/task-seed.ts`, `engine/conductor.ts` (`seedBuildTaskTelemetry`), `test/acceptance/daemon-death-resume.acceptance.test.ts`, task-seed unit tests |

## Rationale

The code change is small and confined to `seedTaskStatus` and its pre-BUILD dispatch caller,
but it changes durable recovery semantics that an APPROVED ADR explicitly constrains
(reconstruction distinct from ordinary reseeding; open repairs never restored as completed).
Changing an approved state-transition rule warrants Medium: a lightweight architecture review
with an additive ADR amendment, conflict-check against in-flight task-status work, and a
coherence mapping.
