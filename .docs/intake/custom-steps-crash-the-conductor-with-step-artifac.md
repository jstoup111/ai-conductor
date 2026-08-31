# Intake origin: custom-steps-crash-the-conductor-with-step-artifac

Source-Ref: jstoup111/ai-conductor#1840
Owner: jstoup111

## Desired outcome

- A pipeline containing config-declared custom steps runs those steps through `inline --from`
  without crashing.
- A step with no artifact contract resolves to an empty artifact set rather than throwing, in the
  same way built-in steps that declare `[]` already do.
- If a step genuinely must have a contract, the failure names the step and points at what to
  declare, instead of surfacing as `TypeError: ... is not iterable`.
- The condition is covered by a test that runs a custom step through the crashing path, so a future
  built-in-only assumption cannot reintroduce it.
