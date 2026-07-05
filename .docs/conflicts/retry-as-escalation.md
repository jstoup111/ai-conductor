# Conflict Check: retry-as-escalation

Scope: this feature's stories vs. the existing engine behavior and the sibling
Fable-rollout work (#186–#194). **Result: no blocking conflicts.** Interactions are
compositional and documented below.

## Cross-story internal consistency

Stories 1–11 are mutually consistent. The only shared mutable state is the loop's
`attempt` counter; Stories 9 and 10 pin the two invariants that keep it safe
(no extra attempts; non-consuming paths don't advance the rung). No two stories
assert contradictory `(model, effort)` for the same attempt.

## Interaction with sibling / existing features

| Other work | Interaction | Verdict |
|------------|-------------|---------|
| **#186 availability ladder** (merged) | Escalation picks a *target* tier; #186 substitutes a live model downstream. Opposite directions (upgrade-on-retry vs. substitute-on-dead), composed at the existing `effectiveModel` call. | **Compose, no conflict.** Story 8 asserts it. |
| **#190 DECIDE tier overrides** (explore/prd base → fable) | A step whose *base* model is already `fable` gets a no-op model bump (top of ladder) and still escalates effort. Intended. | **Compose.** Story 7 covers top-of-tier. |
| **#189 recovery-step models / rebase stays max** | `rebase` has `max_retries` 1, so its loop never retries and escalation never triggers. Other recovery steps escalate normally from their configured base. | **No conflict.** |
| **conflict_check.L → fable** (retained per operator) | Base fable → model-bump no-op; effort still escalates. | **Compose.** |
| **#193 evaluator two-way switch / #194 effort re-baseline** | Both change *base* model/effort selection; escalation is defined relative to whatever base resolves. Re-baselining base efforts simply shifts the ladder's starting rung. | **Orthogonal.** |

## Budget-reduction blast radius

`DEFAULT_STEP_RETRIES` (explore/prd/plan/build 5→3) has exactly one consumer — the
conductor retry loop (`resolved.max_retries`). No other code path depends on the
literal `5`. Reducing it changes only how many attempts a step gets, which the
escalation ladder is designed around (floor 3 keeps the model rung reachable).
**No downstream conflict.**

## Schema / event compatibility

- **`escalate` on `StepConfig`** must be added to the `knownStepKeys` allow-list in the
  same change, or config validation rejects it. This is a **required co-change**, not a
  conflict — flagged so the plan sequences it.
- **`step_retry` new optional fields** (`escalatedModel`, `escalatedEffort`) are
  additive; existing consumers (`EventPersister`, `aggregateRetryHotspots`) read by key
  and ignore unknown fields. Backward-compatible with historical `.pipeline/events.jsonl`
  lines that lack the fields. **No conflict.**

## State / resource contention

None. No new files, locks, ports, or persistent state. Escalation is a pure function
of the in-loop `attempt` counter; the availability dead-set is the pre-existing
per-process state already owned by #186.

## Required co-changes (sequenced in the plan, not conflicts)

1. Add `escalate` to `knownStepKeys` + boolean validation (else valid configs break).
2. Add ladder prose to HARNESS.md **outside** the generated-table markers (else the
   test 5a drift check fails).
3. CHANGELOG `## Migration` note for the default-on behavior change + opt-out.
