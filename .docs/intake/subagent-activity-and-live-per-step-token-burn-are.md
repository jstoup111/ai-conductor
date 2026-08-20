# Intake origin: subagent-activity-and-live-per-step-token-burn-are

Source-Ref: jstoup111/ai-conductor#1441
Owner: jstoup111

## Desired outcome

- While a step runs, operator-visible status reports how many child units of work are active.
- A child finishing is distinguishable from the step waiting on its completion condition.
- Live per-step uncached input and output token consumption is visible while the step runs, not only after `finish`.
- When child activity cannot be determined, status says so explicitly rather than rendering a count that silently means "unknown".
