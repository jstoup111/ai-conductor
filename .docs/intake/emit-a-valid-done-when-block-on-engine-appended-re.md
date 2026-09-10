# Intake origin: emit-a-valid-done-when-block-on-engine-appended-re

Source-Ref: jstoup111/ai-conductor#1802
Owner: jstoup111

## Desired outcome
- A plan that the engine has appended remediation tasks to satisfies the same land-time shape rule
  as a hand-authored plan, whatever order the two run in.
- A hand-authored task that genuinely lacks criteria is still rejected, with the task id named.
- If a shape violation on engine-authored content is ever reported, the message distinguishes it
  from an authoring mistake.
