# Complexity Assessment: retry-as-escalation

Tier: M

## Signals

| Signal | Reading |
|--------|---------|
| New models / DB / persistence | None. Reuses existing `.pipeline/events.jsonl`. |
| External integrations | None new. Composes with the already-merged #186 availability ladder (in-process). |
| Auth / identity | None. |
| State machines | Modifies **one** existing control-flow loop (the conductor step retry loop) — adds an attempt-indexed escalation transform; does not add a new state machine. |
| Config schema change | Yes — one additive, optional, back-compatible field (`escalate`) on `StepConfig`, plus known-key allow-list + boolean validation. |
| New shared primitives | Two small ordering constants (effort order, model-tier order) + one pure escalation function. |
| Event-schema change | Yes — extend the existing `step_retry` event with optional escalation fields; extend the retro aggregator that reads them. |
| Cross-subsystem reach | Retry loop (conductor) + config resolution + event persistence/aggregation + docs. Bounded, but more than one file/subsystem. |
| Story count | ~9–11 (happy + dense negative paths at each ladder boundary). |

## Verdict

**Medium.** Not Small: it changes core control flow (the retry loop that every
autonomous step depends on), a persisted config schema, and a persisted event
schema — each with correctness-critical negative paths (top-of-ladder, opt-out,
dead-model composition, exhausted-retries-still-HALT). Not Large: no new models,
data stores, external integrations, auth, or new state machines; the blast radius
is one loop plus additive schema/logging and documentation.

Because the tier is non-Small, the DECIDE phase runs `architecture-diagram`,
`architecture-review` (lightweight for Medium), and `conflict-check` — all present
in this spec.
