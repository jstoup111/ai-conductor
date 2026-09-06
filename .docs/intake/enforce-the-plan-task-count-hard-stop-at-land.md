# Intake origin: enforce-the-plan-task-count-hard-stop-at-land

Source-Ref: jstoup111/ai-conductor#1645
Owner: jstoup111

## Desired outcome

- A plan exceeding the hard-stop threshold cannot reach BUILD as an ordinary plan — the author or
  operator has to make an explicit, recorded decision first.
- When a large plan does proceed, the decision and its rationale are durably readable afterward by
  someone who was not present, without relying on the authoring agent having remembered to write it.
- A plan inside the normal band is unaffected — no new prompt, no new artifact, no added step.
- The thresholds are observable from one place, so a reader can tell what the current boundaries are
  without inferring them from prose that no code reads.
