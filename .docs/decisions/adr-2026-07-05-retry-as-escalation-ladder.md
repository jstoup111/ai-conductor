# ADR 2026-07-05: Retry-as-escalation ladder

Status: APPROVED

Date: 2026-07-05

Context issue: jstoup111/ai-conductor#188 (Fable rollout #186–#194)

## Context

`DEFAULT_STEP_RETRIES` grants deep steps (explore/prd/plan/build) five identical
retries — same model, same effort. Retries are coin-flips: they burn tokens without
changing the odds. The merged #186 added a model **availability** ladder
(`fable → opus → sonnet`, substitute-on-dead). This ADR defines an orthogonal
**escalation** ladder: on retry, deliberately raise capability so a retry actually
changes the odds, and shrink the now-wasteful deep budgets.

## Decision

### 1. Escalation is a pure, attempt-indexed transform on the base config

A new pure function `escalateAttempt(baseModel, baseEffort, attempt, escalate)`
returns the `(model, effort)` for a given 1-based `attempt`. The base
`(model, effort)` from `resolveStepConfig` is never mutated; escalation is a
strict transform layered on top and recomputed each attempt. It reads two new
ordering constants:

- `EFFORT_ORDER = ['low','medium','high','xhigh','max']`
- `MODEL_TIER_ORDER = ['haiku','sonnet','opus','fable']` (ascending capability)

### 2. Effort first, then model; escalation is cumulative and monotonic

- **Attempt 1** — base model, base effort (unchanged).
- **Attempt 2** — base model, effort bumped **one** level up from base.
- **Attempt 3+** — effort stays at the attempt-2 level; model bumped `(attempt − 2)`
  tiers up from base.

Escalation never de-escalates. Bumps are **capped** at the top of each ladder: an
effort already at `max` or a model already at `fable` stays put (a no-op rung, not an
error).

### 3. Model bump expresses *intent*; #186 availability guarantees *liveness*

`escalateAttempt` picks a **target** tier from `MODEL_TIER_ORDER`. It does **not**
call the availability API itself. The existing `StepRunner` path already routes the
chosen model through `ModelAvailability.effectiveModel`, which substitutes a live
model if the target tier is dead. Thus the model bump "honors the #186 fallback
ladder" by construction, with no new wiring. The two ladders are deliberately
separate: `MODEL_TIER_ORDER` ascends for *upgrade-on-retry*; the availability ladder
descends for *substitute-on-dead*.

### 4. Escalating deep-step budgets floor at 3, not 2

`DEFAULT_STEP_RETRIES` for explore/prd/plan/build drops from **5 → 3**. It is **not**
cut to 2: the model-bump rung lives at attempt 3, so a budget of 2 would truncate the
ladder at effort and never exercise the model bump. Three attempts is the minimum
that preserves the full effort-then-model ladder while removing wasted identical
retries. Steps with `escalate: false` may still be tuned lower independently.

### 5. `escalate` is a per-step opt-out, default true

A new optional `escalate?: boolean` on `StepConfig` (threaded through the
`resolveStepConfig` precedence chain, default **true**). When false, every attempt
uses the base `(model, effort)` — identical-retry is preserved for steps where that
is intentional. Default-true means existing configs begin escalating; this is the
intended behavior change and is documented as a migration note.

### 6. Escalation is logged by extending `step_retry`, read by retro Part C

The existing `step_retry` event gains optional `escalatedModel` and
`escalatedEffort` fields carrying the `(model, effort)` the **next** attempt will
use. It is already persisted to `.pipeline/events.jsonl`. `aggregateRetryHotspots`
(retro Part C's feed) is extended to surface how far up each ladder a step climbed.
No new event type is introduced (lower schema surface, backward-compatible).

### 7. Escalation derives from `attempt`, never a separate counter

The retry loop has non-budget-consuming paths (rate-limit, stale session, auth
park-and-poll) that do `attempt--; continue`. Because escalation is a function of
`attempt`, those transient infra retries re-run at the **same** rung — correct,
since they were not quality failures. No independent escalation counter exists to
drift out of sync.

### 8. The exhausted-retries HALT invariant is preserved

The ladder adds no `continue`/`attempt--` of its own. Once the final rung (attempt ==
`max_retries`) fails, the loop exits with `succeeded=false`, writes
`LOOP_HALT_MARKER`, and emits `loop_halt` exactly as today. Escalation changes *how*
attempts run, never *how many*.

## Consequences

- **Positive:** deep steps get cheaper (fewer full-price identical retries), worst-case
  quality rises (a failing step climbs effort then model), and premium models become
  the escape hatch on demonstrated failure rather than a default cost.
- **Positive:** minimal blast radius — one pure function, two constants, one config
  field, one event-field addition; no new subsystem, no availability re-wiring.
- **Negative / watch:** default-on escalation changes existing pipelines' cost/latency
  profile on retries; mitigated by per-step `escalate: false` and the migration note.
- **Negative / watch:** correctness hinges on deriving from `attempt` and on the
  budget floor of 3 — both are asserted by negative-path tests (top-of-ladder,
  opt-out, dead-model composition, non-consuming retries, exhausted-HALT).

## Alternatives considered

- **New `step_escalated` event** instead of extending `step_retry`: rejected —
  touches `ALL_EVENT_TYPES`, the persister, and event unions for no measurement gain.
- **Escalate effort from the *previous* rung** rather than from base: rejected —
  base-relative bumping is order-independent and trivially testable; prior-relative
  bumping couples each rung to loop history and the non-consuming paths.
- **Cut budgets to 2** per the issue's "2–3" upper text: rejected — unreachable model
  rung (see Decision 4). Acceptance criterion is satisfied at 3 (≤3).
