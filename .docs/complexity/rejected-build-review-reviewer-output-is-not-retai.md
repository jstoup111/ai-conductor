# Complexity: rejected-build-review-reviewer-output-is-not-retai

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One engine-written evidence record (a rejected reviewer response under `.pipeline/`) — no persistent domain model |
| External integrations | None — the record is written from the already-normalized provider invocation result |
| Auth / permission surface | None |
| State machines | None — verdict, retry routing, mechanical-fault accounting, cache, and lap-gate behavior are unchanged |
| Story count | 3 (retain rejected built-in and custom responses; retain the custom prompt; compare cited regions with the frozen input) |
| Files touched | `src/conductor/src/engine/step-runners.ts`, a new `src/conductor/src/engine/build-review-rejection-retention.ts`, `build-review-domain.ts`, `build-review-coordinator.ts`, `build-review-source-region-admission.ts`, `build-review-input-integrity.ts`, `src/conductor/src/types/events.ts`, their tests, and two documentation pages |
| New runtime code | One best-effort record writer, one non-short-circuit region comparison, and one optional event field |

## Rationale

The change is additive, best-effort diagnostics at rejection sites that already exist and already
hold the rejected payload. No accept/reject decision, routing, or allowance logic changes; the only
contract widening is one optional field on an existing event variant and one optional field on an
engine-internal dispatch-failure value. Majority of signals are Small.
→ **Small**. Architecture-diagram, architecture-review, conflict-check, and coherence-check are
skipped for this tier.
